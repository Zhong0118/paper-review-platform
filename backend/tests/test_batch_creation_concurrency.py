import asyncio
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError

from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.tenant import service as tenant_service
from app.modules.tenant.models import ReviewBatch
from app.modules.thesis import service as thesis_service
from app.modules.thesis.models import Thesis
from app.modules.user.models import StudentEligibility
from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login


@pytest_asyncio.fixture
async def operations_client():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            yield client, runtime


def _draft(client, student):
    return client.post("/api/v1/theses", headers=auth(student), json={
        "title": "并发送审论文", "abstract": "虚构摘要", "discipline_code": "0812",
        "discipline_name": "计算机科学与技术", "keywords": ["盲审"],
    })


def _batch_command(client, school, batch_id, command, version, key):
    return client.post(
        f"/api/v1/school-admin/batches/{batch_id}:{command}",
        headers=auth(school, key), json={"expected_version": version},
    )


async def _batch_and_theses(runtime, student):
    batch_id = UUID(runtime.operations_ids["batch_id"])
    async with runtime.session_factory() as session:
        await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
        rows = (await session.execute(
            select(ReviewBatch.status, Thesis.stage).join(Thesis, Thesis.review_batch_id == ReviewBatch.id)
            .where(ReviewBatch.id == batch_id)
        )).all()
        active_count = await session.scalar(
            select(func.count()).select_from(Thesis).where(
                Thesis.tenant_id == UUID(runtime.operations_ids["tenant_id"]),
                Thesis.student_membership_id == UUID(runtime.operations_ids["student_member_id"]),
                Thesis.review_batch_id == batch_id,
                Thesis.stage != "TERMINATED",
            )
        )
    return rows, active_count


async def _batch_lock_held(runtime, student):
    async with runtime.session_factory() as probe:
        await bind_candidate_identity(probe, verified_access_claims(student["access_token"]))
        try:
            await probe.execute(select(ReviewBatch.id).where(
                ReviewBatch.id == UUID(runtime.operations_ids["batch_id"]),
            ).with_for_update(nowait=True))
        except DBAPIError as exc:
            if getattr(exc.orig, "sqlstate", None) != "55P03":
                raise
            return True
        finally:
            await probe.rollback()
    return False


@pytest.mark.asyncio
async def test_create_gate_commits_before_close_and_blocks_archive(operations_client, monkeypatch):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    reached, release, close_attempted = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_discipline = thesis_service._require_discipline
    original_get_batch = tenant_service.get_batch

    async def pause_create(*args):
        reached.set()
        await asyncio.wait_for(release.wait(), 10)
        return await original_discipline(*args)

    async def observe_close(*args, **kwargs):
        if reached.is_set() and kwargs.get("lock"):
            close_attempted.set()
        return await original_get_batch(*args, **kwargs)

    monkeypatch.setattr(thesis_service, "_require_discipline", pause_create)
    monkeypatch.setattr(tenant_service, "get_batch", observe_close)
    draft_task = asyncio.create_task(_draft(client, student))
    close_task = None
    gate_held = False
    try:
        await asyncio.wait_for(reached.wait(), 10)
        gate_held = await _batch_lock_held(runtime, student)
        close_task = asyncio.create_task(_batch_command(
            client, school, runtime.operations_ids["batch_id"], "close-submissions", 2, "r03-close-after-create",
        ))
        await asyncio.wait_for(close_attempted.wait(), 10)
    finally:
        release.set()
    created, closed = await asyncio.wait_for(
        asyncio.gather(draft_task, close_task, return_exceptions=True), 10,
    )
    assert all(not isinstance(row, Exception) for row in (created, closed))
    assert gate_held
    assert created.status_code == closed.status_code == 200
    archived = await _batch_command(
        client, school, runtime.operations_ids["batch_id"], "archive",
        closed.json()["data"]["version"], "r03-archive-pending",
    )
    assert archived.status_code == 409
    rows, active_count = await _batch_and_theses(runtime, student)
    assert active_count == 1
    assert not any(status == "ARCHIVED" and stage not in {"COMPLETED", "TERMINATED"} for status, stage in rows)


