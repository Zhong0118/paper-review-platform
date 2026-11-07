from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class UUIDPrimaryKeyMixin:
    id: Mapped[object] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)


class AuditUserMixin:
    created_by: Mapped[object | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    updated_by: Mapped[object | None] = mapped_column(Uuid(as_uuid=True), nullable=True)


class BaseModel(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __abstract__ = True
