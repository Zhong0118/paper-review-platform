from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, get_current_user
from app.modules.files import service as files_service

router = APIRouter(prefix="/api/v1", tags=["files"])


class PrepareUploadBody(BaseModel):
    thesis_id: UUID
    purpose: str
    filename: str
    content_type: str = "application/pdf"


@router.post("/files:prepare-upload")
async def prepare_upload(
    body: PrepareUploadBody,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await files_service.prepare_upload(
        session,
        current,
        thesis_id=body.thesis_id,
        purpose=body.purpose,
        filename=body.filename,
        content_type=body.content_type,
    )
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


@router.put("/files/{file_id}/content")
async def put_content(
    file_id: UUID,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await request.body()
    await files_service.put_content(session, current, file_id, data)
    await session.commit()
    return ok({"file_id": str(file_id)}, request_id=getattr(request.state, "request_id", None))


@router.post("/files/{file_id}:complete")
async def complete(
    file_id: UUID,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = await files_service.complete_upload(session, current, file_id)
    await session.commit()
    return ok({"file_id": str(obj.id), "sha256": obj.sha256}, request_id=getattr(request.state, "request_id", None))


@router.post("/files/{file_id}:authorize-download")
async def authorize(
    file_id: UUID,
    request: Request,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    data = await files_service.authorize_download(session, current, file_id)
    return ok(data, request_id=getattr(request.state, "request_id", None))


@router.get("/files/{file_id}/content")
async def get_content(
    file_id: UUID,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj, raw = await files_service.load_file_bytes(session, current, file_id)
    return Response(content=raw, media_type=obj.content_type)
