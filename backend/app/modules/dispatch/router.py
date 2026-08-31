from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.dispatch import service as dispatch_service
from app.modules.thesis import service as thesis_service
from app.shared.enums import RoleCode

platform_router = APIRouter(prefix="/api/v1/platform-review", tags=["platform-review"])
expert_router = APIRouter(prefix="/api/v1/expert", tags=["expert"])
task_router = APIRouter(prefix="/api/v1", tags=["expert-tasks"])


class AssignBody(BaseModel):
    expert_id: UUID


class RejectBody(BaseModel):
    reason: str


@platform_router.get("/dispatch-queue")
async def queue(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.PLATFORM_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    data = await dispatch_service.dispatch_queue(session, current)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@platform_router.get("/dispatch-candidates")
async def candidates(
    thesis_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.PLATFORM_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    data = await dispatch_service.list_candidates(session, current, thesis_id)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@platform_router.post("/theses/{thesis_id}:assign")
async def assign(
    thesis_id: UUID,
    body: AssignBody,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.PLATFORM_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    cached = await thesis_service.remember_idempotent(
        session, current, idempotency_key, "assign", {"id": str(thesis_id), "expert_id": str(body.expert_id)}
    )
    if cached:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    thesis, task = await dispatch_service.assign(
        session, current, thesis_id, body.expert_id, getattr(request.state, "request_id", None)
    )
    data = await thesis_service.serialize_thesis(session, current, thesis)
    data["task"] = {"id": str(task.id), "status": task.status, "expert_id": str(task.expert_id)}
    await thesis_service.store_idempotent(
        session, current, idempotency_key, "assign", {"id": str(thesis_id), "expert_id": str(body.expert_id)}, data
    )
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@expert_router.get("/tasks")
async def expert_tasks(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.EXPERT)),
    session: AsyncSession = Depends(get_session),
):
    data = await dispatch_service.list_expert_tasks(session, current)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@expert_router.get("/tasks/{task_id}/invitation")
async def expert_invitation(
    task_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.EXPERT)),
    session: AsyncSession = Depends(get_session),
):
    data = await dispatch_service.invitation(session, current, task_id)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@expert_router.get("/tasks/{task_id}/materials")
async def expert_materials(
    task_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.EXPERT)),
    session: AsyncSession = Depends(get_session),
):
    data = await dispatch_service.materials(session, current, task_id)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@expert_router.post("/tasks/{task_id}:accept")
async def expert_accept(
    task_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.EXPERT)),
    session: AsyncSession = Depends(get_session),
):
    task = await dispatch_service.accept_task(session, current, task_id)
    await session.commit()
    return ok({"id": str(task.id), "status": task.status}, request_id=getattr(request.state, "request_id", None))


@expert_router.post("/tasks/{task_id}:reject")
async def expert_reject(
    task_id: UUID,
    body: RejectBody,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.EXPERT)),
    session: AsyncSession = Depends(get_session),
):
    task = await dispatch_service.reject_task(session, current, task_id, body.reason)
    await session.commit()
    return ok({"id": str(task.id), "status": task.status}, request_id=getattr(request.state, "request_id", None))
