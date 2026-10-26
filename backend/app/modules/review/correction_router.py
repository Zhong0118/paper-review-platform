from typing import Literal
from uuid import UUID
from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.response import ok
from app.db.session import get_session
from app.modules.auth.deps import CurrentUser, require_roles
from app.modules.review.service import ReviewPayload, CheckAck
from app.modules.review import correction_service as service

router = APIRouter(prefix='/api/v1', tags=['review-corrections'])


class ReasonBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator('reason')
    @classmethod
    def not_blank(cls, value):
        if not value.strip(): raise ValueError('原因不能为空')
        return value.strip()


class RequestBody(ReasonBody):
    base_result_id: UUID
    base_revision_id: UUID | None = None


class VersionBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: StrictInt = Field(ge=1)


class DecisionBody(ReasonBody):
    version: StrictInt = Field(ge=1)
    decision: Literal['APPROVE', 'REJECT']


class SchoolBody(ReasonBody):
    version: StrictInt = Field(ge=1)


class DraftBody(VersionBody):
    payload: ReviewPayload


class CorrectionSubmission(DraftBody):
    check_ack: CheckAck | None = None


class CheckBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    payload: ReviewPayload


@router.post('/expert-tasks/{task_id}/review-similarity')
@router.post('/expert-tasks/{task_id}/review-checks')
async def task_checks(task_id: UUID, body: CheckBody, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session)):
    from app.modules.review.comment_checks import preview_checks
    return ok(await preview_checks(session, current, body.payload, task_id=task_id), request_id=request.state.request_id)


@router.post('/expert-corrections/{correction_id}/review-similarity')
@router.post('/expert-corrections/{correction_id}/review-checks')
async def correction_checks(correction_id: UUID, body: CheckBody, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session)):
    from app.modules.review.comment_checks import preview_checks
    return ok(await preview_checks(session, current, body.payload, correction_id=correction_id), request_id=request.state.request_id)


@router.get('/expert-tasks/{task_id}/corrections')
async def expert_list(task_id: UUID, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session)):
    return ok(await service.list_for_task(session, current, task_id), request_id=request.state.request_id)


@router.get('/platform-review/corrections')
async def platform_list(request: Request,
    current: CurrentUser = Depends(require_roles('platform_reviewer')), session: AsyncSession = Depends(get_session)):
    return ok(await service.list_requests(session, current), request_id=request.state.request_id)


@router.get('/school-review/corrections')
async def school_list(request: Request,
    current: CurrentUser = Depends(require_roles('school_reviewer')), session: AsyncSession = Depends(get_session)):
    return ok(await service.list_requests(session, current), request_id=request.state.request_id)


async def execute(action, target, body, request, current, session, key):
    command_body = body.model_dump(mode='json')
    if action == 'submit' and command_body.get('check_ack') is None:
        command_body.pop('check_ack', None)
    data = await service.command(session, current, action, target, command_body, key, request.state.request_id)
    await session.commit()
    return ok(data, request_id=request.state.request_id)


@router.post('/expert-tasks/{task_id}/corrections')
async def create(task_id: UUID, body: RequestBody, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('request', task_id, body, request, current, session, key)


@router.post('/corrections/{correction_id}:cancel')
async def cancel(correction_id: UUID, body: VersionBody, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('cancel', correction_id, body, request, current, session, key)


@router.post('/platform-review/corrections/{correction_id}:decide')
async def decide(correction_id: UUID, body: DecisionBody, request: Request,
    current: CurrentUser = Depends(require_roles('platform_reviewer')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('decide', correction_id, body, request, current, session, key)


@router.put('/expert-corrections/{correction_id}/draft')
async def draft(correction_id: UUID, body: DraftBody, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('draft', correction_id, body, request, current, session, key)


@router.post('/expert-corrections/{correction_id}:submit')
async def submit(correction_id: UUID, body: CorrectionSubmission, request: Request,
    current: CurrentUser = Depends(require_roles('expert')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('submit', correction_id, body, request, current, session, key)


@router.post('/school-review/corrections/{correction_id}:activate')
async def activate(correction_id: UUID, body: SchoolBody, request: Request,
    current: CurrentUser = Depends(require_roles('school_reviewer')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('activate', correction_id, body, request, current, session, key)


@router.post('/school-review/corrections/{correction_id}:reject')
async def reject(correction_id: UUID, body: SchoolBody, request: Request,
    current: CurrentUser = Depends(require_roles('school_reviewer')), session: AsyncSession = Depends(get_session),
    key: str = Header(alias='Idempotency-Key', min_length=1, max_length=128)):
    return await execute('reject', correction_id, body, request, current, session, key)
