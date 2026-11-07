from uuid import UUID

from sqlalchemy import Boolean, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ReviewDraft(BaseModel):
    __tablename__ = "review_drafts"
    __table_args__ = (UniqueConstraint("task_id"),)

    task_id: Mapped[UUID] = mapped_column(ForeignKey("expert_tasks.id"), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")


class ReviewResultVersion(BaseModel):
    __tablename__ = "review_result_versions"
    __table_args__ = (
        ForeignKeyConstraint(["task_id", "round_id", "tenant_id"],
                             ["expert_tasks.id", "expert_tasks.round_id", "expert_tasks.tenant_id"],
                             name="fk_review_results_task_round_tenant"),
    )

    task_id: Mapped[UUID] = mapped_column(ForeignKey("expert_tasks.id"), nullable=False)
    round_id: Mapped[UUID] = mapped_column(ForeignKey("review_rounds.id"), nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    scores: Mapped[dict] = mapped_column(JSONB, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    check_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comments: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ReviewCorrectionRequest(BaseModel):
    __tablename__ = 'review_correction_requests'
    __table_args__ = (
        UniqueConstraint('id', 'task_id', 'round_id', 'tenant_id', name='uq_correction_parent'),
        ForeignKeyConstraint(['task_id', 'round_id', 'tenant_id'],
                             ['expert_tasks.id', 'expert_tasks.round_id', 'expert_tasks.tenant_id'],
                             name='fk_correction_task'),
    )
    task_id: Mapped[UUID] = mapped_column(nullable=False)
    round_id: Mapped[UUID] = mapped_column(nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    base_result_id: Mapped[UUID] = mapped_column(ForeignKey('review_result_versions.id'), nullable=False)
    base_revision_id: Mapped[UUID | None] = mapped_column(ForeignKey('review_result_revisions.id', use_alter=True), nullable=True)
    requested_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False)
    decided_by: Mapped[UUID | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default='REQUESTED')
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    draft_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class ReviewCorrectionNote(BaseModel):
    __tablename__ = 'review_correction_notes'
    request_id: Mapped[UUID] = mapped_column(ForeignKey('review_correction_requests.id'), nullable=False)
    author_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False)
    note_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(String(2000), nullable=False)


class ReviewResultRevision(BaseModel):
    __tablename__ = 'review_result_revisions'
    __table_args__ = (
        UniqueConstraint('request_id'),
        UniqueConstraint('task_id', 'revision_no'),
        UniqueConstraint('id', 'round_id', 'tenant_id', name='uq_revision_round'),
        ForeignKeyConstraint(['request_id', 'task_id', 'round_id', 'tenant_id'],
                             ['review_correction_requests.id', 'review_correction_requests.task_id',
                              'review_correction_requests.round_id', 'review_correction_requests.tenant_id'],
                             name='fk_revision_request'),
    )
    request_id: Mapped[UUID] = mapped_column(nullable=False)
    task_id: Mapped[UUID] = mapped_column(nullable=False)
    round_id: Mapped[UUID] = mapped_column(nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    base_result_id: Mapped[UUID] = mapped_column(ForeignKey('review_result_versions.id'), nullable=False)
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    scores: Mapped[dict] = mapped_column(JSONB, nullable=False)
    comments: Mapped[dict] = mapped_column(JSONB, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    check_summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    rule_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
