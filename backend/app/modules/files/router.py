from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials
from jwt import InvalidTokenError

from app.modules.files.pdf import check_size
from app.core.exceptions import AppError
from app.modules.auth import service as auth_service
from app.modules.audit import service as audit_service
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import ok
from app.db.rls_context import bind_candidate_identity, verified_download_claims
from app.db.session import get_auth_session, get_session
from app.modules.auth.deps import CurrentUser, get_current_user, bearer
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
    data = bytearray()
    async for chunk in request.stream():
        check_size(len(data) + len(chunk))
        data.extend(chunk)
    await files_service.put_content(session, current, file_id, data)
    await session.commit()
    return ok({"file_id": str(file_id)}, request_id=getattr(request.state, "request_id", None))


@router.post("/files/{file_id}:complete")
async def complete(
    file_id: UUID,
    request: Request,
    expected: str = Header(alias="If-Draft-Revision", pattern=r"^[0-9a-f]{64}$"),
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    obj = await files_service.complete_upload(session, current, file_id, expected_content_revision=expected)
    from app.modules.thesis.models import ThesisVersion, ThesisVersionFile
    from app.modules.thesis.service import locked_content_revision
    from sqlalchemy import select
    link = await session.scalar(select(ThesisVersionFile.id).where(
        ThesisVersionFile.thesis_version_id == obj.upload_version_id, ThesisVersionFile.file_id == obj.id))
    if link is None:
        raise AppError("VERSION_CONFLICT", 409, "此文件已不再绑定")
    v = await session.get(ThesisVersion, obj.upload_version_id, populate_existing=True)
    revision = await locked_content_revision(session, v)
    await session.commit()
    return ok({"file_id": str(obj.id), "sha256": obj.sha256, "content_revision": revision},
              request_id=getattr(request.state, "request_id", None))


async def authorize_user(
    file_id: UUID,
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
    auth_session: AsyncSession = Depends(get_auth_session),
) -> CurrentUser:
    try:
        return await get_current_user(request, creds, session)
    except (AppError, ValueError, KeyError, TypeError) as exc:
        await session.rollback()
        await audit_service.record(auth_session, user=None, action="file_authorize", object_type="file",
                                   object_id=str(file_id), result="DENIED",
                                   request_id=getattr(request.state, "request_id", None))
        await auth_session.commit()
        if isinstance(exc, AppError):
            raise
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效") from exc


@router.post("/files/{file_id}:authorize-download")
async def authorize(
    file_id: UUID,
    request: Request,
    current: CurrentUser = Depends(authorize_user),
    session: AsyncSession = Depends(get_session),
):
    try:
        data = await files_service.authorize_download(session, current, file_id)
    except AppError:
        await audit_service.record(session, user=current, action="file_authorize", object_type="file",
                                   object_id=str(file_id), result="DENIED",
                                   request_id=getattr(request.state, "request_id", None))
        await session.commit()
        raise
    await audit_service.record(session, user=current, action="file_authorize", object_type="file",
                               object_id=str(file_id), request_id=getattr(request.state, "request_id", None))
    await session.commit()
    return ok(data, request_id=getattr(request.state, "request_id", None))


async def file_reader(
    file_id: UUID,
    request: Request,
    token: str | None = Query(default=None),
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
    auth_session: AsyncSession = Depends(get_auth_session),
) -> CurrentUser:
    try:
        if token is None:
            return await get_current_user(request, creds, session)
        claims, token_file_id = verified_download_claims(token)
        if token_file_id != file_id:
            raise AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")
        await bind_candidate_identity(session, claims)
        identity = await auth_service.load_active_identity(
            session, claims.user_id, token_role=claims.role,
            token_tenant_id=claims.tenant_id, token_auth_version=claims.auth_version,
        )
        current = CurrentUser(id=identity.user.id, role=identity.role.code,
                              tenant_id=identity.assignment.tenant_id,
                              data_scope=identity.assignment.data_scope or {},
                              auth_version=identity.user.auth_version)
        request.state.current_user = current
        return current
    except (InvalidTokenError, ValueError, KeyError, TypeError, AppError) as exc:
        await session.rollback()
        await audit_service.record(auth_session, user=None, action="file_read", object_type="file",
                                   object_id=str(file_id), result="DENIED",
                                   request_id=getattr(request.state, "request_id", None))
        await auth_session.commit()
        if isinstance(exc, AppError):
            raise
        raise AppError("AUTH_REQUIRED", 401, "未认证或会话失效") from exc


@router.get("/files/{file_id}/content")
async def get_content(
    file_id: UUID,
    request: Request,
    current: CurrentUser = Depends(file_reader),
    session: AsyncSession = Depends(get_session),
):
    try:
        obj, raw = await files_service.load_file_bytes(session, current, file_id)
    except AppError:
        await audit_service.record(session, user=current, action="file_read", object_type="file",
                                   object_id=str(file_id), result="DENIED",
                                   request_id=getattr(request.state, "request_id", None))
        await session.commit()
        raise
    await audit_service.record(session, user=current, action="file_read", object_type="file",
                               object_id=str(file_id), request_id=getattr(request.state, "request_id", None))
    await session.commit()
    return Response(content=raw, media_type=obj.content_type, headers={"Cache-Control": "no-store"})
