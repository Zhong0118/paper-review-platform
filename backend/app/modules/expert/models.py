from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Expert(BaseModel):
    __tablename__ = "experts"
    __table_args__ = (
        CheckConstraint("service_status IN ('AVAILABLE','UNAVAILABLE')", name="ck_expert_service_status"),
        CheckConstraint("qualification_status IN ('PENDING','APPROVED','REJECTED')", name="ck_expert_qualification"),
        CheckConstraint("version > 0", name="ck_expert_version"),
        CheckConstraint("jsonb_typeof(research_directions)='array' AND jsonb_array_length(research_directions)<=20", name='ck_expert_research_directions'),
        CheckConstraint("jsonb_typeof(keywords)='array' AND jsonb_array_length(keywords)<=20", name='ck_expert_keywords'),
        CheckConstraint("jsonb_typeof(discipline_codes) = 'array'", name="ck_expert_disciplines"),
    )

    unit: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    title: Mapped[str] = mapped_column(String(128), nullable=False, default="", server_default="")
    qualification_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", server_default="PENDING")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    province_name: Mapped[str | None] = mapped_column(String(128))
    doctoral_supervisor: Mapped[bool | None] = mapped_column(Boolean)
    masters_supervisor: Mapped[bool | None] = mapped_column(Boolean)
    research_directions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default='[]')
    keywords: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default='[]')
    source_url: Mapped[str | None] = mapped_column(String(2048))
    source_note: Mapped[str | None] = mapped_column(String(1000))
    source_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    service_status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE")
    discipline_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class ExpertConflict(BaseModel):
    __tablename__ = "expert_conflicts"
    __table_args__ = (UniqueConstraint("expert_id", "kind", "value", name="uq_expert_conflict"),)

    expert_id: Mapped[UUID] = mapped_column(ForeignKey("experts.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(128), nullable=False)
