from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Thesis(BaseModel):
    __tablename__ = "theses"

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


class ThesisVersion(BaseModel):
    __tablename__ = "thesis_versions"

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
    __table_args__ = (UniqueConstraint("thesis_version_id", "purpose"),)

    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    file_id: Mapped[UUID] = mapped_column(ForeignKey("file_objects.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)


class AnonymizationCheck(BaseModel):
    __tablename__ = "anonymization_checks"

    thesis_version_id: Mapped[UUID] = mapped_column(ForeignKey("thesis_versions.id"), nullable=False)
    auto_conclusion: Mapped[str] = mapped_column(String(32), nullable=False)
    manual_conclusion: Mapped[str | None] = mapped_column(String(32), nullable=True)
    detector_version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")
    findings: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
