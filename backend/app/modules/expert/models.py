from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Expert(BaseModel):
    __tablename__ = "experts"
    __table_args__ = (
        CheckConstraint("service_status IN ('AVAILABLE','UNAVAILABLE')", name="ck_expert_service_status"),
        CheckConstraint("qualification_status IN ('PENDING','APPROVED','REJECTED')", name="ck_expert_qualification"),
        CheckConstraint("version > 0", name="ck_expert_version"),
        CheckConstraint("jsonb_typeof(discipline_codes) = 'array'", name="ck_expert_disciplines"),
    )

    unit: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    title: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    qualification_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", server_default="PENDING")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    service_status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE")
    discipline_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class ExpertConflict(BaseModel):
    __tablename__ = "expert_conflicts"
    __table_args__ = (UniqueConstraint("expert_id", "kind", "value", name="uq_expert_conflict"),)

    expert_id: Mapped[UUID] = mapped_column(ForeignKey("experts.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(128), nullable=False)
