import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.seed import seed_database
from scripts.acceptance_server import acceptance_environment
from tests.conftest import _test_url, isolated_runtime_roles, upgrade_test_schema
from tests.helpers import accepted_task, auth, create_draft, login, published_thesis
from tests.test_review import VALID_DRAFT


WORKFLOW_TABLES = ("result_summaries", "objections", "workflow_events", "termination_records")


@pytest.mark.asyncio
async def test_workflow_rows_default_deny_and_all_four_tables_force_rls():
    async with acceptance_environment("published") as runtime:
        async with runtime.session_factory() as session:
            for table in WORKFLOW_TABLES:
                assert await session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            assert await session.scalar(text("""
                SELECT count(*) FROM pg_class
                WHERE relnamespace = to_regnamespace(current_schema())
                  AND relname = ANY(:tables) AND relrowsecurity AND relforcerowsecurity
            """), {"tables": list(WORKFLOW_TABLES)}) == 4


@pytest.mark.asyncio
async def test_published_summary_objection_and_events_are_scoped_to_own_school():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_a, school_a, thesis_a = await published_thesis(
                client, SimpleNamespace(password=runtime.seed_password))
            student_b = await login(client, "pilot.student", runtime.seed_password)
            school_b = await login(client, "pilot.school", runtime.seed_password)
            platform = await login(client, "platform.chen", runtime.seed_password)
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
            system = await login(client, "admin.system", runtime.seed_password)
            thesis_b = await create_draft(client, student_b, title="另一学校的论文")
            objection = await client.post(
                f"/api/v1/my/theses/{thesis_a}/objections",
                headers=auth(student_a, idempotency="rls-workflow-objection"),
                json={"reason": "请求复核", "request": "请核对评阅意见"},
            )
            assert objection.status_code == 200, objection.text

        for token, expected in (
            (student_a, (1, 1, 1)),
            (school_a, (1, 1, 1)),
            (supervisor, (1, 0, 0)),
            (student_b, (0, 0, 0)),
            (school_b, (0, 0, 0)),
            (platform, (0, 0, 1)),
            (system, (0, 0, 0)),
        ):
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(token["access_token"]))
                counts = [await session.scalar(text(
                    f"SELECT count(*) FROM {table} WHERE thesis_id = :thesis"
                ), {"thesis": UUID(thesis_a)}) for table in
                    ("result_summaries", "objections", "workflow_events")]
                assert tuple(int(value > 0) for value in counts) == expected
                assert await session.scalar(text("""
                    SELECT count(*) FROM workflow_events WHERE thesis_id = :thesis
                """), {"thesis": UUID(thesis_b["id"])}) == 0


@pytest.mark.asyncio
async def test_school_cannot_mix_other_school_parent_ids_into_workflow_rows():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_a, school_a, thesis_a = await published_thesis(
                client, SimpleNamespace(password=runtime.seed_password))
            student_b = await login(client, "pilot.student", runtime.seed_password)
            thesis_b = await create_draft(client, student_b, title="B 校论文")
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school_a["access_token"]))
            summary_id = await session.scalar(text("""
                SELECT id FROM result_summaries WHERE thesis_id = :thesis
            """), {"thesis": UUID(thesis_a)})
            assert summary_id is not None
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    INSERT INTO workflow_events
                        (id, tenant_id, thesis_id, to_stage, action, actor_id, payload)
                    SELECT :id, tenant_id, :foreign, 'COMPLETED', 'publish', app_actor_id(), '{}'::jsonb
                    FROM theses WHERE id = :own
                """), {"id": uuid4(), "foreign": UUID(thesis_b["id"]), "own": UUID(thesis_a)})
            await session.rollback()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school_a["access_token"]))
            changed = await session.execute(text("""
                UPDATE result_summaries SET thesis_id = :foreign WHERE id = :id
            """), {"foreign": UUID(thesis_b["id"]), "id": summary_id})
            assert changed.rowcount == 0  # Published summaries cannot be updated.
            await session.rollback()


@pytest.mark.asyncio
async def test_unpublished_summary_is_hidden_from_student_and_supervisor_and_cannot_rebind():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            expert, student_a, task_id = await accepted_task(
                client, SimpleNamespace(password=runtime.seed_password))
            submitted = await client.post(
                f"/api/v1/expert/tasks/{task_id}:submit-final",
                headers=auth(expert, idempotency="rls-workflow-final"), json=VALID_DRAFT,
            )
            assert submitted.status_code == 200, submitted.text
            school_a = await login(client, "school.wang", runtime.seed_password)
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
            student_b = await login(client, "pilot.student", runtime.seed_password)
            thesis_b = await create_draft(client, student_b, title="B 校论文")
        for token, expected in ((student_a, 0), (supervisor, 0), (school_a, 1)):
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(token["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM result_summaries")) == expected
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(expert["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM result_summaries")) == 1
            changed = await session.execute(text("""
                UPDATE result_summaries SET total = 0
            """))
            assert changed.rowcount == 0
            await session.rollback()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school_a["access_token"]))
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE result_summaries SET thesis_id = :foreign
                """), {"foreign": UUID(thesis_b["id"])})
            await session.rollback()


