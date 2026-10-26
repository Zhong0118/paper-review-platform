from app.modules.review.rules import pilot_rule_snapshot
import os
import json
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
from tests.helpers import attach_files, auth, create_draft, login, published_thesis


CHILD_TABLES = (
    "thesis_version_files", "anonymization_checks", "review_drafts",
    "review_result_versions", "result_publications",
)


@pytest.mark.asyncio
async def test_all_five_child_tables_force_rls_and_default_deny():
    async with acceptance_environment("published") as runtime:
        async with runtime.session_factory() as session:
            for table in CHILD_TABLES:
                assert await session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            assert await session.scalar(text("""
                SELECT count(*) FROM pg_class
                WHERE relnamespace = to_regnamespace(current_schema())
                  AND relname = ANY(:tables) AND relrowsecurity AND relforcerowsecurity
            """), {"tables": list(CHILD_TABLES)}) == 5


@pytest.mark.asyncio
async def test_published_children_follow_role_and_school_scope_without_task_read():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_a, school_a, thesis_a = await published_thesis(
                client, SimpleNamespace(password=runtime.seed_password))
            student_b = await login(client, "pilot.student", runtime.seed_password)
            school_b = await login(client, "pilot.school", runtime.seed_password)
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
            platform = await login(client, "platform.chen", runtime.seed_password)
            expert = await login(client, "expert.zhou", runtime.seed_password)
            system = await login(client, "admin.system", runtime.seed_password)
            for token, expected in (
                (student_a, (2, 1, 0, 1, 1, 0)),
                (school_a, (2, 1, 0, 1, 1, 1)),
                (supervisor, (0, 0, 0, 1, 1, 0)),
                (student_b, (0, 0, 0, 0, 0, 0)),
                (school_b, (0, 0, 0, 0, 0, 0)),
                (platform, (1, 1, 0, 0, 0, 1)),
                (expert, (0, 0, 0, 1, 0, 1)),
                (system, (0, 0, 0, 0, 0, 0)),
            ):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(session, verified_access_claims(token["access_token"]))
                    counts = tuple([await session.scalar(text(f"SELECT count(*) FROM {table}"))
                                    for table in (*CHILD_TABLES, "expert_tasks")])
                    assert counts == expected
            published = await client.get(
                f"/api/v1/my/theses/{thesis_a}/published-result", headers=auth(student_a))
            assert published.status_code == 200, published.text
            assert len(published.json()["data"]["items"]) == 1
            assert published.json()["data"]["items"][0]["alias"] == "E-001"


