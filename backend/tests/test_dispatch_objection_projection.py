from uuid import UUID
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.modules.dispatch.models import ExpertTask
from app.modules.expert.models import Expert
from app.modules.result.objection_models import Objection
from app.modules.user.models import User
from tests.helpers import auth, login, ready_thesis, published_thesis
from tests.test_dispatch import expert_id


@pytest.mark.asyncio
async def test_rejected_task_reopens_dispatch_without_reopening_occupied_seat(client, seed, db_session):
    _, school, thesis = await ready_thesis(client, seed)
    platform = await login(client, "platform.chen")
    expert = await login(client, "expert.zhou")
    async def actions():
        rows = (await client.get("/api/v1/platform-review/dispatch-queue", headers=auth(platform))).json()["data"]
        return next(row for row in rows if row["thesis_id"] == thesis["id"])["allowed_actions"]
    assert await actions() == []
    await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch", headers=auth(school), json={"version": thesis["version"]})
    assert await actions() == ["ASSIGN_EXPERT"]
    zhou = await expert_id(client, platform, thesis["id"], "zhou")
    first = await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign", headers=auth(platform), json={"expert_id": zhou})
    assert first.status_code == 200
    task_id = first.json()["data"]["task"]["id"]
    assert await actions() == ["REASSIGN_EXPERT"]
    await client.post(f"/api/v1/expert/tasks/{task_id}:reject", headers=auth(expert), json={"reason": "时间不足"})
    assert await actions() == ["ASSIGN_EXPERT"]
    qian = (await db_session.execute(select(Expert).join(User, User.id == Expert.user_id).where(User.username == "expert.qian"))).scalar_one()
    qian.discipline_codes = ["0812"]
    await db_session.flush()
    second = await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign", headers=auth(platform), json={"expert_id": str(qian.id)})
    assert second.status_code == 200, second.text
    assert second.json()["data"]["task"]["id"] != task_id
    assert (await db_session.get(ExpertTask, UUID(task_id))).status == "REJECTED"
    assert await actions() == ["REASSIGN_EXPERT"]
    assert (await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign", headers=auth(platform), json={"expert_id": zhou})).status_code == 409


@pytest.mark.asyncio
async def test_current_objection_precedes_closed_history_with_stable_timestamp_order(client, seed, db_session):
    student, school, thesis_id = await published_thesis(client, seed)
    path = f"/api/v1/my/theses/{thesis_id}/objections"
    async def create(reason):
        response = await client.post(path, headers=auth(student), json={"reason": reason})
        assert response.status_code == 200
        return response.json()["data"]
    async def close(row):
        return await client.post(f"/api/v1/school-review/objections/{row['id']}:record-resolution",
                                 headers=auth(school), json={"channel": "ONLINE", "conclusion": "已说明"})
    first = await create("旧异议")
    assert (await close(first)).status_code == 200
    second = await create("新异议")
    # An open objection takes priority even over a newer closed history row.
    old = await db_session.get(Objection, UUID(first["id"]))
    old.created_at = datetime.now(timezone.utc) + timedelta(days=1)
    await db_session.flush()
    rows = (await client.get(path, headers=auth(student))).json()["data"]
    assert [row["id"] for row in rows] == [second["id"], first["id"]]
    assert rows[0]["status"] == "SUBMITTED" and rows[0]["created_at"]
    # Closed histories use creation time rather than update time.
    old = await db_session.get(Objection, UUID(first["id"]))
    new = await db_session.get(Objection, UUID(second["id"]))
    old.created_at = datetime.now(timezone.utc) - timedelta(days=1)
    new.created_at = datetime.now(timezone.utc)
    await db_session.flush()
    assert (await close(second)).status_code == 200
    rows = (await client.get(path, headers=auth(student))).json()["data"]
    assert [row["id"] for row in rows] == [second["id"], first["id"]]
    old.created_at = new.created_at
    await db_session.flush()
    rows = (await client.get(path, headers=auth(student))).json()["data"]
    assert [row["id"] for row in rows] == sorted([first["id"], second["id"]], reverse=True)
