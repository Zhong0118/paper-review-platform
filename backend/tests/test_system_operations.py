import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.tenant import service as tenant_service
from app.modules.tenant.models import Organization, Tenant
from app.modules.tenant.schema import CreateTenantInput
from app.modules.user.models import TenantUserMembership, User
from app.modules.user.schema import CreateTenantUserInput

from tests.helpers import auth, login


TENANT = {
    "code": "pilot-univ",
    "name": "试点大学",
    "organization": {"external_id": "root", "name": "试点大学"},
    "reviewer": {
        "username": "school.operator",
        "display_name": "学校管理员",
        "external_id": "staff-001",
        "password": "operator-secret-1",
    },
}


@pytest.mark.asyncio
@pytest.mark.parametrize("code", [123, None, [], {}])
async def test_system_tenant_invalid_code_is_422_without_writes(client, db_session, code):
    admin = await login(client, "admin.system")
    before = [await db_session.scalar(select(func.count()).select_from(model))
              for model in (Tenant, Organization, User, TenantUserMembership)]
    response = await client.post(
        "/api/v1/system/tenants", headers=auth(admin, "invalid-tenant-code"),
        json={**TENANT, "code": code},
    )
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_FAILED"
    after = [await db_session.scalar(select(func.count()).select_from(model))
             for model in (Tenant, Organization, User, TenantUserMembership)]
    assert after == before


