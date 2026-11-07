from app.shared.time_scope import apply_thesis_scope, resolve_time_scope, utc_now
from app.modules.review.rules import pilot_rule_snapshot
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser
from app.modules.auth.service import load_active_identity
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.dispatch.candidate_ranking import rank_candidate
from app.modules.dispatch.deadlines import clock_fields
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
            .execution_options(populate_existing=True)
        )
    ).scalars().first()


def serialize_round(round_: ReviewRound | None) -> dict | None:
    if round_ is None:
        return None
    return {"id": str(round_.id), "status": round_.status, "round_no": round_.round_no}


async def confirm_dispatch(session: AsyncSession, user: CurrentUser, thesis: Thesis, expected_version: int, request_id: str | None) -> ReviewRound:
    thesis = await session.get(Thesis, thesis.id, with_for_update=True, populate_existing=True)
    if thesis is None or user.role != RoleCode.SCHOOL_REVIEWER or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    if thesis.stage != ThesisStage.READY_FOR_DISPATCH:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许确认送出")
    if expected_version != thesis.version:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    existing = await _round_for(session, thesis.id)
    if existing and existing.thesis_version_id == thesis.current_version_id and existing.status != RoundStatus.CANCELLED:
        return existing
    version = await session.get(ThesisVersion, thesis.current_version_id)
    if version is None:
        raise AppError("VALIDATION_FAILED", 422, "缺少论文版本")
    round_ = ReviewRound(
        tenant_id=thesis.tenant_id,
        thesis_id=thesis.id,
        thesis_version_id=version.id,
        anonymous_title=version.title,
        rule_snapshot=pilot_rule_snapshot(),
        round_no=existing.round_no + 1 if existing else 1,
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


async def _avoided(session: AsyncSession, expert_id: UUID, display_name: str | None, supervisor_name: str, tenant_id: UUID) -> bool:
    if (await session.execute(select(ExpertConflict.id).where(
        ExpertConflict.expert_id == expert_id, ExpertConflict.kind == "TENANT_ID",
        ExpertConflict.value == str(tenant_id),
    ).limit(1))).scalar_one_or_none() is not None:
        return True
    if not supervisor_name:
        return False
    if display_name and (supervisor_name in display_name or display_name in supervisor_name):
        return True
    return (await session.execute(select(ExpertConflict.id).where(
        ExpertConflict.expert_id == expert_id, ExpertConflict.kind == "SUPERVISOR_NAME",
        ExpertConflict.value == supervisor_name,
    ).limit(1))).scalar_one_or_none() is not None


async def _active_expert_user(session: AsyncSession, user_id: UUID) -> bool:
    try:
        identity = await load_active_identity(session, user_id)
    except AppError as exc:
        if exc.code == "AUTH_REQUIRED":
            return False
        raise
    return identity.role.code == RoleCode.EXPERT and identity.assignment.tenant_id is None


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
    round_ = await _round_for(session,thesis.id)
    round_ready = bool(version and round_ and round_.thesis_version_id == thesis.current_version_id
                       and round_.status in {RoundStatus.CREATED,RoundStatus.ACTIVE}
                       and thesis.stage in {ThesisStage.READY_FOR_DISPATCH,ThesisStage.UNDER_REVIEW})
    live = (await session.scalars(select(ExpertTask).where(ExpertTask.round_id==round_.id,
        ExpertTask.status.in_([ExpertTaskStatus.INVITED,ExpertTaskStatus.IN_REVIEW,ExpertTaskStatus.SUBMITTED])))).first() if round_ else None
    metadata={field:getattr(version,field) for field in ('title','abstract','keywords')} if version else {}
    experts = (await session.execute(select(Expert, User).join(User, User.id == Expert.user_id))).all()
    load_counts = (await session.execute(
        select(ExpertTask.expert_id, func.count().filter(ExpertTask.status == 'INVITED'),
               func.count().filter(ExpertTask.status == 'IN_REVIEW'))
        .join(ReviewRound, ReviewRound.id == ExpertTask.round_id)
        .join(Thesis, Thesis.id == ExpertTask.thesis_id)
        .where(ExpertTask.status.in_(('INVITED', 'IN_REVIEW')), ReviewRound.status == 'ACTIVE',
               Thesis.stage == 'UNDER_REVIEW', ReviewRound.thesis_version_id == Thesis.current_version_id)
        .group_by(ExpertTask.expert_id)
    )).all()
    loads = {eid: (inv, rev) for eid, inv, rev in load_counts}
    items = []
    for expert, usr in experts:
        if not await _active_expert_user(session, usr.id):
            continue
        invited, reviewing = loads.get(expert.id, (0, 0))
        codes = expert.discipline_codes or []
        mismatch = version is not None and version.discipline_code not in codes
        avoided = await _avoided(session, expert.id, usr.display_name, supervisor_name, thesis.tenant_id)
        reasons=[]
        if avoided: reasons.append('回避')
        if mismatch: reasons.append('方向不符')
        if expert.qualification_status!='APPROVED': reasons.append('资格未通过')
        if expert.service_status!='AVAILABLE': reasons.append('暂停服务')
        actions=[]
        if not round_ready:
            reasons.append('当前论文或轮次不可派单')
        elif live is None:
            if not reasons: actions=['ASSIGN_EXPERT']
        elif (thesis.stage==ThesisStage.UNDER_REVIEW and round_.status==RoundStatus.ACTIVE
              and live.status in {ExpertTaskStatus.INVITED,ExpertTaskStatus.IN_REVIEW} and live.expert_id!=expert.id):
            if not reasons: actions=['REASSIGN_EXPERT']
        else:
            reasons.append('当前任务专家' if live.expert_id==expert.id else '当前轮次席位不可替换')
        items.append(
            {
                **rank_candidate(metadata,{'research_directions':expert.research_directions,'keywords':expert.keywords}),
                'candidate_version':expert.version,'thesis_version':thesis.version,
                'hard_allowed':bool(actions),'allowed_actions':actions,'unavailable_reasons':reasons,
                'unit':expert.unit,'title':expert.title,'research_directions':expert.research_directions,
                "expert_id": str(expert.id),
                "workload": {"invited": invited, "in_review": reviewing, "total": invited + reviewing},
                "username": usr.username,
                "display_name": usr.display_name,
                "discipline_codes": codes,
                "direction_mismatch": mismatch,
                "avoided": avoided,
                "service_status": expert.service_status,
                "qualification_status": expert.qualification_status,
            }
        )
    return sorted(items,key=lambda item:(not item['hard_allowed'],-item['match_score'],item['expert_id']))


async def assign(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expert_id: UUID, request_id: str | None, *, expected_expert_version: int | None = None) -> tuple[Thesis, ExpertTask]:
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = (await session.execute(select(Thesis).where(Thesis.id == thesis_id).with_for_update()
                                   .execution_options(populate_existing=True))).scalar_one_or_none()
    if thesis is None:
        raise _hidden()
    if thesis.stage not in {ThesisStage.READY_FOR_DISPATCH, ThesisStage.UNDER_REVIEW}:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许派单")
    round_ = await _round_for(session, thesis.id)
    if (round_ is None or round_.thesis_version_id != thesis.current_version_id
            or round_.status not in {RoundStatus.CREATED, RoundStatus.ACTIVE}):
        raise AppError("STATE_TRANSITION_DENIED", 409, "请先由学校确认送出")
    expert = (await session.execute(select(Expert).where(Expert.id == expert_id).with_for_update()
                                    .execution_options(populate_existing=True))).scalar_one_or_none()
    if expert is not None and expected_expert_version is not None and expert.version!=expected_expert_version:
        raise AppError('VERSION_CONFLICT',409,'专家档案已变更，请刷新候选后重新确认')
    if (expert is None or expert.service_status != "AVAILABLE" or expert.qualification_status != "APPROVED"
            or not await _active_expert_user(session, expert.user_id)):
        raise _hidden()
    version = await session.get(ThesisVersion, thesis.current_version_id)
    if version and version.discipline_code not in (expert.discipline_codes or []):
        raise AppError("STATE_TRANSITION_DENIED", 409, "专家擅长方向与送审专业不一致")
    usr = await session.get(User, expert.user_id)
    elig = (
        await session.execute(
            select(StudentEligibility).where(StudentEligibility.student_membership_id == thesis.student_membership_id, StudentEligibility.review_batch_id == thesis.review_batch_id)
        )
    ).scalar_one_or_none()
    supervisor_name = (elig.supervisor_name if elig else "") or ""
    if await _avoided(session, expert.id, usr.display_name if usr else None, supervisor_name, thesis.tenant_id):
        raise AppError("STATE_TRANSITION_DENIED", 409, "命中回避关系")
    live = (
        await session.execute(
            select(ExpertTask).where(
                ExpertTask.round_id == round_.id,
                ExpertTask.status.in_([ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW, ExpertTaskStatus.SUBMITTED]),
            )
        )
    ).scalars().first()
    if live:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前轮次已有专家占位，不能重复派单")
    task = ExpertTask(
        tenant_id=thesis.tenant_id,
        round_id=round_.id,
        thesis_id=thesis.id,
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


async def lock_task_thesis(session: AsyncSession, task_id: UUID) -> Thesis:
    thesis = (await session.execute(select(Thesis)
        .join(ReviewRound, ReviewRound.thesis_id == Thesis.id)
        .join(ExpertTask, ExpertTask.round_id == ReviewRound.id)
        .where(ExpertTask.id == task_id).with_for_update(of=Thesis)
        .execution_options(populate_existing=True))).scalar_one_or_none()
    if thesis is None:
        raise _hidden()
    return thesis


async def reassign(session: AsyncSession, user: CurrentUser, task_id: UUID, expert_id: UUID, request_id: str | None, *, expected_expert_version: int | None = None) -> tuple[Thesis, ExpertTask]:
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await lock_task_thesis(session, task_id)
    old = await session.get(ExpertTask, task_id, with_for_update=True, populate_existing=True)
    round_ = await _round_for(session, thesis.id)
    if (thesis.stage != ThesisStage.UNDER_REVIEW or round_ is None
            or old.round_id != round_.id or round_.status != RoundStatus.ACTIVE
            or round_.thesis_version_id != thesis.current_version_id
            or old.status not in {ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW}
            or old.expert_id == expert_id):
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前任务不可改派给该专家")
    # Roll back cancellation as well if the replacement fails existing assignment checks.
    async with session.begin_nested():
        old.status = ExpertTaskStatus.CANCELLED
        old.version += 1
        await session.flush()
        thesis, new = await assign(session, user, thesis.id, expert_id, request_id, expected_expert_version=expected_expert_version)
        new.replaces_task_id = old.id
        await audit_service.record(session, user=user, action="reassign", object_type="expert_task",
            object_id=str(old.id), request_id=request_id, detail={"replacement_task_id": str(new.id)})
        await session.flush()
    return thesis, new


async def expert_for_user(session: AsyncSession, user_id: UUID) -> Expert:
    expert = (await session.execute(select(Expert).where(Expert.user_id == user_id))).scalar_one_or_none()
    if expert is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    return expert


async def get_task_for_expert(
    session: AsyncSession, user: CurrentUser, task_id: UUID, *, for_update: bool = False
) -> ExpertTask:
    if user.role != RoleCode.EXPERT:
        raise _hidden()
    expert = await expert_for_user(session, user.id)
    query = select(ExpertTask).where(ExpertTask.id == task_id, ExpertTask.expert_id == expert.id)
    if for_update:
        # All commands that can affect a result serialize on thesis before task.
        thesis = (await session.execute(select(Thesis)
            .join(ReviewRound, ReviewRound.thesis_id == Thesis.id)
            .join(ExpertTask, ExpertTask.round_id == ReviewRound.id)
            .where(ExpertTask.id == task_id, ExpertTask.expert_id == expert.id)
            .with_for_update(of=Thesis).execution_options(populate_existing=True))).scalar_one_or_none()
        if thesis is None:
            raise _hidden()
        query = query.with_for_update().execution_options(populate_existing=True)
    task = (await session.execute(query)).scalar_one_or_none()
    if task is None or task.expert_id != expert.id:
        raise _hidden()
    return task


async def accept_task(session: AsyncSession, user: CurrentUser, task_id: UUID) -> ExpertTask:
    task = await get_task_for_expert(session, user, task_id, for_update=True)
    if task.status != ExpertTaskStatus.INVITED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许接受")
    task.status = ExpertTaskStatus.IN_REVIEW
    task.decided_at = datetime.now(timezone.utc)
    await session.flush()
    return task


async def reject_task(session: AsyncSession, user: CurrentUser, task_id: UUID, reason: str) -> ExpertTask:
    if not reason.strip():
        raise AppError("VALIDATION_FAILED", 422, "拒绝必须填写原因")
    task = await get_task_for_expert(session, user, task_id, for_update=True)
    if task.status != ExpertTaskStatus.INVITED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许拒绝")
    task.status = ExpertTaskStatus.REJECTED
    task.reject_reason = reason.strip()
    task.decided_at = datetime.now(timezone.utc)
    await session.flush()
    return task


async def list_expert_tasks(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None) -> list[dict]:
    expert = await expert_for_user(session, user.id)
    query = select(ExpertTask, func.approved_extension_due(ExpertTask.id)).where(ExpertTask.expert_id == expert.id)
    lower, upper = resolve_time_scope(time_scope, as_of if as_of is not None else utc_now())
    if lower is not None:
        query = query.where(func.task_thesis_in_period(ExpertTask.id, lower, upper))
    tasks = (await session.execute(query)).all()
    items = []
    for task, extended_due in tasks:
        round_ = await session.get(ReviewRound, task.round_id)
        items.append(
            {
                "id": str(task.id),
                "status": task.status,
                **clock_fields(task,upper,extended_due),
                "anonymous_id": str(task.id)[:8],
                "anonymous_title": (round_.anonymous_title if round_ else "匿名论文") or "匿名论文",
                "discipline_code": round_.discipline_code if round_ else "",
                "discipline_name": round_.discipline_name if round_ else "",
                "allowed_actions": {
                    ExpertTaskStatus.INVITED: ["ACCEPT_TASK"],
                    ExpertTaskStatus.IN_REVIEW: ["CONTINUE_REVIEW"],
                    ExpertTaskStatus.SUBMITTED: ["VIEW_SUBMITTED"],
                }.get(task.status, []),
            }
        )
    return items


async def invitation(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    task = await get_task_for_expert(session, user, task_id)
    round_ = await session.get(ReviewRound, task.round_id)
    return {
        "id": str(task.id),
        "status": task.status,
        "discipline_code": round_.discipline_code if round_ else "",
        "discipline_name": round_.discipline_name if round_ else "",
        "anonymous_title": (round_.anonymous_title if round_ else "匿名论文") or "匿名论文",
        "anonymous_id": str(task.id)[:8],
        **clock_fields(task,utc_now(),await session.scalar(select(func.approved_extension_due(task.id)))),
        "fee": "未启用",
    }


async def materials(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    task = await get_task_for_expert(session, user, task_id)
    if task.status != ExpertTaskStatus.IN_REVIEW:
        raise _hidden()
    round_ = await session.get(ReviewRound, task.round_id)
    thesis = await session.get(Thesis, round_.thesis_id) if round_ else None
    if (round_ is None or round_.status != RoundStatus.ACTIVE or thesis is None
            or thesis.stage != ThesisStage.UNDER_REVIEW
            or thesis.current_version_id != round_.thesis_version_id):
        raise _hidden()
    rows = (
        await session.execute(
            select(ThesisVersionFile, FileObject)
            .join(FileObject, FileObject.id == ThesisVersionFile.file_id)
            .where(
                ThesisVersionFile.thesis_version_id == round_.thesis_version_id,
                ThesisVersionFile.purpose == FilePurpose.ANONYMOUS,
                FileObject.purpose == FilePurpose.ANONYMOUS,
                FileObject.completed_at.is_not(None),
            )
        )
    ).all()
    return {
        "task_id": str(task.id),
        "files": [{"file_id": str(obj.id), "purpose": link.purpose, "filename": "匿名论文.pdf"} for link, obj in rows],
    }


async def school_progress(session: AsyncSession, thesis: Thesis) -> dict:
    round_ = await _round_for(session, thesis.id)
    counts = {
        "invited_count": 0,
        "in_review_count": 0,
        "submitted_count": 0,
        "rejected_count": 0,
    }
    aliases: list[dict] = []
    if round_:
        tasks = list(
            (
                await session.execute(
                    select(ExpertTask,func.approved_extension_due(ExpertTask.id)).where(ExpertTask.round_id == round_.id).order_by(ExpertTask.invited_at.asc(), ExpertTask.id)
                )
            ).all()
        )
        as_of = utc_now()
        for index, (task, extended) in enumerate(tasks, start=1):
            if task.status == ExpertTaskStatus.INVITED:
                counts["invited_count"] += 1
            elif task.status == ExpertTaskStatus.IN_REVIEW:
                counts["in_review_count"] += 1
            elif task.status == ExpertTaskStatus.SUBMITTED:
                counts["submitted_count"] += 1
            elif task.status == ExpertTaskStatus.REJECTED:
                counts["rejected_count"] += 1
            aliases.append({"alias": f"T-{index:03d}", "status": task.status, **clock_fields(task,as_of,extended,include_original=False)})
    return {
        "thesis_id": str(thesis.id),
        "stage": thesis.stage,
        "round_status": round_.status if round_ else None,
        "tasks": aliases,
        **counts,
    }


async def school_progress_list(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None, status_filter="ALL") -> dict:
    from app.modules.dispatch.projection import operation_rows, matches_filter, card_counts, validate_status_filter
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    validate_status_filter(status_filter)
    as_of = as_of or utc_now()
    rows = await operation_rows(session, user, time_scope=time_scope, as_of=as_of, labels=True)
    rows = [r for r in rows if r['round_id'] and matches_filter(r, status_filter)]
    cards = card_counts(rows)
    items = []
    for row in rows:
        tasks = row['tasks']
        item = {k: row[k] for k in ('thesis_id', 'stage', 'round_status', 'waiting', 'title', 'student_name')}
        item.update({key: sum(t['status'] == status for t in tasks) for key, status in (
            ('invited_count', 'INVITED'), ('in_review_count', 'IN_REVIEW'),
            ('submitted_count', 'SUBMITTED'), ('rejected_count', 'REJECTED'))})
        item['tasks'] = [{'alias': f'T-{index:03d}', 'status': t['status'], **({'deadline':t['deadline']} if 'deadline' in t else {})}
                         for index, t in enumerate(tasks, start=1)
                         if status_filter == 'ALL' or t['status'] == status_filter]
        items.append(item)
    filtered_count = len(items) if status_filter in ('ALL', 'WAITING') else sum(len(r['tasks']) for r in items)
    return {'items': items, 'totals': {
        'waiting': cards['waiting_theses'], 'reviewing': cards['invited_tasks'] + cards['in_review_tasks'],
        'completed': cards['submitted_tasks'], 'rejected': sum(r['rejected_count'] for r in items), 'overdue': cards['overdue_tasks'],
    }, 'overdue_status': 'CONFIGURED' if cards['overdue_tasks'] is not None else 'NOT_CONFIGURED', 'as_of': as_of.isoformat(), 'status_filter': status_filter, 'filtered_count': filtered_count}


async def dispatch_queue(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None, status_filter="ALL") -> list[dict]:
    from app.modules.dispatch.projection import operation_rows, matches_filter, validate_status_filter
    if user.role != RoleCode.PLATFORM_REVIEWER:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    validate_status_filter(status_filter)
    rows = await operation_rows(session, user, time_scope=time_scope, as_of=as_of, labels=True)
    items = []
    for row in rows:
        # The unfiltered workbench keeps its existing dispatch scope. Explicit
        # submitted drill-down also includes result-processing/completed work.
        if status_filter == 'ALL' and row['stage'] not in ('READY_FOR_DISPATCH', 'UNDER_REVIEW'):
            continue
        if not matches_filter(row, status_filter):
            continue
        replacement = next((t for t in row['tasks'] if t['status'] in ('INVITED', 'IN_REVIEW')), None)
        if row['stage'] != 'UNDER_REVIEW' or row['round_status'] != 'ACTIVE':
            replacement = None
        items.append({
            **{k: row[k] for k in ('thesis_id', 'stage', 'title', 'student_name', 'discipline_code')},
            'allowed_actions': ['ASSIGN_EXPERT'] if row['waiting'] else (['REASSIGN_EXPERT'] if replacement else []),
            'reassignable_task': {k: replacement[k] for k in ('id', 'expert_id')} if replacement else None,
            'tasks': [{'status': t['status'], **({'deadline':t['deadline']} if 'deadline' in t else {})} for t in row['tasks']
                      if t['status'] in ('INVITED', 'IN_REVIEW', 'SUBMITTED') and (status_filter == 'ALL' or t['status'] == status_filter)],
        })
    return items
