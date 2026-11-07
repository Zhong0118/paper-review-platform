"""Allow an exact frozen-version clone only during a school's manual return."""
from alembic import op
from sqlalchemy import text

revision = '0029_school_return_clone'
down_revision = '0028_school_programs'
branch_labels = depends_on = None

COPY_TABLES = ('thesis_versions', 'thesis_version_files', 'thesis_program_choices')


def upgrade():
    conn = op.get_bind()
    quote = conn.dialect.identifier_preparer.quote
    schema = quote(conn.scalar(text('SELECT current_schema()')))
    owner = quote(conn.scalar(text('SELECT current_user')))
    # Only the migration owner (the trigger's identity), never the business role.
    school = ("app_role()='school_reviewer' AND app_actor_id() IS NOT NULL "
              "AND tenant_id=app_tenant_id() AND pg_trigger_depth()>0")
    for table in COPY_TABLES:
        op.execute(f'CREATE POLICY school_return_copy ON {table} FOR INSERT TO {owner} WITH CHECK ({school})')
    # 0028 allowed a reviewer to copy a prior choice directly; now only the trigger needs that path.
    op.execute("""CREATE POLICY choice_return_only ON thesis_program_choices AS RESTRICTIVE FOR INSERT
        WITH CHECK (app_role() IS DISTINCT FROM 'school_reviewer' OR
            (pg_trigger_depth()>0 AND current_user::regrole=(
                SELECT relowner FROM pg_catalog.pg_class WHERE oid='thesis_program_choices'::regclass)))""")

    op.execute(f"""CREATE FUNCTION clone_on_school_return() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE clone_id uuid := gen_random_uuid();
        BEGIN
          IF OLD.tenant_id IS DISTINCT FROM app_tenant_id() OR app_actor_id() IS NULL
             OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
             OR NEW.version <> OLD.version+1 OR nullif(btrim(NEW.return_reason),'') IS NULL
             OR NOT EXISTS (
                 SELECT 1 FROM workflow_events e WHERE e.thesis_id=OLD.id AND e.tenant_id=OLD.tenant_id
                 AND e.actor_id=app_actor_id() AND e.action='reject_anonymization'
                 AND e.from_stage=OLD.stage AND e.to_stage=NEW.stage AND e.reason=NEW.return_reason
                 AND e.payload->>'source_version_id'=OLD.current_version_id::text
                 AND e.xmin=pg_current_xact_id()::xid
             ) THEN RAISE EXCEPTION 'school return requires the current rejection event' USING ERRCODE='42501';
          END IF;
          INSERT INTO thesis_versions
            (id,thesis_id,tenant_id,version_no,title,abstract,discipline_code,discipline_name,keywords,is_editable)
            SELECT clone_id,v.thesis_id,v.tenant_id,v.version_no+1,v.title,v.abstract,v.discipline_code,
                   v.discipline_name,v.keywords,true FROM thesis_versions v
            WHERE v.id=OLD.current_version_id AND v.thesis_id=OLD.id AND v.tenant_id=OLD.tenant_id
              AND NOT v.is_editable AND v.submitted_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM thesis_versions newer
                              WHERE newer.thesis_id=v.thesis_id AND newer.version_no>v.version_no);
          IF NOT FOUND THEN RAISE EXCEPTION 'school return requires a frozen version' USING ERRCODE='42501'; END IF;
          INSERT INTO thesis_version_files(id,thesis_version_id,thesis_id,tenant_id,file_id,purpose)
            SELECT gen_random_uuid(),clone_id,thesis_id,tenant_id,file_id,purpose FROM thesis_version_files
            WHERE thesis_version_id=OLD.current_version_id AND thesis_id=OLD.id AND tenant_id=OLD.tenant_id;
          INSERT INTO thesis_program_choices(id,version_id,thesis_id,tenant_id,catalog_id,code)
            SELECT gen_random_uuid(),clone_id,thesis_id,tenant_id,catalog_id,code FROM thesis_program_choices
            WHERE version_id=OLD.current_version_id AND thesis_id=OLD.id AND tenant_id=OLD.tenant_id;
          NEW.current_version_id := clone_id;
          RETURN NEW;
        END $$""")
    op.execute('REVOKE ALL ON FUNCTION clone_on_school_return() FROM PUBLIC')
    op.execute("""CREATE TRIGGER school_return_clone BEFORE UPDATE OF stage ON theses FOR EACH ROW
        WHEN (app_role()='school_reviewer' AND OLD.stage='PREPARING' AND NEW.stage='DRAFT')
        EXECUTE FUNCTION clone_on_school_return()""")


def downgrade():
    op.execute('DROP TRIGGER school_return_clone ON theses')
    op.execute('DROP FUNCTION clone_on_school_return()')
    op.execute('DROP POLICY choice_return_only ON thesis_program_choices')
    for table in COPY_TABLES:
        op.execute(f'DROP POLICY school_return_copy ON {table}')