@pytest.mark.asyncio
async def test_close_commits_first_and_new_draft_is_rejected(operations_client, monkeypatch):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    locked, release, create_attempted = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_get_batch = tenant_service.get_batch
    original_eligibility = thesis_service._eligibility_for_student
    first_lock = True

    async def pause_close(*args, **kwargs):
        nonlocal first_lock
        batch = await original_get_batch(*args, **kwargs)
        if kwargs.get("lock") and first_lock:
            first_lock = False
            locked.set()
            await asyncio.wait_for(release.wait(), 10)
        return batch

    async def observe_create(*args):
        create_attempted.set()
        return await original_eligibility(*args)

    monkeypatch.setattr(tenant_service, "get_batch", pause_close)
    monkeypatch.setattr(thesis_service, "_eligibility_for_student", observe_create)
    close_task = asyncio.create_task(_batch_command(
        client, school, runtime.operations_ids["batch_id"], "close-submissions", 2, "r03-close-first",
    ))
    draft_task = None
    try:
        await asyncio.wait_for(locked.wait(), 10)
        draft_task = asyncio.create_task(_draft(client, student))
        await asyncio.wait_for(create_attempted.wait(), 10)
    finally:
        release.set()
    closed, created = await asyncio.wait_for(
        asyncio.gather(close_task, draft_task, return_exceptions=True), 10,
    )
    assert all(not isinstance(row, Exception) for row in (closed, created))
    assert closed.status_code == 200
    assert created.status_code == 403
    rows, active_count = await _batch_and_theses(runtime, student)
    assert active_count == 0 and rows == []


@pytest.mark.asyncio
async def test_two_creates_keep_one_active_thesis(operations_client, monkeypatch):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    reached, release, second_attempted = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_discipline = thesis_service._require_discipline
    original_eligibility = thesis_service._eligibility_for_student
    first_call = True

    async def pause_first(*args):
        nonlocal first_call
        if first_call:
            first_call = False
            reached.set()
            await asyncio.wait_for(release.wait(), 10)
        return await original_discipline(*args)

    async def observe_second(*args):
        if reached.is_set():
            second_attempted.set()
        return await original_eligibility(*args)

    monkeypatch.setattr(thesis_service, "_require_discipline", pause_first)
    monkeypatch.setattr(thesis_service, "_eligibility_for_student", observe_second)
    first = asyncio.create_task(_draft(client, student))
    second = None
    gate_held = False
    try:
        await asyncio.wait_for(reached.wait(), 10)
        gate_held = await _batch_lock_held(runtime, student)
        second = asyncio.create_task(_draft(client, student))
        await asyncio.wait_for(second_attempted.wait(), 10)
    finally:
        release.set()
    results = await asyncio.wait_for(asyncio.gather(first, second, return_exceptions=True), 10)
    assert all(not isinstance(row, Exception) for row in results)
    assert gate_held
    assert sorted(row.status_code for row in results) == [200, 409]
    _, active_count = await _batch_and_theses(runtime, student)
    assert active_count == 1


@pytest.mark.asyncio
async def test_draft_gate_serializes_eligibility_suspension(operations_client, monkeypatch):
    client, runtime = operations_client
    student = await login(client, "pilot.student")
    school = await login(client, "pilot.school")
    reached, release, suspension_attempted = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_discipline = thesis_service._require_discipline
    original_change = tenant_service.change_eligibility_status

    async def pause_create(*args):
        reached.set()
        await asyncio.wait_for(release.wait(), 10)
        return await original_discipline(*args)

    async def observe_suspension(*args):
        suspension_attempted.set()
        return await original_change(*args)

    monkeypatch.setattr(thesis_service, "_require_discipline", pause_create)
    monkeypatch.setattr(tenant_service, "change_eligibility_status", observe_suspension)
    draft_task = asyncio.create_task(_draft(client, student))
    suspend_task = None
    eligibility_lock_held = False
    try:
        await asyncio.wait_for(reached.wait(), 10)
        async with runtime.session_factory() as probe:
            await bind_candidate_identity(probe, verified_access_claims(student["access_token"]))
            try:
                await probe.execute(select(StudentEligibility.id).where(
                    StudentEligibility.id == UUID(runtime.operations_ids["eligibility_id"]),
                ).with_for_update(nowait=True))
            except DBAPIError as exc:
                if getattr(exc.orig, "sqlstate", None) != "55P03":
                    raise
                eligibility_lock_held = True
            finally:
                await probe.rollback()
        suspend_task = asyncio.create_task(client.post(
            f"/api/v1/school-admin/eligibilities/{runtime.operations_ids['eligibility_id']}:suspend",
            headers=auth(school, "r03-suspend-after-create"),
        ))
        await asyncio.wait_for(suspension_attempted.wait(), 10)
    finally:
        release.set()
    created, suspended = await asyncio.wait_for(
        asyncio.gather(draft_task, suspend_task, return_exceptions=True), 10,
    )
    assert all(not isinstance(row, Exception) for row in (suspended, created))
    assert eligibility_lock_held
    assert created.status_code == 200
    assert suspended.status_code == 200
    _, active_count = await _batch_and_theses(runtime, student)
    assert active_count == 1
