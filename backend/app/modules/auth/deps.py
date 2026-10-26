from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.db.session import get_session
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.auth import service as auth_service

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
    auth_version: int | None = None


async def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效")
    try:
        claims = verified_access_claims(creds.credentials)
    except InvalidTokenError as exc:
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效") from exc
    try:
        await bind_candidate_identity(session, claims)
        identity = await auth_service.load_active_identity(
            session, claims.user_id, token_role=claims.role,
            token_tenant_id=claims.tenant_id, token_auth_version=claims.auth_version,
        )
    except Exception:
        await session.rollback()
        raise
    current = CurrentUser(
        id=identity.user.id,
        role=identity.role.code,
        tenant_id=identity.assignment.tenant_id,
        data_scope=identity.assignment.data_scope or {},
        username=identity.user.username,
        display_name=identity.user.display_name,
        tenant_code=identity.tenant.code if identity.tenant else None,
        auth_version=identity.user.auth_version,
    )
    request.state.current_user = current
    return current


def require_roles(*roles: str):
    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
        return user

    return _dep
