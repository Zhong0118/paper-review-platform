# 应用服务层
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import AppError
from app.core.security import hash_password
from app.modules.audit import service as audit_service
from app.modules.auth import service as auth_service
from app.modules.auth.deps import CurrentUser
from app.modules.tenant.models import Tenant
from app.modules.user.models import Role, TenantUserMembership, User, UserRoleAssignment
from app.modules.user.schema import CreateTenantUserInput, ResetPasswordInput, UpdateMemberInput


ROLE_MEMBERSHIP = {
    "student": "STUDENT",
    "supervisor": "SUPERVISOR",
    "school_reviewer": "STAFF",
}


@dataclass(frozen=True)
class CreatedTenantUser:
    user: User
    membership: TenantUserMembership
    assignment: UserRoleAssignment


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def _lock_active_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    tenant = (
        await session.execute(
            select(Tenant).where(Tenant.id == tenant_id)
            .with_for_update(read=True, key_share=True)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise _hidden()
    if tenant.status != "ACTIVE":
        raise AppError("STATE_TRANSITION_DENIED", 409, "暂停的学校不能管理成员")


async def create_tenant_user(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    organization_id: UUID,
    data: CreateTenantUserInput,
    *,
    role_code: str,
    membership_type: str,
) -> CreatedTenantUser:
    if ROLE_MEMBERSHIP.get(role_code) != membership_type:
        raise AppError("VALIDATION_FAILED", 422, "角色与成员类型不一致")
    await _lock_active_tenant(session, tenant_id)
    if (
        await session.execute(select(User.id).where(User.username == data.username))
    ).scalar_one_or_none() is not None:
        raise AppError("RESOURCE_CONFLICT", 409, "用户名已存在")
    if (
        await session.execute(
            select(TenantUserMembership.id).where(
                TenantUserMembership.tenant_id == tenant_id,
                TenantUserMembership.external_id == data.external_id,
            )
        )
    ).scalar_one_or_none() is not None:
        raise AppError("RESOURCE_CONFLICT", 409, "成员编号已存在")
    role = (
        await session.execute(select(Role).where(Role.code == role_code))
    ).scalar_one()
    try:
        async with session.begin_nested():
            user = User(
                username=data.username,
                password_hash=hash_password(data.password),
                provisioned_by=actor.id,
                provisioned_tenant_id=tenant_id,
                display_name=data.display_name,
                status="ACTIVE",
            )
            session.add(user)
            await session.flush()
            membership = TenantUserMembership(
                tenant_id=tenant_id,
                user_id=user.id,
                organization_id=organization_id,
                membership_type=membership_type,
                external_id=data.external_id,
                external_source="manual",
                is_active=True,
                display_name=data.display_name,
            )
            assignment = UserRoleAssignment(
                user_id=user.id,
                tenant_id=tenant_id,
                role_id=role.id,
                data_scope={},
            )
            session.add(assignment)
            await session.flush()
            session.add(membership)
            await session.flush()
    except IntegrityError as exc:
        raise AppError("RESOURCE_CONFLICT", 409, "账号或成员编号已存在") from exc
    return CreatedTenantUser(user, membership, assignment)


async def _locked_member(
    session: AsyncSession,
    tenant_id: UUID,
    membership_id: UUID,
) -> tuple[TenantUserMembership, User, UserRoleAssignment]:
    await _lock_active_tenant(session, tenant_id)
    membership = (
        await session.execute(
            select(TenantUserMembership)
            .where(
                TenantUserMembership.id == membership_id,
                TenantUserMembership.tenant_id == tenant_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if membership is None:
        raise _hidden()
    user = (
        await session.execute(
            select(User).where(User.id == membership.user_id)
            .with_for_update().execution_options(populate_existing=True)
        )
    ).scalar_one()
    assignment = (
        await session.execute(
            select(UserRoleAssignment)
            .where(
                UserRoleAssignment.user_id == user.id,
                UserRoleAssignment.tenant_id == tenant_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise _hidden()
    return membership, user, assignment


async def update_member(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    membership_id: UUID,
    data: UpdateMemberInput,
) -> CreatedTenantUser:
    membership, user, assignment = await _locked_member(session, tenant_id, membership_id)
    if membership.updated_at != data.expected_updated_at:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    user.display_name = data.display_name
    user.contact_phone = data.contact_phone
    user.contact_email = data.contact_email
    membership.display_name = data.display_name
    membership.updated_at = datetime.now(timezone.utc)
    await session.flush()
    return CreatedTenantUser(user, membership, assignment)


async def disable_tenant_user(
    session: AsyncSession, actor: CurrentUser, tenant_id: UUID, membership_id: UUID
) -> CreatedTenantUser:
    membership, user, assignment = await _locked_member(session, tenant_id, membership_id)
    if user.status != "ACTIVE" or not membership.is_active:
        raise AppError("STATE_TRANSITION_DENIED", 409, "账号当前状态不能停用")
    now = datetime.now(timezone.utc)
    user.status = "DISABLED"
    membership.is_active = False
    assignment.effective_until = now
    await auth_service.revoke_user_sessions(session, user.id, at=now)
    await audit_service.record(
        session, user=actor, action="disable_user", object_type="user", object_id=str(user.id)
    )
    await session.flush()
    return CreatedTenantUser(user, membership, assignment)


async def enable_tenant_user(
    session: AsyncSession, actor: CurrentUser, tenant_id: UUID, membership_id: UUID
) -> CreatedTenantUser:
    membership, user, assignment = await _locked_member(session, tenant_id, membership_id)
    if user.status != "DISABLED" or membership.is_active:
        raise AppError("STATE_TRANSITION_DENIED", 409, "账号当前状态不能启用")
    user.status = "ACTIVE"
    membership.is_active = True
    assignment.effective_from = datetime.now(timezone.utc)
    assignment.effective_until = None
    await audit_service.record(
        session, user=actor, action="enable_user", object_type="user", object_id=str(user.id)
    )
    await session.flush()
    return CreatedTenantUser(user, membership, assignment)


async def reset_tenant_user_password(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    membership_id: UUID,
    data: ResetPasswordInput,
) -> CreatedTenantUser:
    membership, user, assignment = await _locked_member(session, tenant_id, membership_id)
    user.password_hash = hash_password(data.password)
    await auth_service.revoke_user_sessions(session, user.id)
    await audit_service.record(
        session, user=actor, action="reset_password", object_type="user", object_id=str(user.id)
    )
    await session.flush()
    return CreatedTenantUser(user, membership, assignment)


async def school_member(
    session: AsyncSession, tenant_id: UUID, membership_id: UUID,
) -> tuple[TenantUserMembership, User]:
    row = (
        await session.execute(
            select(TenantUserMembership, User)
            .join(User, User.id == TenantUserMembership.user_id)
            .where(
                TenantUserMembership.id == membership_id,
                TenantUserMembership.tenant_id == tenant_id,
                TenantUserMembership.membership_type.in_(["STUDENT", "SUPERVISOR"]),
            )
        )
    ).one_or_none()
    if row is None:
        raise _hidden()
    return row


async def list_school_members(
    session: AsyncSession, tenant_id: UUID, membership_type: str | None,
) -> list[tuple[TenantUserMembership, User]]:
    stmt = (
        select(TenantUserMembership, User)
        .join(User, User.id == TenantUserMembership.user_id)
        .where(
            TenantUserMembership.tenant_id == tenant_id,
            TenantUserMembership.membership_type.in_(["STUDENT", "SUPERVISOR"]),
        )
        .order_by(TenantUserMembership.created_at, TenantUserMembership.id)
    )
    if membership_type:
        stmt = stmt.where(TenantUserMembership.membership_type == membership_type)
    return list((await session.execute(stmt)).all())


def serialize_member(row: tuple[TenantUserMembership, User]) -> dict:
    membership, user = row
    return {
        "membership_id": str(membership.id), "user_id": str(user.id),
        "username": user.username, "display_name": membership.display_name,
        "external_id": membership.external_id, "membership_type": membership.membership_type,
        "status": user.status, "is_active": membership.is_active,
        "contact_phone": user.contact_phone, "contact_email": user.contact_email,
        "updated_at": membership.updated_at.isoformat(),
    }
