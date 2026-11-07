"""Calendar-year scope for thesis-backed lists, independent of updates or task dates."""
from calendar import monthrange
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import Response
from app.core.exceptions import AppError


def utc_now():
    return datetime.now(timezone.utc)


def resolve_time_scope(scope: str, as_of: datetime) -> tuple[datetime | None, datetime]:
    if scope not in ('all', 'past_year'):
        raise AppError('VALIDATION_FAILED', 422, '时间范围只能为all或past_year')
    if scope == 'all':
        return None, as_of
    local = as_of.astimezone(ZoneInfo('Asia/Shanghai'))
    day = min(local.day, monthrange(local.year - 1, local.month)[1])
    lower = local.replace(year=local.year - 1, day=day, hour=0, minute=0, second=0, microsecond=0)
    return lower.astimezone(timezone.utc), as_of


def apply_thesis_scope(query, scope: str = 'all', as_of: datetime | None = None):
    from app.modules.thesis.models import Thesis
    lower, upper = resolve_time_scope(scope, as_of if as_of is not None else utc_now())
    return query if lower is None else query.where(Thesis.created_at >= lower, Thesis.created_at <= upper)


@dataclass(frozen=True)
class TimeScopeRequest:
    scope: str
    as_of: datetime


def time_scope_request(response: Response, time_scope: str = 'all') -> TimeScopeRequest:
    as_of = utc_now()
    lower, upper = resolve_time_scope(time_scope, as_of)
    response.headers['X-Time-Scope'] = time_scope
    response.headers['X-Time-From'] = lower.isoformat() if lower else ''
    response.headers['X-As-Of'] = upper.isoformat()
    return TimeScopeRequest(time_scope, as_of)
