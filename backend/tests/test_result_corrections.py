"""E01: published content is a versioned record, not a live summary projection."""
import pytest
from uuid import UUID
from sqlalchemy import select, text

from app.modules.result.models import ResultSummary
from tests.helpers import auth
from tests.test_dispatch_result_integrity import submitted
from tests.test_file_concurrency import independent_sessions


@pytest.mark.asyncio
async def test_published_snapshot_survives_current_summary_change(independent_sessions):
    sessions, client = independent_sessions
    student, school, _, thesis, _ = await submitted(client, sessions)
    pdf_url = f"/api/v1/school-review/theses/{thesis['id']}/published-review.pdf"
    pending = await client.get(pdf_url, headers=auth(school))
    assert pending.status_code == 404
    assert (await client.get(pdf_url, headers=auth(student))).status_code == 403
    reply = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:publish",
        headers=auth(school), json={'version': thesis['version']})
    assert reply.status_code == 200, reply.text
    url = f"/api/v1/my/theses/{thesis['id']}/published-result"
    before = await client.get(url, headers=auth(student))
    assert before.status_code == 200, before.text
    async with sessions() as session:
        summary = (await session.execute(select(ResultSummary))).scalar_one()
        summary.total = 70
        await session.commit()
    pdf = await client.get(pdf_url, headers=auth(school))
    assert pdf.status_code == 200
    assert f"总分：{before.json()['data']['total']}" in pdf_text(pdf)
    after = await client.get(url, headers=auth(student))
    assert after.status_code == 200, after.text
    assert after.json()['data'] == before.json()['data']


@pytest.mark.asyncio
async def test_publication_contains_bound_immutable_snapshot(independent_sessions):
    sessions, client = independent_sessions
    _, school, _, thesis, _ = await submitted(client, sessions)
    reply = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:publish",
        headers=auth(school), json={'version': thesis['version']})
    assert reply.status_code == 200, reply.text
    async with sessions() as session:
        columns = (await session.execute(text("""SELECT column_name
            FROM information_schema.columns WHERE table_schema=current_schema()
            AND table_name='result_publications'"""))).scalars().all()
        assert {'snapshot', 'publication_no', 'replaces_id'} <= set(columns)
        publication = (await session.execute(text(
            'SELECT snapshot,publication_no,replaces_id FROM result_publications'))).one()
        assert publication.publication_no == 1
        assert publication.replaces_id is None
        assert publication.snapshot['thesis_id'] == thesis['id']
        assert publication.snapshot['thesis_version_id'] == thesis['current_version']['id']
        assert publication.snapshot['base_result_id']
        assert publication.snapshot['revision_id'] is None
        assert len(publication.snapshot['items']) == 1


def pdf_text(response):
    from io import BytesIO
    from pypdf import PdfReader
    assert response.headers['content-type'] == 'application/pdf'
    assert response.headers['cache-control'] == 'no-store'
    doc = PdfReader(BytesIO(response.content))
    result = ''.join(page.extract_text() for page in doc.pages)
    for private in ('周明远', 'expert.zhou', '专家私有申请理由', '学校私有核对理由'):
        assert private not in result + str(doc.metadata) + response.headers['content-disposition']
    for dimension in ('选题价值','文献与理论基础','研究方法','创新性','写作与学术规范','研究成果与工作量'):
        assert dimension in result
    return result


