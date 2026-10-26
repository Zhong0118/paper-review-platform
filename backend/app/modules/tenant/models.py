from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.mixins import AuditUserMixin, BaseModel


class Tenant(AuditUserMixin, BaseModel):
    __tablename__ = "tenants"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    sync_mapping: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    institution_code: Mapped[str | None] = mapped_column(ForeignKey('institution_catalog.code'), nullable=True)
    config_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Organization(BaseModel):
    __tablename__ = "organizations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "external_id"),
        UniqueConstraint("id", "tenant_id", name="uq_organizations_id_tenant_id"),
        ForeignKeyConstraint(["parent_id", "tenant_id"], ["organizations.id", "organizations.tenant_id"],
                             name="fk_organizations_parent_same_tenant"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    parent_id: Mapped[UUID | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    org_type: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class ReviewBatch(BaseModel):
    __tablename__ = "review_batches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code"),
        Index("ix_batch_tenant_status_created", "tenant_id", "status", "created_at"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"), default=1)


class DisciplineCatalog(BaseModel):
    __tablename__ = "discipline_catalog"
    __table_args__ = (UniqueConstraint("code"),)

    tenant_id: Mapped[UUID | None] = mapped_column(ForeignKey("tenants.id"), nullable=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    source_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    category_name: Mapped[str | None] = mapped_column(String(32), nullable=True)
    kind: Mapped[str | None] = mapped_column(String(32), nullable=True)


class InstitutionCatalog(BaseModel):
    __tablename__ = 'institution_catalog'
    code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    province: Mapped[str] = mapped_column(String(64), nullable=False)
    city: Mapped[str] = mapped_column(String(64), nullable=False, default='')
    authority: Mapped[str] = mapped_column(String(128), nullable=False)
    level: Mapped[str] = mapped_column(String(32), nullable=False, default='')
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    source_version: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class SchoolDisciplineSettings(BaseModel):
    __tablename__ = 'school_discipline_settings'
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey('tenants.id'), unique=True, nullable=False)
    codes: Mapped[list] = mapped_column(JSONB, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
