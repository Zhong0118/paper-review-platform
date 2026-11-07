"""E05: real business roles, owned synthetic schema, no production data."""
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text, event
from sqlalchemy.orm import Session

from scripts.acceptance_server import acceptance_environment
from tests.conftest import _test_url
from tests.helpers import auth, login


async def dashboard(client, actor, kind='school-review', **params):
    response = await client.get(f'/api/v1/{kind}/dashboard', headers=auth(actor), params=params)
    assert response.status_code == 200, response.text
    data = response.json()['data']
    assert data['as_of'] == response.headers['X-As-Of']
    assert data['overdue_status'] == 'NOT_CONFIGURED'
    assert data['cards']['overdue_tasks'] is None
    return data


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario,counts', [
    ('empty', (0, 0, 0, 0)), ('accepted', (0, 0, 1, 0)), ('published', (0, 0, 0, 1)),
])
async def test_role_contract_and_scope(scenario, counts):
    async with acceptance_environment(scenario) as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            actors = {name: await login(client, name, runtime.seed_password) for name in
                      ('school.wang', 'platform.chen', 'student.lin', 'expert.zhou', 'admin.system', 'supervisor.zhao')}
            for kind, name in [('school-review', 'school.wang'), ('platform-review', 'platform.chen')]:
                data = await dashboard(client, actors[name], kind)
                assert tuple(data['cards'][k] for k in ('waiting_theses', 'invited_tasks', 'in_review_tasks', 'submitted_tasks')) == counts
                assert data['time_scope'] == 'all' and data['time_from'] is None
                if kind == 'school-review':
                    assert data['published_count'] == int(scenario == 'published')
                    assert sum(b['count'] for b in data['published_score_bands']) == data['published_count']
                else:
                    assert set(data) == {'as_of', 'time_scope', 'time_from', 'cards', 'overdue_status'}
                for wrong in actors.keys() - {name}:
                    assert (await client.get(f'/api/v1/{kind}/dashboard', headers=auth(actors[wrong]))).status_code == 403
                assert (await client.get(f'/api/v1/{kind}/dashboard?time_scope=bad', headers=auth(actors[name]))).status_code == 422
            assert (await client.get('/api/v1/school-review/dashboard')).status_code == 401


def populate_cases(runtime):
    """Only create rows in this acceptance runtime's owned schema; API queries use FORCE RLS."""
    from app.modules.thesis.models import Thesis, ThesisVersion
    from app.modules.tenant.models import ReviewBatch
    from app.modules.user.models import StudentEligibility
    from app.modules.dispatch.models import ReviewRound, ExpertTask
    from app.modules.result.models import ResultSummary
    from app.modules.review.models import ReviewResultVersion
    engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'), connect_args={'options': f'-c search_path={runtime.schema}'})
    ids = {}
    try:
        with Session(engine) as session:
            source = session.get(Thesis, UUID(runtime.thesis_id))
            source.created_at = datetime(2026, 10, 25, tzinfo=timezone.utc)
            version = session.get(ThesisVersion, source.current_version_id)
            rnd = session.scalar(select(ReviewRound).where(ReviewRound.thesis_id == source.id))
            task = session.get(ExpertTask, UUID(runtime.task_id))
            eligibility = session.scalar(select(StudentEligibility).where(StudentEligibility.student_membership_id == source.student_membership_id))
            foreign = session.scalar(select(StudentEligibility).where(StudentEligibility.tenant_id != source.tenant_id))
            def clone(model, obj, **changes):
                values = {c.name: getattr(obj, c.name) for c in model.__table__.columns if c.name not in {'id', 'created_at', 'updated_at'}}
                row = model(id=uuid4(), **{**values, **changes})
                session.add(row); session.flush()
                return row
            # Stage and state are fixture inputs, never mutations through application commands.
            for label, stage, status, score in [
                ('waiting', 'READY_FOR_DISPATCH', None, None),
                ('invited', 'UNDER_REVIEW', 'INVITED', None),
                ('reviewing', 'UNDER_REVIEW', 'IN_REVIEW', None),
                ('cancelled', 'UNDER_REVIEW', 'CANCELLED', None),
                ('terminated', 'TERMINATED', 'IN_REVIEW', None),
                ('old_version', 'UNDER_REVIEW', 'IN_REVIEW', None),
                ('foreign', 'UNDER_REVIEW', 'IN_REVIEW', None),
                ('old_date', 'UNDER_REVIEW', 'IN_REVIEW', None),
                *[(f'score{n}', 'RESULT_PROCESSING', 'SUBMITTED', n) for n in (59, 60, 79)],
            ]:
                elig = foreign if label == 'foreign' else eligibility
                batch = clone(ReviewBatch, session.get(ReviewBatch, elig.review_batch_id), code='e05-' + label, tenant_id=elig.tenant_id)
                clone(StudentEligibility, elig, review_batch_id=batch.id)
                paper = clone(Thesis, source, tenant_id=elig.tenant_id, student_membership_id=elig.student_membership_id,
                              review_batch_id=batch.id, current_version_id=None, stage=stage, created_at=datetime(2026, 10, 25, tzinfo=timezone.utc))
                ver = clone(ThesisVersion, version, thesis_id=paper.id, tenant_id=paper.tenant_id, title='E05虚构-' + label)
                paper.current_version_id = ver.id; session.flush()
                current = clone(ReviewRound, rnd, thesis_id=paper.id, tenant_id=paper.tenant_id,
                                thesis_version_id=ver.id, status='CREATED' if status is None else 'ACTIVE')
                if label == 'old_version':
                    newer = clone(ThesisVersion, ver, version_no=2)
                    paper.current_version_id = newer.id; session.flush()
                if label == 'old_date':
                    paper.created_at = datetime(2020, 1, 1, tzinfo=timezone.utc); session.flush()
                if status:
                    work = clone(ExpertTask, task, tenant_id=paper.tenant_id, thesis_id=paper.id,
                                 round_id=current.id, status=status, replaces_task_id=None)
                    if score is not None:
                        result = session.scalar(select(ReviewResultVersion).where(ReviewResultVersion.task_id == task.id))
                        remaining, scores = score, {}
                        for dimension in rnd.rule_snapshot['dimensions']:
                            scores[dimension['key']] = min(remaining, dimension['max_score'])
                            remaining -= scores[dimension['key']]
                        clone(ReviewResultVersion, result, tenant_id=paper.tenant_id, task_id=work.id, round_id=current.id, total=score, scores=scores)
                        summary = session.scalar(select(ResultSummary).where(ResultSummary.thesis_id == source.id))
                        clone(ResultSummary, summary, tenant_id=paper.tenant_id, thesis_id=paper.id, round_id=current.id,
                              total=score, result_task_ids=[str(work.id)], effective_revision_id=None)
                ids[label] = str(paper.id)
            # A cancelled historical round with an active-looking task must never be counted.
            past = clone(ReviewRound, rnd, round_no=0, status='CANCELLED')
            clone(ExpertTask, task, round_id=past.id, status='IN_REVIEW')
            session.commit()
    finally:
        engine.dispose()
    return ids