@pytest.mark.asyncio
async def test_correction_requires_school_activation_with_real_rls():
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import text
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login
    from tests.test_review import VALID_DRAFT

    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            accounts = {name: await login(client, name, runtime.seed_password)
                        for name in ('expert.zhou', 'school.wang', 'platform.chen', 'student.lin')}
            expert, school, platform, student = (accounts[name] for name in accounts)
            task = runtime.task_id
            listing = await client.get(f'/api/v1/expert-tasks/{task}/corrections', headers=auth(expert))
            assert listing.status_code == 200, listing.text
            assert listing.json()['data']['requests'] == []
            base = listing.json()['data']['base_result_id']
            requested = await client.post(f'/api/v1/expert-tasks/{task}/corrections',
                headers=auth(expert, 'correction-request'),
                json={'base_result_id': base, 'base_revision_id': None, 'reason': '专家私有申请理由'})
            assert requested.status_code == 200, requested.text
            item = requested.json()['data']
            rid = item['id']
            approved = await client.post(f'/api/v1/platform-review/corrections/{rid}:decide',
                headers=auth(platform, 'correction-approve'),
                json={'version': item['version'], 'decision': 'APPROVE', 'reason': '批准核对'})
            assert approved.status_code == 200, approved.text
            corrected = await client.post(f'/api/v1/expert-corrections/{rid}:submit',
                headers=auth(expert, 'correction-submit'),
                json={'version': approved.json()['data']['version'],
                      'payload': {**VALID_DRAFT, 'topicValue': 15, 'literatureTheory': 15, 'methodology': 20}})
            assert corrected.status_code == 200, corrected.text
            url = f'/api/v1/my/theses/{runtime.thesis_id}/published-result'
            before = await client.get(url, headers=auth(student))
            batch = (await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}',headers=auth(school))).json()['data']['review_batch']['id']
            closeout_url = f'/api/v1/school-admin/batches/{batch}/closeout'
            work = (await client.get(closeout_url, headers=auth(school))).json()['data']
            assert [row['id'] for row in work['corrections']] == [rid]
            assert work['unpublished'] == []
            pdf_url = f'/api/v1/school-review/theses/{runtime.thesis_id}/published-review.pdf'
            exported = await client.get(pdf_url, headers=auth(school))
            assert exported.status_code == 200
            document = pdf_text(exported)
            assert '总分：80' in document and '发布版本：1' in document
            assert before.json()['data']['total'] == 80
            assert before.json()['data'].get('correction_pending') is True
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                assert await session.scalar(text("SELECT count(*) FROM review_correction_notes WHERE note_kind='EXPERT_REQUEST'")) == 0
            # A direct SQL writer must not commit a half-activation without publication.
            from sqlalchemy.exc import DBAPIError
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                await session.execute(text("""UPDATE result_summaries s SET total=v.total,
                    effective_revision_id=v.id, version=s.version+1
                    FROM review_result_revisions v WHERE v.request_id=:request AND s.round_id=v.round_id"""),
                    {'request': UUID(rid)})
                with pytest.raises(DBAPIError) as denied_commit:
                    await session.commit()
                assert denied_commit.value.orig.sqlstate in {'42501', '23514'}
                await session.rollback()
            import asyncio
            activation_body = {'version': corrected.json()['data']['version'], 'reason': '学校私有核对理由'}
            competing_keys = ['correction-activate', 'correction-activate-competing']
            attempts = await asyncio.gather(*(client.post(
                f'/api/v1/school-review/corrections/{rid}:activate',
                headers=auth(school, key), json=activation_body) for key in competing_keys))
            assert sorted(response.status_code for response in attempts) == [200, 409]
            winning_index = next(i for i, response in enumerate(attempts) if response.status_code == 200)
            activated = attempts[winning_index]
            winning_key = competing_keys[winning_index]
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                assert await session.scalar(text('SELECT count(*) FROM result_publications')) == 2
            after = await client.get(url, headers=auth(student))
            assert not (await client.get(closeout_url, headers=auth(school))).json()['data']['corrections']
            pdf_url = f'/api/v1/school-review/theses/{runtime.thesis_id}/published-review.pdf'
            exported = await client.get(pdf_url, headers=auth(school))
            assert exported.status_code == 200
            document = pdf_text(exported)
            assert '总分：90' in document and '发布版本：2' in document
            assert after.json()['data']['total'] == 90
            assert after.json()['data'].get('correction_pending') is False
            effective = await client.get(f'/api/v1/expert/tasks/{task}/result', headers=auth(expert))
            assert effective.json()['data']['topicValue'] == 15
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert['access_token']))
                assert await session.scalar(text("SELECT count(*) FROM review_correction_notes WHERE note_kind='SCHOOL_DECISION'")) == 0
                assert await session.scalar(text('SELECT status FROM expert_tasks')) == 'SUBMITTED'
            replay = await client.post(f'/api/v1/school-review/corrections/{rid}:activate',
                headers=auth(school, winning_key), json=activation_body)
            assert replay.status_code == 200
            assert replay.json()['data'] == activated.json()['data']
            mismatch = await client.post(f'/api/v1/school-review/corrections/{rid}:activate',
                headers=auth(school, winning_key), json={**activation_body, 'reason': '不同载荷'})
            assert mismatch.status_code == 409
            assert mismatch.json()['code'] == 'IDEMPOTENCY_CONFLICT'
            assert before.json()['data']['base_result_id'] == base
            assert before.json()['data']['effective_revision_id'] is None
            assert after.json()['data']['base_result_id'] == base
            assert after.json()['data']['effective_revision_id'] == activated.json()['data']['revision']['id']
            school_result = await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results',
                headers=auth(school))
            assert school_result.json()['data']['base_result_id'] == base
            assert school_result.json()['data']['effective_revision_id'] == after.json()['data']['effective_revision_id']


