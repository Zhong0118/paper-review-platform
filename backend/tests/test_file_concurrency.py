from tests.pdf_samples import pdf_bytes
import asyncio
from uuid import UUID

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.main import create_app
from app.db.session import get_auth_session, get_session
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.modules.auth.deps import CurrentUser
from app.modules.files import service as files
from app.modules.thesis import service as theses
from app.modules.thesis.models import Thesis
from app.modules.user.models import User
from app.core.exceptions import AppError
from app.seed import seed_database
from tests.conftest import migrated_test_schema, _test_url
from tests.helpers import login, create_draft, attach_files, auth
from tests.test_file_lifecycle import pending, submit, file_for


@pytest_asyncio.fixture
async def independent_sessions():
    with migrated_test_schema() as schema:
        engine = create_async_engine(_test_url(), connect_args={'server_settings': {'search_path': schema}})
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions() as session:
            await seed_database(session)
        app = create_app()
        async def request_session():
            async with sessions() as session:
                yield session
        app.dependency_overrides[get_session] = request_session
        app.dependency_overrides[get_auth_session] = request_session
        try:
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                yield sessions, client
        finally:
            await engine.dispose()


async def wait_for_db_lock(sessions, pid):
    async def poll():
        async with sessions() as session:
            while not (await session.execute(text('SELECT cardinality(pg_blocking_pids(:pid)) > 0'), {'pid': pid})).scalar_one():
                await asyncio.sleep(0.01)
    await asyncio.wait_for(poll(), timeout=5)


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['submit', 'withdraw'])
@pytest.mark.parametrize('upload_action', ['put', 'complete'])
async def test_late_upload_rechecks_state_after_waiting(independent_sessions, action, upload_action):
    sessions, client = independent_sessions
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    await attach_files(client, tokens, thesis['id'])
    file_id = UUID(await pending(client, tokens, thesis['id']))
    if action == 'withdraw':
        thesis = await submit(client, tokens, thesis)
    async with sessions() as first, sessions() as second:
        await bind_candidate_identity(first, verified_access_claims(tokens['access_token']))
        await bind_candidate_identity(second, verified_access_claims(tokens['access_token']))
        # Deliberately preload an identity-map object before the other transaction changes it.
        stale = await second.get(Thesis, UUID(thesis['id']))
        student_id = (await first.execute(select(User.id).where(User.username == 'student.lin'))).scalar_one()
        user = CurrentUser(id=student_id, tenant_id=stale.tenant_id, role='student', data_scope={})
        pid = (await second.execute(text('SELECT pg_backend_pid()'))).scalar_one()
        if action == 'submit':
            fresh=(await client.get('/api/v1/theses/'+thesis['id'],headers=auth(tokens))).json()['data']
            await theses.submit(first, user, stale.id, thesis['version'], None, fresh['current_version']['content_revision'])
        else:
            await theses.withdraw(first, user, stale.id, thesis['version'], '修改')
        operation = (files.put_content(second, user, file_id, b'late content') if upload_action == 'put'
                     else files.complete_upload(second, user, file_id))
        task = asyncio.create_task(operation)
        try:
            await wait_for_db_lock(sessions, pid)
            await first.commit()
            with pytest.raises(AppError) as error:
                await asyncio.wait_for(task, 5)
            assert error.value.code == 'STATE_TRANSITION_DENIED'
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await second.rollback()


@pytest.mark.asyncio
async def test_submit_waits_for_completed_upload(independent_sessions):
    sessions, client = independent_sessions
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    await attach_files(client, tokens, thesis['id'])
    file_id = UUID(await pending(client, tokens, thesis['id']))
    async with sessions() as first, sessions() as second:
        await bind_candidate_identity(first, verified_access_claims(tokens['access_token']))
        await bind_candidate_identity(second, verified_access_claims(tokens['access_token']))
        row = await second.get(Thesis, UUID(thesis['id']))
        student_id = (await first.execute(select(User.id).where(User.username == 'student.lin'))).scalar_one()
        user = CurrentUser(id=student_id, tenant_id=row.tenant_id, role='student', data_scope={})
        pid = (await second.execute(text('SELECT pg_backend_pid()'))).scalar_one()
        before = (await client.get('/api/v1/theses/'+thesis['id'],headers=auth(tokens))).json()['data']
        await files.complete_upload(first, user, file_id, expected_content_revision=before['current_version']['content_revision'])
        fresh=await theses.serialize_thesis(first,user,await first.get(Thesis,row.id))
        task = asyncio.create_task(theses.submit(second, user, row.id, thesis['version'], None, fresh['current_version']['content_revision']))
        try:
            await wait_for_db_lock(sessions, pid)
            await first.commit()
            result = await asyncio.wait_for(task, 5)
            assert result.stage == 'PREPARING'
            assert (await file_for(second, thesis['current_version']['id'])).id == file_id
            await second.commit()
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_rolled_back_put_cannot_complete_until_reuploaded(independent_sessions):
    sessions, client = independent_sessions
    tokens = await login(client, 'student.lin')
    thesis = await create_draft(client, tokens)
    file_id = UUID(await pending(client, tokens, thesis['id']))
    async with sessions() as session:
        row = await session.get(Thesis, UUID(thesis['id']))
        student_id = (await session.execute(select(User.id).where(User.username == 'student.lin'))).scalar_one()
        user = CurrentUser(id=student_id, tenant_id=row.tenant_id, role='student', data_scope={})
        await files.put_content(session, user, file_id, pdf_bytes('uncommitted'))
        await session.rollback()
    async with sessions() as session:
        with pytest.raises(AppError) as error:
            await files.complete_upload(session, user, file_id, expected_content_revision=thesis['current_version']['content_revision'])
        assert error.value.code == 'FILE_NOT_READY'
        await session.rollback()
    async with sessions() as session:
        await files.put_content(session, user, file_id, pdf_bytes('recovered'))
        await session.commit()
    async with sessions() as session:
        obj = await files.complete_upload(session, user, file_id, expected_content_revision=thesis['current_version']['content_revision'])
        assert obj.completed_at is not None
        assert (await file_for(session, thesis['current_version']['id'])).id == file_id
        await session.commit()
