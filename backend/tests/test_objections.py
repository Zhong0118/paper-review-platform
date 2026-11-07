import pytest
from httpx import AsyncClient

from tests.helpers import auth, login, published_thesis


@pytest.mark.asyncio
async def test_student_files_objection_after_publish(client: AsyncClient, seed):
    student, school, thesis_id = await published_thesis(client, seed)
    ready = await client.get("/api/v1/theses", headers=auth(student))
    assert "SUBMIT_OBJECTION" in ready.json()["data"][0]["allowed_actions"]
    created = await client.post(
        f"/api/v1/my/theses/{thesis_id}/objections",
        headers=auth(student, idempotency="obj-1"),
        json={"reason": "对实验数据判断有疑问", "request": "请学校复核评语依据"},
    )
    assert created.status_code == 200, created.text
    theses = await client.get("/api/v1/theses", headers=auth(student))
    assert theses.json()["data"][0]["stage"] == "COMPLETED"
    assert "SUBMIT_OBJECTION" not in theses.json()["data"][0]["allowed_actions"]
    dup = await client.post(
        f"/api/v1/my/theses/{thesis_id}/objections",
        headers=auth(student, idempotency="obj-2"),
        json={"reason": "再提一条"},
    )
    assert dup.status_code == 409
    listed = await client.get("/api/v1/school-review/objections", headers=auth(school))
    assert listed.status_code == 200
    batch = (await client.get(f"/api/v1/school-review/theses/{thesis_id}",headers=auth(school))).json()["data"]["review_batch"]["id"]
    closeout_url = f"/api/v1/school-admin/batches/{batch}/closeout"
    work = (await client.get(closeout_url,headers=auth(school))).json()["data"]
    assert [item["id"] for item in work["objections"]] == [listed.json()["data"][0]["id"]]
    obj_id = listed.json()["data"][0]["id"]
    assert listed.json()["data"][0]["student_name"] == "林知远"
    await client.post(f"/api/v1/school-review/objections/{obj_id}:start", headers=auth(school, idempotency="st-1"))
    resolved = await client.post(
        f"/api/v1/school-review/objections/{obj_id}:record-resolution",
        headers=auth(school, idempotency="rs-1"),
        json={"channel": "OFFLINE", "conclusion": "维持原结果，已线下说明"},
    )
    assert resolved.json()["data"]["status"] == "RESOLVED"
    assert not (await client.get(closeout_url,headers=auth(school))).json()["data"]["objections"]
    mine = await client.get(f"/api/v1/my/theses/{thesis_id}/objections", headers=auth(student))
    assert mine.json()["data"][0]["conclusion"] == "维持原结果，已线下说明"
    assert "周明远" not in mine.text
    other = await login(client, "other.student", seed.password)
    hidden = await client.get(f"/api/v1/my/theses/{thesis_id}/objections", headers=auth(other))
    assert hidden.status_code == 404


@pytest.mark.asyncio
async def test_open_objection_unique_per_thesis(client: AsyncClient, db_session, seed):
    from uuid import UUID

    from sqlalchemy.exc import IntegrityError

    from app.modules.result.objection_models import Objection
    from app.modules.thesis.models import Thesis

    student, _school, thesis_id = await published_thesis(client, seed)
    del student
    thesis = await db_session.get(Thesis, UUID(thesis_id))
    assert thesis is not None
    db_session.add(
        Objection(
            tenant_id=thesis.tenant_id,
            thesis_id=thesis.id,
            student_membership_id=thesis.student_membership_id,
            reason="第一条未办结",
            status="SUBMITTED",
        )
    )
    await db_session.flush()
    db_session.add(
        Objection(
            tenant_id=thesis.tenant_id,
            thesis_id=thesis.id,
            student_membership_id=thesis.student_membership_id,
            reason="第二条并发",
            status="PROCESSING",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