@pytest.mark.asyncio
@pytest.mark.parametrize('damage', [False, True])
async def test_publication_migration_backfills_or_atomically_rejects(damage):
    from sqlalchemy import create_engine
    from tests.conftest import _test_url
    from tests.legacy_rls_fixture import legacy_accepted_0015
    from tests.test_rule_snapshot_migration import migrate, legacy_result

    async with legacy_accepted_0015() as old:
        engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'),
                               connect_args={'options': f'-c search_path={old.schema}'})
        try:
            with engine.begin() as conn:
                legacy_result(conn, old.task_id)
            result = migrate(old.schema, 'upgrade', '0020_official_catalogs', old.roles)
            assert result.returncode == 0, result.stderr
            with engine.begin() as conn:
                if damage:
                    conn.execute(text('UPDATE result_summaries SET total=70'))
            result = migrate(old.schema, 'upgrade', '0021_publication_snapshots', old.roles)
            if damage:
                assert result.returncode != 0 and '0021 preflight' in result.stderr
                with engine.connect() as conn:
                    assert conn.scalar(text('SELECT version_num FROM alembic_version')) == '0020_official_catalogs'
                    assert not conn.scalar(text("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='result_publications' AND column_name='snapshot')"))
            else:
                assert result.returncode == 0, result.stderr
                with engine.connect() as conn:
                    snapshot = conn.scalar(text('SELECT snapshot FROM result_publications'))
                    assert snapshot['total'] == 100
                    assert snapshot['thesis_id'] == old.thesis_id
                    assert snapshot['items'][0]['overall_comment'] == 'legacy'
                down = migrate(old.schema, 'downgrade', '0020_official_catalogs', old.roles)
                assert down.returncode != 0 and 'requires empty publications' in down.stderr
            with engine.connect() as conn:
                assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relname IN ('result_publications','result_summaries')")) is True
        finally:
            engine.dispose()


@pytest.mark.asyncio
async def test_unfinished_private_request_blocks_first_publication():
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login
    from tests.test_review import VALID_DRAFT

    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            school = await login(client, 'school.wang', runtime.seed_password)
            submitted = await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',
                                          headers=auth(expert), json=VALID_DRAFT)
            assert submitted.status_code == 200, submitted.text
            listing = await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert))
            requested = await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/corrections',
                headers=auth(expert, 'before-publish'), json={
                    'base_result_id': listing.json()['data']['base_result_id'],
                    'base_revision_id': None, 'reason': '尚未处理的私有理由'})
            assert requested.status_code == 200, requested.text
            current = await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results', headers=auth(school))
            published = await client.post(f'/api/v1/school-review/theses/{runtime.thesis_id}:publish',
                headers=auth(school), json={'version': current.json()['data']['version']})
            assert published.status_code == 409, published.text


