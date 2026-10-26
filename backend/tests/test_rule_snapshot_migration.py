import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest
from sqlalchemy import create_engine,text
from sqlalchemy.exc import DBAPIError
from tests.conftest import _test_url,migrated_test_schema
from tests.legacy_rls_fixture import legacy_accepted_0015
from app.modules.review.rules import pilot_rule_snapshot


def migrate(schema,direction,revision,roles=None):
    env={**os.environ,'DATABASE_URL':_test_url(),'PGOPTIONS':f'-c search_path={schema}'}
    if roles:
        env.update(MIGRATION_DATABASE_URL=roles.migration_url,BUSINESS_DATABASE_URL=roles.business_url,AUTH_DATABASE_URL=roles.auth_url)
    return subprocess.run([sys.executable,'-m','alembic',direction,revision],cwd=Path(__file__).resolve().parents[1],env=env,capture_output=True,text=True)


def test_empty_rule_migration_roundtrip():
    with migrated_test_schema('0017_expert_management') as schema:
        for direction,target in [('upgrade','0018_round_rule_snapshot'),('downgrade','0017_expert_management'),('upgrade','0018_round_rule_snapshot')]:
            result=migrate(schema,direction,target)
            assert result.returncode==0,result.stderr


def legacy_result(conn,task_id):
    scores={d['key']:d['max_score'] for d in pilot_rule_snapshot()['dimensions']}
    row=conn.execute(text('SELECT * FROM expert_tasks WHERE id=:id'),{'id':task_id}).mappings().one()
    conn.execute(text("UPDATE expert_tasks SET status='SUBMITTED' WHERE id=:id"),{'id':task_id})
    conn.execute(text("INSERT INTO review_result_versions(id,task_id,round_id,tenant_id,version_no,scores,total,comments,is_current) VALUES(:id,:task,:round,:tenant,1,CAST(:scores AS jsonb),100,'{\"overallComment\":\"legacy\"}',true)"),{'id':uuid4(),'task':row['id'],'round':row['round_id'],'tenant':row['tenant_id'],'scores':json.dumps(scores)})
    sid=uuid4()
    conn.execute(text("INSERT INTO result_summaries(id,tenant_id,thesis_id,round_id,total,rule_snapshot,result_task_ids,version) VALUES(:id,:tenant,:thesis,:round,100,'{\"required_experts\": 1,\"mode\":\"sum_dimensions\"}',CAST(:tasks AS jsonb),1)"),{'id':sid,'tenant':row['tenant_id'],'thesis':row['thesis_id'],'round':row['round_id'],'tasks':json.dumps([task_id])})
    conn.execute(text("INSERT INTO result_publications(id,summary_id,published_by,published_at) SELECT :id,:sid,id,'2020-01-01' FROM users WHERE username='school.wang'"),{'id':uuid4(),'sid':sid})
    conn.execute(text("UPDATE theses SET stage='COMPLETED' WHERE id=:id"),{'id':row['thesis_id']})


@pytest.mark.asyncio
@pytest.mark.parametrize('state',['empty-round','accepted','published'])
async def test_known_legacy_rules_backfill_preserves_business_data(state):
    async with legacy_accepted_0015() as fixture:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={fixture.schema}'})
        try:
            with engine.begin() as conn:
                if state=='empty-round': conn.execute(text('DELETE FROM expert_tasks'))
                elif state=='published': legacy_result(conn,fixture.task_id)
                before={t:conn.execute(text(f'SELECT to_jsonb(t) FROM {t} t ORDER BY id')).scalars().all() for t in ('review_result_versions','result_publications','expert_tasks')}
            result=migrate(fixture.schema,'upgrade','0018_round_rule_snapshot',fixture.roles)
            assert result.returncode==0,result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT rule_snapshot FROM review_rounds'))==pilot_rule_snapshot()
                after={t:conn.execute(text(f'SELECT to_jsonb(t) FROM {t} t ORDER BY id')).scalars().all() for t in before}
                assert before==after
                if state=='published':
                    assert conn.scalar(text('SELECT rule_snapshot FROM result_summaries'))==pilot_rule_snapshot()
                    with pytest.raises(DBAPIError) as caught:
                        conn.execute(text("UPDATE result_summaries SET rule_snapshot=jsonb_set(rule_snapshot,'{required_experts}','1.0')"))
                    assert getattr(caught.value.orig,'sqlstate',None)=='23514'
                    conn.rollback()
            result=migrate(fixture.schema,'downgrade','0017_expert_management',fixture.roles)
            assert result.returncode!=0 and 'requires empty rounds and summaries' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT version_num FROM alembic_version'))=='0018_round_rule_snapshot'
                assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relname IN ('review_rounds','result_summaries')")) is True
        finally:
            engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('damage',['keys','total','bool','decimal','snapshot','duplicate-seat','summary-task'])
async def test_untrusted_legacy_shape_refuses_entire_migration(damage):
    async with legacy_accepted_0015() as fixture:
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={fixture.schema}'})
        try:
            assert migrate(fixture.schema,'upgrade','0017_expert_management',fixture.roles).returncode==0
            with engine.begin() as conn:
                legacy_result(conn,fixture.task_id)
                sql={
                    'keys':"UPDATE review_result_versions SET scores=scores-'topicValue'",
                    'total':'UPDATE review_result_versions SET total=99',
                    'bool':"UPDATE review_result_versions SET scores=jsonb_set(scores,'{topicValue}','true')",
                    'decimal':"UPDATE review_result_versions SET scores=jsonb_set(scores,'{topicValue}','15.0')",
                    'snapshot':"UPDATE result_summaries SET rule_snapshot='{}'",
                    'summary-task':"UPDATE result_summaries SET result_task_ids='[\"not-a-uuid\"]'",
                    'duplicate-seat':"INSERT INTO expert_tasks(id,tenant_id,round_id,thesis_id,expert_id,status,version) SELECT gen_random_uuid(),tenant_id,round_id,thesis_id,expert_id,'INVITED',1 FROM expert_tasks LIMIT 1",
                }[damage]
                conn.execute(text(sql))
            result=migrate(fixture.schema,'upgrade','0018_round_rule_snapshot',fixture.roles)
            assert result.returncode!=0 and '0018 preflight' in result.stderr
            with engine.connect() as conn:
                assert conn.scalar(text('SELECT version_num FROM alembic_version'))=='0017_expert_management'
                assert not conn.scalar(text("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='review_rounds' AND column_name='rule_snapshot')"))
                assert conn.scalar(text("SELECT bool_and(relforcerowsecurity) FROM pg_class WHERE relnamespace=to_regnamespace(current_schema()) AND relname IN ('review_rounds','result_summaries','expert_tasks','review_result_versions')")) is True
        finally:
            engine.dispose()
