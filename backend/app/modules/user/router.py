# 接口层
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.tenant import service as tenant_service
from app.modules.user import service
from app.modules.user.schema import CreateSchoolMemberInput, ResetPasswordInput, UpdateMemberInput
from app.shared.enums import RoleCode


school_member_router = APIRouter(prefix="/api/v1/school-admin", tags=["school-members"])


@school_member_router.get("/members")
async def members(
    request: Request, membership_type: Literal["STUDENT", "SUPERVISOR"] | None = None,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    rows = await service.list_school_members(session, current.tenant_id, membership_type)
    return ok([service.serialize_member(row) for row in rows], request_id=getattr(request.state, "request_id", None))


@school_member_router.post("/members")
async def create_member(
    body: CreateSchoolMemberInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str = Header(alias="Idempotency-Key"),
):
    payload = body.model_dump(mode="json")
    cached = await audit_service.replay(session, current, idempotency_key, "school.create-member", payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    organization = await tenant_service.root_organization(session, current.tenant_id)
    created = await service.create_tenant_user(
        session, current, current.tenant_id, organization.id, body,
        role_code="student" if body.membership_type == "STUDENT" else "supervisor",
        membership_type=body.membership_type,
    )
    await audit_service.record(session, user=current, action="create_member", object_type="user", object_id=str(created.user.id))
    data = service.serialize_member((created.membership, created.user))
    await audit_service.remember(session, current, idempotency_key, "school.create-member", payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_member_router.patch("/members/{membership_id}")
async def update_member(
    membership_id: UUID, body: UpdateMemberInput, request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    await service.school_member(session, current.tenant_id, membership_id)
    changed = await service.update_member(session, current, current.tenant_id, membership_id, body)
    data = service.serialize_member((changed.membership, changed.user))
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def _member_command(
    membership_id: UUID, command: str, request: Request,
    current: CurrentUser, session: AsyncSession, key: str,
    body: ResetPasswordInput | None = None,
):
    route = f"school.member.{membership_id}.{command}"
    payload = body.model_dump(mode="json") if body else {}
    cached = await audit_service.replay(session, current, key, route, payload)
    if cached is not None:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    await service.school_member(session, current.tenant_id, membership_id)
    if command == "disable":
        changed = await service.disable_tenant_user(session, current, current.tenant_id, membership_id)
    elif command == "enable":
        changed = await service.enable_tenant_user(session, current, current.tenant_id, membership_id)
    else:
        changed = await service.reset_tenant_user_password(session, current, current.tenant_id, membership_id, body)
    await session.refresh(changed.membership)
    data = service.serialize_member((changed.membership, changed.user))
    await audit_service.remember(session, current, key, route, payload, data)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_member_router.post("/members/{membership_id}:disable")
async def disable_member(membership_id: UUID, request: Request, current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)), session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key")):
    return await _member_command(membership_id, "disable", request, current, session, idempotency_key)


@school_member_router.post("/members/{membership_id}:enable")
async def enable_member(membership_id: UUID, request: Request, current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)), session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key")):
    return await _member_command(membership_id, "enable", request, current, session, idempotency_key)


@school_member_router.post("/members/{membership_id}:reset-password")
async def reset_member_password(membership_id: UUID, body: ResetPasswordInput, request: Request, current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)), session: AsyncSession = Depends(get_session), idempotency_key: str = Header(alias="Idempotency-Key")):
    return await _member_command(membership_id, "reset-password", request, current, session, idempotency_key, body)