@pytest.mark.asyncio
async def test_concurrent_requests_have_one_open_record_and_private_rows_stay_hidden():
    import asyncio
    from httpx import ASGITransport, AsyncClient
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login

    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            url = f'/api/v1/expert-tasks/{runtime.task_id}/corrections'
            listing = (await client.get(url, headers=auth(expert))).json()['data']
            body = {'base_result_id': listing['base_result_id'], 'base_revision_id': None, 'reason': '私有申请'}
            replies = await asyncio.gather(*[client.post(url, headers=auth(expert, f'compete-{n}'), json=body) for n in range(2)])
            assert sorted(r.status_code for r in replies) == [200, 409]
            request = next(r for r in replies if r.status_code == 200).json()['data']
            for name in ('school.wang', 'student.lin', 'other.student', 'expert.qian', 'admin.system'):
                user = await login(client, name, runtime.seed_password)
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(user['access_token']))
                    for table in ('review_correction_requests', 'review_correction_notes', 'review_result_revisions'):
                        assert await session.scalar(text(f'SELECT count(*) FROM {table}')) == 0
                if name == 'expert.qian':
                    denied = await client.post(f"/api/v1/corrections/{request['id']}:cancel",
                        headers=auth(user, 'not-owner'), json={'version': request['version']})
                    assert denied.status_code == 404
            cancelled = await client.post(f"/api/v1/corrections/{request['id']}:cancel",
                headers=auth(expert, 'cancel-own'), json={'version': request['version']})
            assert cancelled.status_code == 200, cancelled.text
            assert cancelled.json()['data']['status'] == 'CANCELLED'
            again = await client.post(url, headers=auth(expert, 'new-after-cancel'), json=body)
            assert again.status_code == 200, again.text


@pytest.mark.asyncio
@pytest.mark.parametrize('damage', ['snapshot', 'chain'])
async def test_school_cannot_forge_a_publication_with_direct_sql(damage):
    from sqlalchemy.exc import DBAPIError
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from tests.helpers import login
    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            school = await login(client, 'school.wang', runtime.seed_password)
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                expression = "jsonb_set(snapshot,'{total}','99')" if damage == 'snapshot' else 'snapshot'
                with pytest.raises(DBAPIError) as denied:
                    await session.execute(text(f'''INSERT INTO result_publications
                        (id,summary_id,published_by,published_at,snapshot,publication_no,replaces_id)
                        SELECT gen_random_uuid(),summary_id,app_actor_id(),now(),{expression},4,id
                        FROM result_publications'''))
                assert denied.value.orig.sqlstate in {'42501', '23514'}
                await session.rollback()


@pytest.mark.asyncio
async def test_recovery_manifest_tracks_immutable_result_content():
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, _database_snapshot
    async with acceptance_environment('published') as runtime:
        snapshot = _database_snapshot(OwnedResources.capture(runtime))
        for table in ('result_publications', 'review_correction_requests', 'review_correction_notes', 'review_result_revisions'):
            assert len(snapshot['tables'][table].get('content_sha256', '')) == 64


