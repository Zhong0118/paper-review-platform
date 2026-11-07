from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.thesis.models import Thesis
from app.modules.workflow.models import WorkflowEvent
from app.shared.enums import ThesisStage

ALLOWED = {
    (ThesisStage.DRAFT, ThesisStage.SUBMITTED, "submit"),
    (ThesisStage.SUBMITTED, ThesisStage.PREPARING, "start_anonymization"),
    (ThesisStage.PREPARING, ThesisStage.DRAFT, "anonymization_failed"),
    (ThesisStage.PREPARING, ThesisStage.READY_FOR_DISPATCH, "confirm_anonymization"),
    (ThesisStage.PREPARING, ThesisStage.DRAFT, "reject_anonymization"),
    (ThesisStage.SUBMITTED, ThesisStage.DRAFT, "withdraw"),
    (ThesisStage.PREPARING, ThesisStage.DRAFT, "withdraw"),
    (ThesisStage.READY_FOR_DISPATCH, ThesisStage.DRAFT, "withdraw"),
    (ThesisStage.READY_FOR_DISPATCH, ThesisStage.UNDER_REVIEW, "assign_first_task"),
    (ThesisStage.UNDER_REVIEW, ThesisStage.RESULT_PROCESSING, "results_ready"),
    (ThesisStage.RESULT_PROCESSING, ThesisStage.COMPLETED, "publish"),
    (ThesisStage.UNDER_REVIEW, ThesisStage.TERMINATED, "terminate"),
    (ThesisStage.RESULT_PROCESSING, ThesisStage.TERMINATED, "terminate"),
    (ThesisStage.DRAFT, ThesisStage.TERMINATED, "terminate"),
    (ThesisStage.SUBMITTED, ThesisStage.TERMINATED, "terminate"),
    (ThesisStage.PREPARING, ThesisStage.TERMINATED, "terminate"),
    (ThesisStage.READY_FOR_DISPATCH, ThesisStage.TERMINATED, "terminate"),
}


async def transition(
    session: AsyncSession,
    *,
    thesis: Thesis,
    to_stage: str,
    action: str,
    actor: CurrentUser | None,
    reason: str | None = None,
    expected_version: int | None = None,
    request_id: str | None = None,
) -> Thesis:
    if expected_version is not None and thesis.version != expected_version:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    if (thesis.stage, to_stage, action) not in ALLOWED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许该动作")
    event = WorkflowEvent(
        tenant_id=thesis.tenant_id,
        thesis_id=thesis.id,
        from_stage=thesis.stage,
        to_stage=to_stage,
        action=action,
        actor_id=actor.id if actor else None,
        reason=reason,
        request_id=request_id,
        payload={},
    )
    session.add(event)
    if action == "reject_anonymization":
        # The row trigger verifies this event before it copies the locked frozen version.
        event.payload = {"source_version_id": str(thesis.current_version_id)}
        await session.flush([event])
    thesis.stage = to_stage
    thesis.version += 1
    if reason:
        thesis.return_reason = reason
    elif to_stage != ThesisStage.DRAFT:
        thesis.return_reason = None
    await session.flush()
    return thesis
