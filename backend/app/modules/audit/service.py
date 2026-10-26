import json
from hashlib import sha256

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppError
from app.modules.audit.models import AuditEvent, IdempotencyKey
from app.modules.auth.deps import CurrentUser


def request_digest(route: str, payload: dict) -> str:
    raw = json.dumps(
        {"route": route, "payload": payload},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    return sha256(raw.encode()).hexdigest()


async def replay(
    session: AsyncSession,
    user: CurrentUser,
    key: str | None,
    route: str,
    payload: dict,
    *,
    wait: bool = True,
) -> dict | None:
    if not key:
        return None
    # Serialize the read and later insert for the same user/key in this transaction.
    lock_key = int.from_bytes(
        sha256(f"{user.id}:{key}".encode()).digest()[:8], byteorder="big", signed=True
    )
    # Parent-lock holders must not wait behind an older route that takes this
    # advisory lock first; reject the in-flight conflict instead of deadlocking.
    if wait:
        await session.execute(select(func.pg_advisory_xact_lock(lock_key)))
    elif not await session.scalar(select(func.pg_try_advisory_xact_lock(lock_key))):
        raise AppError("IDEMPOTENCY_CONFLICT", 409, "同一幂等键的请求正在处理，请稍后重试")
    existing = (
        await session.execute(
            select(IdempotencyKey).where(
                IdempotencyKey.user_id == user.id,
                IdempotencyKey.key == key,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        return None
    if existing.route != route or existing.request_hash != request_digest(route, payload):
        raise AppError("IDEMPOTENCY_CONFLICT", 409, "同一幂等键用于不同请求")
    return existing.response_body


async def remember(
    session: AsyncSession,
    user: CurrentUser,
    key: str | None,
    route: str,
    payload: dict,
    response_body: dict,
    code: int = 200,
) -> None:
    if not key:
        return
    session.add(
        IdempotencyKey(
            user_id=user.id,
            key=key,
            route=route,
            request_hash=request_digest(route, payload),
            response_code=code,
            response_body=response_body,
        )
    )


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
    values = dict(
        tenant_id=user.tenant_id if user else None,
        actor_id=user.id if user else None,
        action=action,
        object_type=object_type,
        object_id=object_id,
        result=result,
        request_id=request_id,
        detail=detail or {},
    )
    # Neither runtime role can SELECT audit rows; inline INSERT avoids RETURNING.
    await session.execute(insert(AuditEvent).inline().values(**values))
