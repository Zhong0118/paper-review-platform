"""Protect thesis, dispatch, eligibility, and file rows."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import make_url

from app.core.config import get_settings

revision = "0013_rls_core"
down_revision = "0012_rls_metadata"
branch_labels = None
depends_on = None

TABLES = ("student_eligibilities", "theses", "thesis_versions", "file_objects",
          "review_rounds", "expert_tasks")


def _business_role() -> str | None:
    url = get_settings().business_database_url
    username = make_url(url).username if url else None
    return op.get_bind().dialect.identifier_preparer.quote(username) if username else None


def _policy(table: str, name: str, command: str, predicate: str,
            check: str | None = None) -> None:
    sql = f"CREATE POLICY {name} ON {table} FOR {command}"
    if command != "INSERT":
        sql += f" USING ({predicate})"
    if command in ("INSERT", "UPDATE"):
        sql += f" WITH CHECK ({check or predicate})"
    op.execute(sql)


def _audit_old_rows() -> None:
    # Foreign keys in the old schema checked individual IDs, not their ownership.
    checks = {
        "thesis parent": """
            SELECT 1 FROM theses t
            LEFT JOIN tenant_user_memberships m ON m.id = t.student_membership_id
            LEFT JOIN review_batches b ON b.id = t.review_batch_id
            LEFT JOIN thesis_versions v ON v.id = t.current_version_id
            WHERE m.tenant_id IS DISTINCT FROM t.tenant_id
               OR b.tenant_id IS DISTINCT FROM t.tenant_id
               OR (t.current_version_id IS NOT NULL AND
                   (v.thesis_id IS DISTINCT FROM t.id OR v.tenant_id IS DISTINCT FROM t.tenant_id))
        """,
        "version parent": """
            SELECT 1 FROM thesis_versions v JOIN theses t ON t.id = v.thesis_id
            WHERE v.tenant_id IS DISTINCT FROM t.tenant_id
        """,
        "round parent": """
            SELECT 1 FROM review_rounds r
            JOIN theses t ON t.id = r.thesis_id
            JOIN thesis_versions v ON v.id = r.thesis_version_id
            WHERE r.tenant_id IS DISTINCT FROM t.tenant_id
               OR v.thesis_id IS DISTINCT FROM r.thesis_id
               OR v.tenant_id IS DISTINCT FROM r.tenant_id
               OR v.title IS NULL
        """,
        "task parent": """
            SELECT 1 FROM expert_tasks e JOIN review_rounds r ON r.id = e.round_id
            LEFT JOIN expert_tasks old ON old.id = e.replaces_task_id
            WHERE e.tenant_id IS DISTINCT FROM r.tenant_id
               OR (e.replaces_task_id IS NOT NULL AND
                   (old.round_id IS DISTINCT FROM e.round_id OR old.tenant_id IS DISTINCT FROM e.tenant_id))
        """,
        "file ownership": """
            SELECT 1 FROM file_objects f
            LEFT JOIN thesis_versions upload ON upload.id = f.upload_version_id
            LEFT JOIN (
                SELECT l.file_id, min(v.thesis_id::text)::uuid AS thesis_id,
                       count(DISTINCT v.thesis_id) AS thesis_count,
                       count(DISTINCT v.tenant_id) AS tenant_count,
                       min(v.tenant_id::text)::uuid AS tenant_id
                FROM thesis_version_files l
                JOIN thesis_versions v ON v.id = l.thesis_version_id
                GROUP BY l.file_id
            ) linked ON linked.file_id = f.id
            WHERE (f.upload_version_id IS NOT NULL AND upload.tenant_id IS DISTINCT FROM f.tenant_id)
               OR linked.thesis_count > 1 OR linked.tenant_count > 1
               OR (linked.file_id IS NOT NULL AND linked.tenant_id IS DISTINCT FROM f.tenant_id)
               OR (upload.id IS NOT NULL AND linked.file_id IS NOT NULL
                   AND upload.thesis_id IS DISTINCT FROM linked.thesis_id)
        """,
    }
    conn = op.get_bind()
    for name, query in checks.items():
        if conn.execute(sa.text(f"SELECT EXISTS ({query})")).scalar_one():
            raise ValueError(f"0013 preflight rejected inconsistent {name}")


def upgrade() -> None:
    # The migration owner is subject to FORCE RLS on membership and batch parents.
    # Use the platform's read scope only for this transaction's preflight joins.
    op.execute("SELECT set_config('app.role', 'platform_reviewer', true)")
    op.execute("SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true)")
    _audit_old_rows()
    op.execute("""
        CREATE FUNCTION guard_eligibility_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF current_setting('app.role', true) = 'student'
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'students cannot update eligibility'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER eligibility_student_lock_guard BEFORE UPDATE ON student_eligibilities
        FOR EACH ROW EXECUTE FUNCTION guard_eligibility_write()
    """)
    op.execute("""
        CREATE FUNCTION guard_thesis_parent_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF (OLD.tenant_id, OLD.student_membership_id, OLD.review_batch_id)
               IS DISTINCT FROM
               (NEW.tenant_id, NEW.student_membership_id, NEW.review_batch_id)
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'thesis parent identity is immutable'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER thesis_parent_guard BEFORE UPDATE ON theses
        FOR EACH ROW EXECUTE FUNCTION guard_thesis_parent_write()
    """)
    op.execute("""
        CREATE FUNCTION guard_legacy_file_detach() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF OLD.upload_version_id IS NULL AND OLD.thesis_id IS NOT NULL
               AND (NEW.upload_version_id IS NOT NULL OR NEW.thesis_id IS NOT NULL
                    OR (to_jsonb(NEW) - 'upload_version_id' - 'thesis_id' - 'updated_at')
                       IS DISTINCT FROM
                       (to_jsonb(OLD) - 'upload_version_id' - 'thesis_id' - 'updated_at'))
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'legacy file ownership can only be detached'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER legacy_file_detach_guard BEFORE UPDATE ON file_objects
        FOR EACH ROW EXECUTE FUNCTION guard_legacy_file_detach()
    """)
    op.add_column("review_rounds", sa.Column("anonymous_title", sa.String(255)))
    op.add_column("expert_tasks", sa.Column("thesis_id", sa.Uuid()))
    op.add_column("file_objects", sa.Column("thesis_id", sa.Uuid()))
    op.execute("""
        UPDATE review_rounds r SET anonymous_title = v.title
        FROM thesis_versions v WHERE v.id = r.thesis_version_id
    """)
    op.execute("""
        UPDATE expert_tasks e SET thesis_id = r.thesis_id
        FROM review_rounds r WHERE r.id = e.round_id
    """)
    op.execute("""
        UPDATE file_objects f SET thesis_id = COALESCE(upload.thesis_id, linked.thesis_id)
        FROM (SELECT f0.id, v.thesis_id FROM file_objects f0
              JOIN thesis_versions v ON v.id = f0.upload_version_id) upload
        FULL JOIN (SELECT l.file_id AS id, min(v.thesis_id::text)::uuid AS thesis_id
                   FROM thesis_version_files l
                   JOIN thesis_versions v ON v.id = l.thesis_version_id
                   GROUP BY l.file_id) linked ON linked.id = upload.id
        WHERE f.id = COALESCE(upload.id, linked.id)
    """)
    op.alter_column("review_rounds", "anonymous_title", nullable=False)
    op.alter_column("expert_tasks", "thesis_id", nullable=False)

    constraints = (
        ("uq_theses_id_tenant_id", "theses", ["id", "tenant_id"]),
        ("uq_thesis_versions_id_thesis_tenant", "thesis_versions", ["id", "thesis_id", "tenant_id"]),
        ("uq_review_rounds_id_thesis_tenant", "review_rounds", ["id", "thesis_id", "tenant_id"]),
        ("uq_expert_tasks_id_round_tenant", "expert_tasks", ["id", "round_id", "tenant_id"]),
        ("uq_file_objects_id_thesis_tenant_purpose", "file_objects", ["id", "thesis_id", "tenant_id", "purpose"]),
    )
    for name, table, columns in constraints:
        op.create_unique_constraint(name, table, columns)
    foreign_keys = (
        ("fk_theses_current_version_same_thesis", "theses", "thesis_versions",
         ["current_version_id", "id", "tenant_id"], ["id", "thesis_id", "tenant_id"]),
        ("fk_thesis_versions_thesis_tenant", "thesis_versions", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_review_rounds_thesis_tenant", "review_rounds", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_review_rounds_version_thesis_tenant", "review_rounds", "thesis_versions",
         ["thesis_version_id", "thesis_id", "tenant_id"], ["id", "thesis_id", "tenant_id"]),
        ("fk_expert_tasks_round_thesis_tenant", "expert_tasks", "review_rounds",
         ["round_id", "thesis_id", "tenant_id"], ["id", "thesis_id", "tenant_id"]),
        ("fk_expert_tasks_replacement_same_round", "expert_tasks", "expert_tasks",
         ["replaces_task_id", "round_id", "tenant_id"], ["id", "round_id", "tenant_id"]),
        ("fk_file_objects_thesis_tenant", "file_objects", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_file_objects_version_thesis_tenant", "file_objects", "thesis_versions",
         ["upload_version_id", "thesis_id", "tenant_id"], ["id", "thesis_id", "tenant_id"]),
    )
    for name, table, parent, local, remote in foreign_keys:
        op.create_foreign_key(name, table, parent, local, remote)
    op.create_check_constraint("ck_file_objects_version_has_thesis", "file_objects",
                               "upload_version_id IS NULL OR thesis_id IS NOT NULL")

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    actor = "app_actor_id() IS NOT NULL"
    school = f"{actor} AND app_role() = 'school_reviewer'"
    platform = f"{actor} AND app_role() = 'platform_reviewer'"
    student = f"{actor} AND app_role() = 'student'"
    supervisor = f"{actor} AND app_role() = 'supervisor'"
    expert = f"{actor} AND app_role() = 'expert'"

    eligibility_student = ("EXISTS (SELECT 1 FROM tenant_user_memberships m "
                           "WHERE m.id = student_eligibilities.student_membership_id "
                           "AND m.tenant_id = student_eligibilities.tenant_id "
                           "AND m.user_id = app_actor_id())")
    eligibility_supervisor = ("EXISTS (SELECT 1 FROM tenant_user_memberships m "
                              "WHERE m.id = student_eligibilities.supervisor_membership_id "
                              "AND m.tenant_id = student_eligibilities.tenant_id "
                              "AND m.user_id = app_actor_id())")
    eligibility_read = (f"{platform} OR ({school} AND student_eligibilities.tenant_id = app_tenant_id()) "
                        f"OR ({student} AND student_eligibilities.tenant_id = app_tenant_id() "
                        f"AND {eligibility_student}) "
                        f"OR ({supervisor} AND student_eligibilities.tenant_id = app_tenant_id() "
                        f"AND {eligibility_supervisor})")
    _policy("student_eligibilities", "eligibilities_read", "SELECT", eligibility_read)
    eligibility_write = (f"{school} AND student_eligibilities.tenant_id = app_tenant_id() "
                         "AND EXISTS (SELECT 1 FROM tenant_user_memberships m WHERE "
                         "m.id = student_eligibilities.student_membership_id "
                         "AND m.tenant_id = student_eligibilities.tenant_id "
                         "AND m.membership_type = 'STUDENT') "
                         "AND (student_eligibilities.supervisor_membership_id IS NULL OR "
                         "EXISTS (SELECT 1 FROM tenant_user_memberships m WHERE "
                         "m.id = student_eligibilities.supervisor_membership_id "
                         "AND m.tenant_id = student_eligibilities.tenant_id "
                         "AND m.membership_type = 'SUPERVISOR')) "
                         "AND EXISTS (SELECT 1 FROM review_batches b WHERE "
                         "b.id = student_eligibilities.review_batch_id "
                         "AND b.tenant_id = student_eligibilities.tenant_id)")
    _policy("student_eligibilities", "eligibilities_insert", "INSERT", eligibility_write)
    _policy("student_eligibilities", "eligibilities_update", "UPDATE", eligibility_write)
    _policy("student_eligibilities", "eligibilities_student_lock", "UPDATE",
            f"{student} AND {eligibility_student}")

    thesis_student = ("EXISTS (SELECT 1 FROM tenant_user_memberships m "
                      "WHERE m.id = theses.student_membership_id AND m.tenant_id = theses.tenant_id "
                      "AND m.user_id = app_actor_id())")
    thesis_supervisor = ("EXISTS (SELECT 1 FROM student_eligibilities e "
                         "WHERE e.student_membership_id = theses.student_membership_id "
                         "AND e.review_batch_id = theses.review_batch_id AND e.tenant_id = theses.tenant_id "
                         "AND e.supervisor_membership_id IN (SELECT m.id FROM tenant_user_memberships m "
                         "WHERE m.tenant_id = theses.tenant_id AND m.user_id = app_actor_id()))")
    thesis_expert = ("EXISTS (SELECT 1 FROM expert_tasks task "
                     "WHERE task.thesis_id = theses.id AND task.tenant_id = theses.tenant_id "
                     "AND task.status IN ('INVITED', 'IN_REVIEW', 'SUBMITTED'))")
    thesis_read = (f"{platform} OR ({school} AND theses.tenant_id = app_tenant_id()) "
                   f"OR ({student} AND theses.tenant_id = app_tenant_id() AND {thesis_student}) "
                   f"OR ({supervisor} AND theses.tenant_id = app_tenant_id() "
                   f"AND theses.stage = 'COMPLETED' AND {thesis_supervisor}) "
                   f"OR ({expert} AND {thesis_expert})")
    _policy("theses", "theses_read", "SELECT", thesis_read)
    thesis_parents = ("EXISTS (SELECT 1 FROM tenant_user_memberships m WHERE "
                      "m.id = theses.student_membership_id AND m.tenant_id = theses.tenant_id "
                      "AND m.membership_type = 'STUDENT') "
                      "AND EXISTS (SELECT 1 FROM review_batches b WHERE "
                      "b.id = theses.review_batch_id AND b.tenant_id = theses.tenant_id)")
    thesis_write = (f"({thesis_parents} AND (({student} AND theses.tenant_id = app_tenant_id() "
                    f"AND {thesis_student}) OR ({school} AND theses.tenant_id = app_tenant_id()) "
                    f"OR {platform})) OR ({expert} AND {thesis_expert})")
    _policy("theses", "theses_insert", "INSERT",
            f"{thesis_parents} AND {student} AND theses.tenant_id = app_tenant_id() AND {thesis_student}")
    _policy("theses", "theses_update", "UPDATE", thesis_write)
    _policy("theses", "theses_delete", "DELETE",
            f"{student} AND theses.tenant_id = app_tenant_id() AND {thesis_student} AND theses.stage = 'DRAFT'")

    version_parent = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = thesis_versions.thesis_id "
                      "AND t.tenant_id = thesis_versions.tenant_id)")
    _policy("thesis_versions", "versions_read", "SELECT",
            f"{actor} AND app_role() IN ('student', 'school_reviewer', 'platform_reviewer', 'supervisor') "
            f"AND {version_parent}")
    _policy("thesis_versions", "versions_insert", "INSERT",
            f"{student} AND thesis_versions.tenant_id = app_tenant_id() AND {version_parent}")
    _policy("thesis_versions", "versions_update", "UPDATE",
            f"{student} AND thesis_versions.tenant_id = app_tenant_id() AND {version_parent}")
    _policy("thesis_versions", "versions_delete", "DELETE",
            f"{student} AND thesis_versions.tenant_id = app_tenant_id() AND {version_parent}")

    task_owner = ("EXISTS (SELECT 1 FROM experts e WHERE e.id = expert_tasks.expert_id "
                  "AND e.user_id = app_actor_id())")
    task_read = (f"{platform} OR ({school} AND expert_tasks.tenant_id = app_tenant_id()) "
                 f"OR ({expert} AND {task_owner})")
    _policy("expert_tasks", "tasks_read", "SELECT", task_read)
    _policy("expert_tasks", "tasks_insert", "INSERT",
            f"{platform} AND EXISTS (SELECT 1 FROM experts e WHERE e.id = expert_tasks.expert_id)")
    _policy("expert_tasks", "tasks_update", "UPDATE",
            f"{platform} OR ({expert} AND {task_owner})")

    round_thesis = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = review_rounds.thesis_id "
                    "AND t.tenant_id = review_rounds.tenant_id)")
    round_expert = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE task.round_id = review_rounds.id "
                    "AND task.thesis_id = review_rounds.thesis_id "
                    "AND task.tenant_id = review_rounds.tenant_id)")
    round_read = (f"({school} AND review_rounds.tenant_id = app_tenant_id()) OR {platform} "
                  f"OR (({student} OR {supervisor}) AND review_rounds.tenant_id = app_tenant_id() "
                  f"AND {round_thesis}) "
                  f"OR ({expert} AND {round_expert})")
    _policy("review_rounds", "rounds_read", "SELECT", round_read)
    round_write = (f"{round_thesis} AND (({school} AND review_rounds.tenant_id = app_tenant_id()) "
                   f"OR {platform})")
    _policy("review_rounds", "rounds_insert", "INSERT", round_write)
    _policy("review_rounds", "rounds_update", "UPDATE", round_write)
    student_cancel = f"{student} AND review_rounds.status = 'CREATED' AND {round_thesis}"
    _policy("review_rounds", "rounds_student_cancel", "UPDATE", student_cancel,
            f"{student} AND review_rounds.status = 'CANCELLED' AND {round_thesis}")

    file_student = (f"{student} AND file_objects.uploaded_by = app_actor_id() "
                    "AND file_objects.tenant_id = app_tenant_id()")
    file_expert = ("EXISTS (SELECT 1 FROM thesis_version_files l "
                   "JOIN review_rounds r ON r.thesis_version_id = l.thesis_version_id "
                   "JOIN expert_tasks task ON task.round_id = r.id "
                   "JOIN theses t ON t.id = r.thesis_id "
                   "WHERE l.file_id = file_objects.id AND l.purpose = 'anonymous' "
                   "AND task.thesis_id = file_objects.thesis_id "
                   "AND task.tenant_id = file_objects.tenant_id "
                   "AND task.status = 'IN_REVIEW' AND r.status = 'ACTIVE' "
                   "AND t.stage = 'UNDER_REVIEW' AND t.current_version_id = r.thesis_version_id)")
    file_read = (f"{file_student} OR ({school} AND file_objects.tenant_id = app_tenant_id()) "
                 f"OR ({platform} AND file_objects.purpose = 'anonymous') "
                 f"OR ({expert} AND file_objects.purpose = 'anonymous' AND {file_expert})")
    _policy("file_objects", "files_read", "SELECT", file_read)
    file_version = ("EXISTS (SELECT 1 FROM thesis_versions v WHERE "
                    "v.id = file_objects.upload_version_id AND v.thesis_id = file_objects.thesis_id "
                    "AND v.tenant_id = file_objects.tenant_id)")
    file_write = (f"{file_student} AND file_objects.thesis_id IS NOT NULL AND {file_version}")
    _policy("file_objects", "files_insert", "INSERT", file_write)
    _policy("file_objects", "files_update", "UPDATE",
            f"{file_student} AND (file_objects.upload_version_id IS NOT NULL "
            "OR file_objects.thesis_id IS NOT NULL)",
            f"{file_student} AND ((file_objects.upload_version_id IS NULL "
            f"AND file_objects.thesis_id IS NULL) OR "
            f"(file_objects.thesis_id IS NOT NULL AND {file_version}))")

    business = _business_role()
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT ON {', '.join(TABLES)} TO {business}")
        op.execute(f"GRANT INSERT, UPDATE ON {', '.join(TABLES)} TO {business}")
        op.execute(f"GRANT DELETE ON theses, thesis_versions TO {business}")


def downgrade() -> None:
    business = _business_role()
    op.execute("DROP TRIGGER legacy_file_detach_guard ON file_objects")
    op.execute("DROP FUNCTION guard_legacy_file_detach()")
    op.execute("DROP TRIGGER thesis_parent_guard ON theses")
    op.execute("DROP FUNCTION guard_thesis_parent_write()")
    op.execute("DROP TRIGGER eligibility_student_lock_guard ON student_eligibilities")
    op.execute("DROP FUNCTION guard_eligibility_write()")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    policies = {
        "student_eligibilities": ("eligibilities_read", "eligibilities_insert", "eligibilities_update",
                                  "eligibilities_student_lock"),
        "theses": ("theses_read", "theses_insert", "theses_update", "theses_delete"),
        "thesis_versions": ("versions_read", "versions_insert", "versions_update", "versions_delete"),
        "expert_tasks": ("tasks_read", "tasks_insert", "tasks_update"),
        "review_rounds": ("rounds_read", "rounds_insert", "rounds_update", "rounds_student_cancel"),
        "file_objects": ("files_read", "files_insert", "files_update"),
    }
    for table, names in policies.items():
        for name in names:
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    foreign_keys = (
        ("fk_theses_current_version_same_thesis", "theses"),
        ("fk_thesis_versions_thesis_tenant", "thesis_versions"),
        ("fk_review_rounds_thesis_tenant", "review_rounds"),
        ("fk_review_rounds_version_thesis_tenant", "review_rounds"),
        ("fk_expert_tasks_round_thesis_tenant", "expert_tasks"),
        ("fk_expert_tasks_replacement_same_round", "expert_tasks"),
        ("fk_file_objects_thesis_tenant", "file_objects"),
        ("fk_file_objects_version_thesis_tenant", "file_objects"),
    )
    for name, table in foreign_keys:
        op.drop_constraint(name, table, type_="foreignkey")
    op.drop_constraint("ck_file_objects_version_has_thesis", "file_objects", type_="check")
    for name, table in (
        ("uq_file_objects_id_thesis_tenant_purpose", "file_objects"),
        ("uq_expert_tasks_id_round_tenant", "expert_tasks"),
        ("uq_review_rounds_id_thesis_tenant", "review_rounds"),
        ("uq_thesis_versions_id_thesis_tenant", "thesis_versions"),
        ("uq_theses_id_tenant_id", "theses"),
    ):
        op.drop_constraint(name, table, type_="unique")
    op.drop_column("file_objects", "thesis_id")
    op.drop_column("expert_tasks", "thesis_id")
    op.drop_column("review_rounds", "anonymous_title")
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {business}")
