import asyncio

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.tenant import service as tenant_service
from app.modules.tenant.models import ReviewBatch
from app.modules.tenant.schema import CreateEligibilityInput
from app.modules.thesis.models import Thesis
from app.modules.user.models import StudentEligibility, TenantUserMembership, User
from app.modules.workflow.models import WorkflowEvent
from app.seed import seed_database

from tests.helpers import attach_files, auth, create_draft, login, submit_current_draft


@pytest.mark.asyncio
async def test_multiple_batches_choose_open_then_recent_closed_eligibility(client):
    school = await login(client, "school.wang")
    student = await login(client, "student.lin")
    members = (await client.get("/api/v1/school-admin/members?membership_type=STUDENT", headers=auth(school))).json()["data"]
    student_id = next(row["membership_id"] for row in members if row["username"] == "student.lin")
    created = await client.post("/api/v1/school-admin/batches", headers=auth(school, "elig-batch"), json={"code": "future-elig", "name": "新批次"})
    assert created.status_code == 200
    batch_id = created.json()["data"]["id"]
    added = await client.post(f"/api/v1/school-admin/batches/{batch_id}/eligibilities", headers=auth(school, "elig-add"), json={"student_membership_id": student_id, "degree_type": "工学硕士"})
    assert added.status_code == 200, added.text
    current = await client.get("/api/v1/me/eligibility", headers=auth(student))
    assert current.status_code == 200
    assert current.json()["data"]["batch_name"] == "2026 年春季硕士论文盲审"
    old_batch = next(row for row in (await client.get("/api/v1/school-admin/batches", headers=auth(school))).json()["data"] if row["code"] == "2026-spring")
    closed = await client.post(f"/api/v1/school-admin/batches/{old_batch['id']}:close-submissions", headers=auth(school, "close-old"), json={"expected_version": old_batch["version"]})
    assert closed.status_code == 200
    current = await client.get("/api/v1/me/eligibility", headers=auth(student))
    assert current.status_code == 200
    assert current.json()["data"]["batch_id"] == batch_id
    assert current.json()["data"]["eligible"] is False


@pytest.mark.asyncio
async def test_historical_thesis_detail_keeps_its_own_batch_and_eligibility(client):
    school = await login(client, "school.wang")
    student = await login(client, "student.lin")
    thesis = await create_draft(client, student)
    old_student = thesis["student"]
    old_batch = next(row for row in (await client.get(
        "/api/v1/school-admin/batches", headers=auth(school),
    )).json()["data"] if row["code"] == "2026-spring")

    closed = await client.post(
        f"/api/v1/school-admin/batches/{old_batch['id']}:close-submissions",
        headers=auth(school, "history-close-old"),
        json={"expected_version": old_batch["version"]},
    )
    assert closed.status_code == 200, closed.text
    supervisor = await client.post(
        "/api/v1/school-admin/members", headers=auth(school, "history-supervisor"),
        json={"membership_type": "SUPERVISOR", "username": "supervisor.new",
              "display_name": "新导师", "external_id": "T-new", "password": "test-password-123"},
    )
    assert supervisor.status_code == 200, supervisor.text
    created = await client.post(
        "/api/v1/school-admin/batches", headers=auth(school, "history-new-batch"),
        json={"code": "history-new", "name": "新批次", "end_at": "2027-05-20T10:00:00Z"},
    )
    assert created.status_code == 200, created.text
    new_batch = created.json()["data"]
    student_id = old_student["student_no"]
    members = (await client.get(
        "/api/v1/school-admin/members?membership_type=STUDENT", headers=auth(school),
    )).json()["data"]
    student_membership = next(row["membership_id"] for row in members if row["external_id"] == student_id)
    added = await client.post(
        f"/api/v1/school-admin/batches/{new_batch['id']}/eligibilities",
        headers=auth(school, "history-new-eligibility"),
        json={"student_membership_id": student_membership,
              "supervisor_membership_id": supervisor.json()["data"]["membership_id"],
              "degree_type": "理学博士"},
    )
    assert added.status_code == 200, added.text
    opened = await client.post(
        f"/api/v1/school-admin/batches/{new_batch['id']}:open",
        headers=auth(school, "history-open-new"),
        json={"expected_version": new_batch["version"]},
    )
    assert opened.status_code == 200, opened.text
    current = (await client.get("/api/v1/me/eligibility", headers=auth(student))).json()["data"]
    assert current["batch_id"] == new_batch["id"]
    assert current["supervisor_name"] == "新导师"

    for actor in (student, school):
        response = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(actor))
        assert response.status_code == 200, response.text
        detail = response.json()["data"]
        assert detail["student"]["student_no"] == old_student["student_no"]
        assert detail["student"]["supervisor_name"] == old_student["supervisor_name"]
        assert detail["student"]["degree_type"] == "工学硕士"
        assert detail["batch_name"] == old_batch["name"]
        assert detail["review_batch"] == {
            "id": old_batch["id"], "name": old_batch["name"], "end_at": old_batch["end_at"],
        }
    for username in ("admin.system", "expert.zhou"):
        actor = await login(client, username)
        response = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(actor))
        assert response.status_code == 404
        assert response.json()["code"] == "RESOURCE_NOT_FOUND"


