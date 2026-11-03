from app.shared.time_scope import apply_thesis_scope
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.result.models import ResultPublication, ResultSummary
from app.modules.review.models import ReviewResultVersion, ReviewResultRevision, ReviewCorrectionRequest
from app.modules.thesis.models import Thesis, ThesisVersion
from app.modules.user.models import StudentEligibility, TenantUserMembership
from app.modules.workflow import service as workflow_service
from app.shared.enums import ExpertTaskStatus, RoleCode, ThesisStage

from app.modules.review.rules import validate_rule_snapshot, outcome_for_total


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def maybe_close_round(session: AsyncSession, task: ExpertTask, actor: CurrentUser) -> None:
    round_ = await session.get(ReviewRound, task.round_id)
    if round_ is None:
        return
    rule = validate_rule_snapshot(round_.rule_snapshot)
    required = rule["required_experts"]
    submitted = list(
        (
            await session.execute(
                select(ExpertTask).where(
                    ExpertTask.round_id == round_.id, ExpertTask.status == ExpertTaskStatus.SUBMITTED
                )
            )
        ).scalars()
    )
    if len(submitted) < required:
        return
    if len(submitted) != required:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前单专家轮次任务数量异常")
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
    if len(totals) != required:
        raise AppError("STATE_TRANSITION_DENIED", 409, "正式结果不完整，需核查")
    outcome_for_total(rule, totals[0])
    total = totals[0]
    existing = (
        await session.execute(select(ResultSummary).where(ResultSummary.round_id == round_.id))
    ).scalar_one_or_none()
    if existing:
        existing.total = total
        existing.result_task_ids = task_ids
        existing.rule_snapshot = rule
    else:
        session.add(
            ResultSummary(
                tenant_id=thesis.tenant_id,
                thesis_id=thesis.id,
                round_id=round_.id,
                total=total,
                rule_snapshot=rule,
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


def publication_snapshot(thesis: Thesis, summary: ResultSummary, results: list) -> dict:
    """Persist exactly what was released; later summary changes cannot change it."""
    rule = validate_rule_snapshot(summary.rule_snapshot)
    return {
        "thesis_id": str(thesis.id), "thesis_version_id": str(thesis.current_version_id),
        "round_id": str(summary.round_id), "result_task_ids": list(summary.result_task_ids),
        "base_result_id": str(getattr(results[0], "base_result_id", results[0].id)),
        "revision_id": str(summary.effective_revision_id) if summary.effective_revision_id else None,
        "total": summary.total, "rule_snapshot": rule,
        "outcome": outcome_for_total(rule, summary.total), "items": _alias_items(results),
    }


async def _summary_results(session: AsyncSession, summary: ResultSummary) -> list[ReviewResultVersion]:
    rule = validate_rule_snapshot(summary.rule_snapshot)
    required = rule["required_experts"]
    round_ = await session.get(ReviewRound, summary.round_id)
    if round_ is None or validate_rule_snapshot(round_.rule_snapshot) != rule:
        raise AppError("STATE_TRANSITION_DENIED", 409, "汇总与轮次规则不一致，需核查")
    outcome_for_total(rule, summary.total)
    if summary.effective_revision_id:
        revision = await session.get(ReviewResultRevision, summary.effective_revision_id)
        if (revision is None or revision.round_id != summary.round_id
                or revision.tenant_id != summary.tenant_id or revision.total != summary.total):
            raise AppError("STATE_TRANSITION_DENIED", 409, "更正汇总与正式版本不一致")
        return [revision]
    try:
        ids = [UUID(value) for value in summary.result_task_ids]
    except (ValueError, TypeError, AttributeError):
        ids = []
    rows = list((await session.execute(select(ReviewResultVersion).join(
        ExpertTask, ExpertTask.id == ReviewResultVersion.task_id
    ).where(ExpertTask.id.in_(ids), ExpertTask.round_id == summary.round_id,
            ExpertTask.status == ExpertTaskStatus.SUBMITTED, ReviewResultVersion.is_current.is_(True)))).scalars())
    if len(ids) != required or len(rows) != required or rows[0].total != summary.total:
        raise AppError("STATE_TRANSITION_DENIED", 409, "汇总与正式结果不一致，需核查")
    return rows


async def school_results(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> dict:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or thesis.tenant_id != user.tenant_id:
        raise _hidden()
    summary = (
        await session.execute(select(ResultSummary).where(ResultSummary.thesis_id == thesis.id))
    ).scalar_one_or_none()
    results = await _summary_results(session, summary) if summary else []
    from app.modules.review.comment_checks import anonymous_summary
    items = [{**item, 'check_summary': anonymous_summary(row.check_summary)}
             for item, row in zip(_alias_items(results), results)]
    return {
        "thesis_id": str(thesis.id),
        "stage": thesis.stage,
        "version": thesis.version,
        "summary_total": summary.total if summary else None,
        "base_result_id": str(getattr(results[0], "base_result_id", results[0].id)) if results else None,
        "effective_revision_id": str(summary.effective_revision_id) if summary and summary.effective_revision_id else None,
        "rule_snapshot": validate_rule_snapshot(summary.rule_snapshot) if summary else None,
        "outcome": outcome_for_total(summary.rule_snapshot, summary.total) if summary else None,
        "items": items,
        "published": thesis.stage == ThesisStage.COMPLETED,
    }


async def publish(session: AsyncSession, user: CurrentUser, thesis_id: UUID, expected_version: int) -> Thesis:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    thesis = (await session.execute(select(Thesis).where(Thesis.id == thesis_id).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
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
    round_ = await session.get(ReviewRound, summary.round_id)
    if round_ is None or round_.thesis_version_id != thesis.current_version_id:
        raise AppError("STATE_TRANSITION_DENIED", 409, "汇总不属于当前版本")
    if await session.scalar(select(func.has_open_review_correction(summary.round_id))):
        raise AppError("STATE_TRANSITION_DENIED", 409, "存在未结束的更正申请，暂不可发布")
    results = await _summary_results(session, summary)
    occupied = list((await session.execute(select(ExpertTask.id).where(
        ExpertTask.round_id == summary.round_id,
        ExpertTask.status.in_([ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW, ExpertTaskStatus.SUBMITTED]),
    ))).scalars())
    if occupied != [results[0].task_id]:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前单专家轮次任务数量异常")
    await workflow_service.transition(
        session,
        thesis=thesis,
        to_stage=ThesisStage.COMPLETED,
        action="publish",
        actor=user,
        expected_version=expected_version,
    )
    session.add(
        ResultPublication(summary_id=summary.id, published_by=user.id,
                          published_at=datetime.now(timezone.utc),
                          snapshot=publication_snapshot(thesis, summary, results), publication_no=1)
    )
    await session.flush()
    return thesis


def _supervised_published_theses(user: CurrentUser):
    # Bind both the tenant and the eligibility batch; a student can have many batches.
    return (select(Thesis)
        .join(StudentEligibility, and_(
            StudentEligibility.student_membership_id == Thesis.student_membership_id,
            StudentEligibility.review_batch_id == Thesis.review_batch_id,
            StudentEligibility.tenant_id == Thesis.tenant_id,
        ))
        .join(TenantUserMembership,
              TenantUserMembership.id == StudentEligibility.supervisor_membership_id)
        .where(
            Thesis.stage == ThesisStage.COMPLETED,
            Thesis.tenant_id == user.tenant_id,
            TenantUserMembership.tenant_id == user.tenant_id,
            TenantUserMembership.user_id == user.id,
            TenantUserMembership.membership_type == "SUPERVISOR",
            TenantUserMembership.is_active.is_(True),
        ))


async def list_supervised_published_theses(session: AsyncSession, user: CurrentUser, *, time_scope="all", as_of=None) -> list[dict]:
    if user.role != RoleCode.SUPERVISOR or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    rows = (await session.execute(
        apply_thesis_scope(_supervised_published_theses(user), time_scope, as_of)
        .join(ThesisVersion, ThesisVersion.id == Thesis.current_version_id)
        .with_only_columns(Thesis.id, ThesisVersion.title, StudentEligibility.student_name)
        .order_by(Thesis.created_at.desc(), Thesis.id)
    )).all()
    return [{"id": str(row.id), "title": row.title, "student_name": row.student_name} for row in rows]


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
        supervised = (await session.execute(
            _supervised_published_theses(user).where(Thesis.id == thesis.id)
        )).scalar_one_or_none()
        if supervised is None:
            raise _hidden()
    else:
        raise _hidden()
    summary, publication = await latest_publication(session, thesis)
    snapshot = publication.snapshot
    rule = validate_rule_snapshot(snapshot["rule_snapshot"])
    return {
        "thesis_id": str(thesis.id),
        "total": snapshot["total"],
        "base_result_id": snapshot["base_result_id"],
        "effective_revision_id": snapshot["revision_id"],
        "rule_snapshot": rule,
        "outcome": outcome_for_total(rule, snapshot["total"]),
        "items": snapshot["items"],
        "correction_pending": bool(await session.scalar(select(func.has_open_review_correction(summary.round_id)))),
    }


async def latest_publication(session: AsyncSession, thesis: Thesis) -> tuple[ResultSummary, ResultPublication]:
    """The caller has authorized the thesis; only the effective, bound publication is readable."""
    if thesis.stage != ThesisStage.COMPLETED:
        raise _hidden()
    summary = (await session.execute(select(ResultSummary).where(
        ResultSummary.thesis_id == thesis.id,
    ))).scalar_one_or_none()
    if summary is None:
        raise _hidden()
    publication = (await session.execute(select(ResultPublication).where(
        ResultPublication.summary_id == summary.id,
    ).order_by(ResultPublication.publication_no.desc()).limit(1))).scalar_one_or_none()
    if publication is None:
        raise _hidden()
    snapshot = publication.snapshot
    if (snapshot.get("thesis_id") != str(thesis.id)
            or snapshot.get("thesis_version_id") != str(thesis.current_version_id)):
        raise _hidden()
    if (snapshot.get("round_id") != str(summary.round_id)
            or snapshot.get("result_task_ids") != summary.result_task_ids):
        raise AppError("STATE_TRANSITION_DENIED", 409, "发布归属与汇总不一致，需核查")
    return summary, publication
