from sqlalchemy import create_engine,text
from tests.conftest import migrated_test_schema,_test_url
from tests.test_expert_migration import migrate


def test_catalog_migration_empty_roundtrip_preserves_existing_metadata():
    with migrated_test_schema('0019_school_task_cancellation') as schema:
        for direction,target in [('upgrade','0020_official_catalogs'),('downgrade','0019_school_task_cancellation'),('upgrade','0020_official_catalogs')]:
            result=migrate(schema,direction,target)
            assert result.returncode==0, result.stderr[-1000:]
        engine=create_engine(_test_url().replace('+asyncpg','+psycopg'),connect_args={'options':f'-c search_path={schema}'})
        try:
            with engine.connect() as conn:
                rows=conn.execute(text("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace=current_schema()::regnamespace AND relname IN ('institution_catalog','school_discipline_settings')")).all()
                assert len(rows)==2 and all(r[1] and r[2] for r in rows)
        finally:
            engine.dispose()
