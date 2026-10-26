import asyncio
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.modules.auth import service as auth_service
from app.modules.tenant import service as tenant_service
from app.modules.tenant.models import Tenant
from app.modules.user import service as user_service
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.user.models import TenantUserMembership, User
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login


@pytest_asyncio.fixture
async def operations_client():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            yield client, runtime


async def _reset(client, school, member_id, key):
    return await client.post(
        f"/api/v1/school-admin/members/{member_id}:reset-password",
        headers=auth(school, key), json={"password": "Replacement!2026Test"},
    )


def _pause_student_issue(monkeypatch, student_id):
    reached = asyncio.Event()
    release = asyncio.Event()
    original = auth_service.issue_tokens

    async def paused(session, identity):
        if str(identity.user.id) == student_id:
            reached.set()
            await asyncio.wait_for(release.wait(), 10)
        return await original(session, identity)

    monkeypatch.setattr(auth_service, "issue_tokens", paused)
    return reached, release


@pytest.mark.asyncio
async def test_reset_commits_after_refresh_lookup_before_user_lock(operations_client, monkeypatch):
    client, runtime = operations_client
    old = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    reached = asyncio.Event()
    release = asyncio.Event()
    original_execute = AsyncSession.execute

    async def pause_after_lookup(self, statement, *args, **kwargs):
        result = await original_execute(self, statement, *args, **kwargs)
        if isinstance(statement, Select) and "auth_sessions.refresh_token_hash" in str(statement):
            reached.set()
            await asyncio.wait_for(release.wait(), 10)
        return result

    monkeypatch.setattr(AsyncSession, "execute", pause_after_lookup)
    pending = asyncio.create_task(client.post(
        "/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]},
    ))
    try:
        await asyncio.wait_for(reached.wait(), 10)
        reset = await asyncio.wait_for(_reset(client, school, runtime.operations_ids["student_member_id"],
                                               "r02-reset-before-refresh"), 10)
        assert reset.status_code == 200
    finally:
        release.set()
    response = await asyncio.wait_for(pending, 10)
    assert response.status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})).status_code == 401
    assert (await client.post("/api/v1/auth/login", json={
        "username": "pilot.student", "password": runtime.seed_password,
    })).status_code == 401
    fresh = await login(client, "pilot.student", "Replacement!2026Test")
    assert (await client.get("/api/v1/me", headers=auth(fresh))).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["refresh", "login"])
async def test_credential_issues_before_reset_then_reset_revokes_it(operations_client, monkeypatch, operation):
    client, runtime = operations_client
    old = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    reached, release = _pause_student_issue(monkeypatch, old["user"]["id"])
    reset_started = asyncio.Event()
    original_lock_member = user_service._locked_member

    async def lock_member(*args, **kwargs):
        reset_started.set()
        return await original_lock_member(*args, **kwargs)

    monkeypatch.setattr(user_service, "_locked_member", lock_member)
    if operation == "refresh":
        pending = asyncio.create_task(client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}))
    else:
        pending = asyncio.create_task(client.post("/api/v1/auth/login", json={
            "username": "pilot.student", "password": runtime.seed_password,
        }))
    reset_task = None
    user_lock_held = False
    try:
        await asyncio.wait_for(reached.wait(), 10)
        async with runtime.session_factory() as probe:
            try:
                await bind_candidate_identity(probe, verified_access_claims(school["access_token"]))
                await probe.execute(select(User).where(User.id == UUID(old["user"]["id"])).with_for_update(nowait=True))
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) != "55P03":
                    raise
                user_lock_held = True
            finally:
                await probe.rollback()
        reset_task = asyncio.create_task(_reset(
            client, school, runtime.operations_ids["student_member_id"], f"r02-issue-before-{operation}",
        ))
        await asyncio.wait_for(reset_started.wait(), 10)
    finally:
        release.set()
    issued, reset = await asyncio.wait_for(
        asyncio.gather(pending, reset_task, return_exceptions=True), 10,
    )
    assert not isinstance(issued, Exception), type(issued).__name__
    assert not isinstance(reset, Exception), type(reset).__name__
    assert user_lock_held
    assert issued.status_code == reset.status_code == 200
    tokens = issued.json()["data"]
    assert (await client.get("/api/v1/me", headers=auth(tokens))).status_code == 401
    assert (await client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})).status_code == 401