@pytest.mark.asyncio
async def test_seed_can_run_again_after_student_gains_historical_eligibility(client, db_session):
    school = await login(client, "school.wang")
    student = (await db_session.execute(select(User).where(User.username == "student.lin"))).scalar_one()
    member = (await db_session.execute(select(TenantUserMembership).where(
        TenantUserMembership.user_id == student.id,
    ))).scalar_one()
    created = await client.post(
        "/api/v1/school-admin/batches", headers=auth(school, "seed-history-batch"),
        json={"code": "seed-history", "name": "历史批次"},
    )
    batch_id = created.json()["data"]["id"]
    added = await client.post(
        f"/api/v1/school-admin/batches/{batch_id}/eligibilities",
        headers=auth(school, "seed-history-eligibility"),
        json={"student_membership_id": str(member.id)},
    )
    assert added.status_code == 200
    await seed_database(db_session)
    await db_session.flush()
    count = await db_session.scalar(select(func.count()).select_from(StudentEligibility).where(
        StudentEligibility.student_membership_id == member.id,
    ))
    assert count == 2


@pytest.mark.asyncio
async def test_eligibility_rejects_client_snapshot_and_foreign_membership(client):
    school = await login(client, "school.wang")
    batch = next(row for row in (await client.get("/api/v1/school-admin/batches", headers=auth(school))).json()["data"] if row["code"] == "2026-spring")
    other = await login(client, "other.student")
    other_member = other["user"]["id"]
    invalid = await client.post(f"/api/v1/school-admin/batches/{batch['id']}/eligibilities", headers=auth(school, "bad-snapshot"), json={"student_membership_id": other_member, "student_name": "伪造"})
    assert invalid.status_code == 422
    foreign = await client.post(f"/api/v1/school-admin/batches/{batch['id']}/eligibilities", headers=auth(school, "foreign-member"), json={"student_membership_id": other_member})
    assert foreign.status_code == 404


