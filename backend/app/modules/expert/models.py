from uuid import UUID

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Expert(BaseModel):
    __tablename__ = "experts"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    service_status: Mapped[str] = mapped_column(String(32), nullable=False, default="AVAILABLE")
    discipline_codes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)


class ExpertConflict(BaseModel):
    __tablename__ = "expert_conflicts"

    expert_id: Mapped[UUID] = mapped_column(ForeignKey("experts.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[str] = mapped_column(String(128), nullable=False)