@pytest.mark.asyncio
async def test_valid_tenant_code_and_reviewer_username_are_normalized(client):
    admin = await login(client, "admin.system")
    response = await client.post(
        "/api/v1/system/tenants", headers=auth(admin, "normalized-tenant-code"),
        json={**TENANT, "code": " MIXED-CODE ",
              "reviewer": {**TENANT["reviewer"], "username": " School.Mixed ", "external_id": "staff-mixed"}},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["code"] == "mixed-code"
    reviewer = await login(client, "school.mixed", "operator-secret-1")
    assert reviewer["user"]["tenant_id"] == response.json()["data"]["id"]


@pytest.mark.asyncio
async def test_system_admin_creates_tenant_and_first_reviewer(client):
    admin = await login(client, "admin.system")

    response = await client.post(
        "/api/v1/system/tenants",
        headers=auth(admin, "create-pilot-univ"),
        json=TENANT,
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["code"] == "pilot-univ"
    assert data["reviewer_count"] == 1
    reviewer = await login(client, "school.operator", "operator-secret-1")
    assert reviewer["user"]["role"] == "school_reviewer"
    assert reviewer["user"]["tenant_id"] == data["id"]
    listed = await client.get("/api/v1/system/tenants", headers=auth(admin))
    assert any(item["id"] == data["id"] for item in listed.json()["data"])
    assert "password" not in listed.text and "password_hash" not in listed.text


@pytest.mark.asyncio
async def test_non_system_user_cannot_create_tenant(client):
    school = await login(client, "school.wang")
    response = await client.post(
        "/api/v1/system/tenants",
        headers=auth(school, "forbidden-create"),
        json=TENANT,
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_suspend_tenant_invalidates_reviewer_and_resume_restores_login(client):
    admin = await login(client, "admin.system")
    created = await client.post(
        "/api/v1/system/tenants",
        headers=auth(admin, "create-suspend-test"),
        json={**TENANT, "code": "suspend-univ", "reviewer": {**TENANT["reviewer"], "username": "school.suspend", "external_id": "staff-s"}},
    )
    tenant_id = created.json()["data"]["id"]
    reviewer = await login(client, "school.suspend", "operator-secret-1")

    suspended = await client.post(
        f"/api/v1/system/tenants/{tenant_id}:suspend",
        headers=auth(admin, "suspend-tenant"),
    )
    assert suspended.status_code == 200
    assert (await client.get("/api/v1/me", headers=auth(reviewer))).status_code == 401
    resumed = await client.post(
        f"/api/v1/system/tenants/{tenant_id}:resume",
        headers=auth(admin, "resume-tenant"),
    )
    assert resumed.status_code == 200
    assert (await login(client, "school.suspend", "operator-secret-1"))["user"]["tenant_id"] == tenant_id


@pytest.mark.asyncio
async def test_system_admin_manages_reviewers_and_protects_last_active_one(client):
    admin = await login(client, "admin.system")
    created = await client.post(
        "/api/v1/system/tenants",
        headers=auth(admin, "create-reviewer-test"),
        json={**TENANT, "code": "reviewer-univ", "reviewer": {**TENANT["reviewer"], "username": "school.first", "external_id": "staff-first"}},
    )
    tenant_id = created.json()["data"]["id"]
    reviewers = (await client.get(f"/api/v1/system/tenants/{tenant_id}/reviewers", headers=auth(admin))).json()["data"]
    first_id = reviewers[0]["user_id"]
    last = await client.post(
        f"/api/v1/system/tenants/{tenant_id}/reviewers/{first_id}:disable",
        headers=auth(admin, "disable-last"),
    )
    assert last.status_code == 409

    added = await client.post(
        f"/api/v1/system/tenants/{tenant_id}/reviewers",
        headers=auth(admin, "add-second"),
        json={"username": "school.second", "display_name": "第二管理员", "external_id": "staff-second", "password": "second-secret-1"},
    )
    assert added.status_code == 200
    disabled = await client.post(
        f"/api/v1/system/tenants/{tenant_id}/reviewers/{first_id}:disable",
        headers=auth(admin, "disable-first"),
    )
    assert disabled.status_code == 200
    assert (await client.post("/api/v1/auth/login", json={"username": "school.first", "password": "operator-secret-1"})).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", ["tenant_code", "username", "external_id"])
async def test_create_tenant_conflict_is_409_and_atomic(client, db_session: AsyncSession, conflict: str):
    admin = await login(client, "admin.system")
    first = await client.post("/api/v1/system/tenants", headers=auth(admin, "base-" + conflict), json=TENANT)
    assert first.status_code == 200
    alternate = {
        **TENANT,
        "code": "other-pilot",
        "reviewer": {**TENANT["reviewer"], "username": "school.other", "external_id": "staff-other"},
    }
    if conflict == "tenant_code":
        alternate["code"] = TENANT["code"]
    elif conflict == "username":
        alternate["reviewer"]["username"] = TENANT["reviewer"]["username"]
    else:
        alternate["reviewer"]["external_id"] = TENANT["reviewer"]["external_id"]
        # external_id is scoped to a tenant, so collide in the existing tenant reviewer endpoint.
        response = await client.post(
            f"/api/v1/system/tenants/{first.json()['data']['id']}/reviewers",
            headers=auth(admin, "conflicting-external"), json=alternate["reviewer"],
        )
        assert response.status_code == 409 and response.json()["code"] == "RESOURCE_CONFLICT"
        return
    response = await client.post("/api/v1/system/tenants", headers=auth(admin, "conflict-" + conflict), json=alternate)
    assert response.status_code == 409 and response.json()["code"] == "RESOURCE_CONFLICT"
    assert await db_session.scalar(select(func.count()).select_from(Tenant).where(Tenant.code == "other-pilot")) == 0
    assert await db_session.scalar(select(func.count()).select_from(Organization).where(Organization.name == "试点大学")) == 1
    assert await db_session.scalar(select(func.count()).select_from(User).where(User.username == "school.other")) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("conflict", ["tenant_code", "username"])
async def test_concurrent_tenant_conflict_commits_only_one(test_engine: AsyncEngine, conflict: str):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        admin_id = (await session.execute(select(User.id).where(User.username == "admin.system"))).scalar_one()
    actor = CurrentUser(id=admin_id, role="system_admin", tenant_id=None, data_scope={})

    async def create(index: int):
        code = "race-univ" if conflict == "tenant_code" else f"race-univ-{index}"
        username = f"school.race.{index}" if conflict == "tenant_code" else "school.race.shared"
        payload = {**TENANT, "code": code, "reviewer": {**TENANT["reviewer"], "username": username}}
        async with sessions() as session:
            try:
                await tenant_service.create_tenant(session, actor, CreateTenantInput.model_validate(payload), "race")
                await session.commit()
                return "created"
            except AppError as exc:
                await session.rollback()
                return exc.code

    results = await asyncio.gather(create(1), create(2))
    assert sorted(results) == ["RESOURCE_CONFLICT", "created"]
    async with sessions() as session:
        codes = ["race-univ"] if conflict == "tenant_code" else ["race-univ-1", "race-univ-2"]
        assert await session.scalar(select(func.count()).select_from(Tenant).where(Tenant.code.in_(codes))) == 1
        assert await session.scalar(select(func.count()).select_from(Organization).join(Tenant).where(Tenant.code.in_(codes))) == 1


@pytest.mark.asyncio
async def test_concurrent_reviewer_external_id_conflict_commits_only_one(test_engine: AsyncEngine):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        admin_id = (await session.execute(select(User.id).where(User.username == "admin.system"))).scalar_one()
        tenant_id = (await session.execute(select(Tenant.id).where(Tenant.code == "demo-univ"))).scalar_one()
    actor = CurrentUser(id=admin_id, role="system_admin", tenant_id=None, data_scope={})

    async def create(index: int):
        data = CreateTenantUserInput(
            username=f"school.external.race.{index}", display_name="并发管理员",
            external_id="staff-external-race", password="external-race-pass-1",
        )
        async with sessions() as session:
            try:
                await tenant_service.create_school_reviewer(session, actor, tenant_id, data, "race")
                await session.commit()
                return "created"
            except AppError as exc:
                await session.rollback()
                return exc.code

    results = await asyncio.gather(create(1), create(2))
    assert sorted(results) == ["RESOURCE_CONFLICT", "created"]
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(TenantUserMembership).where(
            TenantUserMembership.tenant_id == tenant_id,
            TenantUserMembership.external_id == "staff-external-race",
        )) == 1
