from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class FileObject(BaseModel):
    __tablename__ = "file_objects"
    __table_args__ = (
        UniqueConstraint("id", "thesis_id", "tenant_id", "purpose", name="uq_file_objects_id_thesis_tenant_purpose"),
        ForeignKeyConstraint(["thesis_id", "tenant_id"], ["theses.id", "theses.tenant_id"],
                             name="fk_file_objects_thesis_tenant"),
        ForeignKeyConstraint(["upload_version_id", "thesis_id", "tenant_id"],
                             ["thesis_versions.id", "thesis_versions.thesis_id", "thesis_versions.tenant_id"],
                             name="fk_file_objects_version_thesis_tenant"),
        CheckConstraint("upload_version_id IS NULL OR thesis_id IS NOT NULL",
                        name="ck_file_objects_version_has_thesis"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID | None] = mapped_column(ForeignKey("theses.id"), nullable=True)
    upload_version_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("thesis_versions.id"), nullable=True
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scan_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    uploaded_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
