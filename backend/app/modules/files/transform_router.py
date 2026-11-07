from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, get_current_user
from app.modules.files import service as files, transform_service

router = APIRouter(prefix='/api/v1')


class Source(BaseModel):
    model_config = ConfigDict(extra='forbid')
    file_id: UUID
    pages: list[StrictInt] = Field(min_length=1, max_length=1000)


class TransformBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=1)
    purpose: Literal['original', 'anonymous']
    operation: Literal['MERGE', 'EXTRACT', 'DELETE_PAGES']
    sources: list[Source] = Field(min_length=1, max_length=10)


class FinishBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=1)


@router.post('/theses/{thesis_id}/pdf-transforms')
async def generate(thesis_id: UUID, body: TransformBody, user: CurrentUser = Depends(get_current_user),
                   session: AsyncSession = Depends(get_session), idempotency_key: str | None = Header(None)):
    result = await transform_service.generate(session, user, thesis_id, body.model_dump(mode='json'), idempotency_key)
    await session.commit()
    return ok(result)


@router.post('/files/{file_id}:complete-transform-source')
async def complete_source(file_id: UUID, user: CurrentUser = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    obj, thesis = await files._lock_upload(session, user, file_id)
    if thesis is None or obj.purpose not in ('original', 'anonymous'):
        raise files._hidden()
    await files._require_editable(session, thesis, obj.upload_version_id)
    obj = await files.complete_upload(session, user, file_id, bind=False)
    await session.commit()
    return ok({'file_id': str(obj.id), 'sha256': obj.sha256})


@router.post('/pdf-transforms/{operation_id}:apply')
async def apply(operation_id: UUID, body: FinishBody,
                expected: str = Header(alias="If-Draft-Revision", pattern=r"^[0-9a-f]{64}$"), user: CurrentUser = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await transform_service.finish(session, user, operation_id, body.expected_version, expected_content_revision=expected)
    await session.commit()
    return ok(result)


@router.post('/pdf-transforms/{operation_id}:cancel')
async def cancel(operation_id: UUID, body: FinishBody, user: CurrentUser = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await transform_service.finish(session, user, operation_id, body.expected_version, cancel=True)
    await session.commit()
    return ok(result)
