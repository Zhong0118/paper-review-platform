from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, ForeignKeyConstraint, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from app.modules.review.rules import pilot_rule_snapshot

from app.db.base import Base
from app.db.mixins import BaseModel


class ReviewRound(BaseModel):
    __tablename__ = "review_rounds"
    __table_args__ = (
        UniqueConstraint("thesis_id", "round_no"),
        UniqueConstraint("id", "thesis_id", "tenant_id", name="uq_review_rounds_id_thesis_tenant"),
        ForeignKeyConstraint(["thesis_id", "tenant_id"], ["theses.id", "theses.tenant_id"],
                             name="fk_review_rounds_thesis_tenant"),
        ForeignKeyConstraint(["thesis_version_id", "thesis_id", "tenant_id"],
                             ["thesis_versions.id", "thesis_versions.thesis_id", "thesis_versions.tenant_id"],
                             name="fk_review_rounds_version_thesis_tenant"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    rule_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=pilot_rule_snapshot)
    anonymous_title: Mapped[str] = mapped_column(String(255), nullable=False)
    round_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="CREATED")
    discipline_code: Mapped[str] = mapped_column(String(32), nullable=False)
    discipline_name: Mapped[str] = mapped_column(String(128), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ExpertTask(BaseModel):
    __tablename__ = "expert_tasks"
    __table_args__ = (
        UniqueConstraint("id", "round_id", "tenant_id", name="uq_expert_tasks_id_round_tenant"),
        ForeignKeyConstraint(["round_id", "thesis_id", "tenant_id"],
                             ["review_rounds.id", "review_rounds.thesis_id", "review_rounds.tenant_id"],
                             name="fk_expert_tasks_round_thesis_tenant"),
        ForeignKeyConstraint(["replaces_task_id", "round_id", "tenant_id"],
                             ["expert_tasks.id", "expert_tasks.round_id", "expert_tasks.tenant_id"],
                             name="fk_expert_tasks_replacement_same_round"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("review_rounds.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    expert_id: Mapped[UUID] = mapped_column(ForeignKey("experts.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="INVITED")
    replaces_task_id: Mapped[UUID | None] = mapped_column(ForeignKey("expert_tasks.id"), nullable=True)
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    accept_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_days: Mapped[int | None] = mapped_column(SmallInteger)
    original_review_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BatchDeadlineRule(Base):
    __tablename__ = 'batch_deadline_rules'
    __table_args__ = (ForeignKeyConstraint(['id','tenant_id'],['review_batches.id','review_batches.tenant_id']),)
    id: Mapped[UUID] = mapped_column(primary_key=True)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    accept_days: Mapped[int | None] = mapped_column(SmallInteger)
    review_days: Mapped[int | None] = mapped_column(SmallInteger)


class TaskExtension(Base):
    __tablename__ = 'task_extensions'
    id: Mapped[UUID] = mapped_column(primary_key=True)
    task_id: Mapped[UUID] = mapped_column(ForeignKey('expert_tasks.id'))
    requested_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'))
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    original_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    requested_due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    decided_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id'))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decision_reason: Mapped[str | None] = mapped_column(Text)
