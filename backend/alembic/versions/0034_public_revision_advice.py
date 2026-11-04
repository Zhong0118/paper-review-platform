"""Validate revision advice on new publications; never rewrite a released snapshot."""
from alembic import op
import sqlalchemy as sa

revision = '0034_public_revision_advice'
down_revision = '0033_abandoned_drafts'
branch_labels = depends_on = None


def _install_guard(*, v2):
    conn = op.get_bind()
    schema = conn.dialect.identifier_preparer.quote(conn.scalar(sa.text('SELECT current_schema()')))
    v2_fields = """expected := jsonb_set(expected || jsonb_build_object('snapshot_schema_version',2),
        '{items,0,revision_advice}',to_jsonb(coalesce(source->'comments'->>'revisionAdvice','')));""" if v2 else ''
    op.execute(f'''CREATE OR REPLACE FUNCTION guard_publication_content() RETURNS trigger LANGUAGE plpgsql
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
    {v2_fields}
    IF NEW.snapshot IS DISTINCT FROM expected THEN
        RAISE EXCEPTION 'publication snapshot does not match effective result' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
END $$
''')



def upgrade():
    _install_guard(v2=True)


def downgrade():
    _install_guard(v2=False)