@pytest.mark.asyncio
async def test_closed_batch_blocks_new_draft_but_existing_draft_can_be_edited(client):
    school = await login(client, "school.wang")
    student = await login(client, "student.lin")
    thesis = await create_draft(client, student)
    batch = next(row for row in (await client.get("/api/v1/school-admin/batches", headers=auth(school))).json()["data"] if row["code"] == "2026-spring")
    closed = await client.post(f"/api/v1/school-admin/batches/{batch['id']}:close-submissions", headers=auth(school, "close-draft-batch"), json={"expected_version": batch["version"]})
    assert closed.status_code == 200
    edited = await client.patch(f"/api/v1/theses/{thesis['id']}", headers=auth(student), json={"expected_content_revision":thesis["current_version"]["content_revision"],"title": "关闭后仍可编辑", "abstract": "", "discipline_code": "0812", "discipline_name": "计算机科学与技术", "keywords": ["盲审"]})
    assert edited.status_code == 200, edited.text
    await attach_files(client, student, thesis["id"])
    submitted = await submit_current_draft(client,
        f"/api/v1/theses/{thesis['id']}:submit", headers=auth(student, "submit-after-close"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200, submitted.text


@pytest.mark.asyncio
async def test_adding_student_to_second_open_batch_conflicts(client):
    school = await login(client, "school.wang")
    student_id = next(row["membership_id"] for row in (await client.get("/api/v1/school-admin/members?membership_type=STUDENT", headers=auth(school))).json()["data"] if row["username"] == "student.lin")
    created = await client.post("/api/v1/school-admin/batches", headers=auth(school, "second-open-create"), json={"code": "second-open", "name": "第二开放批次"})
    batch_id = created.json()["data"]["id"]
    opened = await client.post(f"/api/v1/school-admin/batches/{batch_id}:open", headers=auth(school, "second-open"), json={"expected_version": 1})
    assert opened.status_code == 200
    attempted = await client.post(f"/api/v1/school-admin/batches/{batch_id}/eligibilities", headers=auth(school, "second-open-student"), json={"student_membership_id": student_id})
    assert attempted.status_code == 409 and attempted.json()["code"] == "RESOURCE_CONFLICT"
    listed = await client.get(f"/api/v1/school-admin/batches/{batch_id}/eligibilities", headers=auth(school))
    assert listed.json()["data"] == []


@pytest.mark.asyncio
async def test_suspended_eligibility_blocks_new_draft_but_preserves_existing_draft(client, db_session):
    school = await login(client, "school.wang")
    student = await login(client, "student.lin")
    batch = next(row for row in (await client.get(
        "/api/v1/school-admin/batches", headers=auth(school),
    )).json()["data"] if row["code"] == "2026-spring")
    eligibility = (await client.get(
        f"/api/v1/school-admin/batches/{batch['id']}/eligibilities", headers=auth(school),
    )).json()["data"][0]
    eligibility_id = eligibility["id"]
    suspended = await client.post(
        f"/api/v1/school-admin/eligibilities/{eligibility_id}:suspend",
        headers=auth(school, "suspend-before-draft"),
    )
    assert suspended.status_code == 200
    blocked = await client.post("/api/v1/theses", headers=auth(student), json={
        "title": "暂停时新建", "abstract": "", "discipline_code": "0812",
        "discipline_name": "计算机科学与技术", "keywords": ["盲审"],
    })
    assert blocked.status_code == 403
    resumed = await client.post(
        f"/api/v1/school-admin/eligibilities/{eligibility_id}:resume",
        headers=auth(school, "resume-for-draft"),
    )
    assert resumed.status_code == 200
    thesis = await create_draft(client, student)
    before_theses = await db_session.scalar(select(func.count()).select_from(Thesis))
    before_events = await db_session.scalar(select(func.count()).select_from(WorkflowEvent))
    suspended_again = await client.post(
        f"/api/v1/school-admin/eligibilities/{eligibility_id}:suspend",
        headers=auth(school, "suspend-existing-draft"),
    )
    assert suspended_again.status_code == 200
    owned = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(student))
    assert owned.json()["data"]["draft_eligibility_status"] == "SUSPENDED"
    assert await db_session.scalar(select(func.count()).select_from(Thesis)) == before_theses
    assert await db_session.scalar(select(func.count()).select_from(WorkflowEvent)) == before_events
    edited = await client.patch(f"/api/v1/theses/{thesis['id']}", headers=auth(student), json={
        "expected_content_revision":thesis["current_version"]["content_revision"], "title": "暂停后仍可编辑", "abstract": "", "discipline_code": "0812",
        "discipline_name": "计算机科学与技术", "keywords": ["盲审"],
    })
    assert edited.status_code == 200, edited.text
    await attach_files(client, student, thesis["id"])
    submitted = await submit_current_draft(client,
        f"/api/v1/theses/{thesis['id']}:submit", headers=auth(student, "submit-suspended"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200, submitted.text


@pytest.mark.asyncio
async def test_concurrent_eligibility_creation_keeps_student_in_one_open_batch(test_engine: AsyncEngine):
    sessions = async_sessionmaker(test_engine, expire_on_commit=False)
    async with sessions() as session:
        school = (await session.execute(select(User).where(User.username == "school.wang"))).scalar_one()
        student = (await session.execute(select(User).where(User.username == "student.lin"))).scalar_one()
        member = (await session.execute(select(TenantUserMembership).where(
            TenantUserMembership.user_id == student.id,
        ))).scalar_one()
        old = (await session.execute(select(ReviewBatch).where(
            ReviewBatch.tenant_id == member.tenant_id, ReviewBatch.code == "2026-spring",
        ))).scalar_one()
        old.status = "SUBMISSION_CLOSED"
        first = ReviewBatch(tenant_id=member.tenant_id, code="elig-race-one", name="一批", status="OPEN", version=2)
        second = ReviewBatch(tenant_id=member.tenant_id, code="elig-race-two", name="二批", status="OPEN", version=2)
        session.add_all([first, second])
        await session.flush()
        batch_ids = [first.id, second.id]
        actor = CurrentUser(id=school.id, role="school_reviewer", tenant_id=member.tenant_id, data_scope={})
        await session.commit()

    async def add(batch_id):
        async with sessions() as session:
            try:
                await tenant_service.create_eligibility(
                    session, actor, batch_id,
                    CreateEligibilityInput(student_membership_id=member.id), "race",
                )
                await session.commit()
                return "created"
            except AppError as exc:
                await session.rollback()
                return exc.code

    try:
        results = await asyncio.gather(*(add(batch_id) for batch_id in batch_ids))
        assert sorted(results) == ["RESOURCE_CONFLICT", "created"]
        async with sessions() as session:
            assert await session.scalar(select(func.count()).select_from(StudentEligibility).where(
                StudentEligibility.review_batch_id.in_(batch_ids),
            )) == 1
    finally:
        async with sessions() as session:
            await session.execute(delete(StudentEligibility).where(StudentEligibility.review_batch_id.in_(batch_ids)))
            await session.execute(delete(ReviewBatch).where(ReviewBatch.id.in_(batch_ids)))
            old = (await session.execute(select(ReviewBatch).where(
                ReviewBatch.tenant_id == actor.tenant_id, ReviewBatch.code == "2026-spring",
            ))).scalar_one()
            old.status = "OPEN"
            await session.commit()
