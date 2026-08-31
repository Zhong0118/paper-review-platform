from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ReviewRound(BaseModel):
    __tablename__ = "review_rounds"
    __table_args__ = (UniqueConstraint("thesis_id", "round_no"),)

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    round_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    discipline_code: Mapped[str] = mapped_column(String(32), nullable=False)
    discipline_name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ExpertTask(BaseModel):
    __tablename__ = "expert_tasks"

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("review_rounds.id"), nullable=False)
    expert_id: Mapped[UUID] = mapped_column(ForeignKey("experts.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INVITED")
    replaces_task_id: Mapped[UUID | None] = mapped_column(ForeignKey("expert_tasks.id"), nullable=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
