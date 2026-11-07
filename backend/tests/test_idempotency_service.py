import asyncio

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.exceptions import AppError
from app.modules.audit import service as audit_service
from app.modules.auth.deps import CurrentUser
from app.modules.user.models import User, UserRoleAssignment


async def _student(session: AsyncSession) -> CurrentUser:
    user = (
        await session.execute(select(User).where(User.username == "student.lin"))
    ).scalar_one()
    assignment = (
        await session.execute(
            select(UserRoleAssignment).where(UserRoleAssignment.user_id == user.id)
        )
    ).scalar_one()
    return CurrentUser(
        id=user.id,
        role="student",
        tenant_id=assignment.tenant_id,
        data_scope={},
    )


def test_request_digest_is_stable_for_nested_key_order():
    first = {"a": {"x": 1, "y": 2}, "items": [{"b": 2, "a": 1}]}
    second = {"items": [{"a": 1, "b": 2}], "a": {"y": 2, "x": 1}}

    assert audit_service.request_digest("route", first) == audit_service.request_digest(
        "route", second
    )


@pytest.mark.asyncio
async def test_replay_returns_stored_response_for_equivalent_request(
    db_session: AsyncSession,
):
    user = await _student(db_session)
    await audit_service.remember(
        db_session,
        user,
        "same-key",
        "route",
        {"a": {"x": 1, "y": 2}},
        {"id": "stored"},
    )
    await db_session.flush()

    replayed = await audit_service.replay(
        db_session, user, "same-key", "route", {"a": {"y": 2, "x": 1}}
    )

    assert replayed == {"id": "stored"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("route", "payload"),
    [("other-route", {"a": 1}), ("route", {"a": 2})],
)
async def test_replay_rejects_reusing_key_for_another_request(
    db_session: AsyncSession,
    route: str,
    payload: dict,
):
    user = await _student(db_session)
    await audit_service.remember(
        db_session, user, "same-key", "route", {"a": 1}, {"id": "stored"}
    )
    await db_session.flush()

    with pytest.raises(AppError) as error:
        await audit_service.replay(
            db_session, user, "same-key", route, payload
        )

    assert error.value.code == "IDEMPOTENCY_CONFLICT"
    assert error.value.http_status == 409


@pytest.mark.asyncio
async def test_concurrent_same_key_replays_first_committed_response(test_engine: AsyncEngine):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        actor = await _student(session)

    async def request(index: int):
        async with sessions() as session:
            cached = await audit_service.replay(session, actor, "concurrent-key", "route", {"value": 1})
            if cached is not None:
                return cached
            await asyncio.sleep(0.05)
            body = {"winner": index}
            await audit_service.remember(session, actor, "concurrent-key", "route", {"value": 1}, body)
            await session.commit()
            return body

    first, second = await asyncio.gather(request(1), request(2))
    assert first == second
