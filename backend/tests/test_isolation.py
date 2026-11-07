import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.user.models import StudentEligibility
from tests.helpers import attach_files, auth, create_draft, login


@pytest.mark.asyncio
async def test_other_tenant_cannot_read(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    other = await login(client, "other.student", seed.password)
    thesis = await create_draft(client, student)
    res = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(other))
    assert res.status_code == 404
    assert res.json()["code"] == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_expert_cannot_download_original(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    expert = await login(client, "expert.zhou", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    detail = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(student))
    original_id = next(
        f["file_id"] for f in detail.json()["data"]["current_version"]["files"] if f["purpose"] == "original"
    )
    res = await client.post(f"/api/v1/files/{original_id}:authorize-download", headers=auth(expert))
    assert res.status_code in (403, 404)
    assert res.json()["code"] in {"ACCESS_DENIED", "RESOURCE_NOT_FOUND"}


@pytest.mark.asyncio
async def test_platform_reviewer_cannot_use_school_review(client: AsyncClient, seed):
    platform = await login(client, "platform.chen", seed.password)
    res = await client.get("/api/v1/school-review/theses", headers=auth(platform))
    assert res.status_code == 403
    assert res.json()["code"] == "ACCESS_DENIED"


@pytest.mark.asyncio
async def test_admin_cannot_read_thesis_content(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    admin = await login(client, "admin.system", seed.password)
    thesis = await create_draft(client, student)
    res = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(admin))
    assert res.status_code in (403, 404)


@pytest.mark.asyncio
async def test_ineligible_cannot_create(client: AsyncClient, seed, db_session: AsyncSession):
    await db_session.execute(update(StudentEligibility).values(status="REVOKED"))
    await db_session.flush()
    student = await login(client, "student.lin", seed.password)
    res = await client.post(
        "/api/v1/theses",
        headers=auth(student),
        json={
            "title": "无资格",
            "abstract": "x",
            "discipline_code": "0812",
            "discipline_name": "计算机科学与技术",
            "keywords": ["a"],
        },
    )
    assert res.status_code in (403, 409, 422)
