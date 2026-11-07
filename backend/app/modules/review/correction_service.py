"""Corrections preserve submitted tasks and append published versions."""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.audit import service as audit
from app.modules.auth.deps import CurrentUser
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.dispatch.service import get_task_for_expert
from app.modules.result.models import ResultPublication, ResultSummary
from app.modules.result.service import publication_snapshot
from app.modules.review.models import (ReviewCorrectionRequest as Correction,
    ReviewCorrectionNote as Note, ReviewResultRevision as Revision, ReviewResultVersion)
from app.modules.review.service import ReviewPayload, validate_for_submit, total_score
from app.modules.thesis.models import Thesis

OPEN = ('REQUESTED', 'APPROVED', 'AWAITING_SCHOOL')


def hidden():
    return AppError('RESOURCE_NOT_FOUND', 404, '资源不存在或不可见')


def conflict(message='更正状态或版本已变化，请刷新后重试'):
    return AppError('STATE_TRANSITION_DENIED', 409, message)


async def original_result(session, task):
    row = (await session.execute(select(ReviewResultVersion).where(
        ReviewResultVersion.task_id == task.id, ReviewResultVersion.is_current.is_(True)
    ))).scalar_one_or_none()
    if row is None:
        raise hidden()
    return row


async def effective_revision(session, task_id):
    return (await session.execute(select(Revision).join(Correction, Correction.id == Revision.request_id)
        .where(Revision.task_id == task_id, Correction.status == 'ACTIVATED')
        .order_by(Revision.revision_no.desc()).limit(1))).scalar_one_or_none()


async def serialize(session, row, user):
    revision = (await session.execute(select(Revision).where(Revision.request_id == row.id))).scalar_one_or_none()
    notes = (await session.execute(select(Note).where(Note.request_id == row.id).order_by(Note.created_at))).scalars()
    data = {'id': str(row.id), 'task_id': str(row.task_id), 'status': row.status,
            'version': row.version, 'base_result_id': str(row.base_result_id),
            'base_revision_id': str(row.base_revision_id) if row.base_revision_id else None,
            'created_at': row.created_at.isoformat(),
            'notes': [{'kind': n.note_kind, 'reason': n.reason} for n in notes],
            'revision': ({'id': str(revision.id), 'total': revision.total,
                          'payload': {**revision.scores, **revision.comments}} if revision else None)}
    if revision:
        from app.modules.review.comment_checks import anonymous_summary
        data['revision']['check_summary'] = anonymous_summary(revision.check_summary)
    if user.role == 'expert':
        data['draft_payload'] = row.draft_payload
    if user.role in ('school_reviewer', 'platform_reviewer'):
        task = await session.get(ExpertTask, row.task_id)
        data['thesis_id'] = str(task.thesis_id)
    if user.role == 'school_reviewer':
        base = (await session.get(Revision, row.base_revision_id) if row.base_revision_id
                else await session.get(ReviewResultVersion, row.base_result_id))
        data['before'] = {'total': base.total, 'payload': {**base.scores, **base.comments}} if base else None
    return data


async def list_for_task(session, user, task_id):
    task = await get_task_for_expert(session, user, task_id)
    if task.status != 'SUBMITTED':
        raise hidden()
    base = await original_result(session, task)
    revision = await effective_revision(session, task.id)
    rows = (await session.execute(select(Correction).where(Correction.task_id == task.id)
        .order_by(Correction.created_at.desc()))).scalars().all()
    return {'base_result_id': str(base.id), 'base_revision_id': str(revision.id) if revision else None,
            'current_payload': {**(revision or base).scores, **(revision or base).comments},
            'requests': [await serialize(session, row, user) for row in rows]}


async def list_requests(session, user):
    if user.role not in ('school_reviewer', 'platform_reviewer'):
        raise hidden()
    rows = (await session.execute(select(Correction).order_by(Correction.created_at.desc()))).scalars().all()
    return [await serialize(session, row, user) for row in rows]


