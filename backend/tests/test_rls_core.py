import json
from app.modules.review.rules import pilot_rule_snapshot
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

from app.core.config import get_settings
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.seed import seed_database
from scripts.acceptance_server import acceptance_environment
from tests.conftest import _test_url, isolated_runtime_roles, upgrade_test_schema
from tests.helpers import attach_files, auth, create_draft, login, ready_thesis
from tests.test_dispatch import expert_id


CORE_TABLES = (
    "student_eligibilities", "theses", "thesis_versions", "file_objects",
    "review_rounds", "expert_tasks",
)


@pytest.mark.asyncio
async def test_core_tables_default_deny_and_expert_title_uses_round_snapshot():
    async with acceptance_environment("accepted") as runtime:
        async with runtime.session_factory() as session:
            for table in CORE_TABLES:
                assert await session.scalar(text(f"SELECT count(*) FROM {table}")) == 0
            assert await session.scalar(text("""
                SELECT count(*) FROM pg_class
                WHERE relnamespace = to_regnamespace(current_schema())
                  AND relname = ANY(:tables) AND relrowsecurity AND relforcerowsecurity
            """), {"tables": list(CORE_TABLES)}) == 6

        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "expert.zhou", "password": runtime.seed_password,
            })
            assert login.status_code == 200
            token = login.json()["data"]["access_token"]
            headers = {"Authorization": f"Bearer {token}"}
            invitation = await client.get(
                f"/api/v1/expert/tasks/{runtime.task_id}/invitation", headers=headers,
            )
            assert invitation.status_code == 200, invitation.text
            assert invitation.json()["data"]["anonymous_title"]

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(token))
            assert await session.scalar(text("SELECT count(*) FROM expert_tasks")) == 1
            assert await session.scalar(text("SELECT count(*) FROM thesis_versions")) == 0
            assert await session.scalar(text("""
                SELECT count(*) FROM file_objects WHERE purpose = 'anonymous'
            """)) == 1
            assert await session.scalar(text("""
                SELECT count(*) FROM file_objects WHERE purpose = 'original'
            """)) == 0
            title = await session.scalar(text("""
                SELECT anonymous_title FROM review_rounds WHERE thesis_id = :id
            """), {"id": UUID(runtime.thesis_id)})
            assert invitation.json()["data"]["anonymous_title"] == title


