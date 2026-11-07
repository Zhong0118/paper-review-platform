from app.core.exceptions import AppError
from app.modules.dispatch.projection import card_counts, operation_rows
from app.shared.time_scope import resolve_time_scope


async def dashboard(session, user, scope, *, scores=False):
    rows = await operation_rows(session, user, time_scope=scope.scope, as_of=scope.as_of, scores=scores)
    lower, upper = resolve_time_scope(scope.scope, scope.as_of)
    data = dict(as_of=upper.isoformat(), time_scope=scope.scope, time_from=lower.isoformat() if lower else None,
                cards=card_counts(rows))
    data['overdue_status']='CONFIGURED' if data['cards']['overdue_tasks'] is not None else 'NOT_CONFIGURED'
    if scores:
        bands = [{'code': code, 'count': 0} for code in ('0-59', '60-79', '80-100')]
        for row in rows:
            score = row['published_score']
            if score is None:
                continue
            if not 0 <= score <= 100:
                raise AppError('STATE_TRANSITION_DENIED', 409, '发布分值异常，需核查')
            bands[0 if score < 60 else 1 if score < 80 else 2]['count'] += 1
        data.update(published_score_bands=bands, published_count=sum(b['count'] for b in bands))
    return data
