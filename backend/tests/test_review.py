import pytest
from httpx import AsyncClient

from tests.helpers import accepted_task, auth, login

VALID_DRAFT = {
    "topicValue": 12,
    "literatureTheory": 12,
    "methodology": 16,
    "innovation": 20,
    "writingStandards": 8,
    "resultsWorkload": 12,
    "recommendation": "建议通过",
    "strengths": "结构清楚",
    "issues": "现有实验仍缺少不同样本规模的对照分析，建议补充并说明局限性。",
    "revisionAdvice": "补充对照",
    "overallComment": "本文研究问题明确，采用的方法基本适当，实验结果能够支持主要结论。建议作者进一步补充数据来源说明，并详细讨论研究结论的适用条件。",
}


@pytest.mark.asyncio
async def test_save_and_reload_draft(client: AsyncClient, seed):
    expert, _student, task_id = await accepted_task(client, seed)
    saved = await client.put(f"/api/v1/expert/tasks/{task_id}/draft", headers=auth(expert), json={**VALID_DRAFT, "expected_revision": 0})
    assert saved.status_code == 200, saved.text
    loaded = await client.get(f"/api/v1/expert/tasks/{task_id}/draft", headers=auth(expert))
    assert loaded.json()["data"]["issues"] == VALID_DRAFT["issues"]


@pytest.mark.asyncio
async def test_submit_final_locks_and_moves_to_result_processing(client: AsyncClient, seed):
    expert, student, task_id = await accepted_task(client, seed)
    res = await client.post(
        f"/api/v1/expert/tasks/{task_id}:submit-final",
        headers=auth(expert, idempotency="sf-1"),
        json=VALID_DRAFT,
    )
    assert res.status_code == 200, res.text
    assert res.json()["data"]["status"] == "SUBMITTED"
    again = await client.put(f"/api/v1/expert/tasks/{task_id}/draft", headers=auth(expert), json={**VALID_DRAFT, "expected_revision": 0})
    assert again.status_code == 409
    theses = await client.get("/api/v1/theses", headers=auth(student))
    assert theses.json()["data"][0]["stage"] == "RESULT_PROCESSING"


@pytest.mark.asyncio
async def test_submit_requires_comment(client: AsyncClient, seed):
    expert, _student, task_id = await accepted_task(client, seed)
    body = {**VALID_DRAFT, "overallComment": ""}
    res = await client.post(f"/api/v1/expert/tasks/{task_id}:submit-final", headers=auth(expert), json=body)
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_other_expert_cannot_read_draft(client: AsyncClient, seed):
    expert, _student, task_id = await accepted_task(client, seed)
    qian = await login(client, "expert.qian", seed.password)
    res = await client.get(f"/api/v1/expert/tasks/{task_id}/draft", headers=auth(qian))
    assert res.status_code == 404
