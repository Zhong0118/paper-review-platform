import pytest
from httpx import AsyncClient

from tests.helpers import attach_files, auth, create_draft, login


@pytest.mark.asyncio
async def test_failing_detection_returns_to_draft(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(
        client,
        student,
        thesis["id"],
        anonymous_name="20260042.txt",
        anonymous_bytes="作者 林知远 学号 20260042 导师 赵文博".encode("utf-8"),
        anonymous_type="text/plain",
    )
    res = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="sub-fail"),
        json={"version": thesis["version"]},
    )
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["stage"] == "DRAFT"
    assert data["anonymization"]["auto_conclusion"] == "FAIL"
    assert data["anonymization"]["findings"]
    locations = {item["location"] for item in data["anonymization"]["findings"]}
    assert "filename" in locations or "body" in locations


@pytest.mark.asyncio
async def test_school_cannot_pass_failed_check(client: AsyncClient, seed):
    student = await login(client, "student.lin", seed.password)
    school = await login(client, "school.wang", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(
        client,
        student,
        thesis["id"],
        anonymous_name="lin.txt",
        anonymous_bytes="林知远 20260042".encode("utf-8"),
        anonymous_type="text/plain",
    )
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="fail-pass"),
        json={"version": thesis["version"]},
    )
    assert submitted.json()["data"]["stage"] == "DRAFT"
    confirmed = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",
        headers=auth(school, idempotency="bad-pass"),
        json={"decision": "PASS", "version": submitted.json()["data"]["version"]},
    )
    assert confirmed.status_code in (409, 422)
    assert confirmed.json()["code"] in {"STATE_TRANSITION_DENIED", "ANONYMIZATION_FAILED"}
