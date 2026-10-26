from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ResultSummary(BaseModel):
    __tablename__ = "result_summaries"
    __table_args__ = (
        UniqueConstraint("round_id"),
        ForeignKeyConstraint(["thesis_id", "tenant_id"], ["theses.id", "theses.tenant_id"],
                             name="fk_result_summaries_thesis_tenant"),
        ForeignKeyConstraint(["round_id", "thesis_id", "tenant_id"],
                             ["review_rounds.id", "review_rounds.thesis_id", "review_rounds.tenant_id"],
                             name="fk_result_summaries_round_thesis_tenant"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("review_rounds.id"), nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    rule_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_task_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    effective_revision_id: Mapped[UUID | None] = mapped_column(ForeignKey("review_result_revisions.id"), nullable=True)


class ResultPublication(BaseModel):
    __tablename__ = "result_publications"
    __table_args__ = (
        UniqueConstraint("summary_id", "publication_no", name="uq_publication_number"),
        UniqueConstraint("id", "summary_id", name="uq_publication_parent"),
        UniqueConstraint("replaces_id", name="uq_publication_successor"),
        ForeignKeyConstraint(["replaces_id", "summary_id"],
                             ["result_publications.id", "result_publications.summary_id"],
                             name="fk_publication_replaces_same_summary"),
    )

    summary_id: Mapped[UUID] = mapped_column(ForeignKey("result_summaries.id"), nullable=False)
    published_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    publication_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    replaces_id: Mapped[UUID | None] = mapped_column(nullable=True)
