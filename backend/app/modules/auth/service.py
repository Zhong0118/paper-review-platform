from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.security import (
    create_access_token,
    hash_token,
    new_refresh_token,
    verify_password,
)
from app.modules.auth.models import AuthSession
from app.modules.tenant.models import Tenant
from app.modules.user.models import Role, User, UserRoleAssignment


async def _load_assignment(session: AsyncSession, user: User) -> tuple[Role, UserRoleAssignment]:
    stmt = (
        select(Role, UserRoleAssignment)
        .join(UserRoleAssignment, UserRoleAssignment.role_id == Role.id)
        .where(UserRoleAssignment.user_id == user.id)
        .order_by(UserRoleAssignment.created_at.asc())
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise AppError("ACCESS_DENIED", 403, "账号未分配角色")
    return row[0], row[1]


async def _tenant_code(session: AsyncSession, tenant_id: UUID | None) -> str | None:
    if tenant_id is None:
        return None
    tenant = await session.get(Tenant, tenant_id)
    return tenant.code if tenant else None


async def issue_tokens(session: AsyncSession, user: User) -> dict:
    settings = get_settings()
    role, assignment = await _load_assignment(session, user)
    tenant_id = assignment.tenant_id
    access = create_access_token(
        user_id=user.id,
        role=role.code,
        tenant_id=tenant_id,
        data_scope=assignment.data_scope or {},
    )
    refresh = new_refresh_token()
    session.add(
        AuthSession(
            user_id=user.id,
            refresh_token_hash=hash_token(refresh),
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.jwt_refresh_ttl_seconds),
        )
    )
    user.last_login_at = datetime.now(timezone.utc)
    code = await _tenant_code(session, tenant_id)
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "expires_in": settings.jwt_access_ttl_seconds,
        "user": {
            "id": str(user.id),
            "username": user.username,
            "display_name": user.display_name,
            "role": role.code,
            "tenant_id": str(tenant_id) if tenant_id else None,
            "tenant_code": code,
        },
    }


async def login(session: AsyncSession, username: str, password: str) -> dict:
    stmt = select(User).where(User.username == username)
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(password, user.password_hash):
        raise AppError("AUTH_REQUIRED", 401, "用户名或密码错误")
    if user.status != "ACTIVE":
        raise AppError("AUTH_REQUIRED", 401, "账号不可用")
    return await issue_tokens(session, user)


async def refresh_tokens(session: AsyncSession, refresh_token: str) -> dict:
    hashed = hash_token(refresh_token)
    stmt = select(AuthSession).where(AuthSession.refresh_token_hash == hashed)
    record = (await session.execute(stmt)).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if record is None or record.revoked_at is not None or record.expires_at <= now:
        raise AppError("AUTH_REQUIRED", 401, "会话已失效")
    user = await session.get(User, record.user_id)
    if user is None:
        raise AppError("AUTH_REQUIRED", 401, "会话已失效")
    record.revoked_at = now
    return await issue_tokens(session, user)


async def logout(session: AsyncSession, refresh_token: str) -> None:
    hashed = hash_token(refresh_token)
    stmt = select(AuthSession).where(AuthSession.refresh_token_hash == hashed)
    record = (await session.execute(stmt)).scalar_one_or_none()
    if record and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)


async def me_payload(session: AsyncSession, user_id: UUID, role: str, tenant_id: UUID | None) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效")
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
        "role": role,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "tenant_code": await _tenant_code(session, tenant_id),
    }
