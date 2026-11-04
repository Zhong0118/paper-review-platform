import asyncio
from types import SimpleNamespace
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.exceptions import AppError
from app.modules.auth.deps import CurrentUser
from app.modules.dispatch.models import ExpertTask
from app.modules.review import service as reviews
from app.modules.review.models import ReviewDraft, ReviewResultVersion
from app.modules.result.models import ResultSummary
from app.modules.user.models import User
from tests.test_file_concurrency import independent_sessions
from tests.helpers import accepted_task, auth, login
from tests.test_review import VALID_DRAFT


async def setup_task(client):
    return await accepted_task(client, SimpleNamespace(password='ChangeMe!dev-only'))


async def expert_actor(session):
    uid = (await session.execute(select(User.id).where(User.username == 'expert.zhou'))).scalar_one()
    return CurrentUser(id=uid, role='expert', tenant_id=None, data_scope={})


async def assert_one_result(sessions, task_id):
    async with sessions() as session:
        results = list((await session.execute(select(ReviewResultVersion).where(
            ReviewResultVersion.task_id == UUID(task_id)
        ))).scalars())
        assert [(r.version_no, r.total, r.is_current) for r in results] == [(1, 80, True)]
        summary = (await session.execute(select(ResultSummary))).scalar_one()
        assert summary.total == 80
        assert summary.result_task_ids == [task_id]
        assert (await session.get(ExpertTask, UUID(task_id))).status == 'SUBMITTED'


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['final', 'draft'])
async def test_stale_task_cannot_write_after_final(independent_sessions, operation):
    sessions, client = independent_sessions
    _, _, task_id = await setup_task(client)
    async with sessions() as first, sessions() as second:
        actor = await expert_actor(first)
        stale = await second.get(ExpertTask, UUID(task_id))
        await reviews.submit_final(first, actor, stale.id, reviews.ReviewPayload(**VALID_DRAFT))
        await first.commit()
        action = reviews.submit_final if operation == 'final' else reviews.save_draft
        model = reviews.ReviewPayload if operation == 'final' else reviews.ReviewDraftWrite
        with pytest.raises(AppError) as error:
            await action(second, actor, stale.id, model(**{**VALID_DRAFT, 'topicValue': 1, 'expected_revision': 0}))
        assert error.value.code == 'STATE_TRANSITION_DENIED'
        await second.rollback()
    await assert_one_result(sessions, task_id)
    async with sessions() as session:
        assert (await session.execute(select(ReviewDraft))).scalars().all() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('change', [
    {'topicValue': 1}, {'overallComment': '新的总体评价'}, {'evaluations': {'innovation': '不同评价'}},
])
async def test_final_idempotency_rejects_changed_body(independent_sessions, change):
    sessions, client = independent_sessions
    expert, _, task_id = await setup_task(client)
    url = f'/api/v1/expert/tasks/{task_id}:submit-final'
    first = await client.post(url, headers=auth(expert, 'final-key'), json=VALID_DRAFT)
    assert first.status_code == 200, first.text
    changed = await client.post(url, headers=auth(expert, 'final-key'), json={**VALID_DRAFT, **change})
    assert changed.status_code == 409, changed.text
    assert changed.json()['code'] == 'IDEMPOTENCY_CONFLICT'
    await assert_one_result(sessions, task_id)


@pytest.mark.asyncio
async def test_final_idempotency_normalizes_nested_key_order(independent_sessions):
    sessions, client = independent_sessions
    expert, _, task_id = await setup_task(client)
    url = f'/api/v1/expert/tasks/{task_id}:submit-final'
    payload = {**VALID_DRAFT, 'evaluations': {'innovation': '充分', 'methodology': '合理'}}
    first = await client.post(url, headers=auth(expert, 'final-key'), json=payload)
    assert first.status_code == 200, first.text
    second = await client.post(url, headers=auth(expert, 'final-key'), json={
        **payload, 'evaluations': {'methodology': '合理', 'innovation': '充分'},
    })
    assert second.status_code == 200, second.text
    assert second.json()['data'] == first.json()['data']
    await assert_one_result(sessions, task_id)


