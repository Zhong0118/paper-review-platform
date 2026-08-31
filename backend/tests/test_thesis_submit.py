import pytest
from httpx import AsyncClient

from tests.helpers import attach_files, auth, create_draft, login


@pytest.mark.asyncio
async def test_student_submit_pass_then_school_confirms(client: AsyncClient, seed, tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    student = await login(client, "student.lin", seed.password)
    school = await login(client, "school.wang", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="sub-1"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200, submitted.text
    body = submitted.json()["data"]
    assert body["stage"] == "PREPARING"
    assert "SUBMITTED" in {e["to_stage"] for e in body["recent_events"]}

    confirmed = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",
        headers=auth(school, idempotency="cfm-1"),
        json={"decision": "PASS", "version": body["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["data"]["stage"] == "READY_FOR_DISPATCH"


@pytest.mark.asyncio
async def test_idempotent_submit(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    first = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="same-key"),
        json={"version": thesis["version"]},
    )
    second = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="same-key"),
        json={"version": thesis["version"]},
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["current_version"]["id"] == second.json()["data"]["current_version"]["id"]


@pytest.mark.asyncio
async def test_cannot_delete_after_submit(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="del-1"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200
    deleted = await client.delete(f"/api/v1/theses/{thesis['id']}", headers=auth(student))
    assert deleted.status_code in (409, 422)
    assert deleted.json()["code"] in {"STATE_TRANSITION_DENIED", "VALIDATION_FAILED"}


@pytest.mark.asyncio
async def test_withdraw_before_dispatch_returns_draft(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="wd-1"),
        json={"version": thesis["version"]},
    )
    withdrawn = await client.post(
        f"/api/v1/theses/{thesis['id']}:withdraw",
        headers=auth(student, idempotency="wd-2"),
        json={"version": submitted.json()["data"]["version"], "reason": "修改匿名版"},
    )
    assert withdrawn.status_code == 200
    assert withdrawn.json()["data"]["stage"] == "DRAFT"
    assert withdrawn.json()["data"]["current_version"]["is_editable"] is True
