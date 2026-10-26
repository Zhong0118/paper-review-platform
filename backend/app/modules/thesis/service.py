from app.shared.time_scope import apply_thesis_scope
from starlette.concurrency import run_in_threadpool
from app.modules.files.pdf import validated_bytes
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser
from app.modules.files.models import FileObject
from app.modules.tenant.models import DisciplineCatalog, Organization, ReviewBatch, Tenant
from app.modules.thesis import sensitive_terms
from app.modules.thesis.models import AnonymizationCheck, Thesis, ThesisVersion, ThesisVersionFile
from app.modules.user.models import StudentEligibility, TenantUserMembership
from app.modules.workflow import service as workflow_service
from app.modules.workflow.models import WorkflowEvent
from app.shared.enums import AnonymizationConclusion, FilePurpose, RoleCode, ThesisStage


class DraftInput(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    abstract: str = ""
    discipline_code: str
    discipline_name: str
    keywords: list[str] = Field(default_factory=list)


class SubmitInput(BaseModel):
    version: int


class WithdrawInput(BaseModel):
    version: int
    reason: str = ""


class ConfirmInput(BaseModel):
    decision: str
    version: int
    reason: str | None = None


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


def _normalize_keywords(keywords: list[str]) -> list[str]:
    seen: list[str] = []
    for raw in keywords:
        item = raw.strip()
        if item and item not in seen:
            seen.append(item)
    if not (1 <= len(seen) <= 5):
        raise AppError("VALIDATION_FAILED", 422, "关键词需 1 至 5 个且去重")
    return seen


async def _eligibility_for_student(session: AsyncSession, user: CurrentUser) -> StudentEligibility:
    from app.modules.tenant import service as tenant_service

    if user.role != RoleCode.STUDENT or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    candidate, _ = await tenant_service.current_student_eligibility(session, user.id, user.tenant_id)
    batch = await tenant_service.get_batch(session, user.tenant_id, candidate.review_batch_id, lock=True)
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.id == candidate.student_membership_id,
                TenantUserMembership.user_id == user.id,
                TenantUserMembership.tenant_id == user.tenant_id,
                TenantUserMembership.membership_type == "STUDENT",
            ).with_for_update().execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    elig = (
        await session.execute(
            select(StudentEligibility).where(
                StudentEligibility.id == candidate.id,
                StudentEligibility.tenant_id == user.tenant_id,
                StudentEligibility.student_membership_id == candidate.student_membership_id,
                StudentEligibility.review_batch_id == batch.id,
            ).with_for_update().execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if membership is None or not membership.is_active or elig is None or elig.status != "ELIGIBLE" or batch.status != "OPEN":
        raise AppError("ACCESS_DENIED", 403, "当前没有有效送审资格")
    return elig


async def _require_discipline(session: AsyncSession, code: str, name: str) -> None:
    row = (await session.execute(select(DisciplineCatalog).where(DisciplineCatalog.code == code))).scalar_one_or_none()
    if row is None or row.name != name or not row.is_active:
        raise AppError("VALIDATION_FAILED", 422, "送审专业必须选自受控目录")


async def _latest_check(session: AsyncSession, thesis: Thesis) -> AnonymizationCheck | None:
    versions = (
        await session.execute(select(ThesisVersion.id).where(ThesisVersion.thesis_id == thesis.id))
    ).scalars()
    ids = list(versions)
    if not ids:
        return None
    return (
        await session.execute(
            select(AnonymizationCheck)
            .where(AnonymizationCheck.thesis_version_id.in_(ids))
            .order_by(AnonymizationCheck.created_at.desc())
        )
    ).scalars().first()


async def _events(session: AsyncSession, thesis_id: UUID) -> list[WorkflowEvent]:
    return list(
        (
            await session.execute(
                select(WorkflowEvent)
                .where(WorkflowEvent.thesis_id == thesis_id)
                .order_by(WorkflowEvent.created_at.asc())
            )
        ).scalars()
    )


def allowed_actions(
    role: str,
    thesis: Thesis,
    check: AnonymizationCheck | None,
    submitted_before: bool,
    *,
    has_open_objection: bool = False,
    stale_check: bool = False,
) -> list[str]:
    actions: list[str] = []
    if role == RoleCode.STUDENT:
        if thesis.stage == ThesisStage.DRAFT:
            actions.extend(["EDIT_THESIS", "SUBMIT_THESIS"])
            if not submitted_before:
                actions.append("DELETE_DRAFT")
        if thesis.stage in {ThesisStage.SUBMITTED, ThesisStage.PREPARING, ThesisStage.READY_FOR_DISPATCH}:
            actions.append("WITHDRAW_BEFORE_DISPATCH")
        if thesis.stage == ThesisStage.COMPLETED and not has_open_objection:
            actions.append("SUBMIT_OBJECTION")
    if role == RoleCode.SCHOOL_REVIEWER and thesis.stage == ThesisStage.PREPARING:
        if not stale_check and check is not None and check.auto_conclusion != AnonymizationConclusion.FAIL:
            actions.append("CONFIRM_ANONYMIZATION")
        actions.append("REJECT_ANONYMIZATION")
    if role == RoleCode.SCHOOL_REVIEWER and thesis.stage == ThesisStage.READY_FOR_DISPATCH:
        actions.append("CONFIRM_DISPATCH")
    if role == RoleCode.SCHOOL_REVIEWER and thesis.stage == ThesisStage.RESULT_PROCESSING:
        actions.append("PUBLISH_RESULT")
    if role == RoleCode.SCHOOL_REVIEWER and thesis.stage not in {ThesisStage.COMPLETED, ThesisStage.TERMINATED}:
        actions.append("TERMINATE")
    return actions


async def serialize_thesis(session: AsyncSession, user: CurrentUser, thesis: Thesis) -> dict:
    version = await session.get(ThesisVersion, thesis.current_version_id) if thesis.current_version_id else None
    files = []
    if version:
        rows = (
            await session.execute(
                select(ThesisVersionFile, FileObject)
                .join(FileObject, FileObject.id == ThesisVersionFile.file_id)
                .where(ThesisVersionFile.thesis_version_id == version.id)
            )
        ).all()
        files = [
            {"file_id": str(f.id), "purpose": link.purpose, "filename": f.original_filename}
            for link, f in rows
        ]
    check = await _latest_check(session, thesis)
    stale_check = await sensitive_terms.is_stale(session, thesis, check)
    events = await _events(session, thesis.id)
    submitted_before = any(e.action == "submit" for e in events)
    has_open_objection = False
    if thesis.stage == ThesisStage.COMPLETED:
        from app.modules.result.objection_models import Objection
        from app.modules.result.objection_service import OPEN_STATUSES

        has_open_objection = (
            await session.execute(
                select(Objection).where(Objection.thesis_id == thesis.id, Objection.status.in_(list(OPEN_STATUSES)))
            )
        ).scalar_one_or_none() is not None
    membership = await session.get(TenantUserMembership, thesis.student_membership_id)
    elig = (
        await session.execute(
            select(StudentEligibility).where(
                StudentEligibility.student_membership_id == thesis.student_membership_id,
                StudentEligibility.review_batch_id == thesis.review_batch_id,
            )
        )
    ).scalar_one_or_none()
    tenant = await session.get(Tenant, thesis.tenant_id)
    org = await session.get(Organization, membership.organization_id) if membership else None
    batch = await session.get(ReviewBatch, thesis.review_batch_id)
    student_block = None
    if user.role in {RoleCode.STUDENT, RoleCode.SCHOOL_REVIEWER, RoleCode.PLATFORM_REVIEWER} and elig:
        student_block = {
            "name": elig.student_name,
            "student_no": elig.student_no,
            "supervisor_name": elig.supervisor_name,
            "degree_type": elig.degree_type,
            "tenant_name": tenant.name if tenant else "",
            "college_name": org.name if org else "",
        }
    return {
        "id": str(thesis.id),
        "stage": thesis.stage,
        "version": thesis.version,
        "return_reason": thesis.return_reason,
        "allowed_actions": allowed_actions(
            user.role, thesis, check, submitted_before, has_open_objection=has_open_objection, stale_check=stale_check
        ),
        "student": student_block,
        "batch_name": batch.name if batch else "",
        "review_batch": {
            "id": str(batch.id), "name": batch.name,
            "end_at": batch.end_at.isoformat() if batch.end_at else None,
        } if batch else None,
        "anonymization": sensitive_terms.serialize_report(check, stale_check),
        "current_version": None
        if version is None
        else {
            "id": str(version.id),
            "title": version.title,
            "abstract": version.abstract,
            "discipline_code": version.discipline_code,
            "discipline_name": version.discipline_name,
            "keywords": version.keywords,
            "is_editable": version.is_editable,
            "files": files,
        },
        "recent_events": [
            {"action": e.action, "from_stage": e.from_stage, "to_stage": e.to_stage, "reason": e.reason}
            for e in events
        ],
    }


async def create_draft(session: AsyncSession, user: CurrentUser, data: DraftInput) -> Thesis:
    elig = await _eligibility_for_student(session, user)
    await _require_discipline(session, data.discipline_code, data.discipline_name)
    from app.modules.tenant.catalog_service import require_school_discipline
    await require_school_discipline(session, user.tenant_id, data.discipline_code)
    keywords = _normalize_keywords(data.keywords)
    existing = (
        await session.execute(
            select(Thesis).where(
                Thesis.tenant_id == elig.tenant_id,
                Thesis.student_membership_id == elig.student_membership_id,
                Thesis.review_batch_id == elig.review_batch_id,
                Thesis.stage != ThesisStage.TERMINATED,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise AppError("VERSION_CONFLICT", 409, "本批次已有有效论文", details={"id": str(existing.id)})
    thesis = Thesis(
        tenant_id=elig.tenant_id,
        student_membership_id=elig.student_membership_id,
        review_batch_id=elig.review_batch_id,
        stage=ThesisStage.DRAFT,
        submission_source="STUDENT",
        version=1,
    )
    session.add(thesis)
    await session.flush()
    version = ThesisVersion(
        thesis_id=thesis.id,
        tenant_id=thesis.tenant_id,
        version_no=1,
        title=data.title,
        abstract=data.abstract,
        discipline_code=data.discipline_code,
        discipline_name=data.discipline_name,
        keywords=keywords,
        is_editable=True,
    )
    session.add(version)
    await session.flush()
    thesis.current_version_id = version.id
    await audit_service.record(
        session, user=user, action="create_draft", object_type="thesis", object_id=str(thesis.id)
    )
    await session.flush()
    return thesis


async def get_student_thesis(
    session: AsyncSession, user: CurrentUser, thesis_id: UUID, *, for_update: bool = False
) -> Thesis:
    thesis = (await session.get(Thesis, thesis_id, with_for_update=True, populate_existing=True)
              if for_update else await session.get(Thesis, thesis_id))
    if thesis is None or user.tenant_id != thesis.tenant_id or user.role != RoleCode.STUDENT:
        raise _hidden()
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.id == thesis.student_membership_id,
                TenantUserMembership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise _hidden()
    return thesis


async def list_student_theses(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None) -> list[Thesis]:
    if user.role != RoleCode.STUDENT or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.user_id == user.id, TenantUserMembership.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        return []
    return list(
        (
            await session.execute(
                apply_thesis_scope(select(Thesis).where(Thesis.student_membership_id == membership.id).order_by(Thesis.created_at.desc()), time_scope, as_of)
            )
        ).scalars()
    )


async def patch_draft(session: AsyncSession, user: CurrentUser, thesis_id: UUID, data: DraftInput) -> Thesis:
    thesis = await get_student_thesis(session, user, thesis_id, for_update=True)
    if thesis.stage != ThesisStage.DRAFT:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许编辑")
    version = await session.get(ThesisVersion, thesis.current_version_id, populate_existing=True)
    if version is None or not version.is_editable:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前版本不可编辑")
    if (version.discipline_code,version.discipline_name) != (data.discipline_code,data.discipline_name):
        await _require_discipline(session, data.discipline_code, data.discipline_name)
        from app.modules.tenant.catalog_service import require_school_discipline
        await require_school_discipline(session, user.tenant_id, data.discipline_code)
    version.title = data.title
    version.abstract = data.abstract
    version.discipline_code = data.discipline_code
    version.discipline_name = data.discipline_name
    version.keywords = _normalize_keywords(data.keywords)
    await session.flush()
    return thesis


async def _clone_editable_version(session: AsyncSession, thesis: Thesis) -> ThesisVersion:
    old = await session.get(ThesisVersion, thesis.current_version_id, populate_existing=True)
    if old is None:
        raise AppError("VALIDATION_FAILED", 422, "缺少论文版本")
    old.is_editable = False
    new = ThesisVersion(
        thesis_id=thesis.id,
        tenant_id=thesis.tenant_id,
        version_no=old.version_no + 1,
        title=old.title,
        abstract=old.abstract,
        discipline_code=old.discipline_code,
        discipline_name=old.discipline_name,
        keywords=old.keywords,
        is_editable=True,
    )
    session.add(new)
    await session.flush()
    files = (
        await session.execute(select(ThesisVersionFile).where(ThesisVersionFile.thesis_version_id == old.id))
    ).scalars()
    for link in files:
        session.add(ThesisVersionFile(thesis_version_id=new.id, thesis_id=thesis.id,
                                      tenant_id=thesis.tenant_id, file_id=link.file_id,
                                      purpose=link.purpose))
    thesis.current_version_id = new.id
    await session.flush()
    return new


async def submit(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expected_version: int, request_id: str | None) -> Thesis:
    locked = await get_student_thesis(session, user, thesis_id, for_update=True)
    elig = (await session.execute(select(StudentEligibility).where(
        StudentEligibility.student_membership_id == locked.student_membership_id,
        StudentEligibility.review_batch_id == locked.review_batch_id,
    ))).scalar_one_or_none()
    if elig is None:
        raise AppError("VALIDATION_FAILED", 422, "论文缺少原批次送审资格")
    if locked.stage != ThesisStage.DRAFT:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许提交")
    version = await session.get(ThesisVersion, locked.current_version_id, populate_existing=True)
    if version is None:
        raise AppError("VALIDATION_FAILED", 422, "缺少论文版本")
    await _require_discipline(session, version.discipline_code, version.discipline_name)
    from app.modules.tenant.catalog_service import require_school_discipline
    await require_school_discipline(session, user.tenant_id, version.discipline_code)
    files = {
        link.purpose: link
        for link in (
            await session.execute(
                select(ThesisVersionFile).where(ThesisVersionFile.thesis_version_id == version.id)
            )
        ).scalars()
    }
    if FilePurpose.ORIGINAL not in files or FilePurpose.ANONYMOUS not in files:
        raise AppError("VALIDATION_FAILED", 422, "必须上传原始版和匿名版")
    checked = {}
    for purpose in (FilePurpose.ORIGINAL, FilePurpose.ANONYMOUS):
        obj = await session.get(FileObject, files[purpose].file_id, populate_existing=True)
        if obj is None or obj.completed_at is None:
            raise AppError("FILE_NOT_READY", 409, "文件尚未上传完成")
        checked[purpose] = (obj, await run_in_threadpool(validated_bytes, obj))
    await workflow_service.transition(
        session,
        thesis=locked,
        to_stage=ThesisStage.SUBMITTED,
        action="submit",
        actor=user,
        expected_version=expected_version,
        request_id=request_id,
    )
    version.is_editable = False
    version.submitted_at = datetime.now(timezone.utc)
    await workflow_service.transition(
        session,
        thesis=locked,
        to_stage=ThesisStage.PREPARING,
        action="start_anonymization",
        actor=user,
        request_id=request_id,
    )
    anonymous, body = checked[FilePurpose.ANONYMOUS]
    report = await sensitive_terms.create_report(session, user, locked, version, elig, anonymous, body)
    conclusion = report.auto_conclusion
    if conclusion == AnonymizationConclusion.FAIL:
        await workflow_service.transition(
            session,
            thesis=locked,
            to_stage=ThesisStage.DRAFT,
            action="anonymization_failed",
            actor=user,
            reason="ANONYMIZATION_FAILED",
            request_id=request_id,
        )
        await _clone_editable_version(session, locked)
    await audit_service.record(
        session, user=user, action="submit", object_type="thesis", object_id=str(locked.id)
    )
    await session.flush()
    return locked


async def withdraw(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expected_version: int, reason: str) -> Thesis:
    from app.modules.dispatch.models import ReviewRound
    from app.shared.enums import RoundStatus

    locked = await get_student_thesis(session, user, thesis_id, for_update=True)
    await workflow_service.transition(
        session,
        thesis=locked,
        to_stage=ThesisStage.DRAFT,
        action="withdraw",
        actor=user,
        reason=reason or "withdraw",
        expected_version=expected_version,
    )
    await session.execute(update(ReviewRound).where(
        ReviewRound.thesis_id == locked.id,
        ReviewRound.thesis_version_id == locked.current_version_id,
        ReviewRound.status == RoundStatus.CREATED,
    ).values(status=RoundStatus.CANCELLED))
    await _clone_editable_version(session, locked)
    return locked


async def delete_draft(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> None:
    thesis = await get_student_thesis(session, user, thesis_id, for_update=True)
    events = await _events(session, thesis.id)
    if any(e.action == "submit" for e in events) or thesis.stage != ThesisStage.DRAFT:
        raise AppError("STATE_TRANSITION_DENIED", 409, "已提交过的论文不能删除")
    version_ids = list((await session.execute(
        select(ThesisVersion.id).where(ThesisVersion.thesis_id == thesis.id)
    )).scalars())
    await session.execute(delete(ThesisVersionFile).where(ThesisVersionFile.thesis_version_id.in_(version_ids)))
    # Keep file bytes and audit history; detached uploads can no longer write to a draft.
    await session.execute(update(FileObject).where(FileObject.thesis_id == thesis.id)
                          .values(upload_version_id=None, thesis_id=None))
    thesis.current_version_id = None
    await session.flush()
    await session.execute(delete(ThesisVersion).where(ThesisVersion.id.in_(version_ids)))
    await audit_service.record(session, user=user, action="delete_draft", object_type="thesis", object_id=str(thesis.id))
    await session.delete(thesis)
    await session.flush()


async def list_school_theses(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None) -> list[Thesis]:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    return list(
        (
            await session.execute(
                apply_thesis_scope(select(Thesis).where(Thesis.tenant_id == user.tenant_id).order_by(Thesis.updated_at.desc()), time_scope, as_of)
            )
        ).scalars()
    )


async def get_school_thesis(session: AsyncSession, user: CurrentUser, thesis_id: UUID, *, for_update: bool = False) -> Thesis:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await session.get(Thesis, thesis_id, with_for_update=for_update, populate_existing=for_update)
    if thesis is None or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    return thesis


async def terminate(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expected_version: int, reason: str, request_id: str | None) -> Thesis:
    from app.modules.dispatch.models import ExpertTask, ReviewRound
    from app.shared.enums import ExpertTaskStatus, RoundStatus

    thesis = await get_school_thesis(session, user, thesis_id, for_update=True)
    if not reason.strip():
        raise AppError("VALIDATION_FAILED", 422, "终止必须填写原因")
    await workflow_service.transition(session, thesis=thesis, to_stage=ThesisStage.TERMINATED,
        action="terminate", actor=user, reason=reason.strip(), expected_version=expected_version, request_id=request_id)
    rounds = list((await session.execute(select(ReviewRound).where(ReviewRound.thesis_id == thesis.id)
        .execution_options(populate_existing=True))).scalars())
    for round_ in rounds:
        if round_.status in {RoundStatus.CREATED, RoundStatus.ACTIVE, RoundStatus.RESULT_READY}:
            round_.status = RoundStatus.CANCELLED
        tasks = (await session.execute(select(ExpertTask).where(ExpertTask.round_id == round_.id,
            ExpertTask.status.in_([ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW]))
            .with_for_update().execution_options(populate_existing=True))).scalars()
        for task in tasks:
            task.status = ExpertTaskStatus.CANCELLED
            task.version += 1
    await audit_service.record(session, user=user, action="terminate", object_type="thesis",
        object_id=str(thesis.id), request_id=request_id, detail={"reason": reason.strip()})
    await session.flush()
    return thesis


async def confirm_anonymization(
    session: AsyncSession, user: CurrentUser, thesis_id: UUID, body: ConfirmInput, request_id: str | None
) -> Thesis:
    thesis = await get_school_thesis(session, user, thesis_id)
    locked = (await session.execute(select(Thesis).where(Thesis.id == thesis.id).with_for_update().execution_options(populate_existing=True))).scalar_one()
    check = await _latest_check(session, locked)
    if body.decision == "PASS":
        if locked.stage != ThesisStage.PREPARING:
            raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许确认")
        if check is None or check.auto_conclusion == AnonymizationConclusion.FAIL:
            raise AppError("ANONYMIZATION_FAILED", 422, "匿名检测未通过，不能确认送审")
        if await sensitive_terms.is_stale(session, locked, check):
            raise AppError("VERSION_CONFLICT", 409, "检测依据已变化，请重新检测后确认")
        anonymous = await sensitive_terms.anonymous_file(session, locked)
        await run_in_threadpool(validated_bytes, anonymous)
        if any(f.get("kind") == "SCHOOL_TERM" and f.get("severity") == "WARN" for f in check.findings) and not (body.reason or "").strip():
            raise AppError("VALIDATION_FAILED", 422, "确认学校词表提示需填写人工核验理由")
        check.manual_conclusion = AnonymizationConclusion.PASS
        await workflow_service.transition(
            session,
            thesis=locked,
            to_stage=ThesisStage.READY_FOR_DISPATCH,
            action="confirm_anonymization",
            actor=user,
            reason=body.reason,
            expected_version=body.version,
            request_id=request_id,
        )
    elif body.decision == "REJECT":
        if not body.reason:
            raise AppError("VALIDATION_FAILED", 422, "退回必须填写原因")
        if check:
            check.manual_conclusion = AnonymizationConclusion.FAIL
        await workflow_service.transition(
            session,
            thesis=locked,
            to_stage=ThesisStage.DRAFT,
            action="reject_anonymization",
            actor=user,
            reason=body.reason,
            expected_version=body.version,
            request_id=request_id,
        )
        await _clone_editable_version(session, locked)
    else:
        raise AppError("VALIDATION_FAILED", 422, "无效的审核决定")
    await audit_service.record(
        session, user=user, action="confirm_anonymization", object_type="thesis", object_id=str(locked.id)
    )
    return locked


async def remember_idempotent(session: AsyncSession, user: CurrentUser, key: str | None, route: str, payload: dict) -> dict | None:
    return await audit_service.replay(session, user, key, route, payload)


async def store_idempotent(
    session: AsyncSession, user: CurrentUser, key: str | None, route: str, payload: dict, response_body: dict, code: int = 200
) -> None:
    await audit_service.remember(
        session, user, key, route, payload, response_body, code
    )
