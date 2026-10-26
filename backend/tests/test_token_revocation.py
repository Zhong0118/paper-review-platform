import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.audit.models import AuditEvent
from app.modules.auth import service as auth_service
from app.modules.files import service as files_service
from app.modules.tenant.models import Tenant
from app.modules.user.models import TenantUserMembership, User, UserRoleAssignment
from scripts.acceptance_server import acceptance_environment
from tests.helpers import attach_files, auth, create_draft, login


@pytest_asyncio.fixture
async def operations_client():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            yield client, runtime


async def _reset_password(client, school, member_id):
    response = await client.post(
        f"/api/v1/school-admin/members/{member_id}:reset-password",
        headers=auth(school, "reset-r01"), json={"password": "Replacement!2026Test"},
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_password_reset_revokes_old_access_and_refresh(operations_client):
    client, runtime = operations_client
    school = await login(client, "pilot.school")
    old = await login(client, "pilot.student")
    await _reset_password(client, school, runtime.operations_ids["student_member_id"])

    assert (await client.get("/api/v1/me", headers=auth(old))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})).status_code == 401
    fresh = await login(client, "pilot.student", "Replacement!2026Test")
    assert (await client.get("/api/v1/me", headers=auth(fresh))).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["disable", "suspend"])
async def test_reenable_does_not_resurrect_old_access(operations_client, action):
    client, runtime = operations_client
    old = await login(client, "pilot.student")
    if action == "disable":
        school = await login(client, "pilot.school")
        target = f"/api/v1/school-admin/members/{runtime.operations_ids['student_member_id']}"
        actor = school
        off, on = "disable", "enable"
    else:
        actor = await login(client, "admin.system")
        target = f"/api/v1/system/tenants/{runtime.operations_ids['tenant_id']}"
        off, on = "suspend", "resume"
    assert (await client.post(f"{target}:{off}", headers=auth(actor, f"r01-{off}"))).status_code == 200
    assert (await client.post(f"{target}:{on}", headers=auth(actor, f"r01-{on}"))).status_code == 200

    assert (await client.get("/api/v1/me", headers=auth(old))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})).status_code == 401
    fresh = await login(client, "pilot.student")
    assert (await client.get("/api/v1/me", headers=auth(fresh))).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("version", [None, True, "1", -1, 999])
async def test_invalid_access_auth_version_is_rejected(operations_client, version):
    client, _ = operations_client
    tokens = await login(client, "pilot.student")
    claims = jwt.decode(tokens["access_token"], options={"verify_signature": False})
    if version is None:
        claims.pop("auth_version", None)
    else:
        claims["auth_version"] = version
    forged = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")
    assert (await client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"})).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["suspend", "membership", "role", "reset"])
async def test_file_grant_rechecks_identity_and_audits_denial(operations_client, change):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    detail = (await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(student))).json()["data"]
    file_id = next(item["file_id"] for item in detail["current_version"]["files"] if item["purpose"] == "original")
    authorized = await client.post(f"/api/v1/files/{file_id}:authorize-download", headers=auth(student))
    assert authorized.status_code == 200
    url = authorized.json()["data"]["url"]
    assert (await client.get(url)).status_code == 200

    if change == "suspend":
        admin = await login(client, "admin.system")
        assert (await client.post(f"/api/v1/system/tenants/{runtime.operations_ids['tenant_id']}:suspend", headers=auth(admin, "r01-suspend"))).status_code == 200
    elif change == "reset":
        school = await login(client, "pilot.school")
        await _reset_password(client, school, runtime.operations_ids["student_member_id"])
    else:
        school = await login(client, "pilot.school")
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school["access_token"]))
            if change == "membership":
                row = await session.get(TenantUserMembership, UUID(runtime.operations_ids["student_member_id"]))
                row.is_active = False
            else:
                row = (await session.execute(select(UserRoleAssignment).where(UserRoleAssignment.user_id == UUID(student["user"]["id"])))).scalar_one()
                row.effective_until = datetime.now(timezone.utc) - timedelta(seconds=1)
            await session.commit()

    assert (await client.get(url)).status_code == 401
    admin_engine = create_async_engine(
        get_settings().database_url,
        connect_args={"server_settings": {"search_path": runtime.schema}},
    )
    try:
        async with admin_engine.connect() as conn:
            denied = (await conn.execute(select(AuditEvent).where(
                AuditEvent.action == "file_read", AuditEvent.object_id == file_id,
                AuditEvent.result == "DENIED",
            ))).all()
            assert denied
    finally:
        await admin_engine.dispose()

    if change == "suspend":
        assert (await client.post(f"/api/v1/system/tenants/{runtime.operations_ids['tenant_id']}:resume", headers=auth(admin, "r01-resume"))).status_code == 200
    if change in {"suspend", "reset"}:
        assert (await client.get(url)).status_code == 401
        fresh = await login(client, "pilot.student", "Replacement!2026Test" if change == "reset" else None)
        new_grant = await client.post(f"/api/v1/files/{file_id}:authorize-download", headers=auth(fresh))
        assert new_grant.status_code == 200
        assert (await client.get(new_grant.json()["data"]["url"])).status_code == 200


