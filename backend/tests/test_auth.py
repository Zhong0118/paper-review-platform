from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.modules.auth import service as auth_service
from app.modules.auth.models import AuthSession
from app.modules.tenant.models import Tenant
from app.modules.user.models import TenantUserMembership, User, UserRoleAssignment


async def _login(client: AsyncClient, password: str) -> dict:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": password},
    )
    assert response.status_code == 200
    return response.json()["data"]


async def _student_identity_rows(
    session: AsyncSession,
) -> tuple[User, UserRoleAssignment, TenantUserMembership, Tenant]:
    user = (
        await session.execute(select(User).where(User.username == "student.lin"))
    ).scalar_one()
    assignment = (
        await session.execute(
            select(UserRoleAssignment).where(UserRoleAssignment.user_id == user.id)
        )
    ).scalar_one()
    membership = (
        await session.execute(
            select(TenantUserMembership).where(TenantUserMembership.user_id == user.id)
        )
    ).scalar_one()
    tenant = await session.get(Tenant, assignment.tenant_id)
    assert tenant is not None
    return user, assignment, membership, tenant


@pytest.mark.asyncio
async def test_login_and_me(client: AsyncClient, seed: SimpleNamespace):
    res = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": seed.password},
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["data"]["role"] == "student"
    assert me.json()["data"]["tenant_code"] == "demo-univ"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    res = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": "nope"},
    )
    assert res.status_code == 401
    assert res.json()["code"] == "AUTH_REQUIRED"


@pytest.mark.asyncio
async def test_logout_revokes_refresh(client: AsyncClient, seed: SimpleNamespace):
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": seed.password},
    )
    assert login.status_code == 200
    refresh = login.json()["data"]["refresh_token"]
    access = login.json()["data"]["access_token"]
    await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refresh},
        headers={"Authorization": f"Bearer {access}"},
    )
    again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert again.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_state",
    ["user_disabled", "assignment_expired", "membership_inactive", "tenant_suspended"],
)
async def test_access_token_stops_when_identity_becomes_inactive(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: SimpleNamespace,
    invalid_state: str,
):
    tokens = await _login(client, seed.password)
    user, assignment, membership, tenant = await _student_identity_rows(db_session)
    if invalid_state == "user_disabled":
        user.status = "DISABLED"
    elif invalid_state == "assignment_expired":
        assignment.effective_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    elif invalid_state == "membership_inactive":
        membership.is_active = False
    else:
        tenant.status = "SUSPENDED"
    await db_session.commit()

    response = await client.get(
        "/api/v1/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_REQUIRED"


@pytest.mark.asyncio
@pytest.mark.parametrize("claim", ["role", "tenant"])
async def test_access_token_claims_must_match_current_assignment(
    client: AsyncClient,
    db_session: AsyncSession,
    claim: str,
):
    user, assignment, _, _ = await _student_identity_rows(db_session)
    token = create_access_token(
        user_id=user.id,
        role="supervisor" if claim == "role" else "student",
        tenant_id=None if claim == "tenant" else assignment.tenant_id,
        auth_version=user.auth_version,
    )

    response = await client.get(
        "/api/v1/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_REQUIRED"


@pytest.mark.asyncio
async def test_refresh_rejects_inactive_identity_without_creating_session(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: SimpleNamespace,
):
    tokens = await _login(client, seed.password)
    user, _, _, _ = await _student_identity_rows(db_session)
    before = await db_session.scalar(
        select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user.id)
    )
    user.status = "DISABLED"
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    after = await db_session.scalar(
        select(func.count()).select_from(AuthSession).where(AuthSession.user_id == user.id)
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_REQUIRED"
    assert after == before


@pytest.mark.asyncio
async def test_revoke_user_sessions_revokes_every_active_session(
    client: AsyncClient,
    db_session: AsyncSession,
    seed: SimpleNamespace,
):
    await _login(client, seed.password)
    await _login(client, seed.password)
    user, _, _, _ = await _student_identity_rows(db_session)
    revoked_at = datetime.now(timezone.utc)

    count = await auth_service.revoke_user_sessions(
        db_session, user.id, at=revoked_at
    )
    await db_session.flush()
    active = await db_session.scalar(
        select(func.count())
        .select_from(AuthSession)
        .where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
    )

    assert count == 2
    assert active == 0