@pytest.mark.asyncio
@pytest.mark.parametrize('same_key', [False, True])
async def test_concurrent_final_requests(independent_sessions, same_key):
    sessions, client = independent_sessions
    expert, _, task_id = await setup_task(client)
    url = f'/api/v1/expert/tasks/{task_id}:submit-final'
    responses = await asyncio.gather(*[
        client.post(url, headers=auth(expert, 'key-1' if same_key else f'key-{i}'), json=VALID_DRAFT)
        for i in range(2)
    ])
    assert sorted(r.status_code for r in responses) == ([200, 200] if same_key else [200, 409])
    if same_key:
        assert responses[0].json()['data'] == responses[1].json()['data']
    await assert_one_result(sessions, task_id)


@pytest.mark.asyncio
async def test_invalid_or_foreign_final_does_not_consume_key(independent_sessions):
    sessions, client = independent_sessions
    expert, _, task_id = await setup_task(client)
    other = await login(client, 'expert.qian')
    url = f'/api/v1/expert/tasks/{task_id}:submit-final'
    foreign = await client.post(url, headers=auth(other, 'key'), json=VALID_DRAFT)
    assert foreign.status_code == 404
    invalid = await client.post(url, headers=auth(expert, 'key'), json={**VALID_DRAFT, 'topicValue': 99})
    assert invalid.status_code == 422
    valid = await client.post(url, headers=auth(expert, 'key'), json=VALID_DRAFT)
    assert valid.status_code == 200, valid.text
    repeat = await client.post(url, headers=auth(expert, 'key'), json={**VALID_DRAFT, 'evaluations': {}})
    assert repeat.status_code == 200, repeat.text
    await assert_one_result(sessions, task_id)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['final', 'draft'])
@pytest.mark.parametrize('commit_first', [True, False])
async def test_waiting_write_rechecks_after_commit_or_rollback(independent_sessions, operation, commit_first):
    from sqlalchemy import text
    from tests.test_file_concurrency import wait_for_db_lock

    sessions, client = independent_sessions
    _, _, task_id = await setup_task(client)
    async with sessions() as first, sessions() as second:
        actor = await expert_actor(first)
        stale = await second.get(ExpertTask, UUID(task_id))
        pid = (await second.execute(text('SELECT pg_backend_pid()'))).scalar_one()
        await reviews.submit_final(first, actor, stale.id, reviews.ReviewPayload(**VALID_DRAFT))
        action = reviews.submit_final if operation == 'final' else reviews.save_draft
        model = reviews.ReviewPayload if operation == 'final' else reviews.ReviewDraftWrite
        pending = asyncio.create_task(action(second, actor, stale.id, model(**VALID_DRAFT, expected_revision=0)))
        try:
            await wait_for_db_lock(sessions, pid)
            if commit_first:
                await first.commit()
                with pytest.raises(AppError) as error:
                    await asyncio.wait_for(pending, 5)
                assert error.value.code == 'STATE_TRANSITION_DENIED'
                await second.rollback()
            else:
                await first.rollback()
                await asyncio.wait_for(pending, 5)
                await second.commit()
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
            await first.rollback()
            await second.rollback()
    if commit_first or operation == 'final':
        await assert_one_result(sessions, task_id)
    else:
        async with sessions() as session:
            assert (await session.execute(select(ReviewResultVersion))).scalars().all() == []
            assert (await session.execute(select(ResultSummary))).scalars().all() == []
            draft = (await session.execute(select(ReviewDraft))).scalar_one()
            assert draft.payload['topicValue'] == 12
            assert (await session.get(ExpertTask, UUID(task_id))).status == 'IN_REVIEW'
