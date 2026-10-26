"""Freeze the known single-expert pilot rule; refuse ambiguous historical rows."""
import json
from uuid import UUID

from alembic import op
import sqlalchemy as sa

revision = "0018_round_rule_snapshot"
down_revision = "0017_expert_management"
branch_labels = None
depends_on = None

# Deliberately self-contained: future application defaults cannot change migration history.
RULE = {'version': 'pilot-single-v1',
 'required_experts': 1,
 'mode': 'sum_dimensions',
 'dimensions': [{'key': 'topicValue', 'label': '选题价值', 'max_score': 15},
                {'key': 'literatureTheory', 'label': '文献与理论基础', 'max_score': 15},
                {'key': 'methodology', 'label': '研究方法', 'max_score': 20},
                {'key': 'innovation', 'label': '创新性', 'max_score': 25},
                {'key': 'writingStandards', 'label': '写作与学术规范', 'max_score': 10},
                {'key': 'resultsWorkload', 'label': '研究成果与工作量', 'max_score': 15}],
 'bands': [{'min': 0, 'max': 59, 'code': 'FAIL', 'label': '不通过'},
           {'min': 60, 'max': 79, 'code': 'REVISION_REQUIRED', 'label': '修改后通过'},
           {'min': 80, 'max': 100, 'code': 'PASS', 'label': '通过'}]}
TABLES = ("review_rounds", "expert_tasks", "review_result_versions", "result_summaries")


def _canonical(value):
    return json.dumps(value, sort_keys=True, allow_nan=False)


def _preflight(conn):
    errors = []
    dimensions = {d["key"]: d["max_score"] for d in RULE["dimensions"]}
    tasks = {str(r["id"]): r for r in conn.execute(sa.text("SELECT * FROM expert_tasks")).mappings()}
    occupied = {}
    for task in tasks.values():
        if task["status"] in ("INVITED", "IN_REVIEW", "SUBMITTED"):
            occupied[task["round_id"]] = occupied.get(task["round_id"], 0) + 1
    errors.extend(f"round:{key}:multiple-seats" for key, count in occupied.items() if count > 1)
    results = list(conn.execute(sa.text("SELECT * FROM review_result_versions")).mappings())
    for result in results:
        scores = result["scores"]
        if (not isinstance(scores, dict) or set(scores) != set(dimensions)
                or any(type(scores[k]) is not int or not 0 <= scores[k] <= dimensions[k] for k in dimensions)
                or sum(scores.values()) != result["total"]):
            errors.append(f"result:{result['id']}:invalid-scores-or-total")
    legacy = {"required_experts": 1, "mode": "sum_dimensions"}
    for summary in conn.execute(sa.text("SELECT * FROM result_summaries")).mappings():
        ids = summary["result_task_ids"]
        if _canonical(summary["rule_snapshot"]) not in (_canonical(legacy), _canonical(RULE)):
            errors.append(f"summary:{summary['id']}:unknown-rule")
        try:
            valid_ids = isinstance(ids, list) and len(ids) == 1 and str(UUID(ids[0])) == ids[0]
        except (ValueError, TypeError, AttributeError):
            valid_ids = False
        task = tasks.get(ids[0]) if valid_ids else None
        rows = [r for r in results if task and r["task_id"] == task["id"] and r["is_current"]]
        if (not task or task["status"] != "SUBMITTED"
                or task["round_id"] != summary["round_id"]
                or task["tenant_id"] != summary["tenant_id"]
                or task["thesis_id"] != summary["thesis_id"]
                or len(rows) != 1 or rows[0]["total"] != summary["total"]):
            errors.append(f"summary:{summary['id']}:invalid-result-set")
    if errors:
        raise ValueError(f"0018 preflight: {len(errors)} anomalies; " + "; ".join(errors[:20]))


def upgrade():
    conn = op.get_bind()
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    _preflight(conn)
    op.add_column("review_rounds", sa.Column("rule_snapshot", sa.dialects.postgresql.JSONB(), nullable=True))
    encoded = json.dumps(RULE, ensure_ascii=False)
    for table in ("review_rounds", "result_summaries"):
        conn.execute(sa.text(f"UPDATE {table} SET rule_snapshot=CAST(:rule AS jsonb)"), {"rule": encoded})
    op.alter_column("review_rounds", "rule_snapshot", nullable=False)
    # JSONB numeric equality treats 1 and 1.0 alike; canonical text also fixes representation.
    op.create_check_constraint("ck_summary_pilot_rule", "result_summaries",
                               f"rule_snapshot::text = ('{encoded}'::jsonb)::text")
    op.execute(f"""
        CREATE FUNCTION guard_round_rule_snapshot() RETURNS trigger
        LANGUAGE plpgsql SET search_path=pg_catalog AS $$
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW.rule_snapshot::text IS DISTINCT FROM OLD.rule_snapshot::text THEN
                RAISE EXCEPTION 'round rule snapshot is immutable' USING ERRCODE='23514';
            END IF;
            IF NEW.rule_snapshot::text IS DISTINCT FROM ('{encoded}'::jsonb)::text THEN
                RAISE EXCEPTION 'unsupported round rule snapshot' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""CREATE TRIGGER round_rule_snapshot_guard BEFORE INSERT OR UPDATE
        ON review_rounds FOR EACH ROW EXECUTE FUNCTION guard_round_rule_snapshot()""")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")


def downgrade():
    for table in ("review_rounds", "result_summaries"):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    if op.get_bind().scalar(sa.text("SELECT EXISTS(SELECT 1 FROM review_rounds) OR EXISTS(SELECT 1 FROM result_summaries)")):
        raise ValueError("0018 downgrade requires empty rounds and summaries")
    op.execute("DROP TRIGGER round_rule_snapshot_guard ON review_rounds")
    op.execute("DROP FUNCTION guard_round_rule_snapshot()")
    op.drop_constraint("ck_summary_pilot_rule", "result_summaries", type_="check")
    op.drop_column("review_rounds", "rule_snapshot")
    for table in ("review_rounds", "result_summaries"):
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
