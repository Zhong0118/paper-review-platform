from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class User(BaseModel):
    __tablename__ = "users"
    __mapper_args__ = {"eager_defaults": False}

    username: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True, deferred=True)
    provisioned_by: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, deferred=True)
    provisioned_tenant_id: Mapped[UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, deferred=True)
    auth_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    contact_email: Mapped[str | None] = mapped_column(String(128), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Role(BaseModel):
    __tablename__ = "roles"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_platform: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)


class TenantUserMembership(BaseModel):
    __tablename__ = "tenant_user_memberships"
    __table_args__ = (
        UniqueConstraint("tenant_id", "external_id"),
        UniqueConstraint("tenant_id", "user_id"),
        UniqueConstraint("id", "tenant_id", name="uq_memberships_id_tenant_for_objections"),
        Index("ix_membership_tenant_type_active", "tenant_id", "membership_type", "is_active"),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    membership_type: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    external_source: Mapped[str] = mapped_column(String(64), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)


class UserRoleAssignment(BaseModel):
    __tablename__ = "user_role_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_role_assignments_user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    tenant_id: Mapped[UUID | None] = mapped_column(ForeignKey("tenants.id"), nullable=True)
    role_id: Mapped[UUID] = mapped_column(ForeignKey("roles.id"), nullable=False)
    data_scope: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    effective_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class StudentEligibility(BaseModel):
    __tablename__ = "student_eligibilities"
    __table_args__ = (UniqueConstraint("tenant_id", "student_membership_id", "review_batch_id"),)

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    student_membership_id: Mapped[UUID] = mapped_column(
        ForeignKey("tenant_user_memberships.id"), nullable=False
    )
    review_batch_id: Mapped[UUID] = mapped_column(ForeignKey("review_batches.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ELIGIBLE")
    supervisor_membership_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("tenant_user_memberships.id"), nullable=True
    )
    degree_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    student_name: Mapped[str] = mapped_column(String(128), nullable=False)
    student_no: Mapped[str] = mapped_column(String(64), nullable=False)
    supervisor_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_version: Mapped[str] = mapped_column(String(64), nullable=False)
    source_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
