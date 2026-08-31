from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditEvent
from app.modules.auth.deps import CurrentUser


async def record(
    session: AsyncSession,
    *,
    user: CurrentUser | None,
    action: str,
    object_type: str,
    object_id: str | None,
    result: str = "SUCCESS",
    request_id: str | None = None,
    detail: dict | None = None,
) -> None:
    session.add(
        AuditEvent(
            tenant_id=user.tenant_id if user else None,
            actor_id=user.id if user else None,
            action=action,
            object_type=object_type,
            object_id=object_id,
            result=result,
            request_id=request_id,
            detail=detail or {},
        )
    )
