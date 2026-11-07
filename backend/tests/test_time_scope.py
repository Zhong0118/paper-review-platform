from datetime import datetime, timezone, timedelta
import pytest

UTC = timezone.utc


@pytest.mark.parametrize('now,lower', [
    (datetime(2024,2,29,4,tzinfo=UTC), datetime(2023,2,27,16,tzinfo=UTC)),
    (datetime(2026,10,13,15,59,tzinfo=UTC), datetime(2025,10,12,16,tzinfo=UTC)),
    (datetime(2026,10,13,16,tzinfo=UTC), datetime(2025,10,13,16,tzinfo=UTC)),
])
def test_calendar_year_uses_shanghai_day_and_clamps_leap_day(now, lower):
    from app.shared.time_scope import resolve_time_scope
    assert resolve_time_scope('past_year', now) == (lower, now)
    assert resolve_time_scope('all', now) == (None, now)


def test_unknown_scope_rejected():
    from app.shared.time_scope import resolve_time_scope
    from app.core.exceptions import AppError
    with pytest.raises(AppError) as caught:
        resolve_time_scope('recent', datetime(2026,10,13,tzinfo=UTC))
    assert caught.value.http_status == 422


def test_parameterized_scope_uses_thesis_creation_and_inclusive_bounds():
    from sqlalchemy import select
    from app.modules.thesis.models import Thesis
    from app.shared.time_scope import apply_thesis_scope
    now=datetime(2026,10,13,4,tzinfo=UTC)
    query=apply_thesis_scope(select(Thesis.id), 'past_year', now)
    compiled=query.compile()
    assert 'theses.created_at >=' in str(compiled) and 'theses.created_at <=' in str(compiled)
    assert 'updated_at' not in str(compiled)
    assert set(compiled.params.values())=={datetime(2025,10,12,16,tzinfo=UTC),now}


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario', ['accepted', 'published'])
async def test_shared_creation_window_across_roles_and_unfiltered_detail(scenario, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import create_engine, text
    from tests.conftest import _test_url
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import login, auth
    from app.shared import time_scope
    now=datetime(2026,10,13,4,tzinfo=UTC)
    lower=datetime(2025,10,12,16,tzinfo=UTC)
    monkeypatch.setattr(time_scope,'utc_now',lambda:now)
    async with acceptance_environment(scenario) as runtime:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={runtime.schema}'})
        try:
            async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
                actors={key:await login(client,key,runtime.seed_password) for key in
                    ('student.lin','school.wang','expert.zhou','platform.chen','supervisor.zhao','other.student')}
                endpoints=[('/api/v1/theses','student.lin','id',runtime.thesis_id),
                    ('/api/v1/school-review/theses','school.wang','id',runtime.thesis_id),
                    ('/api/v1/school-review/progress','school.wang','thesis_id',runtime.thesis_id),
                    ('/api/v1/expert/tasks','expert.zhou','id',runtime.task_id)]
                endpoints.append(('/api/v1/platform-review/dispatch-queue','platform.chen','thesis_id',runtime.thesis_id)
                    if scenario=='accepted' else ('/api/v1/supervisor/theses/published','supervisor.zhao','id',runtime.thesis_id))
                for created, included in [(lower-timedelta(microseconds=1),False),(lower,True),(now,True),(now+timedelta(microseconds=1),False)]:
                    with engine.begin() as conn:
                        conn.execute(text('UPDATE theses SET created_at=:created,updated_at=:updated WHERE id=:id'),{'created':created,'updated':now,'id':runtime.thesis_id})
                    for path,account,key,identity in endpoints:
                        for scope in ('all','past_year'):
                            response=await client.get(path,headers=auth(actors[account]),params={'time_scope':scope,'as_of':'2099-01-01'})
                            assert response.status_code==200,response.text
                            assert response.headers['X-Time-Scope']==scope
                            assert response.headers['X-As-Of']==now.isoformat()
                            assert response.headers['X-Time-From']==(lower.isoformat() if scope=='past_year' else '')
                            data=response.json()['data']
                            rows=data['items'] if path.endswith('/progress') else data
                            assert (identity in {row[key] for row in rows})==(scope=='all' or included),(path,scope,created)
                            if path.endswith('/progress'):
                                assert data['totals']['reviewing']==(int(scope=='all' or included) if scenario=='accepted' else 0)
                invalid=await client.get('/api/v1/theses?time_scope=recent',headers=auth(actors['student.lin']))
                assert invalid.status_code==422
                foreign=await client.get('/api/v1/theses?time_scope=all',headers=auth(actors['other.student']))
                assert runtime.thesis_id not in foreign.text
                detail=await client.get(f'/api/v1/theses/{runtime.thesis_id}?time_scope=past_year',headers=auth(actors['student.lin']))
                assert detail.status_code==200
                assert (await client.get(f'/api/v1/theses/{runtime.thesis_id}',headers=auth(actors['other.student']))).status_code==404
                # Lists never change the direct task/publication authorization path.
                path=(f'/api/v1/expert/tasks/{runtime.task_id}/materials' if scenario=='accepted' else f'/api/v1/my/theses/{runtime.thesis_id}/published-result')
                owner='expert.zhou' if scenario=='accepted' else 'supervisor.zhao'
                assert (await client.get(path,headers=auth(actors[owner]),params={'time_scope':'past_year'})).status_code==200
        finally:
            engine.dispose()


@pytest.mark.asyncio
async def test_all_keeps_owned_rejected_tasks_and_past_year_uses_their_thesis_date():
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import auth, login, ready_thesis
    from tests.test_dispatch import expert_id
    from types import SimpleNamespace
    async with acceptance_environment('empty') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            student,school,thesis=await ready_thesis(client,SimpleNamespace(password=runtime.seed_password))
            platform=await login(client,'platform.chen',runtime.seed_password)
            expert=await login(client,'expert.zhou',runtime.seed_password)
            confirmed=await client.post(f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",headers=auth(school),json={'version':thesis['version']})
            assert confirmed.status_code==200,confirmed.text
            identity=await expert_id(client,platform,thesis['id'],'zhou')
            assigned=await client.post(f"/api/v1/platform-review/theses/{thesis['id']}:assign",headers=auth(platform),json={'expert_id':identity})
            assert assigned.status_code==200,assigned.text
            task=assigned.json()['data']['task']['id']
            rejected=await client.post(f'/api/v1/expert/tasks/{task}:reject',headers=auth(expert),json={'reason':'本次虚构测试无法接单'})
            assert rejected.status_code==200,rejected.text
            for scope in ('all','past_year'):
                listed=await client.get('/api/v1/expert/tasks',headers=auth(expert),params={'time_scope':scope})
                assert listed.status_code==200,listed.text
                assert task in {row['id'] for row in listed.json()['data']},scope
            # The business role still cannot read the rejected task's thesis row.
            from sqlalchemy import text
            from app.db.rls_context import bind_candidate_identity, verified_access_claims
            lower=datetime(2020,1,1,tzinfo=UTC)
            upper=datetime(2099,1,1,tzinfo=UTC)
            for actor, permitted in [(expert,True),(student,False),(await login(client,'expert.qian',runtime.seed_password),False)]:
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session,verified_access_claims(actor['access_token']))
                    result=await session.scalar(text('SELECT task_thesis_in_period(:task,:lower,:upper)'),{'task':task,'lower':lower,'upper':upper})
                    assert result is permitted
                    assert await session.scalar(text('SELECT task_thesis_in_period(:task,:lower,:upper)'),{'task':'00000000-0000-0000-0000-000000000000','lower':lower,'upper':upper}) is False
                    if actor is expert:
                        assert await session.scalar(text('SELECT count(*) FROM theses WHERE id=:id'),{'id':thesis['id']})==0
                        assert await session.scalar(text('SELECT task_thesis_in_period(:task,:lower,:upper)'),{'task':task,'lower':upper,'upper':lower}) is False
            # Rejection never restores PDF access.
            assert (await client.get(f'/api/v1/expert/tasks/{task}/materials',headers=auth(expert))).status_code==404



def test_task_date_migration_roundtrip_preserves_rls_and_public_acl():
    from sqlalchemy import create_engine, text
    from tests.conftest import isolated_runtime_roles, _test_url
    from tests.test_rule_snapshot_migration import migrate
    with isolated_runtime_roles(revision='0023_review_check_summaries') as roles:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={roles.schema}'})
        try:
            for direction,target in [('upgrade','0024_expert_task_time_scope'),('downgrade','0023_review_check_summaries'),('upgrade','0024_expert_task_time_scope')]:
                result=migrate(roles.schema,direction,target,roles)
                assert result.returncode==0,result.stderr
                with engine.connect() as conn:
                    assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relkind='r' AND relname<>'alembic_version'")) is True
                    if direction=='upgrade':
                        assert conn.scalar(text("SELECT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='task_thesis_in_period(uuid,timestamptz,timestamptz)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE')")) is False
                        assert conn.scalar(text("SELECT has_function_privilege(:role,'task_thesis_in_period(uuid,timestamptz,timestamptz)','EXECUTE')"),{'role':roles.business_role}) is True
                        assert conn.scalar(text("SELECT has_function_privilege(:role,'task_thesis_in_period(uuid,timestamptz,timestamptz)','EXECUTE')"),{'role':roles.auth_role}) is False
        finally:
            engine.dispose()


@pytest.mark.asyncio
async def test_cancelled_task_remains_filterable_without_restoring_materials():
    from httpx import ASGITransport, AsyncClient
    from scripts.acceptance_server import acceptance_environment
    from tests.helpers import auth, login
    async with acceptance_environment('accepted') as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),base_url='http://test') as client:
            expert=await login(client,'expert.zhou',runtime.seed_password)
            school=await login(client,'school.wang',runtime.seed_password)
            thesis=(await client.get(f'/api/v1/school-review/theses/{runtime.thesis_id}',headers=auth(school))).json()['data']
            terminated=await client.post(f'/api/v1/school-review/theses/{runtime.thesis_id}:terminate',headers=auth(school),json={'version':thesis['version'],'reason':'虚构范围验收终止'})
            assert terminated.status_code==200,terminated.text
            for scope in ('all','past_year'):
                tasks=await client.get('/api/v1/expert/tasks',headers=auth(expert),params={'time_scope':scope})
                assert tasks.status_code==200,tasks.text
                own=next(row for row in tasks.json()['data'] if row['id']==runtime.task_id)
                assert own['status']=='CANCELLED' and own['allowed_actions']==[]
            assert (await client.get(f'/api/v1/expert/tasks/{runtime.task_id}/materials',headers=auth(expert))).status_code==404
