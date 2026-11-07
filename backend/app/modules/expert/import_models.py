from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.mixins import BaseModel


class ExpertImportPreview(BaseModel):
    __tablename__ = 'expert_import_previews'
    __table_args__ = (CheckConstraint("status IN ('READY','INVALID','APPLIED')",name='ck_expert_import_status'),)

    actor_id: Mapped[UUID] = mapped_column(ForeignKey('users.id'),nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64),nullable=False)
    canonical_changes: Mapped[list] = mapped_column(JSONB,nullable=False)
    status: Mapped[str] = mapped_column(String(16),nullable=False)
