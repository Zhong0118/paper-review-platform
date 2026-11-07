import pytest
from httpx import AsyncClient

from tests.helpers import auth, login, ready_thesis


@pytest.mark.asyncio
async def test_me_eligibility_has_student_identity(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    res = await client.get("/api/v1/me/eligibility", headers=auth(student))
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["eligible"] is True
    assert data["student_no"] == "20260042"
    assert data["student_name"] == "林知远"
    assert data["tenant_name"]
    assert data["batch_name"]


@pytest.mark.asyncio
async def test_school_thesis_projection_includes_student_identity(client: AsyncClient, seed):
    _student, school, thesis = await ready_thesis(client, seed)
    res = await client.get(f"/api/v1/school-review/theses/{thesis['id']}", headers=auth(school))
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["student"]["name"] == "林知远"
    assert data["student"]["student_no"] == "20260042"
    assert "CONFIRM_ANONYMIZATION" not in data["allowed_actions"]
    assert "CONFIRM_DISPATCH" in data["allowed_actions"]


@pytest.mark.asyncio
async def test_expert_task_list_has_anonymous_title_not_author(client: AsyncClient, seed):
    from tests.test_dispatch import expert_id

    _student, school, thesis = await ready_thesis(client, seed)
    platform = await login(client, "platform.chen", seed.password)
    expert_user = await login(client, "expert.zhou", seed.password)
    await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",
        headers=auth(school, idempotency="cd-ui-1"),
        json={"version": thesis["version"]},
    )
    zhou = await expert_id(client, platform, thesis["id"], "zhou")
    assigned = await client.post(
        f"/api/v1/platform-review/theses/{thesis['id']}:assign",
        headers=auth(platform, idempotency="as-ui-1"),
        json={"expert_id": zhou},
    )
    assert assigned.status_code == 200
    tasks = await client.get("/api/v1/expert/tasks", headers=auth(expert_user))
    blob = tasks.text
    assert "林知远" not in blob
    assert "20260042" not in blob
    row = tasks.json()["data"][0]
    assert row["anonymous_title"]
    assert row["discipline_name"]
    assert "ACCEPT_TASK" in row["allowed_actions"]
