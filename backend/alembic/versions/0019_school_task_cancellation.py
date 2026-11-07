"""Allow a school to cancel its own unfinished tasks after terminating a thesis."""

from alembic import op


revision = "0019_school_task_cancellation"
down_revision = "0018_round_rule_snapshot"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE POLICY tasks_school_cancel ON expert_tasks FOR UPDATE
        USING (
            app_actor_id() IS NOT NULL AND app_role() = 'school_reviewer'
            AND tenant_id = app_tenant_id()
            AND status IN ('INVITED', 'IN_REVIEW')
        )
        WITH CHECK (
            app_actor_id() IS NOT NULL AND app_role() = 'school_reviewer'
            AND tenant_id = app_tenant_id() AND status = 'CANCELLED'
        )
    """)
    op.execute("""
        CREATE FUNCTION guard_school_task_cancellation() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        DECLARE thesis_terminated boolean;
        BEGIN
            IF current_setting('app.role', true) = 'school_reviewer' THEN
                IF OLD.status NOT IN ('INVITED', 'IN_REVIEW')
                   OR NEW.status <> 'CANCELLED'
                   OR NEW.version <> OLD.version + 1
                   OR (to_jsonb(NEW) - 'status' - 'version' - 'updated_at')
                      IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'version' - 'updated_at') THEN
                    RAISE EXCEPTION 'school may only cancel an unfinished task'
                        USING ERRCODE = '42501';
                END IF;
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.theses WHERE id = $1 '
                               'AND tenant_id = $2 AND stage = ''TERMINATED'')', TG_TABLE_SCHEMA)
                    INTO thesis_terminated USING OLD.thesis_id, OLD.tenant_id;
                IF NOT thesis_terminated THEN
                    RAISE EXCEPTION 'school may only cancel a terminated thesis task'
                        USING ERRCODE = '42501';
                END IF;
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER school_task_cancellation_guard BEFORE UPDATE ON expert_tasks
        FOR EACH ROW EXECUTE FUNCTION guard_school_task_cancellation()
    """)


def downgrade():
    op.execute("DROP TRIGGER school_task_cancellation_guard ON expert_tasks")
    op.execute("DROP FUNCTION guard_school_task_cancellation()")
    op.execute("DROP POLICY tasks_school_cancel ON expert_tasks")
