# 应用服务层
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.core.exceptions import AppError
from app.modules.audit import service as audit_service
from app.modules.auth import service as auth_service
from app.modules.auth.deps import CurrentUser
from app.modules.tenant.models import Organization, ReviewBatch, Tenant, InstitutionCatalog
from app.modules.tenant.schema import CreateBatchInput, CreateEligibilityInput, CreateTenantInput, UpdateBatchInput
from app.modules.thesis.models import Thesis
from app.modules.user import service as user_service
from app.modules.user.models import StudentEligibility, TenantUserMembership, User, UserRoleAssignment
from app.modules.user.schema import CreateTenantUserInput, ResetPasswordInput


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


async def create_tenant(
    session: AsyncSession, actor: CurrentUser, data: CreateTenantInput, request_id: str | None
) -> Tenant:
    if data.institution_code:
        institution = await session.scalar(select(InstitutionCatalog).where(InstitutionCatalog.code == data.institution_code, InstitutionCatalog.is_active.is_(True)))
        if institution is None or institution.name != data.name:
            raise AppError('VALIDATION_FAILED',422,'学校必须与启用官方名录一致')
    try:
        async with session.begin_nested():
            if (await session.execute(select(Tenant.id).where(Tenant.code == data.code))).scalar_one_or_none():
                raise AppError("RESOURCE_CONFLICT", 409, "学校代码已存在")
            tenant = Tenant(code=data.code, name=data.name, status="ACTIVE", sync_mapping={}, institution_code=data.institution_code)
            session.add(tenant)
            await session.flush()
            organization = Organization(
                tenant_id=tenant.id,
                external_id=data.organization.external_id,
                org_type="COLLEGE",
                name=data.organization.name,
                is_active=True,
            )
            session.add(organization)
            await session.flush()
            created = await user_service.create_tenant_user(
                session, actor, tenant.id, organization.id, data.reviewer,
                role_code="school_reviewer", membership_type="STAFF",
            )
            await audit_service.record(
                session, user=actor, action="create_tenant", object_type="tenant",
                object_id=str(tenant.id), request_id=request_id,
                detail={"code": tenant.code, "reviewer_id": str(created.user.id)},
            )
            await session.flush()
    except IntegrityError as exc:
        raise AppError("RESOURCE_CONFLICT", 409, "学校代码或成员信息已存在") from exc
    return tenant


async def root_organization(session: AsyncSession, tenant_id: UUID) -> Organization:
    row = (
        await session.execute(
            select(Organization).where(
                Organization.tenant_id == tenant_id,
                Organization.parent_id.is_(None),
            )
        )
    ).scalars().first()
    if row is None:
        raise _hidden()
    return row


async def reviewer_count(session: AsyncSession, tenant_id: UUID) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(TenantUserMembership)
            .join(User, User.id == TenantUserMembership.user_id)
            .where(
                TenantUserMembership.tenant_id == tenant_id,
                TenantUserMembership.membership_type == "STAFF",
                TenantUserMembership.is_active.is_(True),
                User.status == "ACTIVE",
            )
        )
        or 0
    )


async def serialize_tenant(session: AsyncSession, tenant: Tenant) -> dict:
    root = await root_organization(session, tenant.id)
    return {
        "id": str(tenant.id),
        "code": tenant.code,
        "institution_code": tenant.institution_code,
        "name": tenant.name,
        "status": tenant.status,
        "root_organization": {"id": str(root.id), "external_id": root.external_id, "name": root.name},
        "reviewer_count": await reviewer_count(session, tenant.id),
        "created_at": tenant.created_at.isoformat(),
        "allowed_actions": ["SUSPEND"] if tenant.status == "ACTIVE" else ["RESUME"],
    }


async def list_tenants(session: AsyncSession) -> list[Tenant]:
    return list((await session.execute(select(Tenant).order_by(Tenant.created_at, Tenant.id))).scalars())


