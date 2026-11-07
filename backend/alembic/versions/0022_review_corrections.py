"""Append-only corrections, private notes, and narrowly guarded school activation."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0022_review_corrections'
down_revision = '0021_publication_snapshots'
branch_labels = depends_on = None
TABLES = ('review_correction_requests', 'review_correction_notes', 'review_result_revisions')


def base():
    return [sa.Column('id', sa.Uuid(), primary_key=True),
            sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())]


def policy(table, name, command, predicate, check=None):
    sql = f'CREATE POLICY {name} ON {table} FOR {command}'
    if command != 'INSERT': sql += f' USING ({predicate})'
    if command in ('INSERT', 'UPDATE'): sql += f' WITH CHECK ({check or predicate})'
    op.execute(sql)


def upgrade():
    op.create_table('review_correction_requests', *base(),
        *[sa.Column(x, sa.Uuid(), nullable=False) for x in ('task_id', 'round_id', 'tenant_id')],
        sa.Column('base_result_id', sa.Uuid(), sa.ForeignKey('review_result_versions.id'), nullable=False),
        sa.Column('base_revision_id', sa.Uuid(), nullable=True),
        sa.Column('requested_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('decided_by', sa.Uuid(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('status', sa.String(32), nullable=False),
        sa.Column('version', sa.Integer(), nullable=False),
        sa.Column('draft_payload', JSONB(), nullable=False),
        sa.UniqueConstraint('id', 'task_id', 'round_id', 'tenant_id', name='uq_correction_parent'),
        sa.ForeignKeyConstraint(['task_id', 'round_id', 'tenant_id'],
            ['expert_tasks.id', 'expert_tasks.round_id', 'expert_tasks.tenant_id'], name='fk_correction_task'),
        sa.CheckConstraint("status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED','AWAITING_SCHOOL','ACTIVATED','SCHOOL_REJECTED')"),
        sa.CheckConstraint('version >= 1'))
    op.create_index('uq_correction_open_task', 'review_correction_requests', ['task_id'], unique=True,
                    postgresql_where=sa.text("status IN ('REQUESTED','APPROVED','AWAITING_SCHOOL')"))
    op.create_table('review_correction_notes', *base(),
        sa.Column('request_id', sa.Uuid(), sa.ForeignKey('review_correction_requests.id'), nullable=False),
        sa.Column('author_id', sa.Uuid(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('note_kind', sa.String(32), nullable=False),
        sa.Column('reason', sa.String(2000), nullable=False),
        sa.CheckConstraint("note_kind IN ('EXPERT_REQUEST','PLATFORM_DECISION','SCHOOL_DECISION')"),
        sa.CheckConstraint('length(trim(reason)) BETWEEN 1 AND 2000'))
    op.create_table('review_result_revisions', *base(),
        *[sa.Column(x, sa.Uuid(), nullable=False) for x in ('request_id', 'task_id', 'round_id', 'tenant_id')],
        sa.Column('base_result_id', sa.Uuid(), sa.ForeignKey('review_result_versions.id'), nullable=False),
        sa.Column('revision_no', sa.Integer(), nullable=False),
        sa.Column('scores', JSONB(), nullable=False), sa.Column('comments', JSONB(), nullable=False),
        sa.Column('total', sa.Integer(), nullable=False), sa.Column('rule_snapshot', JSONB(), nullable=False),
        sa.UniqueConstraint('request_id'), sa.UniqueConstraint('task_id', 'revision_no'),
        sa.UniqueConstraint('id', 'round_id', 'tenant_id', name='uq_revision_round'),
        sa.ForeignKeyConstraint(['request_id', 'task_id', 'round_id', 'tenant_id'],
             ['review_correction_requests.id', 'review_correction_requests.task_id',
              'review_correction_requests.round_id', 'review_correction_requests.tenant_id'], name='fk_revision_request'),
        sa.CheckConstraint('total BETWEEN 0 AND 100 AND revision_no >= 1'))
    op.create_foreign_key('fk_correction_base_revision', 'review_correction_requests',
                         'review_result_revisions', ['base_revision_id'], ['id'])
    op.add_column('result_summaries', sa.Column('effective_revision_id', sa.Uuid(), nullable=True))
    op.create_foreign_key('fk_summary_revision', 'result_summaries', 'review_result_revisions',
                         ['effective_revision_id', 'round_id', 'tenant_id'], ['id', 'round_id', 'tenant_id'])
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
    actor = 'app_actor_id() IS NOT NULL'
    expert = f"{actor} AND app_role()='expert'"
    platform = f"{actor} AND app_role()='platform_reviewer'"
    school = f"{actor} AND app_role()='school_reviewer'"
    owned = "EXISTS(SELECT 1 FROM expert_tasks t JOIN experts e ON e.id=t.expert_id WHERE t.id=review_correction_requests.task_id AND e.user_id=app_actor_id())"
    school_request = f"{school} AND tenant_id=app_tenant_id() AND status IN ('AWAITING_SCHOOL','ACTIVATED','SCHOOL_REJECTED')"
    read = f'({expert} AND {owned}) OR ({platform}) OR ({school_request})'
    policy('review_correction_requests', 'corrections_read', 'SELECT', read)
    policy('review_correction_requests', 'corrections_insert', 'INSERT', f'{expert} AND {owned} AND requested_by=app_actor_id()')
    policy('review_correction_requests', 'corrections_update', 'UPDATE', read)
    parent = 'EXISTS(SELECT 1 FROM review_correction_requests c WHERE c.id=review_correction_notes.request_id)'
    note_read = f"{parent} AND (({platform}) OR ({expert} AND note_kind IN ('EXPERT_REQUEST','PLATFORM_DECISION')) OR ({school} AND note_kind='SCHOOL_DECISION'))"
    note_write = f"{parent} AND author_id=app_actor_id() AND (({platform} AND note_kind='PLATFORM_DECISION') OR ({expert} AND note_kind='EXPERT_REQUEST') OR ({school} AND note_kind='SCHOOL_DECISION'))"
    policy('review_correction_notes', 'correction_notes_read', 'SELECT', note_read)
    policy('review_correction_notes', 'correction_notes_insert', 'INSERT', note_write)
    revision_parent = 'EXISTS(SELECT 1 FROM review_correction_requests c WHERE c.id=review_result_revisions.request_id)'
    policy('review_result_revisions', 'revisions_read', 'SELECT', revision_parent)
    policy('review_result_revisions', 'revisions_insert', 'INSERT', f'{expert} AND {revision_parent}')
    # Locking a submitted task requires UPDATE visibility, but the existing school
    # task trigger still refuses every actual change to submitted tasks.
    policy('expert_tasks', 'tasks_school_correction_lock', 'UPDATE',
           f"{school} AND tenant_id=app_tenant_id() AND status='SUBMITTED'", 'false')
    policy('result_summaries', 'summaries_school_correction', 'UPDATE',
           f"{school} AND tenant_id=app_tenant_id() AND EXISTS(SELECT 1 FROM review_correction_requests c WHERE c.round_id=result_summaries.round_id AND c.status='AWAITING_SCHOOL')")
    schema = op.get_bind().dialect.identifier_preparer.quote(op.get_bind().scalar(sa.text('SELECT current_schema()')))
    owner = op.get_bind().dialect.identifier_preparer.quote(op.get_bind().scalar(sa.text('SELECT current_user')))
    # A school may know whether publication is blocked, never read private drafts.
    # Only the owner-executed fixed boolean function receives this row policy.
    op.execute(f"CREATE POLICY correction_pending_owner ON review_correction_requests FOR SELECT TO {owner} USING (app_actor_id() IS NOT NULL AND app_role() IN ('school_reviewer','student','supervisor') AND tenant_id=app_tenant_id())")
    op.execute(f'''CREATE FUNCTION has_open_review_correction(target_round uuid) RETURNS boolean
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,{schema},pg_temp AS $$
        SELECT app_actor_id() IS NOT NULL AND app_role() IN ('school_reviewer','student','supervisor')
        AND EXISTS(SELECT 1 FROM result_summaries s JOIN theses t ON t.id=s.thesis_id
                   WHERE s.round_id=target_round AND s.tenant_id=app_tenant_id()) AND EXISTS(
            SELECT 1 FROM review_correction_requests c
            WHERE c.round_id=target_round AND c.tenant_id=app_tenant_id()
              AND c.status IN ('REQUESTED','APPROVED','AWAITING_SCHOOL'))
        $$''')
    op.execute('REVOKE ALL ON FUNCTION has_open_review_correction(uuid) FROM PUBLIC')
    op.execute(f'''CREATE FUNCTION guard_correction_request() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE task expert_tasks%ROWTYPE; paper theses%ROWTYPE; rnd review_rounds%ROWTYPE;
                last_revision uuid; allowed boolean := false;
        BEGIN
            SELECT * INTO task FROM expert_tasks WHERE id=NEW.task_id;
            SELECT * INTO paper FROM theses WHERE id=task.thesis_id;
            SELECT * INTO rnd FROM review_rounds WHERE id=task.round_id;
            IF task.id IS NULL OR paper.id IS NULL OR rnd.id IS NULL OR task.status<>'SUBMITTED'
               OR paper.stage NOT IN ('RESULT_PROCESSING','COMPLETED')
               OR paper.current_version_id IS DISTINCT FROM rnd.thesis_version_id THEN
                RAISE EXCEPTION 'correction requires current submitted result' USING ERRCODE='42501';
            END IF;
            IF TG_OP='INSERT' THEN
                SELECT v.id INTO last_revision FROM review_result_revisions v
                  JOIN review_correction_requests c ON c.id=v.request_id
                  WHERE v.task_id=NEW.task_id AND c.status='ACTIVATED' ORDER BY v.revision_no DESC LIMIT 1;
                IF app_role()<>'expert' OR NEW.requested_by IS DISTINCT FROM app_actor_id()
                   OR NEW.status<>'REQUESTED' OR NEW.version<>1 OR NEW.decided_by IS NOT NULL
                   OR NEW.draft_payload<>'{{}}'::jsonb OR NEW.base_revision_id IS DISTINCT FROM last_revision
                   OR NOT EXISTS(SELECT 1 FROM review_result_versions v WHERE v.id=NEW.base_result_id
                     AND v.task_id=NEW.task_id AND v.round_id=NEW.round_id AND v.tenant_id=NEW.tenant_id AND v.is_current) THEN
                    RAISE EXCEPTION 'invalid correction request' USING ERRCODE='42501';
                END IF;
            ELSE
                IF (to_jsonb(NEW)-'status'-'version'-'draft_payload'-'decided_by'-'updated_at') IS DISTINCT FROM
                   (to_jsonb(OLD)-'status'-'version'-'draft_payload'-'decided_by'-'updated_at') OR NEW.version<>OLD.version+1 THEN
                    RAISE EXCEPTION 'correction fields are immutable' USING ERRCODE='42501';
                END IF;
                IF app_role()='expert' THEN
                    allowed := NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by AND (
                      (OLD.status IN ('REQUESTED','APPROVED') AND NEW.status='CANCELLED' AND NEW.draft_payload=OLD.draft_payload)
                      OR (OLD.status='APPROVED' AND NEW.status='APPROVED')
                      OR (OLD.status='APPROVED' AND NEW.status='AWAITING_SCHOOL' AND EXISTS(
                          SELECT 1 FROM review_result_revisions WHERE request_id=OLD.id)));
                ELSIF app_role()='platform_reviewer' THEN
                    allowed := OLD.status='REQUESTED' AND NEW.status IN ('APPROVED','REJECTED')
                      AND NEW.decided_by=app_actor_id() AND NEW.draft_payload=OLD.draft_payload;
                ELSIF app_role()='school_reviewer' THEN
                    allowed := OLD.status='AWAITING_SCHOOL' AND NEW.status IN ('ACTIVATED','SCHOOL_REJECTED')
                      AND NEW.tenant_id=app_tenant_id() AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by
                      AND NEW.draft_payload=OLD.draft_payload;
                    IF NEW.status='ACTIVATED' THEN
                        allowed := allowed AND EXISTS(SELECT 1 FROM result_summaries s
                            JOIN review_result_revisions v ON v.id=s.effective_revision_id
                            WHERE v.request_id=OLD.id AND s.round_id=OLD.round_id AND s.total=v.total);
                    END IF;
                END IF;
                IF NOT coalesce(allowed,false) THEN
                    RAISE EXCEPTION 'correction state transition denied' USING ERRCODE='42501';
                END IF;
            END IF;
            RETURN NEW;
        END $$''')
    op.execute('CREATE TRIGGER correction_request_guard BEFORE INSERT OR UPDATE ON review_correction_requests FOR EACH ROW EXECUTE FUNCTION guard_correction_request()')
    op.execute(f'''CREATE FUNCTION guard_result_revision() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE c review_correction_requests%ROWTYPE; rule jsonb; dimension jsonb; n integer; computed integer:=0;
        BEGIN
            IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'revision is immutable' USING ERRCODE='42501'; END IF;
            SELECT * INTO c FROM review_correction_requests WHERE id=NEW.request_id;
            SELECT rule_snapshot INTO rule FROM review_rounds WHERE id=NEW.round_id;
            IF app_role()<>'expert' OR c.id IS NULL OR c.status<>'APPROVED'
               OR NEW.base_result_id<>c.base_result_id OR NEW.rule_snapshot IS DISTINCT FROM rule
               OR jsonb_typeof(NEW.scores)<>'object' OR jsonb_typeof(NEW.comments)<>'object'
               OR length(trim(coalesce(NEW.comments->>'overallComment','')))=0
               OR length(trim(coalesce(NEW.comments->>'issues','')))=0 THEN
                RAISE EXCEPTION 'invalid correction revision' USING ERRCODE='42501';
            END IF;
            SELECT count(*) INTO n FROM jsonb_object_keys(NEW.scores);
            IF n<>jsonb_array_length(rule->'dimensions') THEN RAISE EXCEPTION 'invalid score keys' USING ERRCODE='23514'; END IF;
            FOR dimension IN SELECT * FROM jsonb_array_elements(rule->'dimensions') LOOP
                IF coalesce(NEW.scores->>(dimension->>'key'),'') !~ '^[0-9]+$' THEN
                    RAISE EXCEPTION 'invalid score' USING ERRCODE='23514';
                END IF;
                n := (NEW.scores->>(dimension->>'key'))::integer;
                IF n>(dimension->>'max_score')::integer THEN RAISE EXCEPTION 'score out of range' USING ERRCODE='23514'; END IF;
                computed := computed+n;
            END LOOP;
            IF computed<>NEW.total THEN RAISE EXCEPTION 'invalid total' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$''')
    op.execute('CREATE TRIGGER result_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON review_result_revisions FOR EACH ROW EXECUTE FUNCTION guard_result_revision()')
    op.execute('CREATE TRIGGER correction_notes_immutable BEFORE UPDATE OR DELETE ON review_correction_notes FOR EACH ROW EXECUTE FUNCTION guard_publication_immutable()')
    op.execute(f'''CREATE FUNCTION guard_summary_correction() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        BEGIN
            IF NEW.effective_revision_id IS DISTINCT FROM OLD.effective_revision_id THEN
                IF app_role()<>'school_reviewer' OR NEW.tenant_id IS DISTINCT FROM app_tenant_id()
                   OR NEW.version<>OLD.version+1 OR
                   (to_jsonb(NEW)-'total'-'effective_revision_id'-'version'-'updated_at') IS DISTINCT FROM
                   (to_jsonb(OLD)-'total'-'effective_revision_id'-'version'-'updated_at')
                   OR NOT EXISTS(SELECT 1 FROM review_result_revisions v JOIN review_correction_requests c ON c.id=v.request_id
                     WHERE v.id=NEW.effective_revision_id AND v.round_id=NEW.round_id AND v.tenant_id=NEW.tenant_id
                     AND v.total=NEW.total AND c.status='AWAITING_SCHOOL'
                     AND c.base_revision_id IS NOT DISTINCT FROM OLD.effective_revision_id) THEN
                    RAISE EXCEPTION 'invalid summary activation' USING ERRCODE='42501';
                END IF;
            ELSIF OLD.effective_revision_id IS NOT NULL AND
                  (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
                RAISE EXCEPTION 'effective revision requires correction' USING ERRCODE='42501';
            END IF;
            RETURN NEW;
        END $$''')
    op.execute('CREATE TRIGGER summary_correction_guard BEFORE UPDATE ON result_summaries FOR EACH ROW EXECUTE FUNCTION guard_summary_correction()')
    op.execute(f'''CREATE FUNCTION guard_publication_content() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,{schema},pg_temp AS $$
DECLARE s result_summaries%ROWTYPE; paper theses%ROWTYPE; previous result_publications%ROWTYPE;
        source jsonb; expected jsonb; band jsonb; base_id uuid; correction_id uuid;
BEGIN
    SELECT * INTO s FROM result_summaries WHERE id=NEW.summary_id;
    SELECT * INTO paper FROM theses WHERE id=s.thesis_id;
    IF s.id IS NULL OR paper.id IS NULL OR app_role()<>'school_reviewer'
       OR NEW.published_by IS DISTINCT FROM app_actor_id() OR s.tenant_id IS DISTINCT FROM app_tenant_id()
       OR paper.stage<>'COMPLETED' THEN
        RAISE EXCEPTION 'publication scope denied' USING ERRCODE='42501';
    END IF;
    SELECT * INTO previous FROM result_publications WHERE summary_id=s.id ORDER BY publication_no DESC LIMIT 1;
    IF previous.id IS NULL THEN
        IF NEW.publication_no<>1 OR NEW.replaces_id IS NOT NULL OR has_open_review_correction(s.round_id) THEN
            RAISE EXCEPTION 'invalid first publication' USING ERRCODE='42501';
        END IF;
    ELSE
        IF NEW.publication_no<>previous.publication_no+1 OR NEW.replaces_id IS DISTINCT FROM previous.id
           OR s.effective_revision_id IS NULL OR previous.snapshot->>'revision_id'=s.effective_revision_id::text THEN
            RAISE EXCEPTION 'invalid publication successor' USING ERRCODE='42501';
        END IF;
    END IF;
    IF s.effective_revision_id IS NULL THEN
        SELECT to_jsonb(v),v.id INTO source,base_id FROM review_result_versions v
          WHERE v.round_id=s.round_id AND v.tenant_id=s.tenant_id AND v.is_current
            AND s.result_task_ids=jsonb_build_array(v.task_id::text);
    ELSE
        SELECT to_jsonb(v),v.base_result_id,v.request_id INTO source,base_id,correction_id
          FROM review_result_revisions v WHERE v.id=s.effective_revision_id AND v.round_id=s.round_id AND v.tenant_id=s.tenant_id;
        IF NOT EXISTS(SELECT 1 FROM review_correction_requests c WHERE c.id=correction_id
            AND c.status IN ('AWAITING_SCHOOL','ACTIVATED')
            AND (previous.id IS NULL OR c.base_revision_id::text IS NOT DISTINCT FROM previous.snapshot->>'revision_id')) THEN
            RAISE EXCEPTION 'publication correction is not confirmed' USING ERRCODE='42501';
        END IF;
    END IF;
    IF source IS NULL OR (source->>'total')::integer<>s.total THEN
        RAISE EXCEPTION 'publication source missing' USING ERRCODE='42501';
    END IF;
    SELECT b INTO band FROM jsonb_array_elements(s.rule_snapshot->'bands') b
      WHERE s.total BETWEEN (b->>'min')::integer AND (b->>'max')::integer;
    expected := jsonb_build_object(
      'thesis_id',paper.id::text,'thesis_version_id',paper.current_version_id::text,
      'round_id',s.round_id::text,'result_task_ids',s.result_task_ids,
      'base_result_id',base_id::text,'revision_id',s.effective_revision_id::text,
      'total',s.total,'rule_snapshot',s.rule_snapshot,
      'outcome',jsonb_build_object('code',band->>'code','label',band->>'label'),
      'items',jsonb_build_array(jsonb_build_object('alias','E-001','total',s.total,'scores',source->'scores',
        'recommendation',coalesce(source->'comments'->>'recommendation',''),
        'overall_comment',coalesce(source->'comments'->>'overallComment',''),
        'issues',coalesce(source->'comments'->>'issues',''))));
    IF NEW.snapshot IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'publication snapshot does not match effective result' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$
''')
    op.execute('CREATE TRIGGER publication_content_guard BEFORE INSERT ON result_publications FOR EACH ROW EXECUTE FUNCTION guard_publication_content()')
    op.execute(f'''CREATE FUNCTION check_correction_commit() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog,{schema},pg_temp AS $$
        DECLARE s result_summaries%ROWTYPE; current_state text; paper_stage text;
        BEGIN
            SELECT * INTO s FROM result_summaries WHERE id=NEW.id;
            IF s.effective_revision_id IS NULL THEN RETURN NULL; END IF;
            SELECT c.status INTO current_state FROM review_result_revisions v
                JOIN review_correction_requests c ON c.id=v.request_id
                WHERE v.id=s.effective_revision_id AND v.total=s.total;
            IF current_state IS DISTINCT FROM 'ACTIVATED' THEN
                RAISE EXCEPTION 'correction activation must be atomic' USING ERRCODE='42501';
            END IF;
            SELECT stage INTO paper_stage FROM theses WHERE id=s.thesis_id;
            IF paper_stage='COMPLETED' AND NOT EXISTS(
                SELECT 1 FROM result_publications p WHERE p.summary_id=s.id
                AND p.snapshot->>'revision_id'=s.effective_revision_id::text
                AND p.publication_no=(SELECT max(publication_no) FROM result_publications WHERE summary_id=s.id)) THEN
                RAISE EXCEPTION 'activation requires matching publication' USING ERRCODE='42501';
            END IF;
            RETURN NULL;
        END $$''')
    op.execute('''CREATE CONSTRAINT TRIGGER correction_commit_guard AFTER INSERT OR UPDATE ON result_summaries
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_correction_commit()''')
    url = get_settings().business_database_url
    if url:
        role = op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f"GRANT SELECT,INSERT ON {', '.join(TABLES)} TO {role}")
        op.execute(f'GRANT UPDATE ON review_correction_requests TO {role}')
        op.execute(f'GRANT EXECUTE ON FUNCTION has_open_review_correction(uuid) TO {role}')


def downgrade():
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
        if op.get_bind().scalar(sa.text(f'SELECT EXISTS(SELECT 1 FROM {table})')):
            raise ValueError('0022 downgrade requires empty corrections')
    op.execute('DROP TRIGGER correction_commit_guard ON result_summaries')
    op.execute('DROP FUNCTION check_correction_commit()')
    op.execute('DROP TRIGGER publication_content_guard ON result_publications')
    op.execute('DROP FUNCTION guard_publication_content()')
    op.execute('DROP FUNCTION has_open_review_correction(uuid)')
    op.execute('DROP TRIGGER summary_correction_guard ON result_summaries')
    op.execute('DROP FUNCTION guard_summary_correction()')
    op.execute('DROP POLICY summaries_school_correction ON result_summaries')
    op.execute('DROP POLICY tasks_school_correction_lock ON expert_tasks')
    op.drop_constraint('fk_summary_revision', 'result_summaries', type_='foreignkey')
    op.drop_column('result_summaries', 'effective_revision_id')
    op.drop_constraint('fk_correction_base_revision', 'review_correction_requests', type_='foreignkey')
    for table in reversed(TABLES): op.drop_table(table)
    op.execute('DROP FUNCTION guard_result_revision()')
    op.execute('DROP FUNCTION guard_correction_request()')