@pytest.mark.asyncio
async def test_shared_projection_bands_drilldown_and_single_read_snapshot(monkeypatch):
    from app.shared import time_scope
    now = datetime(2026, 10, 26, 4, tzinfo=timezone.utc)
    monkeypatch.setattr(time_scope, 'utc_now', lambda: now)
    async with acceptance_environment('published') as runtime:
        ids = populate_cases(runtime)
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            school = await login(client, 'school.wang', runtime.seed_password)
            platform = await login(client, 'platform.chen', runtime.seed_password)
            for score in (59, 60, 79):
                paper = (await client.get(f'/api/v1/school-review/theses/{ids[f"score{score}"]}', headers=auth(school))).json()['data']
                published = await client.post(f'/api/v1/school-review/theses/{paper["id"]}:publish', headers=auth(school), json={'version': paper['version']})
                assert published.status_code == 200, published.text
            statements = []
            def record(conn, cursor, statement, *args):
                if statement.lstrip().upper().startswith('SELECT') and 'review_rounds' in statement:
                    statements.append(statement)
            event.listen(runtime.engine.sync_engine, 'before_cursor_execute', record)
            data = await dashboard(client, school)
            event.remove(runtime.engine.sync_engine, 'before_cursor_execute', record)
            assert len(statements) == 1  # all business counts and publication totals in one MVCC statement
            assert data['cards'] == dict(waiting_theses=2, invited_tasks=1, in_review_tasks=2, submitted_tasks=4, overdue_tasks=None)
            assert [b['count'] for b in data['published_score_bands']] == [1, 2, 1]
            assert data['published_count'] == 4
            recent = await dashboard(client, school, time_scope='past_year')
            assert recent['cards']['in_review_tasks'] == 1
            assert recent['time_from'] == '2025-10-25T16:00:00+00:00'
            p = await dashboard(client, platform, 'platform-review')
            assert p['cards']['in_review_tasks'] == 3  # platform includes its authorized other school
            assert 'published_count' not in p and 'published_score_bands' not in p
            for status, card in [('WAITING', 'waiting_theses'), ('INVITED', 'invited_tasks'), ('IN_REVIEW', 'in_review_tasks'), ('SUBMITTED', 'submitted_tasks')]:
                response = await client.get('/api/v1/school-review/progress', headers=auth(school), params={'status_filter': status, 'time_scope': 'past_year'})
                assert response.status_code == 200, response.text
                listing = response.json()['data']
                assert listing['filtered_count'] == recent['cards'][card]
                assert ids['foreign'] not in str(listing) and ids['old_version'] not in str(listing)
                assert listing['as_of'] == recent['as_of']
                for row in listing['items']:
                    assert all(t['status'] == status for t in row['tasks']) if status != 'WAITING' else row['waiting']
                assert 'expert_id' not in response.text and '周' not in response.text
                queue = await client.get('/api/v1/platform-review/dispatch-queue', headers=auth(platform), params={'status_filter': status})
                assert queue.status_code == 200, queue.text
                assert len(queue.json()['data']) == p['cards'][card]
            assert (await client.get('/api/v1/school-review/progress?status_filter=UNKNOWN', headers=auth(school))).status_code == 422