@pytest.mark.asyncio
async def test_same_refresh_can_be_rotated_only_once(operations_client, monkeypatch):
    client, _ = operations_client
    old = await login(client, "pilot.student")
    reached, release = _pause_student_issue(monkeypatch, old["user"]["id"])
    second_located = asyncio.Event()
    original_execute = AsyncSession.execute
    second_task = None

    async def execute_and_signal(self, statement, *args, **kwargs):
        result = await original_execute(self, statement, *args, **kwargs)
        if reached.is_set() and "auth_sessions.refresh_token_hash" in str(statement):
            second_located.set()
        return result

    monkeypatch.setattr(AsyncSession, "execute", execute_and_signal)
    first_task = asyncio.create_task(client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}))
    second_task_started = False
    try:
        await asyncio.wait_for(reached.wait(), 10)
        second_task = asyncio.create_task(client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}))
        await asyncio.wait_for(second_located.wait(), 10)
        second_task_started = True
    except asyncio.TimeoutError:
        pass
    finally:
        release.set()
    tasks = [first_task] + ([second_task] if second_task is not None else [])
    responses = await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 10)
    assert all(not isinstance(response, Exception) for response in responses), [type(response).__name__ for response in responses]
    assert second_task_started
    assert sorted(response.status_code for response in responses) == [200, 401]


@pytest.mark.asyncio
async def test_locked_tenant_read_refreshes_cached_status(operations_client):
    client, runtime = operations_client
    admin = await login(client, "admin.system")
    claims = verified_access_claims(admin["access_token"])
    tenant_id = UUID(runtime.operations_ids["tenant_id"])
    async with runtime.session_factory() as reader:
        await bind_candidate_identity(reader, claims)
        cached = (await reader.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one()
        assert cached.status == "ACTIVE"
        async with runtime.session_factory() as writer:
            await bind_candidate_identity(writer, claims)
            await writer.execute(update(Tenant).where(Tenant.id == tenant_id).values(status="SUSPENDED"))
            await writer.commit()
        locked = await tenant_service.get_tenant(reader, tenant_id, lock=True)
        assert locked.status == "SUSPENDED"
        await reader.rollback()


@pytest.mark.asyncio
async def test_locked_member_read_refreshes_cached_identity(operations_client):
    client, runtime = operations_client
    school = await login(client, "pilot.school")
    claims = verified_access_claims(school["access_token"])
    tenant_id = UUID(runtime.operations_ids["tenant_id"])
    member_id = UUID(runtime.operations_ids["student_member_id"])
    async with runtime.session_factory() as reader:
        await bind_candidate_identity(reader, claims)
        membership = (await reader.execute(select(TenantUserMembership).where(
            TenantUserMembership.id == member_id,
        ))).scalar_one()
        user = (await reader.execute(select(User).where(User.id == membership.user_id))).scalar_one()
        assert membership.is_active and user.status == "ACTIVE"
        async with runtime.session_factory() as writer:
            await bind_candidate_identity(writer, claims)
            await writer.execute(update(TenantUserMembership).where(
                TenantUserMembership.id == member_id,
            ).values(is_active=False))
            await writer.execute(update(User).where(User.id == user.id).values(status="DISABLED"))
            await writer.commit()
        locked_membership, locked_user, _ = await user_service._locked_member(reader, tenant_id, member_id)
        assert locked_membership.is_active is False
        assert locked_user.status == "DISABLED"
        await reader.rollback()


@pytest.mark.asyncio
async def test_member_reset_and_tenant_suspend_do_not_deadlock(operations_client, monkeypatch):
    client, runtime = operations_client
    school = await login(client, "pilot.school")
    admin = await login(client, "admin.system")
    student = await login(client, "pilot.student")
    student_id = UUID(student["user"]["id"])
    tenant_id = UUID(runtime.operations_ids["tenant_id"])
    reset_locked_user = asyncio.Event()
    release_reset = asyncio.Event()
    tenant_lock_attempted = asyncio.Event()
    original_revoke = auth_service.revoke_user_sessions
    original_get_tenant = tenant_service.get_tenant
    first_student_revoke = True

    async def pause_reset(session, user_id, *args, **kwargs):
        nonlocal first_student_revoke
        result = await original_revoke(session, user_id, *args, **kwargs)
        if user_id == student_id and first_student_revoke:
            first_student_revoke = False
            reset_locked_user.set()
            await asyncio.wait_for(release_reset.wait(), 10)
        return result

    async def observe_tenant_lock(session, requested_id, *, lock=False):
        if requested_id == tenant_id and lock:
            tenant_lock_attempted.set()
        return await original_get_tenant(session, requested_id, lock=lock)

    monkeypatch.setattr(auth_service, "revoke_user_sessions", pause_reset)
    monkeypatch.setattr(tenant_service, "get_tenant", observe_tenant_lock)
    reset_task = asyncio.create_task(_reset(
        client, school, runtime.operations_ids["student_member_id"], "r02-deadlock-reset",
    ))
    suspend_task = None
    tenant_guard_held = False
    try:
        await asyncio.wait_for(reset_locked_user.wait(), 10)
        async with runtime.session_factory() as probe:
            try:
                await bind_candidate_identity(probe, verified_access_claims(admin["access_token"]))
                await probe.execute(select(Tenant).where(Tenant.id == tenant_id).with_for_update(nowait=True))
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) != "55P03":
                    raise
                tenant_guard_held = True
            finally:
                await probe.rollback()
        suspend_task = asyncio.create_task(client.post(
            f"/api/v1/system/tenants/{tenant_id}:suspend",
            headers=auth(admin, "r02-deadlock-suspend"),
        ))
        await asyncio.wait_for(tenant_lock_attempted.wait(), 10)
        assert not suspend_task.done()
    finally:
        release_reset.set()
    responses = await asyncio.wait_for(
        asyncio.gather(reset_task, suspend_task, return_exceptions=True), 10,
    )
    assert all(not isinstance(response, Exception) for response in responses), [
        getattr(getattr(response, "orig", None), "sqlstate", type(response).__name__)
        for response in responses
    ]
    assert tenant_guard_held
    assert [response.status_code for response in responses] == [200, 200]


