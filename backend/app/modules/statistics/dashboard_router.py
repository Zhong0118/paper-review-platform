from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.statistics.dashboard_service import dashboard
from app.shared.enums import RoleCode
from app.shared.time_scope import TimeScopeRequest, time_scope_request

router = APIRouter(prefix='/api/v1', tags=['dashboard'])


@router.get('/school-review/dashboard')
async def school_dashboard(request: Request,
                           current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
                           session: AsyncSession = Depends(get_session),
                           scope: TimeScopeRequest = Depends(time_scope_request)):
    return ok(await dashboard(session, current, scope, scores=True), request_id=getattr(request.state, 'request_id', None))


@router.get('/platform-review/dashboard')
async def platform_dashboard(request: Request,
                             current: CurrentUser = Depends(require_roles(RoleCode.PLATFORM_REVIEWER)),
                             session: AsyncSession = Depends(get_session),
                             scope: TimeScopeRequest = Depends(time_scope_request)):
    return ok(await dashboard(session, current, scope), request_id=getattr(request.state, 'request_id', None))