async def command(session: AsyncSession, user: CurrentUser, action: str, target: UUID,
                  body: dict, key: str, request_id: str | None):
    required = {'request': 'expert', 'cancel': 'expert', 'draft': 'expert', 'submit': 'expert',
                'decide': 'platform_reviewer', 'activate': 'school_reviewer', 'reject': 'school_reviewer'}
    if user.role != required[action]:
        raise hidden()
    row = None
    if action == 'request':
        task = await get_task_for_expert(session, user, target)
    else:
        row = await session.get(Correction, target)
        if row is None:
            raise hidden()
        task = await session.get(ExpertTask, row.task_id)
        if task is None:
            raise hidden()
    thesis = (await session.execute(select(Thesis).where(Thesis.id == task.thesis_id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if thesis is None:
        raise hidden()
    task = (await session.execute(select(ExpertTask).where(ExpertTask.id == task.id)
        .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if task is None:
        raise hidden()
    if row is not None:
        row = (await session.execute(select(Correction).where(Correction.id == row.id)
            .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
        if row is None:
            raise hidden()
    digest = {'target': str(target), **body}
    cached = await audit.replay(session, user, key, f'correction:{action}', digest, wait=False)
    if cached is not None:
        return cached
    round_ = await session.get(ReviewRound, task.round_id)
    if (task.status != 'SUBMITTED' or thesis.stage not in ('RESULT_PROCESSING', 'COMPLETED')
            or round_ is None or round_.thesis_version_id != thesis.current_version_id):
        raise conflict('当前论文或评阅任务不允许更正')
    if row is not None and body['version'] != row.version:
        raise AppError('VERSION_CONFLICT', 409, '版本已变化，请刷新后重试')
    note_kind = None
    if action == 'request':
        base = await original_result(session, task)
        revision = await effective_revision(session, task.id)
        if (str(base.id) != str(body['base_result_id'])
                or (str(revision.id) if revision else None) != body['base_revision_id']):
            raise conflict('所选结果不是当前生效版本')
        if await session.scalar(select(Correction.id).where(Correction.task_id == task.id, Correction.status.in_(OPEN))):
            raise conflict('已有待处理的更正申请')
        row = Correction(task_id=task.id, round_id=task.round_id, tenant_id=task.tenant_id,
                         base_result_id=base.id, base_revision_id=revision.id if revision else None,
                         requested_by=user.id, status='REQUESTED', version=1, draft_payload={})
        session.add(row)
        note_kind = 'EXPERT_REQUEST'
    elif action == 'decide':
        if row.status != 'REQUESTED': raise conflict()
        row.status = 'APPROVED' if body['decision'] == 'APPROVE' else 'REJECTED'
        row.decided_by = user.id
        note_kind = 'PLATFORM_DECISION'
    elif action == 'cancel':
        if row.status not in ('REQUESTED', 'APPROVED'): raise conflict()
        row.status = 'CANCELLED'
    elif action in ('draft', 'submit'):
        if row.status != 'APPROVED': raise conflict()
        payload = ReviewPayload(**body['payload'])
        if action == 'submit':
            validate_for_submit(payload, round_.rule_snapshot)
            from app.modules.review.comment_checks import confirm_checks
            from app.modules.review.comment_similarity import checked_report
            report = await checked_report(session, user, task.id, payload.model_dump(), round_.rule_snapshot)
            check_summary = confirm_checks(payload.model_dump(), round_.rule_snapshot, body.get('check_ack'), user.id, report=report)
            score_keys = [d['key'] for d in round_.rule_snapshot['dimensions']]
            data = payload.model_dump()
            number = (await session.scalar(select(func.max(Revision.revision_no)).where(Revision.task_id == task.id)) or 0) + 1
            revision = Revision(request_id=row.id, task_id=task.id, round_id=task.round_id,
                tenant_id=task.tenant_id, base_result_id=row.base_result_id, revision_no=number,
                scores={k: data[k] for k in score_keys}, comments={k: v for k, v in data.items() if k not in score_keys},
                total=total_score(payload, round_.rule_snapshot), rule_snapshot=round_.rule_snapshot, check_summary=check_summary)
            session.add(revision)
            await session.flush()  # The request must still be APPROVED for the immutable insert.
            row.status = 'AWAITING_SCHOOL'
        row.draft_payload = payload.model_dump()
    else:
        if row.status != 'AWAITING_SCHOOL': raise conflict()
        if action == 'activate':
            summary = (await session.execute(select(ResultSummary).where(ResultSummary.round_id == task.round_id)
                .with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
            revision = (await session.execute(select(Revision).where(Revision.request_id == row.id))).scalar_one_or_none()
            if summary is None or revision is None or summary.effective_revision_id != row.base_revision_id:
                raise conflict('汇总版本与更正申请不一致')
            summary.total = revision.total
            summary.effective_revision_id = revision.id
            summary.version += 1
            await session.flush()
            if thesis.stage == 'COMPLETED':
                previous = (await session.execute(select(ResultPublication).where(ResultPublication.summary_id == summary.id)
                    .order_by(ResultPublication.publication_no.desc()).limit(1))).scalar_one_or_none()
                if previous is None: raise conflict('缺少原发布记录')
                snapshot = publication_snapshot(thesis, summary, [revision])
                session.add(ResultPublication(summary_id=summary.id, published_by=user.id,
                    published_at=datetime.now(timezone.utc), snapshot=snapshot,
                    publication_no=previous.publication_no + 1, replaces_id=previous.id))
            row.status = 'ACTIVATED'
        else:
            row.status = 'SCHOOL_REJECTED'
        note_kind = 'SCHOOL_DECISION'
    if action != 'request':
        row.version += 1
    await session.flush()
    if note_kind:
        session.add(Note(request_id=row.id, author_id=user.id, note_kind=note_kind, reason=body['reason']))
        await session.flush()
    data = await serialize(session, row, user)
    await audit.record(session, user=user, action=f'correction_{action}', object_type='review_correction',
        object_id=str(row.id), request_id=request_id, detail={'status': row.status, 'version': row.version})
    await audit.remember(session, user, key, f'correction:{action}', digest, data)
    return data