@pytest.mark.asyncio
async def test_0014_rejects_old_cross_school_parent_then_downgrades_without_row_loss():
    with isolated_runtime_roles(revision="0010_auth_version") as roles:
        owner = create_async_engine(roles.migration_url, connect_args={
            "server_settings": {"search_path": roles.schema},
        })
        try:
            async with async_sessionmaker(owner)() as session:
                await seed_database(session)
        finally:
            await owner.dispose()
        upgrade_test_schema("0013_rls_core", roles.schema, roles.migration_url,
                            roles.business_url, roles.auth_url)
        admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={roles.schema}"})
        thesis_id, version_id, round_id, summary_id, event_id = (uuid4() for _ in range(5))
        try:
            with admin.begin() as conn:
                a = conn.execute(text("""
                    SELECT m.id AS membership_id, m.tenant_id, e.review_batch_id
                    FROM tenant_user_memberships m
                    JOIN users u ON u.id = m.user_id
                    JOIN student_eligibilities e ON e.student_membership_id = m.id
                    WHERE u.username = 'student.lin'
                """)).one()
                tenant_b = conn.scalar(text("""
                    SELECT m.tenant_id FROM tenant_user_memberships m
                    JOIN users u ON u.id = m.user_id WHERE u.username = 'other.student'
                """))
                conn.execute(text("""
                    INSERT INTO theses (id, tenant_id, student_membership_id, review_batch_id)
                    VALUES (:id, :tenant, :member, :batch)
                """), {"id": thesis_id, "tenant": a.tenant_id,
                       "member": a.membership_id, "batch": a.review_batch_id})
                conn.execute(text("""
                    INSERT INTO thesis_versions (id, thesis_id, tenant_id, title)
                    VALUES (:id, :thesis, :tenant, '旧论文')
                """), {"id": version_id, "thesis": thesis_id, "tenant": a.tenant_id})
                conn.execute(text("""
                    INSERT INTO review_rounds
                        (id, tenant_id, thesis_id, thesis_version_id, anonymous_title,
                         discipline_code, discipline_name)
                    VALUES (:id, :tenant, :thesis, :version, '旧论文', '0812', '计算机')
                """), {"id": round_id, "tenant": a.tenant_id,
                       "thesis": thesis_id, "version": version_id})
                conn.execute(text("""
                    INSERT INTO result_summaries
                        (id, tenant_id, thesis_id, round_id, total, rule_snapshot,
                         result_task_ids)
                    VALUES (:id, :tenant, :thesis, :round, 80, '{}'::jsonb, '[]'::jsonb)
                """), {"id": summary_id, "tenant": tenant_b,
                       "thesis": thesis_id, "round": round_id})
                conn.execute(text("""
                    INSERT INTO workflow_events
                        (id, tenant_id, thesis_id, to_stage, action, payload)
                    VALUES (:id, :tenant, :thesis, 'SUBMITTED', 'submit', '{}'::jsonb)
                """), {"id": event_id, "tenant": a.tenant_id, "thesis": thesis_id})
            with pytest.raises(subprocess.CalledProcessError) as rejected:
                upgrade_test_schema("0014_rls_workflow", roles.schema, roles.migration_url,
                                    roles.business_url, roles.auth_url)
            assert "0014 preflight rejected inconsistent result summary" in rejected.value.stderr
            with admin.begin() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0013_rls_core"
                conn.execute(text("""
                    UPDATE result_summaries SET tenant_id = :tenant WHERE id = :id
                """), {"tenant": a.tenant_id, "id": summary_id})
            upgrade_test_schema("0014_rls_workflow", roles.schema, roles.migration_url,
                                roles.business_url, roles.auth_url)
            migration_env = {**os.environ, "DATABASE_URL": _test_url(),
                             "MIGRATION_DATABASE_URL": roles.migration_url,
                             "BUSINESS_DATABASE_URL": roles.business_url,
                             "AUTH_DATABASE_URL": roles.auth_url,
                             "PGOPTIONS": f"-c search_path={roles.schema}"}
            subprocess.run([sys.executable, "-m", "alembic", "downgrade", "0013_rls_core"],
                           cwd=Path(__file__).resolve().parents[1], env=migration_env,
                           check=True, capture_output=True, text=True)
            with admin.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM result_summaries")) == 1
                assert conn.scalar(text("SELECT count(*) FROM workflow_events")) == 1
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0013_rls_core"
        finally:
            admin.dispose()


@pytest.mark.asyncio
async def test_expert_cannot_read_other_actors_results_ready_event_for_same_thesis():
    async with acceptance_environment("published") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            expert = await login(client, "expert.zhou", runtime.seed_password)
            school = await login(client, "school.wang", runtime.seed_password)
        school_claims = verified_access_claims(school["access_token"])
        admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={runtime.schema}"})
        try:
            with admin.begin() as conn:
                tenant_id = conn.scalar(text("""
                    SELECT tenant_id FROM theses WHERE id = :thesis
                """), {"thesis": UUID(runtime.thesis_id)})
                conn.execute(text("""
                    INSERT INTO workflow_events
                        (id, tenant_id, thesis_id, to_stage, action, actor_id, reason, payload)
                    VALUES (:id, :tenant, :thesis, 'RESULT_PROCESSING',
                            'results_ready', :school, '学校内部记录', '{}'::jsonb)
                """), {"id": uuid4(), "tenant": tenant_id,
                       "thesis": UUID(runtime.thesis_id), "school": school_claims.user_id})
        finally:
            admin.dispose()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(expert["access_token"]))
            rows = (await session.execute(text("""
                SELECT actor_id FROM workflow_events
                WHERE thesis_id = :thesis AND action = 'results_ready'
            """), {"thesis": UUID(runtime.thesis_id)})).all()
            assert len(rows) == 1
            assert rows[0].actor_id == verified_access_claims(expert["access_token"]).user_id
