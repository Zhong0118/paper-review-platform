from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.modules.tenant.models import DisciplineCatalog, Organization, ReviewBatch, Tenant
from app.modules.user.models import (
    Role,
    StudentEligibility,
    TenantUserMembership,
    User,
    UserRoleAssignment,
)

ROLE_DEFS = [
    ("system_admin", "系统管理员", True),
    ("school_reviewer", "学校审核人员", False),
    ("platform_reviewer", "百杰审核人员", True),
    ("student", "学生", False),
    ("supervisor", "导师", False),
    ("expert", "专家", True),
]


async def _role(session: AsyncSession, code: str) -> Role:
    return (await session.execute(select(Role).where(Role.code == code))).scalar_one()


async def _ensure_roles(session: AsyncSession) -> None:
    existing = {r.code for r in (await session.execute(select(Role))).scalars()}
    for code, name, is_platform in ROLE_DEFS:
        if code not in existing:
            session.add(Role(id=uuid4(), code=code, name=name, is_platform=is_platform))
    await session.flush()


async def _user(session: AsyncSession, username: str, display_name: str, password: str) -> User:
    found = (await session.execute(select(User).where(User.username == username))).scalar_one_or_none()
    if found:
        return found
    user = User(
        id=uuid4(),
        username=username,
        password_hash=hash_password(password),
        display_name=display_name,
        status="ACTIVE",
    )
    session.add(user)
    await session.flush()
    return user


async def _tenant(session: AsyncSession, code: str, name: str) -> Tenant:
    found = (await session.execute(select(Tenant).where(Tenant.code == code))).scalar_one_or_none()
    if found:
        return found
    tenant = Tenant(id=uuid4(), code=code, name=name, status="ACTIVE")
    session.add(tenant)
    await session.flush()
    return tenant


async def seed_database(session: AsyncSession) -> None:
    settings = get_settings()
    password = settings.seed_password
    now = datetime.now(timezone.utc)
    await _ensure_roles(session)

    demo = await _tenant(session, "demo-univ", "演示大学")
    other = await _tenant(session, "other-univ", "对照大学")

    async def org_for(tenant: Tenant, external_id: str, name: str) -> Organization:
        found = (
            await session.execute(
                select(Organization).where(
                    Organization.tenant_id == tenant.id, Organization.external_id == external_id
                )
            )
        ).scalar_one_or_none()
        if found:
            return found
        row = Organization(
            id=uuid4(),
            tenant_id=tenant.id,
            external_id=external_id,
            org_type="COLLEGE",
            name=name,
            is_active=True,
        )
        session.add(row)
        await session.flush()
        return row

    demo_org = await org_for(demo, "cs", "计算机学院")
    other_org = await org_for(other, "cs", "计算机学院")

    async def batch_for(tenant: Tenant, code: str, name: str) -> ReviewBatch:
        found = (
            await session.execute(
                select(ReviewBatch).where(ReviewBatch.tenant_id == tenant.id, ReviewBatch.code == code)
            )
        ).scalar_one_or_none()
        if found:
            return found
        row = ReviewBatch(id=uuid4(), tenant_id=tenant.id, code=code, name=name, status="OPEN")
        session.add(row)
        await session.flush()
        return row

    demo_batch = await batch_for(demo, "2026-spring", "2026 年春季硕士论文盲审")
    other_batch = await batch_for(other, "2026-spring", "2026 年春季硕士论文盲审")

    for code, name in (("0812", "计算机科学与技术"), ("0835", "软件工程")):
        exists = (await session.execute(select(DisciplineCatalog).where(DisciplineCatalog.code == code))).scalar_one_or_none()
        if not exists:
            session.add(DisciplineCatalog(id=uuid4(), code=code, name=name, is_active=True))

    student = await _user(session, "student.lin", "林知远", password)
    school = await _user(session, "school.wang", "王老师", password)
    platform = await _user(session, "platform.chen", "陈岚", password)
    expert = await _user(session, "expert.zhou", "周明远教授", password)
    admin = await _user(session, "admin.system", "系统管理员", password)
    other_student = await _user(session, "other.student", "对照学生", password)
    supervisor = await _user(session, "supervisor.zhao", "赵文博教授", password)

    async def membership(
        tenant: Tenant, user: User, org: Organization, mtype: str, external_id: str, display_name: str
    ) -> TenantUserMembership:
        found = (
            await session.execute(
                select(TenantUserMembership).where(
                    TenantUserMembership.tenant_id == tenant.id, TenantUserMembership.user_id == user.id
                )
            )
        ).scalar_one_or_none()
        if found:
            return found
        row = TenantUserMembership(
            id=uuid4(),
            tenant_id=tenant.id,
            user_id=user.id,
            organization_id=org.id,
            membership_type=mtype,
            external_id=external_id,
            external_source="seed",
            is_active=True,
            display_name=display_name,
        )
        session.add(row)
        await session.flush()
        return row

    student_m = await membership(demo, student, demo_org, "STUDENT", "20260042", "林知远")
    supervisor_m = await membership(demo, supervisor, demo_org, "SUPERVISOR", "T-zhao", "赵文博")
    await membership(demo, school, demo_org, "STAFF", "staff-wang", "王老师")
    await membership(other, other_student, other_org, "STUDENT", "20269999", "对照学生")

    async def assign(user: User, role_code: str, tenant: Tenant | None) -> None:
        role = await _role(session, role_code)
        found = (
            await session.execute(
                select(UserRoleAssignment).where(
                    UserRoleAssignment.user_id == user.id, UserRoleAssignment.role_id == role.id
                )
            )
        ).scalar_one_or_none()
        if found:
            return
        session.add(
            UserRoleAssignment(
                id=uuid4(),
                user_id=user.id,
                tenant_id=tenant.id if tenant else None,
                role_id=role.id,
                data_scope={},
            )
        )

    await assign(student, "student", demo)
    await assign(school, "school_reviewer", demo)
    await assign(platform, "platform_reviewer", None)
    await assign(expert, "expert", None)
    await assign(admin, "system_admin", None)
    await assign(other_student, "student", other)
    await assign(supervisor, "supervisor", demo)

    elig = (
        await session.execute(
            select(StudentEligibility).where(StudentEligibility.student_membership_id == student_m.id)
        )
    ).scalar_one_or_none()
    if not elig:
        session.add(
            StudentEligibility(
                id=uuid4(),
                tenant_id=demo.id,
                student_membership_id=student_m.id,
                review_batch_id=demo_batch.id,
                status="ELIGIBLE",
                supervisor_membership_id=supervisor_m.id,
                degree_type="工学硕士",
                student_name="林知远",
                student_no="20260042",
                supervisor_name="赵文博",
                source_version="seed-1",
                source_updated_at=now,
            )
        )
    other_m = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.tenant_id == other.id, TenantUserMembership.user_id == other_student.id
            )
        )
    ).scalar_one()
    other_elig = (
        await session.execute(
            select(StudentEligibility).where(StudentEligibility.student_membership_id == other_m.id)
        )
    ).scalar_one_or_none()
    if not other_elig:
        session.add(
            StudentEligibility(
                id=uuid4(),
                tenant_id=other.id,
                student_membership_id=other_m.id,
                review_batch_id=other_batch.id,
                status="ELIGIBLE",
                degree_type="工学硕士",
                student_name="对照学生",
                student_no="20269999",
                supervisor_name="对照导师",
                source_version="seed-1",
                source_updated_at=now,
            )
        )
    await session.commit()


async def main() -> None:
    from app.db.session import SessionLocal

    async with SessionLocal() as session:
        await seed_database(session)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
