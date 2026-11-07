import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.tenant import service as tenant_service
from app.modules.tenant.models import ReviewBatch
from app.modules.user.models import StudentEligibility, TenantUserMembership, User

from tests.helpers import auth, create_draft, login


@pytest.mark.asyncio
async def test_school_batch_state_machine_and_version(client):
    school = await login(client, "school.wang")
    created = await client.post(
        "/api/v1/school-admin/batches", headers=auth(school, "create-batch"),
        json={"code": "2027-spring", "name": "2027 春季"},
    )
    assert created.status_code == 200, created.text
    batch = created.json()["data"]
    assert batch["status"] == "DRAFT" and batch["version"] == 1
    assert "OPEN" in batch["allowed_actions"]
    batch_id = batch["id"]
    stale = await client.patch(f"/api/v1/school-admin/batches/{batch_id}", headers=auth(school), json={"name": "新名字", "expected_version": 0})
    assert stale.status_code in (409, 422)
    opened = await client.post(f"/api/v1/school-admin/batches/{batch_id}:open", headers=auth(school, "open-batch"), json={"expected_version": 1})
    assert opened.status_code == 200, opened.text
    assert opened.json()["data"]["version"] == 2
    assert opened.json()["data"]["status"] == "OPEN"
    edit = await client.patch(f"/api/v1/school-admin/batches/{batch_id}", headers=auth(school), json={"name": "不能编辑", "expected_version": 2})
    assert edit.status_code == 409
    closed = await client.post(f"/api/v1/school-admin/batches/{batch_id}:close-submissions", headers=auth(school, "close-batch"), json={"expected_version": 2})
    assert closed.status_code == 200 and closed.json()["data"]["status"] == "SUBMISSION_CLOSED"
    reopen = await client.post(f"/api/v1/school-admin/batches/{batch_id}:open", headers=auth(school, "reopen-batch"), json={"expected_version": 3})
    assert reopen.status_code == 409 and reopen.json()["code"] == "STATE_TRANSITION_DENIED"
    archived = await client.post(f"/api/v1/school-admin/batches/{batch_id}:archive", headers=auth(school, "archive-batch"), json={"expected_version": 3})
    assert archived.status_code == 200 and archived.json()["data"]["status"] == "ARCHIVED"


@pytest.mark.asyncio
async def test_batch_archive_waits_for_terminal_theses_and_hides_foreign_batch(client):
    school = await login(client, "school.wang")
    student = await login(client, "student.lin")
    other = await login(client, "other.student")
    foreign_batch_id = (await client.get("/api/v1/me/eligibility", headers=auth(other))).json()["data"]["batch_id"]
    assert (await client.post(
        f"/api/v1/school-admin/batches/{foreign_batch_id}:close-submissions",
        headers=auth(school, "foreign-close"), json={"expected_version": 1},
    )).status_code == 404

    await create_draft(client, student)
    batch = next(row for row in (await client.get(
        "/api/v1/school-admin/batches", headers=auth(school),
    )).json()["data"] if row["code"] == "2026-spring")
    closed = await client.post(
        f"/api/v1/school-admin/batches/{batch['id']}:close-submissions",
        headers=auth(school, "close-pending"), json={"expected_version": batch["version"]},
    )
    assert closed.status_code == 200, closed.text
    assert "ARCHIVE" not in closed.json()["data"]["allowed_actions"]
    archived = await client.post(
        f"/api/v1/school-admin/batches/{batch['id']}:archive",
        headers=auth(school, "archive-pending"), json={"expected_version": closed.json()["data"]["version"]},
    )
    assert archived.status_code == 409
    assert archived.json()["code"] == "STATE_TRANSITION_DENIED"


@pytest.mark.asyncio
async def test_concurrent_open_for_same_student_keeps_only_one_open(test_engine: AsyncEngine):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        school = (await session.execute(select(User).where(User.username == "school.wang"))).scalar_one()
        student = (await session.execute(select(User).where(User.username == "student.lin"))).scalar_one()
        membership = (await session.execute(select(TenantUserMembership).where(TenantUserMembership.user_id == student.id))).scalar_one()
        old = (await session.execute(select(ReviewBatch).where(ReviewBatch.tenant_id == membership.tenant_id, ReviewBatch.status == "OPEN"))).scalar_one()
        old.status = "SUBMISSION_CLOSED"
        first = ReviewBatch(tenant_id=membership.tenant_id, code="race-one", name="一批", status="DRAFT", version=1)
        second = ReviewBatch(tenant_id=membership.tenant_id, code="race-two", name="二批", status="DRAFT", version=1)
        session.add_all([first, second])
        await session.flush()
        for batch in (first, second):
            session.add(StudentEligibility(
                tenant_id=membership.tenant_id, student_membership_id=membership.id,
                review_batch_id=batch.id, status="ELIGIBLE", student_name="林知远",
                student_no="20260042", source_version="test", source_updated_at=datetime.now(timezone.utc),
            ))
        ids = [first.id, second.id]
        actor = CurrentUser(id=school.id, role="school_reviewer", tenant_id=membership.tenant_id, data_scope={})
        await session.commit()

    async def open_one(batch_id):
        async with sessions() as session:
            try:
                await tenant_service.change_batch_status(session, actor, batch_id, "OPEN", 1)
                await session.commit()
                return "OPEN"
            except AppError as exc:
                await session.rollback()
                return exc.code

    results = await asyncio.gather(*(open_one(batch_id) for batch_id in ids))
    assert sorted(results) == ["OPEN", "RESOURCE_CONFLICT"]
    async with sessions() as session:
        rows = (await session.execute(select(ReviewBatch.status).where(ReviewBatch.id.in_(ids)))).scalars().all()
        assert sorted(rows) == ["DRAFT", "OPEN"]
        await session.execute(delete(StudentEligibility).where(StudentEligibility.review_batch_id.in_(ids)))
        await session.execute(delete(ReviewBatch).where(ReviewBatch.id.in_(ids)))
        old = (await session.execute(select(ReviewBatch).where(
            ReviewBatch.tenant_id == actor.tenant_id, ReviewBatch.code == "2026-spring",
        ))).scalar_one()
        old.status = "OPEN"
        await session.commit()