@pytest.mark.asyncio
async def test_correction_replaces_published_score_without_counting_task_twice():
    from tests.test_review import VALID_DRAFT
    async with acceptance_environment('published') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            school, expert, platform = [await login(client, n, runtime.seed_password) for n in ('school.wang', 'expert.zhou', 'platform.chen')]
            async def post(path, actor, body):
                response = await client.post('/api/v1/' + path, headers=auth(actor, str(uuid4())), json=body)
                assert response.status_code == 200, response.text
                return response.json()['data']
            listing = (await client.get(f'/api/v1/expert-tasks/{runtime.task_id}/corrections', headers=auth(expert))).json()['data']
            req = await post(f'expert-tasks/{runtime.task_id}/corrections', expert, {'base_result_id': listing['base_result_id'], 'base_revision_id': None, 'reason': '虚构分值复核'})
            req = await post(f'platform-review/corrections/{req["id"]}:decide', platform, {'version': req['version'], 'decision': 'APPROVE', 'reason': '核实'})
            payload = {**VALID_DRAFT, 'topicValue': 0}
            check = await post(f'expert-corrections/{req["id"]}/review-checks', expert, {'payload': payload})
            ack = {k: check[k] for k in ('payload_hash', 'rule_version')}
            ack['codes'] = sorted({f['code'] for f in check['findings']})
            req = await post(f'expert-corrections/{req["id"]}:submit', expert, {'version': req['version'], 'payload': payload, 'check_ack': ack})
            before = await dashboard(client, school)
            assert [r['count'] for r in before['published_score_bands']] == [0, 0, 1]
            await post(f'school-review/corrections/{req["id"]}:activate', school, {'version': req['version'], 'reason': '确认'})
            after = await dashboard(client, school)
            assert after['published_count'] == 1 and after['cards']['submitted_tasks'] == 1
            assert [r['count'] for r in after['published_score_bands']] == [0, 1, 0]


@pytest.mark.asyncio
async def test_real_reassignment_and_termination_remove_previous_tasks():
    async with acceptance_environment('accepted') as runtime:
        engine = create_engine(_test_url().replace('+asyncpg', '+psycopg'), connect_args={'options': f'-c search_path={runtime.schema}'})
        try:
            with engine.begin() as conn:
                replacement = conn.scalar(text("UPDATE experts SET discipline_codes='[\"0812\"]'::jsonb FROM users WHERE users.id=experts.user_id AND users.username='expert.qian' RETURNING experts.id"))
        finally:
            engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url='http://test') as client:
            school = await login(client, 'school.wang', runtime.seed_password)
            platform = await login(client, 'platform.chen', runtime.seed_password)
            before = await dashboard(client, school)
            assert before['cards']['in_review_tasks'] == 1
            response = await client.post(f'/api/v1/expert-tasks/{runtime.task_id}:reassign', headers=auth(platform), json={'expert_id': str(replacement)})
            assert response.status_code == 200, response.text
            after = await dashboard(client, school)
            assert after['cards']['in_review_tasks'] == 0 and after['cards']['invited_tasks'] == 1
            listing = (await client.get('/api/v1/school-review/progress?status_filter=INVITED', headers=auth(school))).json()['data']
            assert listing['filtered_count'] == 1
            assert [t['status'] for r in listing['items'] for t in r['tasks']] == ['INVITED']
            paper = (await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}', headers=auth(school))).json()['data']
            stopped = await client.post(f'/api/v1/school-review/theses/{runtime.thesis_id}:terminate', headers=auth(school), json={'version': paper['version'], 'reason': '虚构验收终止'})
            assert stopped.status_code == 200, stopped.text
            end = await dashboard(client, school)
            assert all(value == 0 for key, value in end['cards'].items() if key != 'overdue_tasks')
