from uuid import UUID
from sqlalchemy import CheckConstraint, ForeignKey, ForeignKeyConstraint, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.mixins import BaseModel


class PdfTransformOperation(BaseModel):
    __tablename__ = 'pdf_transform_operations'
    __table_args__ = (
        UniqueConstraint('created_by', 'request_hash', name='uq_pdf_transform_request'),
        ForeignKeyConstraint(['source_version', 'thesis_id', 'tenant_id'],
            ['thesis_versions.id', 'thesis_versions.thesis_id', 'thesis_versions.tenant_id']),
        ForeignKeyConstraint(['new_file_id', 'thesis_id', 'tenant_id', 'purpose'],
            ['file_objects.id', 'file_objects.thesis_id', 'file_objects.tenant_id', 'file_objects.purpose']),
        CheckConstraint("status IN ('READY','APPLIED','CANCELLED')", name='ck_pdf_transform_status'),
        CheckConstraint("purpose IN ('original','anonymous')", name='ck_pdf_transform_purpose'),
        CheckConstraint('page_count BETWEEN 1 AND 1000', name='ck_pdf_transform_pages'),
    )
    thesis_id: Mapped[UUID] = mapped_column(nullable=False)
    tenant_id: Mapped[UUID] = mapped_column(nullable=False)
    created_by: Mapped[UUID] = mapped_column(ForeignKey('users.id'), nullable=False)
    source_version: Mapped[UUID] = mapped_column(nullable=False)
    expected_version: Mapped[int] = mapped_column(Integer, nullable=False)
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    operation: Mapped[str] = mapped_column(String(32), nullable=False)
    sources: Mapped[list] = mapped_column(JSONB, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    bound_file_id: Mapped[UUID | None] = mapped_column(ForeignKey('file_objects.id'))
    new_file_id: Mapped[UUID] = mapped_column(nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='READY')
