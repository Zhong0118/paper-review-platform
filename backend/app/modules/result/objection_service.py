from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.result.objection_models import Objection
from app.modules.thesis.models import Thesis
from app.modules.user.models import StudentEligibility, TenantUserMembership
from app.shared.enums import RoleCode, ThesisStage

OPEN_STATUSES = {"SUBMITTED", "PROCESSING"}


class CreateObjection(BaseModel):
    reason: str = Field(min_length=1)
    request: str = ""


class ResolveObjection(BaseModel):
    channel: str
    conclusion: str = Field(min_length=1)


def _hidden() -> AppError:
    return AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")


def serialize(obj: Objection, *, student_name: str | None = None) -> dict:
    data = {
        "id": str(obj.id),
        "thesis_id": str(obj.thesis_id),
        "reason": obj.reason,
        "request": obj.request,
        "status": obj.status,
        "channel": obj.channel,
        "conclusion": obj.conclusion,
    }
    if student_name is not None:
        data["student_name"] = student_name
    return data


async def _student_thesis(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> Thesis:
    thesis = await session.get(Thesis, thesis_id)
    if thesis is None or user.tenant_id != thesis.tenant_id or user.role != RoleCode.STUDENT:
        raise _hidden()
    membership = (
        await session.execute(
            select(TenantUserMembership).where(
                TenantUserMembership.id == thesis.student_membership_id, TenantUserMembership.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        raise _hidden()
    return thesis


async def create_objection(session: AsyncSession, user: CurrentUser, thesis_id: UUID, body: CreateObjection) -> Objection:
    thesis = await _student_thesis(session, user, thesis_id)
    if thesis.stage != ThesisStage.COMPLETED:
        raise AppError("STATE_TRANSITION_DENIED", 409, "结果发布后才能提出异议")
    open_row = (
        await session.execute(
            select(Objection).where(Objection.thesis_id == thesis.id, Objection.status.in_(list(OPEN_STATUSES)))
        )
    ).scalar_one_or_none()
    if open_row:
        raise AppError("STATE_TRANSITION_DENIED", 409, "已有未办结异议")
    obj = Objection(
        tenant_id=thesis.tenant_id,
        thesis_id=thesis.id,
        student_membership_id=thesis.student_membership_id,
        reason=body.reason.strip(),
        request=body.request.strip(),
        status="SUBMITTED",
    )
    session.add(obj)
    await session.flush()
    return obj


async def list_mine(session: AsyncSession, user: CurrentUser, thesis_id: UUID) -> list[dict]:
    await _student_thesis(session, user, thesis_id)
    rows = list((await session.execute(select(Objection).where(Objection.thesis_id == thesis_id))).scalars())
    return [serialize(row) for row in rows]


async def list_school(session: AsyncSession, user: CurrentUser) -> list[dict]:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    rows = list(
        (await session.execute(select(Objection).where(Objection.tenant_id == user.tenant_id).order_by(Objection.created_at.desc()))).scalars()
    )
    items = []
    for row in rows:
        elig = (
            await session.execute(
                select(StudentEligibility).where(StudentEligibility.student_membership_id == row.student_membership_id)
            )
        ).scalar_one_or_none()
        items.append(serialize(row, student_name=elig.student_name if elig else ""))
    return items


async def start(session: AsyncSession, user: CurrentUser, objection_id: UUID) -> Objection:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    obj = await session.get(Objection, objection_id)
    if obj is None or obj.tenant_id != user.tenant_id:
        raise _hidden()
    if obj.status != "SUBMITTED":
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许受理")
    obj.status = "PROCESSING"
    await session.flush()
    return obj


async def resolve(session: AsyncSession, user: CurrentUser, objection_id: UUID, body: ResolveObjection) -> Objection:
    if user.role != RoleCode.SCHOOL_REVIEWER or user.tenant_id is None:
        raise AppError("ACCESS_DENIED", 403, "无权执行该操作")
    if body.channel not in {"ONLINE", "OFFLINE"}:
        raise AppError("VALIDATION_FAILED", 422, "处理渠道无效")
    obj = await session.get(Objection, objection_id)
    if obj is None or obj.tenant_id != user.tenant_id:
        raise _hidden()
    if obj.status not in OPEN_STATUSES:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许办结")
    obj.status = "RESOLVED"
    obj.channel = body.channel
    obj.conclusion = body.conclusion.strip()
    await session.flush()
    return obj
