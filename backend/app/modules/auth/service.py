from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.orm import load_only, undefer
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
from app.modules.tenant.models import Organization, ReviewBatch, Tenant
from app.modules.user.models import Role, StudentEligibility, TenantUserMembership, User, UserRoleAssignment


TENANT_ROLE_MEMBERSHIP_TYPES = {
    "student": "STUDENT",
    "supervisor": "SUPERVISOR",
    "school_reviewer": "STAFF",
}


@dataclass(frozen=True)
class ActiveIdentity:
    user: User
    role: Role
    assignment: UserRoleAssignment
    tenant: Tenant | None
    membership: TenantUserMembership | None


def _invalid_identity() -> AppError:
    return AppError("AUTH_REQUIRED", 401, "未认证或会话失效")


async def load_active_identity(
    session: AsyncSession,
    user_id: UUID,
    *,
    token_role: str | None = None,
    token_tenant_id: UUID | None = None,
    token_auth_version: object = None,
) -> ActiveIdentity:
    stmt = (
        select(User, Role, UserRoleAssignment)
        .options(
            load_only(User.id, User.username, User.display_name, User.status, User.auth_version),
            load_only(Role.id, Role.code),
            load_only(UserRoleAssignment.id, UserRoleAssignment.user_id,
                      UserRoleAssignment.tenant_id, UserRoleAssignment.role_id,
                      UserRoleAssignment.data_scope, UserRoleAssignment.effective_from,
                      UserRoleAssignment.effective_until),
        )
        .join(UserRoleAssignment, UserRoleAssignment.user_id == User.id)
        .join(Role, Role.id == UserRoleAssignment.role_id)
        .where(User.id == user_id)
        .execution_options(populate_existing=True)
    )
    row = (await session.execute(stmt)).one_or_none()
    if row is None:
        raise _invalid_identity()
    user, role, assignment = row
    now = datetime.now(timezone.utc)
    if (
        user.status != "ACTIVE"
        or assignment.effective_from > now
        or (assignment.effective_until is not None and assignment.effective_until <= now)
    ):
        raise _invalid_identity()
    if token_role is not None and (
        token_role != role.code or token_tenant_id != assignment.tenant_id
        or type(token_auth_version) is not int or token_auth_version < 1
        or token_auth_version != user.auth_version
    ):
        raise _invalid_identity()

    membership_type = TENANT_ROLE_MEMBERSHIP_TYPES.get(role.code)
    if membership_type is None:
        if assignment.tenant_id is not None:
            raise _invalid_identity()
        return ActiveIdentity(user, role, assignment, None, None)
    if assignment.tenant_id is None:
        raise _invalid_identity()

    tenant = (
        await session.execute(
            select(Tenant).options(load_only(Tenant.id, Tenant.code, Tenant.status))
            .where(Tenant.id == assignment.tenant_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    membership = (
        await session.execute(
            select(TenantUserMembership).options(load_only(
                TenantUserMembership.id, TenantUserMembership.user_id,
                TenantUserMembership.tenant_id, TenantUserMembership.membership_type,
                TenantUserMembership.is_active,
            )).where(
                TenantUserMembership.user_id == user.id,
                TenantUserMembership.tenant_id == assignment.tenant_id,
                TenantUserMembership.membership_type == membership_type,
            ).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if tenant is None or tenant.status != "ACTIVE" or membership is None or not membership.is_active:
        raise _invalid_identity()
    return ActiveIdentity(user, role, assignment, tenant, membership)


async def revoke_user_sessions(
    session: AsyncSession,
    user_id: UUID,
    *,
    at: datetime | None = None,
) -> int:
    user = (await session.execute(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if user is None:
        return 0
    user.auth_version += 1
    result = await session.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=at or datetime.now(timezone.utc))
    )
    return int(result.rowcount or 0)


async def issue_tokens(session: AsyncSession, identity: ActiveIdentity) -> dict:
    settings = get_settings()
    user = identity.user
    role = identity.role
    assignment = identity.assignment
    tenant_id = assignment.tenant_id
    access = create_access_token(
        user_id=user.id,
        role=role.code,
        tenant_id=tenant_id,
        auth_version=user.auth_version,
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
            "tenant_code": identity.tenant.code if identity.tenant else None,
        },
    }


async def login(session: AsyncSession, username: str, password: str) -> dict:
    stmt = (
        select(User).options(load_only(User.id, User.username, User.password_hash),
                             undefer(User.password_hash)).where(User.username == username)
        .with_for_update().execution_options(populate_existing=True)
    )
    user = (await session.execute(stmt)).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_password(password, user.password_hash):
        raise AppError("AUTH_REQUIRED", 401, "用户名或密码错误")
    identity = await load_active_identity(session, user.id)
    return await issue_tokens(session, identity)


async def refresh_tokens(session: AsyncSession, refresh_token: str) -> dict:
    hashed = hash_token(refresh_token)
    user_id = (await session.execute(
        select(AuthSession.user_id).where(AuthSession.refresh_token_hash == hashed)
    )).scalar_one_or_none()
    if user_id is None:
        raise AppError("AUTH_REQUIRED", 401, "会话已失效")
    user = (await session.execute(
        select(User).options(load_only(User.id)).where(User.id == user_id)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if user is None:
        raise AppError("AUTH_REQUIRED", 401, "会话已失效")
    record = (await session.execute(
        select(AuthSession).options(load_only(
            AuthSession.id, AuthSession.user_id, AuthSession.refresh_token_hash,
            AuthSession.expires_at, AuthSession.revoked_at,
        )).where(AuthSession.refresh_token_hash == hashed)
        .with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if record is None or record.revoked_at is not None or record.expires_at <= now:
        raise AppError("AUTH_REQUIRED", 401, "会话已失效")
    identity = await load_active_identity(session, record.user_id)
    record.revoked_at = now
    return await issue_tokens(session, identity)


async def logout(session: AsyncSession, refresh_token: str) -> None:
    hashed = hash_token(refresh_token)
    stmt = select(AuthSession).options(load_only(
        AuthSession.id, AuthSession.revoked_at,
    )).where(AuthSession.refresh_token_hash == hashed)
    record = (await session.execute(stmt)).scalar_one_or_none()
    if record and record.revoked_at is None:
        record.revoked_at = datetime.now(timezone.utc)


async def me_payload(session: AsyncSession, user_id: UUID, role: str, tenant_id: UUID | None) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效")
    tenant = await session.get(Tenant, tenant_id) if tenant_id else None
    return {
        "id": str(user.id),
        "username": user.username,
        "display_name": user.display_name,
        "role": role,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "tenant_code": tenant.code if tenant else None,
        "tenant_name": tenant.name if tenant else None,
    }


async def eligibility_payload(session: AsyncSession, user_id: UUID, tenant_id: UUID | None) -> dict:
    from app.modules.tenant import service as tenant_service

    if tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.user_id == user_id,
                TenantUserMembership.tenant_id == tenant_id,
                TenantUserMembership.membership_type == "STUDENT",
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    elig, batch = await tenant_service.current_student_eligibility(session, user_id, tenant_id)
    tenant = await session.get(Tenant, tenant_id)
    org = await session.get(Organization, membership.organization_id)
    return {
        "eligible": elig.status == "ELIGIBLE" and batch.status == "OPEN",
        "status": elig.status,
        "student_no": elig.student_no,
        "student_name": elig.student_name,
        "supervisor_name": elig.supervisor_name,
        "degree_type": elig.degree_type,
        "tenant_name": tenant.name if tenant else "",
        "college_name": org.name if org else "",
        "batch_id": str(elig.review_batch_id),
        "batch_name": batch.name if batch else "",
        "deadline": batch.end_at.isoformat() if batch and batch.end_at else "",
    }
