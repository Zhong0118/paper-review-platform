from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.expert.models import Expert, ExpertConflict
from app.modules.files.models import FileObject
from app.modules.thesis.models import Thesis, ThesisVersion, ThesisVersionFile
from app.modules.user.models import StudentEligibility, TenantUserMembership, User
from app.modules.workflow import service as workflow_service
from app.shared.enums import ExpertTaskStatus, FilePurpose, RoleCode, RoundStatus, ThesisStage


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def _round_for(session: AsyncSession, thesis_id: UUID) -> ReviewRound | None:
    return (
        await session.execute(
            select(ReviewRound).where(ReviewRound.thesis_id == thesis_id).order_by(ReviewRound.round_no.desc())
        )
    ).scalars().first()


def serialize_round(round_: ReviewRound | None) -> dict | None:
    if round_ is None:
        return None
    return {"id": str(round_.id), "status": round_.status, "round_no": round_.round_no}


async def confirm_dispatch(session: AsyncSession, user: CurrentUser, thesis: Thesis, expected_version: int, request_id: str | None) -> ReviewRound:
    if thesis.stage != ThesisStage.READY_FOR_DISPATCH:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许确认送出")
    if expected_version != thesis.version:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    existing = await _round_for(session, thesis.id)
    if existing:
        return existing
    version = await session.get(ThesisVersion, thesis.current_version_id)
    if version is None:
        raise AppError("VALIDATION_FAILED", 422, "缺少论文版本")
    round_ = ReviewRound(
        tenant_id=thesis.tenant_id,
        thesis_id=thesis.id,
        thesis_version_id=version.id,
        round_no=1,
        status=RoundStatus.CREATED,
        discipline_code=version.discipline_code,
        discipline_name=version.discipline_name,
    )
    session.add(round_)
    await audit_service.record(
        session,
        user=user,
        action="confirm_dispatch",
        object_type="thesis",
        object_id=str(thesis.id),
        detail={"fee_freeze_skipped": "slice2"},
        request_id=request_id,
    )
    await session.flush()
    return round_


