from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Thesis(BaseModel):
    __tablename__ = "theses"
    __table_args__ = (
        UniqueConstraint("id", "tenant_id", name="uq_theses_id_tenant_id"),
        ForeignKeyConstraint(
            ["current_version_id", "id", "tenant_id"],
            ["thesis_versions.id", "thesis_versions.thesis_id", "thesis_versions.tenant_id"],
            name="fk_theses_current_version_same_thesis",
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    student_membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenant_user_memberships.id"), nullable=False
    )
    review_batch_id: Mapped[UUID] = mapped_column(ForeignKey("review_batches.id"), nullable=False)
    current_version_id: Mapped[UUID | None] = mapped_column(ForeignKey("thesis_versions.id"), nullable=True)
    stage: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    submission_source: Mapped[str] = mapped_column(String(32), nullable=False, default="STUDENT")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    return_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    draft_abandoned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), deferred=True)


class ThesisVersion(BaseModel):
    __tablename__ = "thesis_versions"
    __table_args__ = (
        UniqueConstraint("id", "thesis_id", "tenant_id", name="uq_thesis_versions_id_thesis_tenant"),
        ForeignKeyConstraint(["thesis_id", "tenant_id"], ["theses.id", "theses.tenant_id"],
                             name="fk_thesis_versions_thesis_tenant"),
    )

    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    abstract: Mapped[str] = mapped_column(Text, nullable=False, default="")
    discipline_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    discipline_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    keywords: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    is_editable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ThesisVersionFile(BaseModel):
    __tablename__ = "thesis_version_files"
    __table_args__ = (
        UniqueConstraint("thesis_version_id", "purpose"),
        ForeignKeyConstraint(["thesis_version_id", "thesis_id", "tenant_id"],
                             ["thesis_versions.id", "thesis_versions.thesis_id", "thesis_versions.tenant_id"],
                             name="fk_version_files_version_thesis_tenant"),
        ForeignKeyConstraint(["file_id", "thesis_id", "tenant_id", "purpose"],
                             ["file_objects.id", "file_objects.thesis_id", "file_objects.tenant_id",
                              "file_objects.purpose"], name="fk_version_files_file_thesis_tenant_purpose"),
    )

    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    file_id: Mapped[UUID] = mapped_column(ForeignKey("file_objects.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)


class AnonymizationCheck(BaseModel):
    __tablename__ = "anonymization_checks"

    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    auto_conclusion: Mapped[str] = mapped_column(String(32), nullable=False)
    manual_conclusion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    detector_version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")
    findings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    source_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class TenantSensitiveTerms(BaseModel):
    __tablename__ = "tenant_sensitive_terms"
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), unique=True, nullable=False)
    terms: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
