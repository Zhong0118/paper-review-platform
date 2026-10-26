"""Read-only current-work projection shared by cards and their drill-down lists."""
from sqlalchemy import and_, select

from app.core.exceptions import AppError
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.result.models import ResultPublication, ResultSummary
from app.modules.thesis.models import Thesis, ThesisVersion
from app.modules.user.models import StudentEligibility
from app.shared.enums import RoleCode
from app.shared.time_scope import apply_thesis_scope

ACTIVE_TASKS = ('INVITED', 'IN_REVIEW', 'SUBMITTED')
FILTERS = ('ALL', 'WAITING', *ACTIVE_TASKS)


def validate_status_filter(value):
    if value not in FILTERS:
        raise AppError('VALIDATION_FAILED', 422, '未知任务状态筛选')
    return value


def can_assign(stage, round_status, occupied):
    return (stage in ('READY_FOR_DISPATCH', 'UNDER_REVIEW')
            and round_status in ('CREATED', 'ACTIVE') and not occupied)


async def operation_rows(session, user, *, time_scope='all', as_of=None, labels=False, scores=False):
    if user.role not in (RoleCode.SCHOOL_REVIEWER, RoleCode.PLATFORM_REVIEWER) or (
        user.role == RoleCode.SCHOOL_REVIEWER and user.tenant_id is None
    ) or (scores and user.role != RoleCode.SCHOOL_REVIEWER):
        raise AppError('ACCESS_DENIED', 403, '无权执行该操作')
    # One SELECT: all rows, tasks and (school only) latest publications share a
    # PostgreSQL statement snapshot even when concurrent commands commit.
    latest_round = select(ReviewRound.id).where(ReviewRound.thesis_id == Thesis.id).order_by(
        ReviewRound.round_no.desc()).limit(1).correlate(Thesis).scalar_subquery()
    query = select(Thesis.id, Thesis.stage, ReviewRound.id.label('round_id'),
                   ReviewRound.status.label('round_status'), ExpertTask.id.label('task_id'),
                   ExpertTask.status.label('task_status'), ExpertTask.expert_id).outerjoin(
        ReviewRound, and_(ReviewRound.id == latest_round,
                          ReviewRound.thesis_version_id == Thesis.current_version_id,
                          ReviewRound.status != 'CANCELLED')).outerjoin(
        ExpertTask, ExpertTask.round_id == ReviewRound.id).where(
        Thesis.stage.in_(('READY_FOR_DISPATCH', 'UNDER_REVIEW', 'RESULT_PROCESSING', 'COMPLETED')))
    if user.role == RoleCode.SCHOOL_REVIEWER:
        query = query.where(Thesis.tenant_id == user.tenant_id)
    if labels:
        query = query.outerjoin(ThesisVersion, ThesisVersion.id == Thesis.current_version_id).outerjoin(
            StudentEligibility, and_(StudentEligibility.student_membership_id == Thesis.student_membership_id,
                                     StudentEligibility.review_batch_id == Thesis.review_batch_id)
        ).add_columns(ThesisVersion.title, ThesisVersion.discipline_code, StudentEligibility.student_name)
    if scores:
        # Read the published value, not a mutable/unpublished summary or revision.
        score = select(ResultPublication.snapshot['total'].as_integer()).join(
            ResultSummary, ResultSummary.id == ResultPublication.summary_id).where(
            ResultSummary.round_id == ReviewRound.id, Thesis.stage == 'COMPLETED'
        ).order_by(ResultPublication.publication_no.desc()).limit(1).correlate(ReviewRound, Thesis).scalar_subquery()
        query = query.add_columns(score.label('published_score'))
    query = apply_thesis_scope(query, time_scope, as_of).order_by(
        Thesis.created_at.desc(), Thesis.id, ExpertTask.invited_at.asc(), ExpertTask.id)
    papers = {}
    for row in (await session.execute(query)).mappings():
        key = str(row['id'])
        if key not in papers:
            papers[key] = {k: row[k] for k in ('stage', 'round_id', 'round_status')}
            papers[key].update(thesis_id=key, tasks=[])
            if labels:
                papers[key].update({k: row[k] or '' for k in ('title', 'discipline_code', 'student_name')})
            if scores:
                papers[key]['published_score'] = row['published_score']
        if row['task_id'] is not None:
            papers[key]['tasks'].append({'id': str(row['task_id']), 'status': row['task_status'],
                                         'expert_id': str(row['expert_id'])})
    for paper in papers.values():
        occupied = [t for t in paper['tasks'] if t['status'] in ACTIVE_TASKS]
        paper['waiting'] = can_assign(paper['stage'], paper['round_status'], occupied)
    return list(papers.values())


def matches_filter(row, status):
    return status == 'ALL' or (row['waiting'] if status == 'WAITING' else any(
        task['status'] == status for task in row['tasks']))


def card_counts(rows):
    counts = dict(waiting_theses=0, invited_tasks=0, in_review_tasks=0, submitted_tasks=0, overdue_tasks=None)
    for row in rows:
        counts['waiting_theses'] += int(row['waiting'])
        for task in row['tasks']:
            key = {'INVITED': 'invited_tasks', 'IN_REVIEW': 'in_review_tasks', 'SUBMITTED': 'submitted_tasks'}.get(task['status'])
            if key:
                counts[key] += 1
    return counts