@pytest.mark.asyncio
async def test_suspend_finishes_before_member_reset_rejects_stale_actor(operations_client, monkeypatch):
    client, runtime = operations_client
    school = await login(client, "pilot.school")
    admin = await login(client, "admin.system")
    tenant_id = UUID(runtime.operations_ids["tenant_id"])
    tenant_locked = asyncio.Event()
    release_suspend = asyncio.Event()
    member_lock_attempted = asyncio.Event()
    original_get_tenant = tenant_service.get_tenant
    original_locked_member = user_service._locked_member
    first_tenant_lock = True

    async def pause_suspension(session, requested_id, *, lock=False):
        nonlocal first_tenant_lock
        tenant = await original_get_tenant(session, requested_id, lock=lock)
        if requested_id == tenant_id and lock and first_tenant_lock:
            first_tenant_lock = False
            tenant_locked.set()
            await asyncio.wait_for(release_suspend.wait(), 10)
        return tenant

    async def observe_member_lock(*args, **kwargs):
        member_lock_attempted.set()
        return await original_locked_member(*args, **kwargs)

    monkeypatch.setattr(tenant_service, "get_tenant", pause_suspension)
    monkeypatch.setattr(user_service, "_locked_member", observe_member_lock)
    suspend_task = asyncio.create_task(client.post(
        f"/api/v1/system/tenants/{tenant_id}:suspend",
        headers=auth(admin, "r02-suspend-first"),
    ))
    reset_task = None
    try:
        await asyncio.wait_for(tenant_locked.wait(), 10)
        reset_task = asyncio.create_task(_reset(
            client, school, runtime.operations_ids["student_member_id"], "r02-reset-after-suspend",
        ))
        await asyncio.wait_for(member_lock_attempted.wait(), 10)
        assert not reset_task.done()
    finally:
        release_suspend.set()
    suspended, reset = await asyncio.wait_for(
        asyncio.gather(suspend_task, reset_task, return_exceptions=True), 10,
    )
    assert all(not isinstance(response, Exception) for response in (suspended, reset)), [
        getattr(getattr(response, "orig", None), "sqlstate", type(response).__name__)
        for response in (suspended, reset)
    ]
    assert suspended.status_code == 200
    assert reset.status_code == 409
    assert reset.json()["code"] == "STATE_TRANSITION_DENIED"


@pytest.mark.asyncio
async def test_suspend_finishes_before_member_creation_rejects_stale_actor(operations_client, monkeypatch):
    client, runtime = operations_client
    school = await login(client, "pilot.school")
    admin = await login(client, "admin.system")
    tenant_id = UUID(runtime.operations_ids["tenant_id"])
    create_reached = asyncio.Event()
    release_create = asyncio.Event()
    original_create = user_service.create_tenant_user

    async def pause_before_create(*args, **kwargs):
        create_reached.set()
        await asyncio.wait_for(release_create.wait(), 10)
        return await original_create(*args, **kwargs)

    monkeypatch.setattr(user_service, "create_tenant_user", pause_before_create)
    create_task = asyncio.create_task(client.post(
        "/api/v1/school-admin/members",
        headers=auth(school, "r02-create-after-suspend"),
        json={
            "username": "pilot.late.student", "display_name": "迟到成员",
            "external_id": "PILOT-LATE", "password": "LateStudent!2026",
            "membership_type": "STUDENT",
        },
    ))
    try:
        await asyncio.wait_for(create_reached.wait(), 10)
        suspended = await asyncio.wait_for(client.post(
            f"/api/v1/system/tenants/{tenant_id}:suspend",
            headers=auth(admin, "r02-suspend-before-create"),
        ), 10)
        assert suspended.status_code == 200
    finally:
        release_create.set()
    created = await asyncio.wait_for(create_task, 10)
    assert created.status_code == 409
    assert created.json()["code"] == "STATE_TRANSITION_DENIED"
    async with runtime.session_factory() as session:
        await bind_candidate_identity(session, verified_access_claims(admin["access_token"]))
        assert (await session.execute(select(User.id).where(
            User.username == "pilot.late.student",
        ))).scalar_one_or_none() is None
