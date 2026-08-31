from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, get_current_user, require_roles
from app.modules.thesis import service as thesis_service
from app.modules.thesis.service import ConfirmInput, DraftInput, SubmitInput, WithdrawInput
from app.shared.enums import RoleCode

student_router = APIRouter(prefix="/api/v1", tags=["theses"])
school_router = APIRouter(prefix="/api/v1/school-review", tags=["school-review"])


@student_router.post("/theses")
async def create_thesis(
    body: DraftInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
):
    thesis = await thesis_service.create_draft(session, current, body)
    data = await thesis_service.serialize_thesis(session, current, thesis)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@student_router.get("/theses")
async def list_theses(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
):
    items = await thesis_service.list_student_theses(session, current)
    data = [await thesis_service.serialize_thesis(session, current, item) for item in items]
    return ok(data, request_id=getattr(request.state, "request_id", None))


@student_router.get("/theses/{thesis_id}")
async def get_thesis(
    thesis_id: UUID,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    if current.role == RoleCode.SCHOOL_REVIEWER:
        thesis = await thesis_service.get_school_thesis(session, current, thesis_id)
    elif current.role == RoleCode.STUDENT:
        thesis = await thesis_service.get_student_thesis(session, current, thesis_id)
    else:
        from app.core.exceptions import AppError

        raise AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")
    data = await thesis_service.serialize_thesis(session, current, thesis)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@student_router.patch("/theses/{thesis_id}")
async def patch_thesis(
    thesis_id: UUID,
    body: DraftInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
):
    thesis = await thesis_service.patch_draft(session, current, thesis_id, body)
    data = await thesis_service.serialize_thesis(session, current, thesis)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@student_router.delete("/theses/{thesis_id}")
async def delete_thesis(
    thesis_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
):
    await thesis_service.delete_draft(session, current, thesis_id)
    await session.commit()
    return ok({}, request_id=getattr(request.state, "request_id", None))


@student_router.post("/theses/{thesis_id}:submit")
async def submit_thesis(
    thesis_id: UUID,
    body: SubmitInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    cached = await thesis_service.remember_idempotent(
        session, current, idempotency_key, "submit", {"id": str(thesis_id), "version": body.version}
    )
    if cached:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    thesis = await thesis_service.submit(
        session, current, thesis_id, body.version, getattr(request.state, "request_id", None)
    )
    data = await thesis_service.serialize_thesis(session, current, thesis)
    await thesis_service.store_idempotent(
        session, current, idempotency_key, "submit", {"id": str(thesis_id), "version": body.version}, data
    )
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@student_router.post("/theses/{thesis_id}:withdraw")
async def withdraw_thesis(
    thesis_id: UUID,
    body: WithdrawInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.STUDENT)),
    session: AsyncSession = Depends(get_session),
):
    thesis = await thesis_service.withdraw(session, current, thesis_id, body.version, body.reason)
    data = await thesis_service.serialize_thesis(session, current, thesis)
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_router.get("/theses")
async def school_list(
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    items = await thesis_service.list_school_theses(session, current)
    data = [await thesis_service.serialize_thesis(session, current, item) for item in items]
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_router.get("/theses/{thesis_id}")
async def school_get(
    thesis_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    thesis = await thesis_service.get_school_thesis(session, current, thesis_id)
    data = await thesis_service.serialize_thesis(session, current, thesis)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_router.post("/theses/{thesis_id}:confirm-anonymization")
async def school_confirm(
    thesis_id: UUID,
    body: ConfirmInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    cached = await thesis_service.remember_idempotent(
        session, current, idempotency_key, "confirm", {"id": str(thesis_id), **body.model_dump()}
    )
    if cached:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    thesis = await thesis_service.confirm_anonymization(
        session, current, thesis_id, body, getattr(request.state, "request_id", None)
    )
    data = await thesis_service.serialize_thesis(session, current, thesis)
    await thesis_service.store_idempotent(
        session, current, idempotency_key, "confirm", {"id": str(thesis_id), **body.model_dump()}, data
    )
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


class DispatchConfirmInput(BaseModel):
    version: int


@school_router.post("/theses/{thesis_id}:confirm-dispatch")
async def school_confirm_dispatch(
    thesis_id: UUID,
    body: DispatchConfirmInput,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    from app.modules.dispatch import service as dispatch_service

    cached = await thesis_service.remember_idempotent(
        session, current, idempotency_key, "confirm-dispatch", {"id": str(thesis_id), "version": body.version}
    )
    if cached:
        return ok(cached, request_id=getattr(request.state, "request_id", None))
    thesis = await thesis_service.get_school_thesis(session, current, thesis_id)
    round_ = await dispatch_service.confirm_dispatch(
        session, current, thesis, body.version, getattr(request.state, "request_id", None)
    )
    data = await thesis_service.serialize_thesis(session, current, thesis)
    data["round"] = dispatch_service.serialize_round(round_)
    await thesis_service.store_idempotent(
        session, current, idempotency_key, "confirm-dispatch", {"id": str(thesis_id), "version": body.version}, data
    )
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@school_router.get("/theses/{thesis_id}/progress")
async def school_progress(
    thesis_id: UUID,
    request: Request,
    current: CurrentUser = Depends(require_roles(RoleCode.SCHOOL_REVIEWER)),
    session: AsyncSession = Depends(get_session),
):
    from app.modules.dispatch import service as dispatch_service

    thesis = await thesis_service.get_school_thesis(session, current, thesis_id)
    data = await dispatch_service.school_progress(session, thesis)
    return ok(data, request_id=getattr(request.state, "request_id", None))