@pytest.mark.asyncio
async def test_confirmed_correction_survives_owned_restore():
    from tempfile import TemporaryDirectory
    from pathlib import Path
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from scripts.recovery_drill import OwnedResources, backup_owned_resources, restore_owned_resources
    from tests.helpers import login
    from tests.test_review import VALID_DRAFT
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    owned = None
    def guard(stage):
        if owned is not None:
            owned.assert_cleanup_stage(stage)
    async with acceptance_environment('published', cleanup_guard=guard, strict_cleanup=True) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            platform = await login(client, 'platform.chen', runtime.seed_password)
            school = await login(client, 'school.wang', runtime.seed_password)
            listing = (await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert))).json()['data']
            response = await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert, 'restore-request'),
                json={'base_result_id': listing['base_result_id'], 'base_revision_id': None, 'reason': '核对录入'})
            assert response.status_code == 200, response.text
            row = response.json()['data']
            for path, actor, body in [
                (f"/api/v1/platform-review/corrections/{row['id']}:decide", platform, {'decision': 'APPROVE', 'reason': '批准更正'}),
                (f"/api/v1/expert-corrections/{row['id']}:submit", expert, {'payload': {**VALID_DRAFT, 'topicValue': 15, 'literatureTheory': 15, 'methodology': 20}}),
                (f"/api/v1/school-review/corrections/{row['id']}:activate", school, {'reason': '确认并保留版本'}),
            ]:
                response = await client.post(path, headers=auth(actor, path), json={**body, 'version': row['version']})
                assert response.status_code == 200, response.text
                row = response.json()['data']
            owned = OwnedResources.capture(runtime)
            with TemporaryDirectory(prefix='paper-review-correction-restore-') as directory:
                archive = Path(directory)
                manifest = backup_owned_resources(owned, archive)
                assert manifest['tables']['review_result_revisions']['count'] == 1
                assert manifest['tables']['result_publications']['count'] == 2
                await runtime.engine.dispose()
                await runtime.auth_engine.dispose()
                restore_owned_resources(owned, manifest, archive)
                student = await login(client, 'student.lin', runtime.seed_password)
                result = await client.get(f'/api/v1/my/theses/{runtime.thesis_id}/published-result', headers=auth(student))
                assert result.status_code == 200, result.text
                assert result.json()['data']['total'] == 90
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                    snapshots = (await session.execute(text('SELECT snapshot FROM result_publications ORDER BY publication_no'))).scalars().all()
                    assert [s['total'] for s in snapshots] == [80, 90]


@pytest.mark.asyncio
async def test_correction_does_not_deadlock_with_existing_submit_idempotency_order():
    import asyncio
    from httpx import ASGITransport, AsyncClient
    from app.modules.audit import service as audit
    from app.modules.auth.deps import CurrentUser
    from app.modules.dispatch.service import get_task_for_expert
    from app.modules.review import correction_service
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from app.modules.thesis.models import Thesis
    from app.core.exceptions import AppError
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login
    from tests.test_file_concurrency import wait_for_db_lock

    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            tokens = await login(client, 'expert.zhou', runtime.seed_password)
            user = CurrentUser(id=UUID(tokens['user']['id']), role='expert', tenant_id=None, data_scope={})
            listing = (await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(tokens))).json()['data']
            body = {'base_result_id': listing['base_result_id'], 'base_revision_id': None, 'reason': '同键并发测试'}
            async with runtime.session_factory() as old, runtime.session_factory() as new:
                for session in (old, new):
                    await bind_candidate_identity(session, verified_access_claims(tokens['access_token']))
                await new.execute(select(Thesis).where(Thesis.id == UUID(runtime.thesis_id)).with_for_update())
                await audit.replay(old, user, 'shared-key', 'submit-final', {})
                pid = await old.scalar(text('SELECT pg_backend_pid()'))
                waiting = asyncio.create_task(get_task_for_expert(old, user, UUID(runtime.task_id), for_update=True))
                try:
                    await wait_for_db_lock(runtime.session_factory, pid)
                    with pytest.raises(AppError) as conflict:
                        await asyncio.wait_for(correction_service.command(new, user, 'request', UUID(runtime.task_id), body, 'shared-key', None), 5)
                    assert conflict.value.http_status == 409
                finally:
                    await new.rollback()
                    await asyncio.gather(waiting, return_exceptions=True)
                    await old.rollback()