async def list_candidates(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> list[dict]:
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None:
        raise _hidden()
    version = await session.get(ThesisVersion, thesis.current_version_id)
    elig = (
        await session.execute(
            select(StudentEligibility).where(
                StudentEligibility.student_membership_id == thesis.student_membership_id,
                StudentEligibility.review_batch_id == thesis.review_batch_id,
            )
        )
    ).scalar_one_or_none()
    supervisor_name = (elig.supervisor_name if elig else "") or ""
    experts = (await session.execute(select(Expert, User).join(User, User.id == Expert.user_id))).all()
    items = []
    for expert, usr in experts:
        codes = expert.discipline_codes or []
        mismatch = version is not None and version.discipline_code not in codes
        avoided = bool(supervisor_name) and (
            supervisor_name in (usr.display_name or "") or (usr.display_name or "") in supervisor_name
        )
        conflicts = (
            await session.execute(select(ExpertConflict).where(ExpertConflict.expert_id == expert.id))
        ).scalars()
        for conflict in conflicts:
            if conflict.kind == "SUPERVISOR_NAME" and conflict.value == supervisor_name:
                avoided = True
        items.append(
            {
                "expert_id": str(expert.id),
                "username": usr.username,
                "display_name": usr.display_name,
                "discipline_codes": codes,
                "direction_mismatch": mismatch,
                "avoided": avoided,
                "service_status": expert.service_status,
            }
        )
    return items


async def assign(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expert_id: UUID, request_id: str | None) -> tuple[Thesis, ExpertTask]:
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = (await session.execute(select(Thesis).where(Thesis.id == thesis_id).with_for_update())).scalar_one_or_none()
    if thesis is None:
        raise _hidden()
    if thesis.stage not in {ThesisStage.READY_FOR_DISPATCH, ThesisStage.UNDER_REVIEW}:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许派单")
    round_ = await _round_for(session, thesis.id)
    if round_ is None:
        raise AppError("STATE_TRANSITION_DENIED", 409, "请先由学校确认送出")
    expert = await session.get(Expert, expert_id)
    if expert is None or expert.service_status != "AVAILABLE":
        raise _hidden()
    version = await session.get(ThesisVersion, thesis.current_version_id)
    if version and version.discipline_code not in (expert.discipline_codes or []):
        raise AppError("STATE_TRANSITION_DENIED", 409, "专家擅长方向与送审专业不一致")
    usr = await session.get(User, expert.user_id)
    elig = (
        await session.execute(
            select(StudentEligibility).where(StudentEligibility.student_membership_id == thesis.student_membership_id)
        )
    ).scalar_one_or_none()
    supervisor_name = (elig.supervisor_name if elig else "") or ""
    if supervisor_name and usr and supervisor_name in (usr.display_name or ""):
        raise AppError("STATE_TRANSITION_DENIED", 409, "命中回避关系")
    live = (
        await session.execute(
            select(ExpertTask).where(
                ExpertTask.round_id == round_.id,
                ExpertTask.expert_id == expert.id,
                ExpertTask.status.in_([ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW]),
            )
        )
    ).scalar_one_or_none()
    if live:
        raise AppError("STATE_TRANSITION_DENIED", 409, "该专家已有有效任务")
    task = ExpertTask(
        tenant_id=thesis.tenant_id,
        round_id=round_.id,
        expert_id=expert.id,
        status=ExpertTaskStatus.INVITED,
        invited_at=datetime.now(timezone.utc),
    )
    session.add(task)
    round_.status = RoundStatus.ACTIVE
    if thesis.stage == ThesisStage.READY_FOR_DISPATCH:
        await workflow_service.transition(
            session,
            thesis=thesis,
            to_stage=ThesisStage.UNDER_REVIEW,
            action="assign_first_task",
            actor=user,
            request_id=request_id,
        )
    await session.flush()
    return thesis, task


async def expert_for_user(session: AsyncSession, user_id: UUID) -> Expert:
    expert = (await session.execute(select(Expert).where(Expert.user_id == user_id))).scalar_one_or_none()
    if expert is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    return expert


async def get_task_for_expert(session: AsyncSession, user: CurrentUser, task_id: UUID) -> ExpertTask:
    if user.role != RoleCode.EXPERT:
        raise _hidden()
    expert = await expert_for_user(session, user.id)
    task = await session.get(ExpertTask, task_id)
    if task is None or task.expert_id != expert.id:
        raise _hidden()
    return task


async def accept_task(session: AsyncSession, user: CurrentUser, task_id: UUID) -> ExpertTask:
    task = await get_task_for_expert(session, user, task_id)
    if task.status != ExpertTaskStatus.INVITED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许接受")
    task.status = ExpertTaskStatus.IN_REVIEW
    task.decided_at = datetime.now(timezone.utc)
    await session.flush()
    return task


async def reject_task(session: AsyncSession, user: CurrentUser, task_id: UUID, reason: str) -> ExpertTask:
    if not reason.strip():
        raise AppError("VALIDATION_FAILED", 422, "拒绝必须填写原因")
    task = await get_task_for_expert(session, user, task_id)
    if task.status != ExpertTaskStatus.INVITED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许拒绝")
    task.status = ExpertTaskStatus.REJECTED
    task.reject_reason = reason.strip()
    task.decided_at = datetime.now(timezone.utc)
    await session.flush()
    return task


async def list_expert_tasks(session: AsyncSession, user: CurrentUser) -> list[dict]:
    expert = await expert_for_user(session, user.id)
    tasks = list((await session.execute(select(ExpertTask).where(ExpertTask.expert_id == expert.id))).scalars())
    items = []
    for task in tasks:
        round_ = await session.get(ReviewRound, task.round_id)
        version = await session.get(ThesisVersion, round_.thesis_version_id) if round_ else None
        items.append(
            {
                "id": str(task.id),
                "status": task.status,
                "anonymous_id": str(task.id)[:8],
                "anonymous_title": (version.title if version else "匿名论文") or "匿名论文",
                "discipline_code": round_.discipline_code if round_ else "",
                "discipline_name": round_.discipline_name if round_ else "",
                "allowed_actions": ["ACCEPT_TASK"] if task.status == ExpertTaskStatus.INVITED else [],
            }
        )
    return items


async def invitation(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    task = await get_task_for_expert(session, user, task_id)
    round_ = await session.get(ReviewRound, task.round_id)
    version = await session.get(ThesisVersion, round_.thesis_version_id) if round_ else None
    return {
        "id": str(task.id),
        "status": task.status,
        "discipline_code": round_.discipline_code if round_ else "",
        "discipline_name": round_.discipline_name if round_ else "",
        "anonymous_title": (version.title if version else "匿名论文") or "匿名论文",
        "anonymous_id": str(task.id)[:8],
        "fee": "未启用",
    }


async def materials(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    task = await get_task_for_expert(session, user, task_id)
    if task.status != ExpertTaskStatus.IN_REVIEW:
        raise _hidden()
    round_ = await session.get(ReviewRound, task.round_id)
    if round_ is None:
        raise _hidden()
    rows = (
        await session.execute(
            select(ThesisVersionFile, FileObject)
            .join(FileObject, FileObject.id == ThesisVersionFile.file_id)
            .where(
                ThesisVersionFile.thesis_version_id == round_.thesis_version_id,
                ThesisVersionFile.purpose == FilePurpose.ANONYMOUS,
            )
        )
    ).all()
    return {
        "task_id": str(task.id),
        "files": [{"file_id": str(obj.id), "purpose": link.purpose, "filename": obj.original_filename} for link, obj in rows],
    }


async def school_progress(session: AsyncSession, thesis: Thesis) -> dict:
    round_ = await _round_for(session, thesis.id)
    counts = {"invited_count": 0, "in_review_count": 0, "rejected_count": 0}
    if round_:
        tasks = (await session.execute(select(ExpertTask).where(ExpertTask.round_id == round_.id))).scalars()
        for task in tasks:
            if task.status == ExpertTaskStatus.INVITED:
                counts["invited_count"] += 1
            elif task.status == ExpertTaskStatus.IN_REVIEW:
                counts["in_review_count"] += 1
            elif task.status == ExpertTaskStatus.REJECTED:
                counts["rejected_count"] += 1
    return {"thesis_id": str(thesis.id), "stage": thesis.stage, **counts}


async def dispatch_queue(session: AsyncSession, user: CurrentUser) -> list[dict]:
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    theses = (await session.execute(select(Thesis).where(Thesis.stage.in_([ThesisStage.READY_FOR_DISPATCH, ThesisStage.UNDER_REVIEW])))).scalars()
    items = []
    for thesis in theses:
        elig = (
            await session.execute(
                select(StudentEligibility).where(StudentEligibility.student_membership_id == thesis.student_membership_id)
            )
        ).scalar_one_or_none()
        version = await session.get(ThesisVersion, thesis.current_version_id)
        items.append(
            {
                "thesis_id": str(thesis.id),
                "stage": thesis.stage,
                "student_name": elig.student_name if elig else "",
                "title": version.title if version else "",
                "discipline_code": version.discipline_code if version else "",
            }
        )
    return items
