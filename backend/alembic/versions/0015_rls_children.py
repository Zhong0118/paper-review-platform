"""Protect file links, review inputs, and published result records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import make_url

from app.core.config import get_settings

revision = "0015_rls_children"
down_revision = "0014_rls_workflow"
branch_labels = None
depends_on = None

TABLES = ("thesis_version_files", "anonymization_checks", "review_drafts",
          "review_result_versions", "result_publications")


def _business_role() -> str | None:
    url = get_settings().business_database_url
    username = make_url(url).username if url else None
    return op.get_bind().dialect.identifier_preparer.quote(username) if username else None


def _policy(table: str, name: str, command: str, predicate: str) -> None:
    sql = f"CREATE POLICY {name} ON {table} FOR {command}"
    if command != "INSERT":
        sql += f" USING ({predicate})"
    if command in ("INSERT", "UPDATE"):
        sql += f" WITH CHECK ({predicate})"
    op.execute(sql)


def _audit_old_links() -> None:
    # Owner can audit both original and anonymous files only while FORCE is lifted.
    # The DDL and audit run in this one migration transaction and roll back together.
    for table in ("file_objects", "thesis_versions"):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    try:
        bad = op.get_bind().execute(sa.text("""
            SELECT EXISTS (
                SELECT 1 FROM thesis_version_files l
                LEFT JOIN thesis_versions v ON v.id = l.thesis_version_id
                LEFT JOIN file_objects f ON f.id = l.file_id
                WHERE v.id IS NULL OR f.id IS NULL
                   OR f.thesis_id IS DISTINCT FROM v.thesis_id
                   OR f.tenant_id IS DISTINCT FROM v.tenant_id
                   OR f.purpose IS DISTINCT FROM l.purpose
            )
        """)).scalar_one()
        if bad:
            raise ValueError("0015 preflight rejected inconsistent file link")
    finally:
        for table in ("file_objects", "thesis_versions"):
            op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def upgrade() -> None:
    op.execute("SELECT set_config('app.role', 'platform_reviewer', true)")
    op.execute("SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true)")
    _audit_old_links()
    op.add_column("thesis_version_files", sa.Column("thesis_id", sa.Uuid()))
    op.add_column("thesis_version_files", sa.Column("tenant_id", sa.Uuid()))
    op.execute("""
        UPDATE thesis_version_files l SET thesis_id = v.thesis_id, tenant_id = v.tenant_id
        FROM thesis_versions v WHERE v.id = l.thesis_version_id
    """)
    op.alter_column("thesis_version_files", "thesis_id", nullable=False)
    op.alter_column("thesis_version_files", "tenant_id", nullable=False)
    op.create_foreign_key("fk_version_files_version_thesis_tenant", "thesis_version_files",
                          "thesis_versions", ["thesis_version_id", "thesis_id", "tenant_id"],
                          ["id", "thesis_id", "tenant_id"])
    # Validation must see original files too; the owner is subject to FORCE RLS
    # and the platform policy exposes only anonymous files. Transactional DDL
    # restores FORCE automatically if the constraint cannot be created.
    op.execute("ALTER TABLE file_objects NO FORCE ROW LEVEL SECURITY")
    op.create_foreign_key("fk_version_files_file_thesis_tenant_purpose", "thesis_version_files",
                          "file_objects", ["file_id", "thesis_id", "tenant_id", "purpose"],
                          ["id", "thesis_id", "tenant_id", "purpose"])
    op.execute("ALTER TABLE file_objects FORCE ROW LEVEL SECURITY")

    op.add_column("review_result_versions", sa.Column("round_id", sa.Uuid()))
    op.add_column("review_result_versions", sa.Column("tenant_id", sa.Uuid()))
    op.execute("""
        UPDATE review_result_versions r SET round_id = task.round_id,
            tenant_id = task.tenant_id
        FROM expert_tasks task WHERE task.id = r.task_id
    """)
    op.alter_column("review_result_versions", "round_id", nullable=False)
    op.alter_column("review_result_versions", "tenant_id", nullable=False)
    op.create_foreign_key("fk_review_results_task_round_tenant", "review_result_versions",
                          "expert_tasks", ["task_id", "round_id", "tenant_id"],
                          ["id", "round_id", "tenant_id"])

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    actor = "app_actor_id() IS NOT NULL"
    student = f"{actor} AND app_role() = 'student'"
    school = f"{actor} AND app_role() = 'school_reviewer'"
    platform = f"{actor} AND app_role() = 'platform_reviewer'"
    expert = f"{actor} AND app_role() = 'expert'"
    supervisor = f"{actor} AND app_role() = 'supervisor'"

    link_version = ("EXISTS (SELECT 1 FROM thesis_versions v WHERE "
                    "v.id = thesis_version_files.thesis_version_id "
                    "AND v.thesis_id = thesis_version_files.thesis_id "
                    "AND v.tenant_id = thesis_version_files.tenant_id)")
    link_expert = ("EXISTS (SELECT 1 FROM review_rounds r "
                   "JOIN expert_tasks task ON task.round_id = r.id "
                   "JOIN theses t ON t.id = r.thesis_id "
                   "WHERE r.thesis_version_id = thesis_version_files.thesis_version_id "
                   "AND r.thesis_id = thesis_version_files.thesis_id "
                   "AND r.tenant_id = thesis_version_files.tenant_id "
                   "AND task.thesis_id = r.thesis_id AND task.tenant_id = r.tenant_id "
                   "AND task.status = 'IN_REVIEW' AND r.status = 'ACTIVE' "
                   "AND t.tenant_id = r.tenant_id AND t.stage = 'UNDER_REVIEW' "
                   "AND t.current_version_id = r.thesis_version_id)")
    link_read = (f"({actor} AND app_role() IN ('student', 'school_reviewer') "
                 f"AND thesis_version_files.tenant_id = app_tenant_id() AND {link_version}) "
                 f"OR ({platform} AND thesis_version_files.purpose = 'anonymous' "
                 f"AND {link_version}) OR ({expert} "
                 "AND thesis_version_files.purpose = 'anonymous' "
                 f"AND {link_expert})")
    _policy("thesis_version_files", "links_read", "SELECT", link_read)
    link_student_write = (f"{student} AND thesis_version_files.tenant_id = app_tenant_id() "
                          f"AND {link_version}")
    _policy("thesis_version_files", "links_insert", "INSERT", link_student_write)
    _policy("thesis_version_files", "links_update", "UPDATE", link_student_write)
    _policy("thesis_version_files", "links_delete", "DELETE", link_student_write)

    check_version = ("EXISTS (SELECT 1 FROM thesis_versions v WHERE "
                     "v.id = anonymization_checks.thesis_version_id)")
    check_read = (f"{actor} AND app_role() IN "
                  f"('student', 'school_reviewer', 'platform_reviewer') AND {check_version}")
    _policy("anonymization_checks", "checks_read", "SELECT", check_read)
    _policy("anonymization_checks", "checks_insert", "INSERT",
            f"{student} AND {check_version}")
    _policy("anonymization_checks", "checks_update", "UPDATE",
            f"{school} AND {check_version}")

    draft_task = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                  "task.id = review_drafts.task_id)")
    draft_write = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                   "task.id = review_drafts.task_id AND task.status = 'IN_REVIEW')")
    _policy("review_drafts", "drafts_read", "SELECT", f"{expert} AND {draft_task}")
    _policy("review_drafts", "drafts_insert", "INSERT", f"{expert} AND {draft_write}")
    _policy("review_drafts", "drafts_update", "UPDATE", f"{expert} AND {draft_write}")

    result_task = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                   "task.id = review_result_versions.task_id "
                   "AND task.round_id = review_result_versions.round_id "
                   "AND task.tenant_id = review_result_versions.tenant_id)")
    result_published = ("EXISTS (SELECT 1 FROM result_summaries s WHERE "
                        "s.round_id = review_result_versions.round_id "
                        "AND s.tenant_id = review_result_versions.tenant_id "
                        "AND s.result_task_ids @> jsonb_build_array(review_result_versions.task_id::text))")
    result_read = (f"({expert} AND {result_task}) OR "
                   f"({school} AND review_result_versions.tenant_id = app_tenant_id() "
                   f"AND {result_task}) OR "
                   f"(({student} OR {supervisor}) AND review_result_versions.is_current "
                   f"AND review_result_versions.tenant_id = app_tenant_id() "
                   f"AND {result_published})")
    _policy("review_result_versions", "results_read", "SELECT", result_read)
    result_write = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                    "task.id = review_result_versions.task_id "
                    "AND task.round_id = review_result_versions.round_id "
                    "AND task.tenant_id = review_result_versions.tenant_id "
                    "AND task.status = 'IN_REVIEW')")
    _policy("review_result_versions", "results_insert", "INSERT",
            f"{expert} AND {result_write}")
    _policy("review_result_versions", "results_update", "UPDATE",
            f"{expert} AND {result_write}")

    publication_summary = ("EXISTS (SELECT 1 FROM result_summaries s WHERE "
                           "s.id = result_publications.summary_id)")
    publication_school = (f"{school} AND EXISTS (SELECT 1 FROM result_summaries s "
                          "JOIN theses t ON t.id = s.thesis_id WHERE "
                          "s.id = result_publications.summary_id "
                          "AND s.tenant_id = app_tenant_id() "
                          "AND t.tenant_id = s.tenant_id AND t.stage = 'COMPLETED')")
    _policy("result_publications", "publications_read", "SELECT",
            f"{publication_school} OR (({student} OR {supervisor}) "
            f"AND {publication_summary})")
    _policy("result_publications", "publications_insert", "INSERT",
            f"{publication_school} AND result_publications.published_by = app_actor_id()")

    business = _business_role()
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT ON {', '.join(TABLES)} TO {business}")
        op.execute(f"GRANT UPDATE ON thesis_version_files, anonymization_checks, "
                   f"review_drafts, review_result_versions TO {business}")
        op.execute(f"GRANT DELETE ON thesis_version_files TO {business}")


def downgrade() -> None:
    business = _business_role()
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    policies = {
        "thesis_version_files": ("links_read", "links_insert", "links_update", "links_delete"),
        "anonymization_checks": ("checks_read", "checks_insert", "checks_update"),
        "review_drafts": ("drafts_read", "drafts_insert", "drafts_update"),
        "review_result_versions": ("results_read", "results_insert", "results_update"),
        "result_publications": ("publications_read", "publications_insert"),
    }
    for table, names in policies.items():
        for name in names:
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    op.drop_constraint("fk_version_files_version_thesis_tenant", "thesis_version_files",
                       type_="foreignkey")
    op.drop_constraint("fk_version_files_file_thesis_tenant_purpose", "thesis_version_files",
                       type_="foreignkey")
    op.drop_constraint("fk_review_results_task_round_tenant", "review_result_versions",
                       type_="foreignkey")
    op.drop_column("review_result_versions", "tenant_id")
    op.drop_column("review_result_versions", "round_id")
    op.drop_column("thesis_version_files", "tenant_id")
    op.drop_column("thesis_version_files", "thesis_id")
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {business}")