@pytest.mark.asyncio
async def test_pending_projection_cannot_be_shadowed_by_temporary_table():
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert = await login(client, 'expert.zhou', runtime.seed_password)
            school = await login(client, 'school.wang', runtime.seed_password)
            path = f'/api/v1/expert-tasks/{runtime.task_id}/corrections'
            base = (await client.get(path, headers=auth(expert))).json()['data']['base_result_id']
            response = await client.post(path, headers=auth(expert, 'temporary-shadow'),
                json={'base_result_id': base, 'base_revision_id': None, 'reason': '真实未结申请'})
            assert response.status_code == 200, response.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(school['access_token']))
                await session.execute(text('CREATE TEMP TABLE review_correction_requests(round_id uuid, tenant_id uuid, status text) ON COMMIT DROP'))
                await session.execute(text('GRANT SELECT ON pg_temp.review_correction_requests TO PUBLIC'))
                assert await session.scalar(text('SELECT has_open_review_correction(round_id) FROM result_summaries')) is True


@pytest.mark.asyncio
@pytest.mark.parametrize('ending', ['platform_reject', 'school_reject', 'activate_before_publish'])
async def test_correction_terminal_paths_preserve_expected_publication(ending):
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login
    from tests.test_review import VALID_DRAFT

    scenario = 'accepted' if ending == 'activate_before_publish' else 'published'
    async with acceptance_environment(scenario) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            expert, platform, school, student = [await login(client, name, runtime.seed_password)
                for name in ('expert.zhou', 'platform.chen', 'school.wang', 'student.lin')]
            if ending == 'activate_before_publish':
                original = await client.post(f'/api/v1/expert/tasks/{runtime.task_id}:submit-final',
                    headers=auth(expert), json=VALID_DRAFT)
                assert original.status_code == 200, original.text
            context = (await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections',
                headers=auth(expert))).json()['data']
            request_body = {'base_result_id': context['base_result_id'],
                            'base_revision_id': None, 'reason': '核对评分'}
            requested = await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/corrections',
                headers=auth(expert, 'terminal-request'), json=request_body)
            assert requested.status_code == 200, requested.text
            row = requested.json()['data']
            rid = row['id']
            decided = await client.post(f'/api/v1/platform-review/corrections/{rid}:decide',
                headers=auth(platform, 'terminal-decide'), json={'version': row['version'],
                    'decision': 'REJECT' if ending == 'platform_reject' else 'APPROVE', 'reason': '核对决定'})
            assert decided.status_code == 200, decided.text
            row = decided.json()['data']
            if ending != 'platform_reject':
                submitted = await client.post(f'/api/v1/expert-corrections/{rid}:submit',
                    headers=auth(expert, 'terminal-submit'), json={'version': row['version'],
                        'payload': {**VALID_DRAFT, 'topicValue': 15, 'literatureTheory': 15, 'methodology': 20}})
                assert submitted.status_code == 200, submitted.text
                row = submitted.json()['data']
                action = 'activate' if ending == 'activate_before_publish' else 'reject'
                confirmed = await client.post(f'/api/v1/school-review/corrections/{rid}:{action}',
                    headers=auth(school, 'terminal-school'),
                    json={'version': row['version'], 'reason': '学校核对决定'})
                assert confirmed.status_code == 200, confirmed.text
                row = confirmed.json()['data']
            expected_status = {'platform_reject': 'REJECTED', 'school_reject': 'SCHOOL_REJECTED',
                               'activate_before_publish': 'ACTIVATED'}[ending]
            assert row['status'] == expected_status
            if ending == 'activate_before_publish':
                current = await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}/results',
                    headers=auth(school))
                published = await client.post(f'/api/v1/school-review/theses/{runtime.thesis_id}:publish',
                    headers=auth(school, 'terminal-publish'), json={'version': current.json()['data']['version']})
                assert published.status_code == 200, published.text
            result = await client.get(f'/api/v1/my/theses/{runtime.thesis_id}/published-result', headers=auth(student))
            assert result.status_code == 200, result.text
            assert result.json()['data']['total'] == (90 if ending == 'activate_before_publish' else 80)
            assert result.json()['data']['correction_pending'] is False
            if ending != 'activate_before_publish':
                again = await client.post(f'/api/v1/expert-tasks/{runtime.task_id}/corrections',
                    headers=auth(expert, 'terminal-new-request'), json=request_body)
                assert again.status_code == 200, again.text
