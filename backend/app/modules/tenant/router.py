# 接口层
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.dispatch.deadlines import DeadlineInput, set_rule
from app.core.response import ok
from app.db.session import get_session
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.tenant import service
from app.modules.tenant.schema import CreateBatchInput, CreateEligibilityInput, CreateTenantInput, UpdateBatchInput, VersionInput
from app.modules.user.schema import CreateTenantUserInput, ResetPasswordInput
from app.shared.enums import RoleCode


system_router = APIRouter(prefix="/api/v1/system", tags=["system-operations"])
school_admin_router = APIRouter(prefix="/api/v1/school-admin", tags=["school-operations"])


@system_router.get("/tenants")
async def tenants(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
):
    rows = await service.list_tenants(session)
    return ok(
        [await service.serialize_tenant(session, row) for row in rows],
        request_id=getattr(request.state, "request_id", None),
    )


@system_router.post("/tenants")
async def create_tenant(
    body: CreateTenantInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    payload = body.model_dump(mode="json")
    cached = await audit_service.replay(session, current, idempotency_key, "system.create-tenant", payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    tenant = await service.create_tenant(session, current, body, getattr(request.state, "request_id", None))
    data = await service.serialize_tenant(session, tenant)
    await audit_service.remember(session, current, idempotency_key, "system.create-tenant", payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def _change_status(
    tenant_id: UUID,
    target: str,
    route: str,
    request: Request,
    current: CurrentUser,
    session: AsyncSession,
    key: str,
):
    cached = await audit_service.replay(session, current, key, route, {})
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    tenant = await service.set_tenant_status(
        session, current, tenant_id, target, getattr(request.state, "request_id", None)
    )
    data = await service.serialize_tenant(session, tenant)
    await audit_service.remember(session, current, key, route, {}, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@system_router.post("/tenants/{tenant_id}:suspend")
async def suspend_tenant(
    tenant_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _change_status(tenant_id, "SUSPENDED", f"system.tenant.{tenant_id}.suspend", request, current, session, idempotency_key)


@system_router.post("/tenants/{tenant_id}:resume")
async def resume_tenant(
    tenant_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _change_status(tenant_id, "ACTIVE", f"system.tenant.{tenant_id}.resume", request, current, session, idempotency_key)


@system_router.get("/tenants/{tenant_id}/reviewers")
async def reviewers(
    tenant_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
):
    rows = await service.list_reviewers(session, tenant_id)
    return ok([service.serialize_reviewer(row) for row in rows], request_id=getattr(request.state, "request_id", None))


@system_router.post("/tenants/{tenant_id}/reviewers")
async def create_reviewer(
    tenant_id: UUID, body: CreateTenantUserInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    payload = body.model_dump(mode="json")
    route = f"system.tenant.{tenant_id}.create-reviewer"
    cached = await audit_service.replay(session, current, idempotency_key, route, payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    row = await service.create_school_reviewer(session, current, tenant_id, body, getattr(request.state, "request_id", None))
    data = service.serialize_reviewer(row)
    await audit_service.remember(session, current, idempotency_key, route, payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def _reviewer_command(
    tenant_id: UUID, user_id: UUID, command: str, request: Request,
    current: CurrentUser, session: AsyncSession, key: str, password: ResetPasswordInput | None = None,
):
    route = f"system.tenant.{tenant_id}.reviewer.{user_id}.{command}"
    payload = password.model_dump() if password else {}
    cached = await audit_service.replay(session, current, key, route, payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    if command == "reset-password":
        row = await service.reset_reviewer_password(session, current, tenant_id, user_id, password)
    else:
        row = await service.change_reviewer_status(session, current, tenant_id, user_id, enable=command == "enable")
    data = service.serialize_reviewer(row)
    await audit_service.remember(session, current, key, route, payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@system_router.post("/tenants/{tenant_id}/reviewers/{user_id}:disable")
async def disable_reviewer(
    tenant_id: UUID, user_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)), session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _reviewer_command(tenant_id, user_id, "disable", request, current, session, idempotency_key)


@system_router.post("/tenants/{tenant_id}/reviewers/{user_id}:enable")
async def enable_reviewer(
    tenant_id: UUID, user_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)), session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _reviewer_command(tenant_id, user_id, "enable", request, current, session, idempotency_key)


@system_router.post("/tenants/{tenant_id}/reviewers/{user_id}:reset-password")
async def reset_reviewer_password(
    tenant_id: UUID, user_id: UUID, body: ResetPasswordInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SYSTEM_ADMIN)), session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _reviewer_command(tenant_id, user_id, "reset-password", request, current, session, idempotency_key, body)


@school_admin_router.get("/batches")
async def batches(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    rows = await service.list_batches(session, current.tenant_id)
    return ok([await service.serialize_batch(session, row) for row in rows], request_id=getattr(request.state, "request_id", None))


@school_admin_router.get("/batches/{batch_id}/closeout")
async def batch_closeout(batch_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    from app.modules.tenant.batch_service import closeout
    return ok(await closeout(session, current.tenant_id, batch_id), request_id=request.state.request_id)


@school_admin_router.post("/batches")
async def create_batch(
    body: CreateBatchInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    payload = body.model_dump(mode="json")
    cached = await audit_service.replay(session, current, idempotency_key, "school.create-batch", payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    batch = await service.create_batch(session, current, body)
    data = await service.serialize_batch(session, batch)
    await audit_service.remember(session, current, idempotency_key, "school.create-batch", payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_admin_router.patch("/batches/{batch_id}")
async def update_batch(
    batch_id: UUID, body: UpdateBatchInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    batch = await service.update_batch(session, current, batch_id, body)
    data = await service.serialize_batch(session, batch)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def _batch_command(
    batch_id: UUID, command: str, target: str, body: VersionInput,
    request: Request, current: CurrentUser, session: AsyncSession, key: str,
):
    route = f"school.batch.{batch_id}.{command}"
    payload = body.model_dump(mode="json")
    cached = await audit_service.replay(session, current, key, route, payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    batch = await service.change_batch_status(session, current, batch_id, target, body.expected_version)
    data = await service.serialize_batch(session, batch)
    await audit_service.remember(session, current, key, route, payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_admin_router.post("/batches/{batch_id}:open")
async def open_batch(
    batch_id: UUID, body: VersionInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _batch_command(batch_id, "open", "OPEN", body, request, current, session, idempotency_key)


@school_admin_router.post("/batches/{batch_id}:close-submissions")
async def close_batch(
    batch_id: UUID, body: VersionInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _batch_command(batch_id, "close-submissions", "SUBMISSION_CLOSED", body, request, current, session, idempotency_key)


@school_admin_router.post("/batches/{batch_id}:archive")
async def archive_batch(
    batch_id: UUID, body: VersionInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _batch_command(batch_id, "archive", "ARCHIVED", body, request, current, session, idempotency_key)


@school_admin_router.get("/batches/{batch_id}/eligibilities")
async def eligibilities(
    batch_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    rows = await service.list_eligibilities(session, current.tenant_id, batch_id)
    return ok([service.serialize_eligibility(row) for row in rows], request_id=getattr(request.state, "request_id", None))


@school_admin_router.post("/batches/{batch_id}/eligibilities")
async def create_eligibility(
    batch_id: UUID, body: CreateEligibilityInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    route = f"school.batch.{batch_id}.create-eligibility"
    payload = body.model_dump(mode="json")
    cached = await audit_service.replay(session, current, idempotency_key, route, payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    row = await service.create_eligibility(session, current, batch_id, body, request.state.request_id)
    data = service.serialize_eligibility(row)
    await audit_service.remember(session, current, idempotency_key, route, payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def _eligibility_command(
    eligibility_id: UUID, target: str, request: Request,
    current: CurrentUser, session: AsyncSession, key: str,
):
    route = f"school.eligibility.{eligibility_id}.{target.lower()}"
    cached = await audit_service.replay(session, current, key, route, {})
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    row = await service.change_eligibility_status(session, current, eligibility_id, target)
    data = service.serialize_eligibility(row)
    await audit_service.remember(session, current, key, route, {}, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_admin_router.post("/eligibilities/{eligibility_id}:suspend")
async def suspend_eligibility(
    eligibility_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _eligibility_command(eligibility_id, "SUSPENDED", request, current, session, idempotency_key)


@school_admin_router.post("/eligibilities/{eligibility_id}:resume")
async def resume_eligibility(
    eligibility_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key"),
):
    return await _eligibility_command(eligibility_id, "ELIGIBLE", request, current, session, idempotency_key)

@school_admin_router.put("/batches/{batch_id}/deadlines")
async def deadlines(batch_id:UUID, body:DeadlineInput, request:Request,
                    current:CurrentUser=Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
                    session:AsyncSession=Depends(get_session)):
    batch=await set_rule(session,current,batch_id,body,request.state.request_id)
    data=await service.serialize_batch(session,batch)
    await session.commit()
    return ok(data, request_id=request.state.request_id)
