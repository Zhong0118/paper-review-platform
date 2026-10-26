"""Protect result summaries, objections, and thesis workflow records."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import make_url

from app.core.config import get_settings

revision = "0014_rls_workflow"
down_revision = "0013_rls_core"
branch_labels = None
depends_on = None

TABLES = ("result_summaries", "objections", "workflow_events", "termination_records")


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


def _audit_old_rows() -> None:
    checks = {
        "result summary": """
            SELECT 1 FROM result_summaries s
            LEFT JOIN theses t ON t.id = s.thesis_id
            LEFT JOIN review_rounds r ON r.id = s.round_id
            WHERE t.tenant_id IS DISTINCT FROM s.tenant_id
               OR r.thesis_id IS DISTINCT FROM s.thesis_id
               OR r.tenant_id IS DISTINCT FROM s.tenant_id
        """,
        "objection": """
            SELECT 1 FROM objections o
            LEFT JOIN theses t ON t.id = o.thesis_id
            LEFT JOIN tenant_user_memberships m ON m.id = o.student_membership_id
            WHERE t.tenant_id IS DISTINCT FROM o.tenant_id
               OR t.student_membership_id IS DISTINCT FROM o.student_membership_id
               OR m.tenant_id IS DISTINCT FROM o.tenant_id
        """,
        "workflow event": """
            SELECT 1 FROM workflow_events e LEFT JOIN theses t ON t.id = e.thesis_id
            WHERE t.tenant_id IS DISTINCT FROM e.tenant_id
        """,
        "termination record": """
            SELECT 1 FROM termination_records r LEFT JOIN theses t ON t.id = r.thesis_id
            WHERE t.tenant_id IS DISTINCT FROM r.tenant_id
        """,
    }
    conn = op.get_bind()
    for name, query in checks.items():
        if conn.execute(sa.text(f"SELECT EXISTS ({query})")).scalar_one():
            raise ValueError(f"0014 preflight rejected inconsistent {name}")


def upgrade() -> None:
    # Earlier FORCE RLS protects the parents read during this migration's audit.
    op.execute("SELECT set_config('app.role', 'platform_reviewer', true)")
    op.execute("SELECT set_config('app.user_id', '00000000-0000-0000-0000-000000000001', true)")
    _audit_old_rows()
    op.create_unique_constraint("uq_memberships_id_tenant_for_objections",
                                "tenant_user_memberships", ["id", "tenant_id"])
    foreign_keys = (
        ("fk_result_summaries_thesis_tenant", "result_summaries", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_result_summaries_round_thesis_tenant", "result_summaries", "review_rounds",
         ["round_id", "thesis_id", "tenant_id"], ["id", "thesis_id", "tenant_id"]),
        ("fk_objections_thesis_tenant", "objections", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_objections_member_tenant", "objections", "tenant_user_memberships",
         ["student_membership_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_workflow_events_thesis_tenant", "workflow_events", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
        ("fk_termination_records_thesis_tenant", "termination_records", "theses",
         ["thesis_id", "tenant_id"], ["id", "tenant_id"]),
    )
    for name, table, parent, local, remote in foreign_keys:
        op.create_foreign_key(name, table, parent, local, remote)
    op.execute("""
        CREATE FUNCTION guard_workflow_parent_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF (OLD.tenant_id, OLD.thesis_id) IS DISTINCT FROM
               (NEW.tenant_id, NEW.thesis_id)
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'workflow parent is immutable' USING ERRCODE = '42501';
            END IF;
            IF TG_TABLE_NAME = 'objections'
               AND (to_jsonb(OLD)->'student_membership_id') IS DISTINCT FROM
                   (to_jsonb(NEW)->'student_membership_id')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'objection student is immutable' USING ERRCODE = '42501';
            END IF;
            IF TG_TABLE_NAME = 'result_summaries'
               AND (to_jsonb(OLD)->'round_id') IS DISTINCT FROM
                   (to_jsonb(NEW)->'round_id')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user
                               AND (rolsuper OR rolbypassrls)) THEN
                RAISE EXCEPTION 'summary round is immutable' USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    for table in ("result_summaries", "objections"):
        op.execute(f"CREATE TRIGGER {table}_parent_guard BEFORE UPDATE ON {table} "
                   "FOR EACH ROW EXECUTE FUNCTION guard_workflow_parent_write()")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    actor = "app_actor_id() IS NOT NULL"
    school = f"{actor} AND app_role() = 'school_reviewer'"
    platform = f"{actor} AND app_role() = 'platform_reviewer'"
    student = f"{actor} AND app_role() = 'student'"
    supervisor = f"{actor} AND app_role() = 'supervisor'"
    expert = f"{actor} AND app_role() = 'expert'"

    summary_thesis = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = result_summaries.thesis_id "
                      "AND t.tenant_id = result_summaries.tenant_id)")
    summary_expert = ("EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                      "task.round_id = result_summaries.round_id "
                      "AND task.thesis_id = result_summaries.thesis_id "
                      "AND task.tenant_id = result_summaries.tenant_id "
                      "AND task.status = 'SUBMITTED')")
    summary_open = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = result_summaries.thesis_id "
                    "AND t.tenant_id = result_summaries.tenant_id "
                    "AND t.stage IN ('UNDER_REVIEW', 'RESULT_PROCESSING'))")
    summary_read = (f"({school} AND result_summaries.tenant_id = app_tenant_id() "
                    f"AND {summary_thesis}) OR "
                    f"(({student} OR {supervisor}) AND "
                    f"result_summaries.tenant_id = app_tenant_id() "
                    "AND EXISTS (SELECT 1 FROM theses t WHERE t.id = result_summaries.thesis_id "
                    "AND t.tenant_id = result_summaries.tenant_id AND t.stage = 'COMPLETED')) "
                    f"OR ({expert} AND {summary_expert} AND {summary_open})")
    _policy("result_summaries", "summaries_read", "SELECT", summary_read)
    summary_school_write = (f"{school} AND result_summaries.tenant_id = app_tenant_id() "
                            f"AND {summary_thesis} AND {summary_open}")
    summary_expert_write = f"{expert} AND {summary_expert} AND {summary_open}"
    summary_expert_update = (f"{expert} AND {summary_expert} AND "
                             "EXISTS (SELECT 1 FROM theses t WHERE "
                             "t.id = result_summaries.thesis_id "
                             "AND t.tenant_id = result_summaries.tenant_id "
                             "AND t.stage = 'UNDER_REVIEW')")
    summary_round = ("EXISTS (SELECT 1 FROM review_rounds r WHERE "
                     "r.id = result_summaries.round_id "
                     "AND r.thesis_id = result_summaries.thesis_id "
                     "AND r.tenant_id = result_summaries.tenant_id)")
    _policy("result_summaries", "summaries_insert", "INSERT",
            f"({summary_school_write} OR {summary_expert_write}) AND {summary_round}")
    _policy("result_summaries", "summaries_update", "UPDATE",
            f"({summary_school_write} OR {summary_expert_update}) AND {summary_round}")

    objection_parent = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = objections.thesis_id "
                        "AND t.tenant_id = objections.tenant_id "
                        "AND t.student_membership_id = objections.student_membership_id)")
    objection_student = (f"{student} AND objections.tenant_id = app_tenant_id() "
                         f"AND {objection_parent}")
    objection_school = (f"{school} AND objections.tenant_id = app_tenant_id() "
                        f"AND {objection_parent}")
    _policy("objections", "objections_read", "SELECT",
            f"{objection_student} OR {objection_school}")
    _policy("objections", "objections_insert", "INSERT",
            f"{objection_student} AND objections.status = 'SUBMITTED' "
            "AND EXISTS (SELECT 1 FROM theses t WHERE t.id = objections.thesis_id "
            "AND t.tenant_id = objections.tenant_id AND t.stage = 'COMPLETED')")
    _policy("objections", "objections_update", "UPDATE", objection_school)

    event_parent = ("EXISTS (SELECT 1 FROM theses t WHERE t.id = workflow_events.thesis_id "
                    "AND t.tenant_id = workflow_events.tenant_id)")
    event_student = (f"{student} AND workflow_events.tenant_id = app_tenant_id() "
                     f"AND {event_parent}")
    event_school = (f"{school} AND workflow_events.tenant_id = app_tenant_id() "
                    f"AND {event_parent}")
    event_expert = (f"{expert} AND workflow_events.actor_id = app_actor_id() "
                    "AND workflow_events.action = 'results_ready' "
                    "AND EXISTS (SELECT 1 FROM expert_tasks task WHERE "
                    "task.thesis_id = workflow_events.thesis_id "
                    "AND task.tenant_id = workflow_events.tenant_id "
                    "AND task.status = 'SUBMITTED')")
    # SQLAlchemy INSERT ... RETURNING requires SELECT visibility for the inserted row.
    _policy("workflow_events", "events_read", "SELECT",
            f"{platform} OR {event_school} OR {event_student} OR {event_expert}")
    _policy("workflow_events", "events_insert", "INSERT",
            f"{actor} AND workflow_events.actor_id = app_actor_id() "
            f"AND (({event_student} AND workflow_events.action IN "
            "('submit', 'start_anonymization', 'withdraw')) "
            f"OR {event_school} OR ({platform} AND {event_parent}) OR {event_expert})")

    termination_school = (f"{school} AND termination_records.tenant_id = app_tenant_id() "
                          "AND EXISTS (SELECT 1 FROM theses t WHERE "
                          "t.id = termination_records.thesis_id "
                          "AND t.tenant_id = termination_records.tenant_id)")
    _policy("termination_records", "terminations_read", "SELECT", termination_school)
    _policy("termination_records", "terminations_insert", "INSERT",
            f"{termination_school} AND termination_records.actor_id = app_actor_id()")

    business = _business_role()
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT ON {', '.join(TABLES)} TO {business}")
        op.execute(f"GRANT INSERT ON {', '.join(TABLES)} TO {business}")
        op.execute(f"GRANT UPDATE ON result_summaries, objections TO {business}")


def downgrade() -> None:
    business = _business_role()
    for table in ("result_summaries", "objections"):
        op.execute(f"DROP TRIGGER {table}_parent_guard ON {table}")
    op.execute("DROP FUNCTION guard_workflow_parent_write()")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    policies = {
        "result_summaries": ("summaries_read", "summaries_insert", "summaries_update"),
        "objections": ("objections_read", "objections_insert", "objections_update"),
        "workflow_events": ("events_read", "events_insert"),
        "termination_records": ("terminations_read", "terminations_insert"),
    }
    for table, names in policies.items():
        for name in names:
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    for name, table in (
        ("fk_result_summaries_thesis_tenant", "result_summaries"),
        ("fk_result_summaries_round_thesis_tenant", "result_summaries"),
        ("fk_objections_thesis_tenant", "objections"),
        ("fk_objections_member_tenant", "objections"),
        ("fk_workflow_events_thesis_tenant", "workflow_events"),
        ("fk_termination_records_thesis_tenant", "termination_records"),
    ):
        op.drop_constraint(name, table, type_="foreignkey")
    op.drop_constraint("uq_memberships_id_tenant_for_objections",
                       "tenant_user_memberships", type_="unique")
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {business}")
