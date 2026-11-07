"""Requests and decisions share the paper → task lock used by submission and reassignment."""

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, StringConstraints
from sqlalchemy import and_, select

from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.dispatch import service as dispatch
from app.modules.dispatch.models import ExpertTask, ReviewRound, TaskExtension
from app.modules.thesis.models import Thesis
from app.shared.time_scope import utc_now

Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class RequestExtension(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requested_due_at: AwareDatetime
    reason: Reason


class DecideExtension(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['APPROVED', 'REJECTED']
    reason: Reason


def record(row, active):
    return {
        'id': str(row.id),
        'task_id': str(row.task_id),
        'status': row.status,
        'reason': row.reason,
        'decision_reason': row.decision_reason,
        'requested_at': row.requested_at.isoformat(),
        'requested_due_at': row.requested_due_at.isoformat(),
        'original_due_at': row.original_due_at.isoformat(),
        'decided_at': row.decided_at.isoformat() if row.decided_at else None,
        'actionable': active and row.status == 'PENDING',
    }


def active_task():
    return and_(
        ExpertTask.status == 'IN_REVIEW',
        ExpertTask.original_review_due_at.is_not(None),
        ReviewRound.status == 'ACTIVE',
        Thesis.stage == 'UNDER_REVIEW',
        ReviewRound.thesis_version_id == Thesis.current_version_id,
    )


async def is_active(session, task_id):
    return bool(
        await session.scalar(
            select(ExpertTask.id)
            .join(ReviewRound, ReviewRound.id == ExpertTask.round_id)
            .join(Thesis, Thesis.id == ExpertTask.thesis_id)
            .where(ExpertTask.id == task_id, active_task())
        )
    )


async def history(session, task_id=None):
    # Outer joins retain private history after the expert loses access to the paper.
    query = (
        select(TaskExtension, active_task())
        .join(ExpertTask, ExpertTask.id == TaskExtension.task_id)
        .outerjoin(ReviewRound, ReviewRound.id == ExpertTask.round_id)
        .outerjoin(Thesis, Thesis.id == ExpertTask.thesis_id)
        .order_by(TaskExtension.requested_at.desc(), TaskExtension.id)
    )
    if task_id is not None:
        query = query.where(TaskExtension.task_id == task_id)
    return [record(row, bool(active)) for row, active in (await session.execute(query)).all()]


def conflict(message):
    return AppError('STATE_TRANSITION_DENIED', 409, message)


async def request_extension(session, actor, task_id, body, key, request_id):
    await dispatch.get_task_for_expert(session, actor, task_id)
    route = 'task.extension.request'
    payload = {'task_id': str(task_id), **body.model_dump(mode='json')}
    cached = await audit.replay(session, actor, key, route, payload)
    if cached:
        return cached
    task = await dispatch.get_task_for_expert(session, actor, task_id, for_update=True)
    if not await is_active(session, task_id):
        raise conflict('仅已接单且设有评阅期限的有效任务可申请延期')
    if await session.scalar(
        select(TaskExtension.id).where(
            TaskExtension.task_id == task_id, TaskExtension.status.in_(('PENDING', 'APPROVED'))
        )
    ):
        raise conflict('本任务已有待审或已批准的延期')
    now = utc_now()
    if body.requested_due_at <= max(task.original_review_due_at, now):
        raise AppError('VALIDATION_FAILED', 422, '申请的截止时间必须晚于原期限和当前时间')
    row = TaskExtension(
        id=uuid4(),
        task_id=task_id,
        requested_by=actor.id,
        requested_at=now,
        status='PENDING',
        original_due_at=task.original_review_due_at,
        requested_due_at=body.requested_due_at,
        reason=body.reason,
    )
    session.add(row)
    await session.flush()
    return await finish(session, actor, row, key, route, payload, request_id)


async def decide(session, actor, extension_id, body, key, request_id):
    row = await session.get(TaskExtension, extension_id)
    if row is None:
        raise AppError('RESOURCE_NOT_FOUND', 404, '申请不存在或不可见')
    route = 'task.extension.decide'
    payload = {'id': str(extension_id), **body.model_dump(mode='json')}
    cached = await audit.replay(session, actor, key, route, payload)
    if cached:
        return cached
    await dispatch.lock_task_thesis(session, row.task_id)
    await session.get(ExpertTask, row.task_id, with_for_update=True, populate_existing=True)
    await session.refresh(row)
    if row.status != 'PENDING' or not await is_active(session, row.task_id):
        raise conflict('申请已处理或任务已结束')
    now = utc_now()
    if body.status == 'APPROVED' and row.requested_due_at <= now:
        raise conflict('申请的截止时间已过，请驳回后重新申请')
    row.status, row.decided_by, row.decided_at = body.status, actor.id, now
    row.decision_reason = body.reason
    await session.flush()
    return await finish(session, actor, row, key, route, payload, request_id)


async def finish(session, actor, row, key, route, payload, request_id):
    data = record(row, True)
    await audit.record(
        session,
        user=actor,
        action=route,
        object_type='task_extension',
        object_id=str(row.id),
        request_id=request_id,
        detail={'task_id': str(row.task_id), 'status': row.status},
    )
    await audit.remember(session, actor, key, route, payload, data)
    await session.commit()
    return data
