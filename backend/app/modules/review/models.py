from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ReviewDraft(BaseModel):
    __tablename__ = "review_drafts"
    __table_args__ = (UniqueConstraint("task_id"),)

    task_id: Mapped[UUID] = mapped_column(ForeignKey("expert_tasks.id"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class ReviewResultVersion(BaseModel):
    __tablename__ = "review_result_versions"

    task_id: Mapped[UUID] = mapped_column(ForeignKey("expert_tasks.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scores: Mapped[dict] = mapped_column(JSONB, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    comments: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