@pytest.mark.asyncio
async def test_student_sees_own_thesis_but_not_expert_tasks():
    async with acceptance_environment("accepted") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
            assert login.status_code == 200
            claims = verified_access_claims(login.json()["data"]["access_token"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id = :id"),
                                        {"id": UUID(runtime.thesis_id)}) == 1
            assert await session.scalar(text("SELECT count(*) FROM expert_tasks")) == 0
            assert await session.scalar(text("SELECT count(*) FROM thesis_versions")) >= 1


@pytest.mark.asyncio
async def test_known_cross_school_ids_cannot_be_read_or_mixed_into_core_parents():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student_a, school_a, thesis_a = await ready_thesis(
                client, SimpleNamespace(password=runtime.seed_password),
            )
            student_b = await login(client, "pilot.student", runtime.seed_password)
            thesis_b = await create_draft(client, student_b, title="另一学校的论文")
            platform = await login(client, "platform.chen", runtime.seed_password)
            admin = await login(client, "admin.system", runtime.seed_password)
            confirmed = await client.post(
                f"/api/v1/school-review/theses/{thesis_a['id']}:confirm-dispatch",
                headers=auth(school_a, idempotency="rls-core-confirm"),
                json={"version": thesis_a["version"]},
            )
            assert confirmed.status_code == 200, confirmed.text
            expert = await expert_id(client, platform, thesis_a["id"], "zhou")
            assigned = await client.post(
                f"/api/v1/platform-review/theses/{thesis_a['id']}:assign",
                headers=auth(platform, idempotency="rls-core-assign"),
                json={"expert_id": expert},
            )
            assert assigned.status_code == 200, assigned.text

        a_id, b_id = UUID(thesis_a["id"]), UUID(thesis_b["id"])
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student_a["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id = :id"), {"id": b_id}) == 0
            assert await session.scalar(text("SELECT count(*) FROM expert_tasks")) == 0
            a_batch = await session.scalar(text("SELECT review_batch_id FROM theses WHERE id = :id"),
                                           {"id": a_id})
            a_file = await session.scalar(text("SELECT id FROM file_objects WHERE thesis_id = :id LIMIT 1"),
                                          {"id": a_id})
            assert a_file is not None
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    INSERT INTO theses (id, tenant_id, student_membership_id, review_batch_id)
                    VALUES (:id, :tenant, :foreign_member, :batch)
                """), {"id": uuid4(), "tenant": verified_access_claims(
                    student_a["access_token"]).tenant_id,
                        "foreign_member": UUID(runtime.operations_ids["student_member_id"]),
                        "batch": a_batch})
            await session.rollback()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student_a["access_token"]))
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE file_objects SET thesis_id = :foreign WHERE id = :file
                """), {"foreign": b_id, "file": a_file})
            await session.rollback()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student_b["access_token"]))
            b_version = await session.scalar(text("SELECT current_version_id FROM theses WHERE id = :id"),
                                             {"id": b_id})
            assert b_version is not None
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id = :id"), {"id": a_id}) == 0
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE thesis_versions SET thesis_id = :foreign WHERE id = :version
                """), {"foreign": a_id, "version": b_version})
            await session.rollback()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school_a["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id = :id"), {"id": b_id}) == 0
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE theses SET current_version_id = :foreign WHERE id = :own
                """), {"foreign": b_version, "own": a_id})
            await session.rollback()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(school_a["access_token"]))
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE review_rounds SET thesis_version_id = :foreign
                    WHERE thesis_id = :own
                """), {"foreign": b_version, "own": a_id})
            await session.rollback()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(platform["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id IN (:a, :b)"),
                                        {"a": a_id, "b": b_id}) == 2
            with pytest.raises(DBAPIError):
                await session.execute(text("""
                    UPDATE expert_tasks SET thesis_id = :foreign WHERE thesis_id = :own
                """), {"foreign": b_id, "own": a_id})
            await session.rollback()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(admin["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM theses")) == 0


@pytest.mark.asyncio
async def test_student_can_cancel_own_created_round_and_still_read_it():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student, school, thesis = await ready_thesis(
                client, SimpleNamespace(password=runtime.seed_password),
            )
            confirmed = await client.post(
                f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",
                headers=auth(school, idempotency="rls-core-cancel"),
                json={"version": thesis["version"]},
            )
            assert confirmed.status_code == 200, confirmed.text
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
            round_id = await session.scalar(text("""
                SELECT id FROM review_rounds WHERE thesis_id = :thesis
            """), {"thesis": UUID(thesis["id"])})
            assert round_id is not None
            changed = await session.execute(text("""
                UPDATE review_rounds SET status = 'CANCELLED' WHERE id = :id
            """), {"id": round_id})
            assert changed.rowcount == 1
            await session.commit()
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
            assert await session.scalar(text("SELECT status FROM review_rounds WHERE id = :id"),
                                        {"id": round_id}) == "CANCELLED"


@pytest.mark.asyncio
async def test_same_user_memberships_in_two_schools_do_not_cross_token_tenant():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student = await login(client, "student.lin", runtime.seed_password)
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
        claims = verified_access_claims(student["access_token"])
        supervisor_claims = verified_access_claims(supervisor["access_token"])
        tenant_b = UUID(runtime.operations_ids["tenant_id"])
        member_b, eligibility_b, thesis_b, version_b, round_b = (uuid4() for _ in range(5))
        supervisor_member_b = uuid4()
        admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={runtime.schema}"})
        try:
            with admin.begin() as conn:
                organization_b = conn.scalar(text("""
                    SELECT id FROM organizations WHERE tenant_id = :tenant LIMIT 1
                """), {"tenant": tenant_b})
                conn.execute(text("""
                    INSERT INTO tenant_user_memberships
                        (id, tenant_id, user_id, organization_id, membership_type,
                         external_id, external_source, is_active)
                    VALUES (:id, :tenant, :user, :organization, 'STUDENT',
                            'dual-student', 'legacy', true)
                """), {"id": member_b, "tenant": tenant_b, "user": claims.user_id,
                        "organization": organization_b})
                conn.execute(text("""
                    INSERT INTO tenant_user_memberships
                        (id, tenant_id, user_id, organization_id, membership_type,
                         external_id, external_source, is_active)
                    VALUES (:id, :tenant, :user, :organization, 'SUPERVISOR',
                            'dual-supervisor', 'legacy', true)
                """), {"id": supervisor_member_b, "tenant": tenant_b,
                        "user": supervisor_claims.user_id, "organization": organization_b})
                conn.execute(text("""
                    INSERT INTO student_eligibilities
                        (id, tenant_id, student_membership_id, review_batch_id,
                         supervisor_membership_id, status, student_name, student_no,
                         source_version, source_updated_at)
                    VALUES (:id, :tenant, :membership, :batch, :supervisor,
                            'ELIGIBLE', '双校学生', 'DUAL-001', 'legacy', now())
                """), {"id": eligibility_b, "tenant": tenant_b, "membership": member_b,
                        "batch": UUID(runtime.operations_ids["batch_id"]),
                        "supervisor": supervisor_member_b})
                conn.execute(text("""
                    INSERT INTO theses (id, tenant_id, student_membership_id, review_batch_id, stage)
                    VALUES (:id, :tenant, :membership, :batch, 'COMPLETED')
                """), {"id": thesis_b, "tenant": tenant_b, "membership": member_b,
                        "batch": UUID(runtime.operations_ids["batch_id"])})
                conn.execute(text("""
                    INSERT INTO thesis_versions (id, thesis_id, tenant_id, title)
                    VALUES (:id, :thesis, :tenant, 'B 校旧论文')
                """), {"id": version_b, "thesis": thesis_b, "tenant": tenant_b})
                conn.execute(text("""
                    UPDATE theses SET current_version_id = :version WHERE id = :thesis
                """), {"version": version_b, "thesis": thesis_b})
                conn.execute(text("""
                    INSERT INTO review_rounds
                        (id, tenant_id, thesis_id, thesis_version_id,
                         anonymous_title, discipline_code, discipline_name, rule_snapshot)
                    VALUES (:id, :tenant, :thesis, :version,
                            'B 校旧论文', '0812', '计算机科学与技术', CAST(:rule AS jsonb))
                """), {"id": round_b, "tenant": tenant_b,
                        "thesis": thesis_b, "version": version_b,
                        "rule": json.dumps(pilot_rule_snapshot())})
        finally:
            admin.dispose()

        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, claims)
            for table, id_ in (
                ("tenant_user_memberships", member_b),
                ("student_eligibilities", eligibility_b),
                ("theses", thesis_b),
                ("thesis_versions", version_b),
                ("review_rounds", round_b),
            ):
                assert await session.scalar(text(f"SELECT count(*) FROM {table} WHERE id = :id"),
                                            {"id": id_}) == 0
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, supervisor_claims)
            for table, id_ in (
                ("tenant_user_memberships", supervisor_member_b),
                ("student_eligibilities", eligibility_b),
                ("theses", thesis_b),
                ("thesis_versions", version_b),
                ("review_rounds", round_b),
            ):
                assert await session.scalar(text(f"SELECT count(*) FROM {table} WHERE id = :id"),
                                            {"id": id_}) == 0


@pytest.mark.asyncio
async def test_delete_draft_detaches_both_file_ownership_columns():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            student = await login(client, "student.lin", runtime.seed_password)
            thesis = await create_draft(client, student)
            await attach_files(client, student, thesis["id"])
            admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                                  connect_args={"options": f"-c search_path={runtime.schema}"})
            try:
                with admin.begin() as conn:
                    legacy_file = conn.scalar(text("""
                        SELECT id FROM file_objects WHERE thesis_id = :thesis LIMIT 1
                    """), {"thesis": UUID(thesis["id"])})
                    conn.execute(text("""
                        UPDATE file_objects SET upload_version_id = NULL WHERE id = :file
                    """), {"file": legacy_file})
            finally:
                admin.dispose()
            async with runtime.session_factory() as session:
                await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
                with pytest.raises(DBAPIError):
                    await session.execute(text("""
                        UPDATE file_objects
                        SET thesis_id = NULL, purpose = 'tampered' WHERE id = :file
                    """), {"file": legacy_file})
                await session.rollback()
            response = await client.delete(f"/api/v1/theses/{thesis['id']}", headers=auth(student))
            assert response.status_code == 200, response.text
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(student["access_token"]))
            rows = (await session.execute(text("""
                SELECT id, upload_version_id, thesis_id FROM file_objects
                WHERE uploaded_by = :actor
            """), {"actor": verified_access_claims(student["access_token"]).user_id})).all()
            assert len(rows) == 2
            assert all(row.upload_version_id is None and row.thesis_id is None for row in rows)
            changed = await session.execute(text("""
                UPDATE file_objects SET thesis_id = :thesis WHERE id = :file
            """), {"thesis": UUID(thesis["id"]), "file": rows[0].id})
            assert changed.rowcount == 0
            await session.rollback()


@pytest.mark.asyncio
async def test_supervisor_sees_published_thesis_without_task_rows():
    async with acceptance_environment("published") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app),
                               base_url="http://test") as client:
            supervisor = await login(client, "supervisor.zhao", runtime.seed_password)
        async with runtime.session_factory() as session:
            await bind_candidate_identity(session, verified_access_claims(supervisor["access_token"]))
            assert await session.scalar(text("SELECT count(*) FROM theses WHERE id = :id"),
                                        {"id": UUID(runtime.thesis_id)}) == 1
            assert await session.scalar(text("SELECT count(*) FROM thesis_versions")) >= 1
            assert await session.scalar(text("SELECT count(*) FROM expert_tasks")) == 0


@pytest.mark.asyncio
async def test_0013_rejects_conflicting_old_file_ownership_then_backfills_and_downgrades():
    with isolated_runtime_roles(revision="0010_auth_version") as roles:
        owner = create_async_engine(roles.migration_url, connect_args={
            "server_settings": {"search_path": roles.schema},
        })
        try:
            sessions = async_sessionmaker(owner, expire_on_commit=False)
            async with sessions() as session:
                await seed_database(session)
        finally:
            await owner.dispose()

        upgrade_test_schema("0012_rls_metadata", roles.schema, roles.migration_url,
                            roles.business_url, roles.auth_url)
        admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"),
                              connect_args={"options": f"-c search_path={roles.schema}"})
        thesis_a, thesis_b = uuid4(), uuid4()
        version_a, version_b = uuid4(), uuid4()
        round_a, task_a = uuid4(), uuid4()
        linked_file, link_only_file, orphan_file = uuid4(), uuid4(), uuid4()
        try:
            with admin.begin() as conn:
                ids = {}
                for username in ("student.lin", "other.student"):
                    row = conn.execute(text("""
                        SELECT m.id AS membership_id, m.tenant_id, m.user_id,
                               e.review_batch_id
                        FROM tenant_user_memberships m
                        JOIN users u ON u.id = m.user_id
                        JOIN student_eligibilities e ON e.student_membership_id = m.id
                        WHERE u.username = :username
                    """), {"username": username}).one()
                    ids[username] = row
                expert = conn.execute(text("""
                    SELECT e.id FROM experts e JOIN users u ON u.id = e.user_id
                    WHERE u.username = 'expert.zhou'
                """)).scalar_one()
                for thesis_id, version_id, owner_id, title in (
                    (thesis_a, version_a, ids["student.lin"], "旧版标题 A"),
                    (thesis_b, version_b, ids["other.student"], "旧版标题 B"),
                ):
                    conn.execute(text("""
                        INSERT INTO theses (id, tenant_id, student_membership_id, review_batch_id)
                        VALUES (:id, :tenant, :membership, :batch)
                    """), {"id": thesis_id, "tenant": owner_id.tenant_id,
                            "membership": owner_id.membership_id,
                            "batch": owner_id.review_batch_id})
                    conn.execute(text("""
                        INSERT INTO thesis_versions (id, thesis_id, tenant_id, title)
                        VALUES (:id, :thesis, :tenant, :title)
                    """), {"id": version_id, "thesis": thesis_id,
                            "tenant": owner_id.tenant_id, "title": title})
                    conn.execute(text("""
                        UPDATE theses SET current_version_id = :version WHERE id = :thesis
                    """), {"version": version_id, "thesis": thesis_id})
                a = ids["student.lin"]
                conn.execute(text("""
                    INSERT INTO review_rounds
                        (id, tenant_id, thesis_id, thesis_version_id,
                         discipline_code, discipline_name)
                    VALUES (:id, :tenant, :thesis, :version, '0812', '计算机科学与技术')
                """), {"id": round_a, "tenant": a.tenant_id,
                        "thesis": thesis_a, "version": version_a})
                conn.execute(text("""
                    INSERT INTO expert_tasks (id, tenant_id, round_id, expert_id)
                    VALUES (:id, :tenant, :round, :expert)
                """), {"id": task_a, "tenant": a.tenant_id,
                        "round": round_a, "expert": expert})
                for file_id, upload_version, purpose, key in (
                    (linked_file, version_a, "anonymous", "old-linked-file"),
                    (link_only_file, None, "attachment", "old-link-only-file"),
                    (orphan_file, None, "anonymous", "old-orphan-file"),
                ):
                    conn.execute(text("""
                        INSERT INTO file_objects
                            (id, tenant_id, upload_version_id, purpose, storage_key,
                             original_filename, content_type, uploaded_by)
                        VALUES (:id, :tenant, :version, :purpose, :key,
                                'old.pdf', 'application/pdf', :student)
                    """), {"id": file_id, "tenant": a.tenant_id,
                            "version": upload_version, "purpose": purpose, "key": key,
                            "student": a.user_id})
                link_id = uuid4()
                conn.execute(text("""
                    INSERT INTO thesis_version_files (id, thesis_version_id, file_id, purpose)
                    VALUES (:id, :version, :file, 'anonymous')
                """), {"id": link_id, "version": version_b, "file": linked_file})
                conn.execute(text("""
                    INSERT INTO thesis_version_files (id, thesis_version_id, file_id, purpose)
                    VALUES (:id, :version, :file, 'attachment')
                """), {"id": uuid4(), "version": version_a, "file": link_only_file})

            with pytest.raises(subprocess.CalledProcessError) as rejected:
                upgrade_test_schema("0013_rls_core", roles.schema, roles.migration_url,
                                    roles.business_url, roles.auth_url)
            assert "0013 preflight rejected inconsistent file ownership" in rejected.value.stderr
            with admin.begin() as conn:
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0012_rls_metadata"
                conn.execute(text("""
                    UPDATE thesis_version_files SET thesis_version_id = :version WHERE id = :id
                """), {"version": version_a, "id": link_id})

            try:
                upgrade_test_schema("0013_rls_core", roles.schema, roles.migration_url,
                                    roles.business_url, roles.auth_url)
            except subprocess.CalledProcessError as exc:
                raise AssertionError("\n".join(exc.stderr.splitlines()[-8:])) from exc
            with admin.connect() as conn:
                assert conn.scalar(text("SELECT anonymous_title FROM review_rounds WHERE id = :id"),
                                   {"id": round_a}) == "旧版标题 A"
                assert conn.scalar(text("SELECT thesis_id FROM expert_tasks WHERE id = :id"),
                                   {"id": task_a}) == thesis_a
                assert conn.scalar(text("SELECT thesis_id FROM file_objects WHERE id = :id"),
                                   {"id": linked_file}) == thesis_a
                assert conn.scalar(text("SELECT thesis_id FROM file_objects WHERE id = :id"),
                                   {"id": link_only_file}) == thesis_a
                assert conn.scalar(text("SELECT thesis_id FROM file_objects WHERE id = :id"),
                                   {"id": orphan_file}) is None

            migration_env = {**os.environ, "DATABASE_URL": _test_url(),
                             "MIGRATION_DATABASE_URL": roles.migration_url,
                             "BUSINESS_DATABASE_URL": roles.business_url,
                             "AUTH_DATABASE_URL": roles.auth_url,
                             "PGOPTIONS": f"-c search_path={roles.schema}"}
            subprocess.run([sys.executable, "-m", "alembic", "downgrade", "0012_rls_metadata"],
                           cwd=Path(__file__).resolve().parents[1], env=migration_env,
                           check=True, capture_output=True, text=True)
            with admin.connect() as conn:
                assert conn.scalar(text("SELECT count(*) FROM file_objects")) == 3
                assert conn.scalar(text("SELECT count(*) FROM expert_tasks")) == 1
                assert conn.scalar(text("SELECT version_num FROM alembic_version")) == "0012_rls_metadata"
        finally:
            admin.dispose()