@pytest.mark.asyncio
async def test_expert_link_only_current_anonymous_then_hidden_after_submit():
    async with acceptance_environment("accepted") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            expert = await login(client, "expert.zhou", runtime.seed_password)
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert["access_token"]))
                rows = (await session.execute(text("""
                    SELECT purpose FROM thesis_version_files WHERE thesis_id = :thesis
                """), {"thesis": UUID(runtime.thesis_id)})).all()
                assert [row.purpose for row in rows] == ["anonymous"]
            from tests.test_review import VALID_DRAFT
            response = await client.post(
                f"/api/v1/expert/tasks/{runtime.task_id}:submit-final",
                headers=auth(expert, idempotency="rls-children-final"), json=VALID_DRAFT,
            )
            assert response.status_code == 200, response.text
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(expert["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM thesis_version_files")) == 0
            assert await session.scalar(text("SELECT count(*) FROM review_result_versions")) == 1
            changed = await session.execute(text("""
                UPDATE review_result_versions SET total = 99 WHERE task_id = :task
            """), {"task": UUID(runtime.task_id)})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_other_expert_cannot_read_draft_or_result_and_family_cannot_read_before_publish():
    async with acceptance_environment("accepted") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            expert = await login(client, "expert.zhou", runtime.seed_password)
            other_expert = await login(client, "expert.qian", runtime.seed_password)
            student = await login(client, "student.lin", runtime.seed_password)
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
            from tests.test_review import VALID_DRAFT
            saved = await client.put(f"/api/v1/expert/tasks/{runtime.task_id}/draft",
                                     headers=auth(expert), json=VALID_DRAFT)
            assert saved.status_code == 200, saved.text
            async with runtime.session_factory() as session:
                await bind_candidate_identity(
                    session, verified_access_claims(other_expert["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM review_drafts")) == 0
            submitted = await client.post(
                f"/api/v1/expert/tasks/{runtime.task_id}:submit-final",
                headers=auth(expert, idempotency="rls-child-private-final"),
                json=VALID_DRAFT)
            assert submitted.status_code == 200, submitted.text
            for token in (student, supervisor):
                async with runtime.session_factory() as session:
                    await bind_candidate_identity(
                        session, verified_access_claims(token["access_token"]))
                    assert await session.scalar(text("SELECT count(*) FROM review_result_versions")) == 0
                    assert await session.scalar(text("SELECT count(*) FROM result_publications")) == 0
                    assert await session.scalar(text("SELECT count(*) FROM expert_tasks")) == 0
            async with runtime.session_factory() as session:
                await bind_candidate_identity(
                    session, verified_access_claims(other_expert["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM review_result_versions")) == 0
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(expert["access_token"]))
                assert await session.scalar(text("SELECT count(*) FROM review_result_versions")) == 1


@pytest.mark.asyncio
async def test_same_school_other_thesis_file_cannot_be_attached_by_direct_sql():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student = await login(client, "student.lin", runtime.seed_password)
            school = await login(client, "school.wang", runtime.seed_password)
            first = await create_draft(client, student, title="论文一")
            await attach_files(client, student, first["id"])
            created = await client.post("/api/v1/school-admin/members",
                headers=auth(school, idempotency="rls-child-second-student"),
                json={"membership_type": "STUDENT", "username": "student.child-test",
                      "display_name": "第二位学生", "external_id": "CHILD-02",
                      "password": "child-test-password"})
            assert created.status_code == 200, created.text
            batches = (await client.get("/api/v1/school-admin/batches",
                                        headers=auth(school))).json()["data"]
            batch_id = next(row["id"] for row in batches if row["code"] == "2026-spring")
            eligible = await client.post(
                f"/api/v1/school-admin/batches/{batch_id}/eligibilities",
                headers=auth(school, idempotency="rls-child-second-eligibility"),
                json={"student_membership_id": created.json()["data"]["membership_id"]})
            assert eligible.status_code == 200, eligible.text
            other_student = await login(client, "student.child-test", "child-test-password")
            second = await create_draft(client, other_student, title="论文二")
            await attach_files(client, other_student, second["id"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(other_student["access_token"]))
            foreign_file = await session.scalar(text("""
                SELECT file_id FROM thesis_version_files
                WHERE thesis_id = :thesis AND purpose = 'anonymous'
            """), {"thesis": UUID(second["id"])})
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
            link_id = await session.scalar(text("""
                SELECT id FROM thesis_version_files
                WHERE thesis_id = :thesis AND purpose = 'anonymous'
            """), {"thesis": UUID(first["id"])})
            assert await session.scalar(text("""
                SELECT count(*) FROM thesis_version_files WHERE thesis_id = :thesis
            """), {"thesis": UUID(second["id"])}) == 0
            assert link_id and foreign_file
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE thesis_version_files SET file_id = :foreign WHERE id = :id
                """), {"foreign": foreign_file, "id": link_id})
            await session.rollback()


@pytest.mark.asyncio
async def test_0015_rejects_old_wrong_purpose_link_then_backfills_and_downgrades():
    with isolated_runtime_roles(revision="0010_auth_version") as roles:
        owner = create_async_engine(roles.migration_url, connect_args={
            "server_settings": {"search_path": roles.schema},
        })
        try:
            async with async_sessionmaker(owner)() as session:
                await seed_database(session)
        finally:
            await owner.dispose()
        upgrade_test_schema("0014_rls_workflow", roles.schema, roles.migration_url,
                            roles.business_url, roles.auth_url)
        admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={roles.schema}"})
        thesis_id, version_id, file_id, link_id = (uuid4() for _ in range(4))
        try:
            with admin.begin() as conn:
                a = conn.execute(text("""
                    SELECT m.id AS member_id, m.tenant_id, m.user_id, e.review_batch_id
                    FROM tenant_user_memberships m
                    JOIN users u ON u.id = m.user_id
                    JOIN student_eligibilities e ON e.student_membership_id = m.id
                    WHERE u.username = 'student.lin'
                """)).one()
                conn.execute(text("""
                    INSERT INTO theses (id, tenant_id, student_membership_id, review_batch_id)
                    VALUES (:id, :tenant, :member, :batch)
                """), {"id": thesis_id, "tenant": a.tenant_id,
                       "member": a.member_id, "batch": a.review_batch_id})
                conn.execute(text("""
                    INSERT INTO thesis_versions (id, thesis_id, tenant_id, title)
                    VALUES (:id, :thesis, :tenant, '旧版')
                """), {"id": version_id, "thesis": thesis_id, "tenant": a.tenant_id})
                conn.execute(text("""
                    INSERT INTO file_objects
                        (id, tenant_id, thesis_id, upload_version_id, purpose,
                         storage_key, original_filename, content_type, uploaded_by)
                    VALUES (:id, :tenant, :thesis, :version, 'anonymous',
                            'legacy-child-link', 'old.pdf', 'application/pdf', :student)
                """), {"id": file_id, "tenant": a.tenant_id, "thesis": thesis_id,
                       "version": version_id, "student": a.user_id})
                conn.execute(text("""
                    INSERT INTO thesis_version_files (id, thesis_version_id, file_id, purpose)
                    VALUES (:id, :version, :file, 'original')
                """), {"id": link_id, "version": version_id, "file": file_id})
            with pytest.raises(subprocess.CalledProcessError) as rejected:
                upgrade_test_schema("0015_rls_children", roles.schema, roles.migration_url,
                                    roles.business_url, roles.auth_url)
            assert "0015 preflight rejected inconsistent file link" in rejected.value.stderr
            with admin.begin() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0014_rls_workflow"
                conn.execute(text("""
                    UPDATE thesis_version_files SET purpose = 'anonymous' WHERE id = :id
                """), {"id": link_id})
            upgrade_test_schema("0015_rls_children", roles.schema, roles.migration_url,
                                roles.business_url, roles.auth_url)
            with admin.connect() as conn:
                row = conn.execute(text("""
                    SELECT thesis_id, tenant_id FROM thesis_version_files WHERE id = :id
                """), {"id": link_id}).one()
                assert row.thesis_id == thesis_id and row.tenant_id == a.tenant_id
            migration_env = {**os.environ, "DATABASE_URL": _test_url(),
                             "MIGRATION_DATABASE_URL": roles.migration_url,
                             "BUSINESS_DATABASE_URL": roles.business_url,
                             "AUTH_DATABASE_URL": roles.auth_url,
                             "PGOPTIONS": f"-c search_path={roles.schema}"}
            subprocess.run([sys.executable, "-m", "alembic", "downgrade", "0014_rls_workflow"],
                           cwd=Path(__file__).resolve().parents[1], env=migration_env,
                           check=True, capture_output=True, text=True)
            with admin.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM thesis_version_files")) == 1
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0014_rls_workflow"
        finally:
            admin.dispose()


@pytest.mark.asyncio
async def test_published_result_ids_cannot_expose_another_schools_task_result():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_a, _, thesis_a = await published_thesis(
                client, SimpleNamespace(password=runtime.seed_password))
            student_b = await login(client, "pilot.student", runtime.seed_password)
            thesis_b = await create_draft(client, student_b, title="B 校论文")
            task_b, round_b, result_b = (uuid4() for _ in range(3))
            admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                                  connect_args={"options": f"-c search_path={runtime.schema}"})
            try:
                with admin.begin() as conn:
                    tenant_b, version_b = conn.execute(text("""
                        SELECT tenant_id, current_version_id FROM theses WHERE id = :id
                    """), {"id": UUID(thesis_b["id"])}).one()
                    expert_id = conn.scalar(text("SELECT id FROM experts LIMIT 1"))
                    conn.execute(text("""
                        INSERT INTO review_rounds
                            (id, tenant_id, thesis_id, thesis_version_id, anonymous_title,
                             discipline_code, discipline_name, rule_snapshot)
                        VALUES (:id, :tenant, :thesis, :version, 'B 校标题', '0812', '计算机', CAST(:rule AS jsonb))
                    """), {"id": round_b, "tenant": tenant_b,
                           "thesis": UUID(thesis_b["id"]), "version": version_b,
                           "rule": json.dumps(pilot_rule_snapshot())})
                    conn.execute(text("""
                        INSERT INTO expert_tasks
                            (id, tenant_id, thesis_id, round_id, expert_id, status)
                        VALUES (:id, :tenant, :thesis, :round, :expert, 'SUBMITTED')
                    """), {"id": task_b, "tenant": tenant_b, "thesis": UUID(thesis_b["id"]),
                           "round": round_b, "expert": expert_id})
                    conn.execute(text("""
                        INSERT INTO review_result_versions
                            (id, task_id, round_id, tenant_id, version_no, scores,
                             total, comments, is_current)
                        VALUES (:id, :task, :round, :tenant, 1, '{}'::jsonb,
                                99, '{}'::jsonb, true)
                    """), {"id": result_b, "task": task_b, "round": round_b, "tenant": tenant_b})
                    conn.execute(text("""
                        UPDATE result_summaries SET result_task_ids = CAST(:ids AS jsonb)
                        WHERE thesis_id = :thesis
                    """), {"ids": json.dumps([str(task_b)]), "thesis": UUID(thesis_a)})
            finally:
                admin.dispose()
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(student_a["access_token"]))
                assert await session.scalar(text("""
                    SELECT count(*) FROM review_result_versions WHERE id = :id
                """), {"id": result_b}) == 0
            result = await client.get(f"/api/v1/my/theses/{thesis_a}/published-result",
                                      headers=auth(student_a))
            assert result.status_code == 409
            assert str(task_b) not in result.text


@pytest.mark.asyncio
async def test_detached_old_file_cannot_be_linked_to_new_draft():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student = await login(client, "student.lin", runtime.seed_password)
            first = await create_draft(client, student)
            await attach_files(client, student, first["id"])
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
                old_file = await session.scalar(text("""
                    SELECT file_id FROM thesis_version_files
                    WHERE thesis_id = :thesis AND purpose = 'anonymous'
                """), {"thesis": UUID(first["id"])})
            deleted = await client.delete(f"/api/v1/theses/{first['id']}", headers=auth(student))
            assert deleted.status_code == 200, deleted.text
            replacement = await create_draft(client, student, title="重建草稿")
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
            version, tenant = (await session.execute(text("""
                SELECT current_version_id, tenant_id FROM theses WHERE id = :id
            """), {"id": UUID(replacement["id"])})).one()
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    INSERT INTO thesis_version_files
                        (id, thesis_version_id, thesis_id, tenant_id, file_id, purpose)
                    VALUES (:id, :version, :thesis, :tenant, :file, 'anonymous')
                """), {"id": uuid4(), "version": version, "thesis": UUID(replacement["id"]),
                       "tenant": tenant, "file": old_file})
            await session.rollback()
