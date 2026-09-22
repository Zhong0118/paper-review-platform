from uuid import UUID

import pytest

from app.modules.dispatch.models import ExpertTask, ReviewRound
from app.shared.enums import RoundStatus
from tests.helpers import accepted_task, auth, login
from tests.test_review import VALID_DRAFT


@pytest.mark.asyncio
async def test_workspace_actions_and_formal_result(client, seed):
    expert, _, task_id = await accepted_task(client, seed)
    listed = (await client.get("/api/v1/expert/tasks", headers=auth(expert))).json()["data"]
    assert next(t for t in listed if t["id"] == task_id)["allowed_actions"] == ["CONTINUE_REVIEW"]
    assert (await client.get(f"/api/v1/expert/tasks/{task_id}/result", headers=auth(expert))).status_code == 404
    await client.put(f"/api/v1/expert/tasks/{task_id}/draft", headers=auth(expert), json=VALID_DRAFT)
    final = {**VALID_DRAFT, "overallComment": "正式意见不同于草稿", "topicValue": 10}
    assert (await client.post(f"/api/v1/expert/tasks/{task_id}:submit-final", headers=auth(expert), json=final)).status_code == 200
    result = await client.get(f"/api/v1/expert/tasks/{task_id}/result", headers=auth(expert))
    assert result.status_code == 200
    assert result.json()["data"]["overallComment"] == final["overallComment"]
    assert result.json()["data"]["topicValue"] == 10
    listed = (await client.get("/api/v1/expert/tasks", headers=auth(expert))).json()["data"]
    assert next(t for t in listed if t["id"] == task_id)["allowed_actions"] == ["VIEW_SUBMITTED"]
    other = await login(client, "expert.qian", seed.password)
    assert (await client.get(f"/api/v1/expert/tasks/{task_id}/result", headers=auth(other))).status_code == 404
    assert (await client.get(f"/api/v1/expert/tasks/{task_id}/materials", headers=auth(expert))).status_code == 404


@pytest.mark.asyncio
async def test_materials_hide_upload_filename_and_reject_inactive_round(client, seed, db_session):
    expert, _, task_id = await accepted_task(client, seed)
    response = await client.get(f"/api/v1/expert/tasks/{task_id}/materials", headers=auth(expert))
    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["files"]) == 1
    assert data["files"][0]["filename"] == "匿名论文.pdf"
    file_id = data["files"][0]["file_id"]
    content = await client.get(f"/api/v1/files/{file_id}/content", headers=auth(expert))
    assert content.status_code == 200 and content.content.startswith(b"%PDF")
    task = await db_session.get(ExpertTask, UUID(task_id))
    round_ = await db_session.get(ReviewRound, task.round_id)
    round_.status = RoundStatus.CANCELLED
    await db_session.flush()
    assert (await client.get(f"/api/v1/expert/tasks/{task_id}/materials", headers=auth(expert))).status_code == 404
