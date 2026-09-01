from uuid import UUID

from sqlalchemy import ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class Objection(BaseModel):
    __tablename__ = "objections"
    __table_args__ = (
        Index(
            "uq_objections_open_per_thesis",
            "thesis_id",
            unique=True,
            postgresql_where=text("status IN ('SUBMITTED', 'PROCESSING')"),
        ),
    )

    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"), nullable=False)
    thesis_id: Mapped[UUID] = mapped_column(ForeignKey("theses.id"), nullable=False)
    student_membership_id: Mapped[UUID] = mapped_column(ForeignKey("tenant_user_memberships.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    request: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="SUBMITTED")
    channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    conclusion: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
