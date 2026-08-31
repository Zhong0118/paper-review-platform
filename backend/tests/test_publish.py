import json

import pytest
from httpx import AsyncClient

from tests.helpers import accepted_task, auth, login
from tests.test_review import VALID_DRAFT


@pytest.mark.asyncio
async def test_submit_moves_to_result_processing_and_publish(client: AsyncClient, seed):
    expert, student, task_id = await accepted_task(client, seed)
    school = await login(client, "school.wang", seed.password)
    submitted = await client.post(
        f"/api/v1/expert/tasks/{task_id}:submit-final",
        headers=auth(expert, idempotency="pub-sf"),
        json=VALID_DRAFT,
    )
    assert submitted.status_code == 200
    theses = await client.get("/api/v1/theses", headers=auth(student))
    thesis_id = theses.json()["data"][0]["id"]
    assert theses.json()["data"][0]["stage"] == "RESULT_PROCESSING"
    results = await client.get(f"/api/v1/school-review/theses/{thesis_id}/results", headers=auth(school))
    assert results.status_code == 200, results.text
    blob = json.dumps(results.json())
    assert "周明远" not in blob
    assert "expert.zhou" not in blob
    assert results.json()["data"]["items"][0]["alias"] == "E-001"
    before = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(student))
    assert before.status_code == 404
    published = await client.post(
        f"/api/v1/school-review/theses/{thesis_id}:publish",
        headers=auth(school, idempotency="pub-1"),
        json={"version": theses.json()["data"][0]["version"]},
    )
    assert published.status_code == 200, published.text
    assert published.json()["data"]["stage"] == "COMPLETED"
    mine = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(student))
    assert mine.status_code == 200
    assert "周明远" not in mine.text
    assert mine.json()["data"]["total"] == 80
    supervisor = await login(client, "supervisor.zhao", seed.password)
    sup = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(supervisor))
    assert sup.status_code == 200
    other = await login(client, "other.student", seed.password)
    hidden = await client.get(f"/api/v1/my/theses/{thesis_id}/published-result", headers=auth(other))
    assert hidden.status_code == 404
