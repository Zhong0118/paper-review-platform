from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ResultSummary(BaseModel):
    __tablename__ = "result_summaries"
    __table_args__ = (UniqueConstraint("round_id"),)

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("review_rounds.id"), nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_task_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ResultPublication(BaseModel):
    __tablename__ = "result_publications"

    summary_id: Mapped[UUID] = mapped_column(ForeignKey("result_summaries.id"), nullable=False)
    published_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
