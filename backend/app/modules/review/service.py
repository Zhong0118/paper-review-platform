from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.modules.thesis.models import Thesis
from app.modules.dispatch.service import get_task_for_expert
from app.modules.auth.deps import CurrentUser
from app.modules.review.models import ReviewDraft, ReviewResultVersion
from app.shared.enums import ExpertTaskStatus, ThesisStage, RoundStatus

DIMENSIONS = {
    "topicValue": 15,
    "literatureTheory": 15,
    "methodology": 20,
    "innovation": 25,
    "writingStandards": 10,
    "resultsWorkload": 15,
}


class ReviewPayload(BaseModel):
    topicValue: int
    literatureTheory: int
    methodology: int
    innovation: int
    writingStandards: int
    resultsWorkload: int
    recommendation: str = ""
    strengths: str = ""
    issues: str = ""
    revisionAdvice: str = ""
    overallComment: str = ""
    evaluations: dict[str, str] = Field(default_factory=dict)


def validate_for_submit(payload: ReviewPayload) -> None:
    for key, max_score in DIMENSIONS.items():
        value = getattr(payload, key)
        if value < 0 or value > max_score:
            raise AppError("VALIDATION_FAILED", 422, f"{key} 分值应在 0–{max_score} 之间")
    if not payload.overallComment.strip():
        raise AppError("VALIDATION_FAILED", 422, "总体评价为必填项")
    if not payload.issues.strip():
        raise AppError("VALIDATION_FAILED", 422, "主要问题为必填项")


def total_score(payload: ReviewPayload) -> int:
    return sum(getattr(payload, key) for key in DIMENSIONS)


async def get_draft(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    await get_task_for_expert(session, user, task_id)
    draft = (await session.execute(select(ReviewDraft).where(ReviewDraft.task_id == task_id))).scalar_one_or_none()
    return draft.payload if draft else {}


async def get_result(session: AsyncSession, user: CurrentUser, task_id: UUID) -> dict:
    task = await get_task_for_expert(session, user, task_id)
    if task.status != ExpertTaskStatus.SUBMITTED:
        raise AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")
    result = (await session.execute(select(ReviewResultVersion).where(
        ReviewResultVersion.task_id == task_id, ReviewResultVersion.is_current.is_(True),
    ))).scalar_one_or_none()
    if result is None:
        raise AppError("RESOURCE_NOT_FOUND", 404, "资源不存在或不可见")
    return {**result.comments, **result.scores}


async def save_draft(session: AsyncSession, user: CurrentUser, task_id: UUID, payload: ReviewPayload) -> dict:
    task = await get_task_for_expert(session, user, task_id, for_update=True)
    if task.status != ExpertTaskStatus.IN_REVIEW:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许保存草稿")
    data = payload.model_dump()
    draft = (await session.execute(select(ReviewDraft).where(ReviewDraft.task_id == task_id))).scalar_one_or_none()
    if draft:
        draft.payload = data
    else:
        session.add(ReviewDraft(task_id=task_id, payload=data))
    await session.flush()
    return data


async def submit_final(session: AsyncSession, user: CurrentUser, task_id: UUID, payload: ReviewPayload) -> dict:
    task = await get_task_for_expert(session, user, task_id, for_update=True)
    if task.status != ExpertTaskStatus.IN_REVIEW:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前状态不允许最终提交")
    round_ = await session.get(ReviewRound, task.round_id, populate_existing=True)
    thesis = await session.get(Thesis, round_.thesis_id) if round_ else None
    if (thesis is None or thesis.stage != ThesisStage.UNDER_REVIEW
            or round_.thesis_version_id != thesis.current_version_id or round_.status != RoundStatus.ACTIVE):
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前轮次不允许最终提交")
    occupied = list((await session.execute(select(ExpertTask.id).where(
        ExpertTask.round_id == task.round_id,
        ExpertTask.status.in_([ExpertTaskStatus.INVITED, ExpertTaskStatus.IN_REVIEW, ExpertTaskStatus.SUBMITTED]),
    ))).scalars())
    if occupied != [task.id]:
        raise AppError("STATE_TRANSITION_DENIED", 409, "当前单专家轮次任务数量异常")
    validate_for_submit(payload)
    existing = (
        await session.execute(
            select(ReviewResultVersion).where(ReviewResultVersion.task_id == task_id, ReviewResultVersion.is_current.is_(True))
        )
    ).scalar_one_or_none()
    version_no = (existing.version_no + 1) if existing else 1
    if existing:
        existing.is_current = False
    session.add(
        ReviewResultVersion(
            task_id=task_id,
            version_no=version_no,
            scores={key: getattr(payload, key) for key in DIMENSIONS},
            total=total_score(payload),
            comments=payload.model_dump(),
            is_current=True,
        )
    )
    task.status = ExpertTaskStatus.SUBMITTED
    from app.modules.result.service import maybe_close_round

    await maybe_close_round(session, task, user)
    await session.flush()
    return {"id": str(task.id), "status": task.status, "total": total_score(payload)}
