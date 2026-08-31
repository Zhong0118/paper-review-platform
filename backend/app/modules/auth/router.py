from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, get_current_user
from app.modules.auth.schemas import LoginRequest, LogoutRequest, RefreshRequest
from app.modules.auth import service as auth_service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)):
    data = await auth_service.login(session, body.username, body.password)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@router.post("/refresh")
async def refresh(body: RefreshRequest, request: Request, session: AsyncSession = Depends(get_session)):
    data = await auth_service.refresh_tokens(session, body.refresh_token)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@router.post("/logout")
async def logout(body: LogoutRequest, request: Request, session: AsyncSession = Depends(get_session)):
    await auth_service.logout(session, body.refresh_token)
    await session.commit()
    return ok({}, request_id=getattr(request.state, "request_id", None))


me_router = APIRouter(prefix="/api/v1", tags=["me"])


@me_router.get("/me")
async def me(
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await auth_service.me_payload(session, current.id, current.role, current.tenant_id)
    return ok(data, request_id=getattr(request.state, "request_id", None))