async def get_tenant(session: AsyncSession, tenant_id: UUID, *, lock: bool = False) -> Tenant:
    stmt = select(Tenant).where(Tenant.id == tenant_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    tenant = (await session.execute(stmt)).scalar_one_or_none()
    if tenant is None:
        raise _hidden()
    return tenant


async def set_tenant_status(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    target: str,
    request_id: str | None,
) -> Tenant:
    tenant = await get_tenant(session, tenant_id, lock=True)
    expected = "ACTIVE" if target == "SUSPENDED" else "SUSPENDED"
    if tenant.status != expected:
        raise AppError("STATE_TRANSITION_DENIED", 409, "学校当前状态不允许该操作")
    tenant.status = target
    tenant.suspended_at = datetime.now(timezone.utc) if target == "SUSPENDED" else None
    if target == "SUSPENDED":
        user_ids = sorted(set(
            (
                await session.execute(
                    select(UserRoleAssignment.user_id).where(
                        UserRoleAssignment.tenant_id == tenant.id
                    )
                )
            ).scalars()
        ))
        for user_id in user_ids:
            await auth_service.revoke_user_sessions(session, user_id)
    await audit_service.record(
        session,
        user=actor,
        action="suspend_tenant" if target == "SUSPENDED" else "resume_tenant",
        object_type="tenant",
        object_id=str(tenant.id),
        request_id=request_id,
    )
    return tenant


async def list_reviewers(session: AsyncSession, tenant_id: UUID) -> list[tuple[TenantUserMembership, User]]:
    await get_tenant(session, tenant_id)
    return list(
        (
            await session.execute(
                select(TenantUserMembership, User)
                .join(User, User.id == TenantUserMembership.user_id)
                .where(
                    TenantUserMembership.tenant_id == tenant_id,
                    TenantUserMembership.membership_type == "STAFF",
                )
                .order_by(TenantUserMembership.created_at, TenantUserMembership.id)
            )
        ).all()
    )


def serialize_reviewer(row: tuple[TenantUserMembership, User]) -> dict:
    membership, user = row
    return {
        "membership_id": str(membership.id),
        "user_id": str(user.id),
        "username": user.username,
        "display_name": membership.display_name,
        "external_id": membership.external_id,
        "status": user.status,
        "is_active": membership.is_active,
    }


async def create_school_reviewer(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    data: CreateTenantUserInput,
    request_id: str | None,
) -> tuple[TenantUserMembership, User]:
    tenant = await get_tenant(session, tenant_id, lock=True)
    if tenant.status != "ACTIVE":
        raise AppError("STATE_TRANSITION_DENIED", 409, "暂停的学校不能新增管理员")
    organization = await root_organization(session, tenant_id)
    created = await user_service.create_tenant_user(
        session, actor, tenant_id, organization.id, data,
        role_code="school_reviewer", membership_type="STAFF",
    )
    await audit_service.record(
        session, user=actor, action="create_school_reviewer", object_type="user",
        object_id=str(created.user.id), request_id=request_id,
    )
    return created.membership, created.user


async def reviewer_membership(
    session: AsyncSession, tenant_id: UUID, user_id: UUID
) -> TenantUserMembership:
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.tenant_id == tenant_id,
                TenantUserMembership.user_id == user_id,
                TenantUserMembership.membership_type == "STAFF",
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise _hidden()
    return membership


async def change_reviewer_status(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    user_id: UUID,
    *,
    enable: bool,
) -> tuple[TenantUserMembership, User]:
    await get_tenant(session, tenant_id, lock=True)
    membership = await reviewer_membership(session, tenant_id, user_id)
    if not enable and await reviewer_count(session, tenant_id) <= 1:
        raise AppError("STATE_TRANSITION_DENIED", 409, "不能停用最后一名学校管理员")
    result = (
        await user_service.enable_tenant_user(session, actor, tenant_id, membership.id)
        if enable
        else await user_service.disable_tenant_user(session, actor, tenant_id, membership.id)
    )
    return result.membership, result.user


async def reset_reviewer_password(
    session: AsyncSession,
    actor: CurrentUser,
    tenant_id: UUID,
    user_id: UUID,
    data: ResetPasswordInput,
) -> tuple[TenantUserMembership, User]:
    membership = await reviewer_membership(session, tenant_id, user_id)
    result = await user_service.reset_tenant_user_password(
        session, actor, tenant_id, membership.id, data
    )
    return result.membership, result.user


async def get_batch(session: AsyncSession, tenant_id: UUID, batch_id: UUID, *, lock: bool = False) -> ReviewBatch:
    stmt = select(ReviewBatch).where(ReviewBatch.id == batch_id, ReviewBatch.tenant_id == tenant_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    batch = (await session.execute(stmt)).scalar_one_or_none()
    if batch is None:
        raise _hidden()
    return batch


def _check_batch_times(start_at: datetime | None, end_at: datetime | None) -> None:
    if start_at and end_at and start_at >= end_at:
        raise AppError("VALIDATION_FAILED", 422, "开始时间须早于结束时间")


async def serialize_batch(session: AsyncSession, batch: ReviewBatch) -> dict:
    from app.modules.tenant.programs import binding
    catalog_id = await binding(session,batch.id)
    actions = {
        "DRAFT": ["EDIT", "OPEN"],
        "OPEN": ["CLOSE_SUBMISSIONS"],
        "SUBMISSION_CLOSED": ["ARCHIVE"],
        "ARCHIVED": [],
    }.get(batch.status, [])
    if "ARCHIVE" in actions:
        pending = (
            await session.execute(select(Thesis.id).where(
                Thesis.review_batch_id == batch.id,
                Thesis.stage.notin_(["COMPLETED", "TERMINATED"]),
            ).limit(1))
        ).scalar_one_or_none()
        if pending is not None:
            actions = []
    return {
        "id": str(batch.id), "code": batch.code, "name": batch.name,
        "status": batch.status, "start_at": batch.start_at.isoformat() if batch.start_at else None,
        "end_at": batch.end_at.isoformat() if batch.end_at else None,
        "program_catalog_id": str(catalog_id) if catalog_id else None,
        "rule_version": batch.rule_version, "version": batch.version,
        "allowed_actions": actions,
    }


async def list_batches(session: AsyncSession, tenant_id: UUID) -> list[ReviewBatch]:
    return list((await session.execute(select(ReviewBatch).where(
        ReviewBatch.tenant_id == tenant_id,
    ).order_by(ReviewBatch.created_at.desc(), ReviewBatch.id.desc()))).scalars())


async def create_batch(session: AsyncSession, actor: CurrentUser, data: CreateBatchInput) -> ReviewBatch:
    _check_batch_times(data.start_at, data.end_at)
    if (await session.execute(select(ReviewBatch.id).where(
        ReviewBatch.tenant_id == actor.tenant_id, ReviewBatch.code == data.code,
    ))).scalar_one_or_none() is not None:
        raise AppError("RESOURCE_CONFLICT", 409, "批次代码已存在")
    try:
        async with session.begin_nested():
            batch = ReviewBatch(
                tenant_id=actor.tenant_id, code=data.code, name=data.name,
                status="DRAFT", start_at=data.start_at, end_at=data.end_at,
                rule_version=1, version=1,
            )
            session.add(batch)
            await session.flush()
    except IntegrityError as exc:
        raise AppError("RESOURCE_CONFLICT", 409, "批次代码已存在") from exc
    await audit_service.record(session, user=actor, action="create_batch", object_type="review_batch", object_id=str(batch.id))
    return batch


async def update_batch(
    session: AsyncSession, actor: CurrentUser, batch_id: UUID, data: UpdateBatchInput
) -> ReviewBatch:
    batch = await get_batch(session, actor.tenant_id, batch_id, lock=True)
    if batch.version != data.expected_version:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    if batch.status != "DRAFT":
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不可编辑")
    _check_batch_times(data.start_at, data.end_at)
    batch.name, batch.start_at, batch.end_at = data.name, data.start_at, data.end_at
    batch.version += 1
    await audit_service.record(session, user=actor, action="update_batch", object_type="review_batch", object_id=str(batch.id))
    await session.flush()
    return batch


async def change_batch_status(
    session: AsyncSession, actor: CurrentUser, batch_id: UUID, target: str, expected_version: int
) -> ReviewBatch:
    transitions = {"OPEN": "DRAFT", "SUBMISSION_CLOSED": "OPEN", "ARCHIVED": "SUBMISSION_CLOSED"}
    if target not in transitions:
        raise AppError("VALIDATION_FAILED", 422, "无效批次状态")
    batch = await get_batch(session, actor.tenant_id, batch_id, lock=True)
    if batch.version != expected_version:
        raise AppError("VERSION_CONFLICT", 409, "数据已变更，请刷新后重试")
    if batch.status != transitions[target]:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不可执行该操作")
    if target == "OPEN":
        member_ids = list((await session.execute(
            select(StudentEligibility.student_membership_id).where(
                StudentEligibility.review_batch_id == batch.id,
            ).order_by(StudentEligibility.student_membership_id)
        )).scalars())
        for member_id in member_ids:
            await session.execute(select(TenantUserMembership.id).where(
                TenantUserMembership.id == member_id,
            ).with_for_update())
        if member_ids:
            another = (await session.execute(
                select(StudentEligibility.id)
                .join(ReviewBatch, ReviewBatch.id == StudentEligibility.review_batch_id)
                .where(
                    StudentEligibility.student_membership_id.in_(member_ids),
                    ReviewBatch.status == "OPEN",
                    ReviewBatch.id != batch.id,
                ).limit(1)
            )).scalar_one_or_none()
            if another is not None:
                raise AppError("RESOURCE_CONFLICT", 409, "学生已在其他开放批次")
    if target == "ARCHIVED":
        pending = (await session.execute(select(Thesis.id).where(
            Thesis.review_batch_id == batch.id,
            Thesis.stage.notin_(["COMPLETED", "TERMINATED"]),
        ).limit(1))).scalar_one_or_none()
        if pending is not None:
            raise AppError("STATE_TRANSITION_DENIED", 409, "批次仍有未完成论文")
    batch.status = target
    batch.version += 1
    await audit_service.record(
        session, user=actor,
        action={"OPEN": "open_batch", "SUBMISSION_CLOSED": "close_batch_submissions", "ARCHIVED": "archive_batch"}[target],
        object_type="review_batch", object_id=str(batch.id),
    )
    await session.flush()
    return batch


async def current_student_eligibility(
    session: AsyncSession, user_id: UUID, tenant_id: UUID,
) -> tuple[StudentEligibility, ReviewBatch]:
    row = (await session.execute(
        select(StudentEligibility, ReviewBatch)
        .join(ReviewBatch, ReviewBatch.id == StudentEligibility.review_batch_id)
        .join(TenantUserMembership, TenantUserMembership.id == StudentEligibility.student_membership_id)
        .where(TenantUserMembership.user_id == user_id, TenantUserMembership.tenant_id == tenant_id)
        .order_by(case((ReviewBatch.status == "OPEN", 0), else_=1), ReviewBatch.created_at.desc(), ReviewBatch.id.desc())
        .limit(1)
    )).one_or_none()
    if row is None:
        raise AppError("ACCESS_DENIED", 403, "当前没有送审资格")
    return row


async def list_eligibilities(session: AsyncSession, tenant_id: UUID, batch_id: UUID) -> list[StudentEligibility]:
    await get_batch(session, tenant_id, batch_id)
    return list((await session.execute(select(StudentEligibility).where(
        StudentEligibility.tenant_id == tenant_id,
        StudentEligibility.review_batch_id == batch_id,
    ).order_by(StudentEligibility.created_at, StudentEligibility.id))).scalars())


def serialize_eligibility(row: StudentEligibility) -> dict:
    return {
        "id": str(row.id), "review_batch_id": str(row.review_batch_id),
        "student_membership_id": str(row.student_membership_id),
        "supervisor_membership_id": str(row.supervisor_membership_id) if row.supervisor_membership_id else None,
        "student_name": row.student_name, "student_no": row.student_no,
        "supervisor_name": row.supervisor_name, "degree_type": row.degree_type,
        "status": row.status,
    }


async def create_eligibility(
    session: AsyncSession, actor: CurrentUser, batch_id: UUID,
    data: CreateEligibilityInput, request_id: str,
) -> StudentEligibility:
    batch = await get_batch(session, actor.tenant_id, batch_id, lock=True)
    if batch.status not in {"DRAFT", "OPEN"}:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前批次不可建立资格")
    student = (await session.execute(select(TenantUserMembership).where(
        TenantUserMembership.id == data.student_membership_id,
        TenantUserMembership.tenant_id == actor.tenant_id,
        TenantUserMembership.membership_type == "STUDENT",
    ).with_for_update())).scalar_one_or_none()
    if student is None:
        raise _hidden()
    student_user = await session.get(User, student.user_id)
    if not student.is_active or student_user is None or student_user.status != "ACTIVE":
        raise AppError("STATE_TRANSITION_DENIED", 409, "学生账号不可用")
    supervisor = None
    if data.supervisor_membership_id:
        supervisor = (await session.execute(select(TenantUserMembership).where(
            TenantUserMembership.id == data.supervisor_membership_id,
            TenantUserMembership.tenant_id == actor.tenant_id,
            TenantUserMembership.membership_type == "SUPERVISOR",
        ))).scalar_one_or_none()
        if supervisor is None:
            raise _hidden()
        supervisor_user = await session.get(User, supervisor.user_id)
        if not supervisor.is_active or supervisor_user is None or supervisor_user.status != "ACTIVE":
            raise AppError("STATE_TRANSITION_DENIED", 409, "导师账号不可用")
    if (await session.execute(select(StudentEligibility.id).where(
        StudentEligibility.review_batch_id == batch.id,
        StudentEligibility.student_membership_id == student.id,
    ))).scalar_one_or_none():
        raise AppError("RESOURCE_CONFLICT", 409, "本批次已有学生资格")
    if batch.status == "OPEN":
        other = (await session.execute(select(StudentEligibility.id)
            .join(ReviewBatch, ReviewBatch.id == StudentEligibility.review_batch_id)
            .where(StudentEligibility.student_membership_id == student.id,
                ReviewBatch.status == "OPEN", ReviewBatch.id != batch.id).limit(1)
        )).scalar_one_or_none()
        if other is not None:
            raise AppError("RESOURCE_CONFLICT", 409, "学生已在其他开放批次")
    now = datetime.now(timezone.utc)
    try:
        async with session.begin_nested():
            row = StudentEligibility(
                tenant_id=actor.tenant_id, student_membership_id=student.id,
                review_batch_id=batch.id, supervisor_membership_id=supervisor.id if supervisor else None,
                status="ELIGIBLE", degree_type=data.degree_type,
                student_name=student.display_name or student_user.display_name or "",
                student_no=student.external_id,
                supervisor_name=supervisor.display_name if supervisor else None,
                source_version=f"manual:{request_id}", source_updated_at=now,
            )
            session.add(row)
            await session.flush()
    except IntegrityError as exc:
        raise AppError("RESOURCE_CONFLICT", 409, "本批次已有学生资格") from exc
    await audit_service.record(session, user=actor, action="create_student_eligibility", object_type="student_eligibility", object_id=str(row.id), request_id=request_id)
    return row


async def change_eligibility_status(
    session: AsyncSession, actor: CurrentUser, eligibility_id: UUID, target: str,
) -> StudentEligibility:
    row = (await session.execute(select(StudentEligibility).where(
        StudentEligibility.id == eligibility_id,
        StudentEligibility.tenant_id == actor.tenant_id,
    ).with_for_update())).scalar_one_or_none()
    if row is None:
        raise _hidden()
    expected = "ELIGIBLE" if target == "SUSPENDED" else "SUSPENDED"
    if row.status != expected:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前资格状态不可执行该操作")
    row.status = target
    await audit_service.record(session, user=actor,
        action="suspend_student_eligibility" if target == "SUSPENDED" else "resume_student_eligibility",
        object_type="student_eligibility", object_id=str(row.id))
    await session.flush()
    return row
