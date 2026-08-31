from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import decode_access_token
from app.db.session import get_session
from app.modules.user.models import User

bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    id: UUID
    role: str
    tenant_id: UUID | None
    data_scope: dict
    username: str | None = None
    display_name: str | None = None
    tenant_code: str | None = None


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效")
    try:
        payload = decode_access_token(creds.credentials)
    except InvalidTokenError as exc:
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效") from exc
    user_id = UUID(payload["sub"])
    user = await session.get(User, user_id)
    if user is None or user.status != "ACTIVE":
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效")
    tenant_raw = payload.get("tenant_id")
    current = CurrentUser(
        id=user.id,
        role=payload["role"],
        tenant_id=UUID(tenant_raw) if tenant_raw else None,
        data_scope=payload.get("data_scope") or {},
        username=user.username,
        display_name=user.display_name,
        tenant_code=None,
    )
    request.state.current_user = current
    return current


def require_roles(*roles: str):
    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
        return user

    return _dep
