"""School timing rules and role-scoped deadline projections."""

from pydantic import BaseModel, ConfigDict, Field

from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.dispatch.models import BatchDeadlineRule
from app.modules.tenant.service import get_batch


class DeadlineInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(strict=True, ge=1)
    accept_days: int | None = Field(strict=True, gt=0, le=32767)
    review_days: int | None = Field(strict=True, gt=0, le=32767)


async def set_rule(session, actor, batch_id, body, request_id):
    batch = await get_batch(session, actor.tenant_id, batch_id, lock=True)
    if batch.version != body.expected_version or batch.status not in ('DRAFT', 'OPEN'):
        raise AppError('VERSION_CONFLICT', 409, '批次状态或版本已变化，请刷新')
    rule = await session.get(BatchDeadlineRule, batch_id)
    if rule is None:
        rule = BatchDeadlineRule(id=batch.id, tenant_id=batch.tenant_id)
        session.add(rule)
    rule.accept_days, rule.review_days = body.accept_days, body.review_days
    batch.version += 1
    await audit.record(
        session,
        user=actor,
        action='batch.deadlines',
        object_type='batch',
        object_id=str(batch.id),
        request_id=request_id,
        detail=body.model_dump(exclude={'expected_version'}),
    )
    await session.flush()
    return batch


def deadline_view(status, invited, decided, accept_due, original, extended, as_of, *, include_original=True):
    review_due = extended or original
    due = {'INVITED': accept_due, 'IN_REVIEW': review_due}.get(status)
    accepted = decided if status in ('IN_REVIEW', 'SUBMITTED') or original is not None else None
    dates = dict(invited_at=invited, accepted_at=accepted, accept_due_at=accept_due, review_due_at=review_due)
    if include_original:
        dates['original_review_due_at'] = original
    return {
        **{key: value.isoformat() if value else None for key, value in dates.items()},
        'overdue': due is not None and as_of >= due,
    }


def clock_fields(task, as_of, extended=None, *, include_original=True):
    if task.accept_due_at is None and task.review_days is None:
        return {}
    return {
        'deadline': deadline_view(
            task.status,
            task.invited_at,
            task.decided_at,
            task.accept_due_at,
            task.original_review_due_at,
            extended,
            as_of,
            include_original=include_original,
        )
    }
