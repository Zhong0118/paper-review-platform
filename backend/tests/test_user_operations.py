import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.core.security import verify_password
from app.modules.audit.models import AuditEvent
from app.modules.auth.deps import CurrentUser
from app.modules.tenant.models import Organization, Tenant
from app.modules.user import service as user_service
from app.modules.user.models import Role, TenantUserMembership, User, UserRoleAssignment
from app.modules.user.schema import CreateTenantUserInput, ResetPasswordInput


async def _school_actor(session: AsyncSession) -> tuple[CurrentUser, Tenant, Organization]:
    user = (await session.execute(select(User).where(User.username == "school.wang"))).scalar_one()
    assignment = (await session.execute(select(UserRoleAssignment).where(UserRoleAssignment.user_id == user.id))).scalar_one()
    tenant = await session.get(Tenant, assignment.tenant_id)
    organization = (await session.execute(select(Organization).where(Organization.tenant_id == assignment.tenant_id))).scalars().first()
    assert tenant is not None and organization is not None
    return CurrentUser(id=user.id, role="school_reviewer", tenant_id=tenant.id, data_scope={}), tenant, organization


@pytest.mark.asyncio
async def test_create_tenant_user_normalizes_username_and_derives_role(db_session: AsyncSession):
    actor, tenant, organization = await _school_actor(db_session)
    created = await user_service.create_tenant_user(
        db_session,
        actor,
        tenant.id,
        organization.id,
        CreateTenantUserInput(
            username=" Student.New ", display_name="新学生", external_id="S-new", password="long-password-1"
        ),
        role_code="student",
        membership_type="STUDENT",
    )
    await db_session.flush()

    assert created.user.username == "student.new"
    assert created.membership.membership_type == "STUDENT"
    role = await db_session.get(Role, created.assignment.role_id)
    assert role is not None and role.code == "student"
    assert verify_password("long-password-1", created.user.password_hash)

    with pytest.raises(AppError) as error:
        await user_service.create_tenant_user(
            db_session,
            actor,
            tenant.id,
            organization.id,
            CreateTenantUserInput(
                username="STUDENT.NEW", display_name="重复", external_id="S-other", password="long-password-2"
            ),
            role_code="student",
            membership_type="STUDENT",
        )
    assert error.value.code == "RESOURCE_CONFLICT"


@pytest.mark.asyncio
async def test_disable_enable_and_reset_preserve_assignment_and_revoke_sessions(db_session: AsyncSession):
    actor, tenant, _ = await _school_actor(db_session)
    user = (await db_session.execute(select(User).where(User.username == "student.lin"))).scalar_one()
    membership = (await db_session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == user.id))).scalar_one()
    assignment = (await db_session.execute(select(UserRoleAssignment).where(UserRoleAssignment.user_id == user.id))).scalar_one()
    assignment_id = assignment.id

    await user_service.disable_tenant_user(db_session, actor, tenant.id, membership.id)
    assert user.status == "DISABLED"
    assert membership.is_active is False
    assert assignment.effective_until is not None

    await user_service.enable_tenant_user(db_session, actor, tenant.id, membership.id)
    assert user.status == "ACTIVE"
    assert membership.is_active is True
    assert assignment.id == assignment_id and assignment.effective_until is None

    await db_session.refresh(user, attribute_names=["password_hash"])
    old_hash = user.password_hash
    await user_service.reset_tenant_user_password(
        db_session, actor, tenant.id, membership.id, ResetPasswordInput(password="replacement-123")
    )
    await db_session.refresh(user, attribute_names=["password_hash"])
    assert user.password_hash != old_hash
    assert verify_password("replacement-123", user.password_hash)
    details = list((await db_session.execute(select(AuditEvent.detail))).scalars())
    assert "replacement-123" not in str(details)
