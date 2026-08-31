from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.result.models import ResultPublication, ResultSummary
from app.modules.review.models import ReviewResultVersion
from app.modules.thesis.models import Thesis
from app.modules.user.models import StudentEligibility, TenantUserMembership
from app.modules.workflow import service as workflow_service
from app.shared.enums import ExpertTaskStatus, RoleCode, ThesisStage

REQUIRED_EXPERTS = 1
RULE = {"required_experts": REQUIRED_EXPERTS, "mode": "sum_dimensions"}


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def maybe_close_round(session: AsyncSession, task: ExpertTask, actor: CurrentUser) -> None:
    round_ = await session.get(ReviewRound, task.round_id)
    if round_ is None:
        return
    submitted = list(
        (
            await session.execute(
                select(ExpertTask).where(
                    ExpertTask.round_id == round_.id, ExpertTask.status == ExpertTaskStatus.SUBMITTED
                )
            )
        ).scalars()
    )
    if len(submitted) < REQUIRED_EXPERTS:
        return
    thesis = await session.get(Thesis, round_.thesis_id)
    if thesis is None or thesis.stage != ThesisStage.UNDER_REVIEW:
        return
    totals = []
    task_ids = []
    for item in submitted:
        result = (
            await session.execute(
                select(ReviewResultVersion).where(
                    ReviewResultVersion.task_id == item.id, ReviewResultVersion.is_current.is_(True)
                )
            )
        ).scalar_one_or_none()
        if result:
            totals.append(result.total)
            task_ids.append(str(item.id))
    if not totals:
        return
    total = totals[0]
    existing = (
        await session.execute(select(ResultSummary).where(ResultSummary.round_id == round_.id))
    ).scalar_one_or_none()
    if existing:
        existing.total = total
        existing.result_task_ids = task_ids
        existing.rule_snapshot = RULE
    else:
        session.add(
            ResultSummary(
                tenant_id=thesis.tenant_id,
                thesis_id=thesis.id,
                round_id=round_.id,
                total=total,
                rule_snapshot=RULE,
                result_task_ids=task_ids,
            )
        )
    await workflow_service.transition(
        session,
        thesis=thesis,
        to_stage=ThesisStage.RESULT_PROCESSING,
        action="results_ready",
        actor=actor,
    )
    await session.flush()


def _alias_items(results: list[ReviewResultVersion]) -> list[dict]:
    items = []
    for index, row in enumerate(results, start=1):
        comments = row.comments or {}
        items.append(
            {
                "alias": f"E-{index:03d}",
                "total": row.total,
                "scores": row.scores,
                "recommendation": comments.get("recommendation", ""),
                "overall_comment": comments.get("overallComment", ""),
                "issues": comments.get("issues", ""),
            }
        )
    return items


async def school_results(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> dict:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    summary = (
        await session.execute(select(ResultSummary).where(ResultSummary.thesis_id == thesis.id))
    ).scalar_one_or_none()
    round_ = (
        await session.execute(select(ReviewRound).where(ReviewRound.thesis_id == thesis.id))
    ).scalars().first()
    results = []
    if round_:
        tasks = list(
            (
                await session.execute(
                    select(ExpertTask).where(
                        ExpertTask.round_id == round_.id, ExpertTask.status == ExpertTaskStatus.SUBMITTED
                    )
                )
            ).scalars()
        )
        for task in tasks:
            row = (
                await session.execute(
                    select(ReviewResultVersion).where(
                        ReviewResultVersion.task_id == task.id, ReviewResultVersion.is_current.is_(True)
                    )
                )
            ).scalar_one_or_none()
            if row:
                results.append(row)
    return {
        "thesis_id": str(thesis.id),
        "stage": thesis.stage,
        "version": thesis.version,
        "summary_total": summary.total if summary else None,
        "items": _alias_items(results),
        "published": thesis.stage == ThesisStage.COMPLETED,
    }


async def publish(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expected_version: int) -> Thesis:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = (await session.execute(select(Thesis).where(Thesis.id == thesis_id).with_for_update())).scalar_one_or_none()
    if thesis is None or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    if thesis.stage == ThesisStage.COMPLETED:
        return thesis
    if thesis.stage != ThesisStage.RESULT_PROCESSING:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许发布")
    summary = (
        await session.execute(select(ResultSummary).where(ResultSummary.thesis_id == thesis.id))
    ).scalar_one_or_none()
    if summary is None:
        raise AppError("STATE_TRANSITION_DENIED", 409, "尚无汇总结果")
    await workflow_service.transition(
        session,
        thesis=thesis,
        to_stage=ThesisStage.COMPLETED,
        action="publish",
        actor=user,
        expected_version=expected_version,
    )
    session.add(
        ResultPublication(summary_id=summary.id, published_by=user.id, published_at=datetime.now(timezone.utc))
    )
    await session.flush()
    return thesis


async def published_result(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> dict:
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or thesis.stage != ThesisStage.COMPLETED:
        raise _hidden()
    if user.role == RoleCode.STUDENT:
        membership = (
            await session.execute(
                select(TenantUserMembership).where(
                    TenantUserMembership.user_id == user.id,
                    TenantUserMembership.id == thesis.student_membership_id,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            raise _hidden()
    elif user.role == RoleCode.SUPERVISOR:
        elig = (
            await session.execute(
                select(StudentEligibility).where(
                    StudentEligibility.student_membership_id == thesis.student_membership_id
                )
            )
        ).scalar_one_or_none()
        supervisor = (
            await session.execute(
                select(TenantUserMembership).where(
                    TenantUserMembership.user_id == user.id, TenantUserMembership.membership_type == "SUPERVISOR"
                )
            )
        ).scalar_one_or_none()
        if elig is None or supervisor is None or elig.supervisor_membership_id != supervisor.id:
            raise _hidden()
    else:
        raise _hidden()
    payload = await school_results(session, CurrentUser(id=user.id, role=RoleCode.SCHOOL_REVIEWER, tenant_id=thesis.tenant_id, data_scope={}), thesis_id)
    return {
        "thesis_id": str(thesis.id),
        "total": payload["summary_total"],
        "items": payload["items"],
    }