@pytest.mark.asyncio
async def test_reset_between_access_check_and_download_grant_cannot_sign_new_version(
    operations_client, monkeypatch,
):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    detail = (await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(student))).json()["data"]
    file_id = next(item["file_id"] for item in detail["current_version"]["files"] if item["purpose"] == "original")

    reached_second_check = asyncio.Event()
    release_second_check = asyncio.Event()
    original = files_service.auth_service.load_active_identity
    calls = 0

    async def pause_second_check(session, user_id, **kwargs):
        nonlocal calls
        if user_id == UUID(student["user"]["id"]):
            calls += 1
            if calls == 2:
                reached_second_check.set()
                await asyncio.wait_for(release_second_check.wait(), 10)
        return await original(session, user_id, **kwargs)

    monkeypatch.setattr(files_service.auth_service, "load_active_identity", pause_second_check)
    pending = asyncio.create_task(client.post(
        f"/api/v1/files/{file_id}:authorize-download", headers=auth(student),
    ))
    try:
        await asyncio.wait_for(reached_second_check.wait(), 10)
        await _reset_password(client, school, runtime.operations_ids["student_member_id"])
    finally:
        release_second_check.set()
    response = await asyncio.wait_for(pending, 10)
    if response.status_code == 200:
        # A successful grant here is exploitable only if its link reads bytes.
        leaked = await client.get(response.json()["data"]["url"])
        assert leaked.status_code != 200
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_token_version_check_refreshes_user_held_in_same_session(operations_client):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    async with runtime.session_factory() as held, runtime.session_factory() as writer:
        await bind_candidate_identity(held, verified_access_claims(student["access_token"]))
        await bind_candidate_identity(writer, verified_access_claims(school["access_token"]))
        user = (await held.execute(select(User).where(User.username == "pilot.student"))).scalar_one()
        old_version = user.auth_version
        await writer.execute(update(User).where(User.id == user.id).values(auth_version=User.auth_version + 1))
        await writer.commit()

        with pytest.raises(AppError) as error:
            await auth_service.load_active_identity(
                held, user.id, token_role="student",
                token_tenant_id=UUID(runtime.operations_ids["tenant_id"]),
                token_auth_version=old_version,
            )
        assert error.value.http_status == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["tenant", "membership"])
async def test_identity_check_refreshes_held_tenant_or_membership(operations_client, state):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    changer = await login(client, "admin.system" if state == "tenant" else "pilot.school")
    async with runtime.session_factory() as held, runtime.session_factory() as writer:
        await bind_candidate_identity(held, verified_access_claims(student["access_token"]))
        await bind_candidate_identity(writer, verified_access_claims(changer["access_token"]))
        user = (await held.execute(select(User).where(User.username == "pilot.student"))).scalar_one()
        identity = await auth_service.load_active_identity(held, user.id)
        if state == "tenant":
            await writer.execute(update(Tenant).where(Tenant.id == identity.tenant.id).values(status="SUSPENDED"))
        else:
            await writer.execute(update(TenantUserMembership).where(
                TenantUserMembership.id == identity.membership.id
            ).values(is_active=False))
        await writer.commit()

        with pytest.raises(AppError) as error:
            await auth_service.load_active_identity(
                held, user.id, token_role="student",
                token_tenant_id=UUID(runtime.operations_ids["tenant_id"]),
                token_auth_version=user.auth_version,
            )
        assert error.value.http_status == 401
