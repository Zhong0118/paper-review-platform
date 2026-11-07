"""Immutable tenant catalogs, one-time batch pin, and private thesis choices."""
from alembic import op
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0028_school_programs'
down_revision = '0027_expert_profiles'
branch_labels = depends_on = None


def upgrade():
    op.execute("""CREATE TABLE school_program_catalogs (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), year int NOT NULL,
        revision int NOT NULL CHECK (revision>0), source varchar(512) NOT NULL, source_version varchar(80) NOT NULL,
        published_by uuid NOT NULL REFERENCES users(id), entries jsonb NOT NULL CHECK(jsonb_typeof(entries)='object'),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(id,tenant_id), UNIQUE(tenant_id,year,revision))""")
    op.create_unique_constraint('uq_program_batch_tenant','review_batches',['id','tenant_id'])
    op.execute("""CREATE TABLE school_batch_programs (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, batch_id uuid NOT NULL UNIQUE, catalog_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(catalog_id,tenant_id) REFERENCES school_program_catalogs(id,tenant_id),
        FOREIGN KEY(batch_id,tenant_id) REFERENCES review_batches(id,tenant_id))""")
    op.execute("""CREATE TABLE thesis_program_choices (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, thesis_id uuid NOT NULL, version_id uuid NOT NULL UNIQUE,
        catalog_id uuid NOT NULL, code varchar(40) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY(catalog_id,tenant_id) REFERENCES school_program_catalogs(id,tenant_id),
        FOREIGN KEY(version_id,thesis_id,tenant_id) REFERENCES thesis_versions(id,thesis_id,tenant_id) ON DELETE CASCADE)""")
    for table in ('school_program_catalogs','school_batch_programs','thesis_program_choices'):
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
    school="app_role()='school_reviewer'"
    student="app_role()='student'"
    tenant="tenant_id=app_tenant_id() AND app_actor_id() IS NOT NULL"
    student_batch="""EXISTS (SELECT 1 FROM student_eligibilities e JOIN tenant_user_memberships m
         ON m.id=e.student_membership_id WHERE e.review_batch_id=school_batch_programs.batch_id AND m.user_id=app_actor_id())"""
    op.execute(f'CREATE POLICY pin_read ON school_batch_programs FOR SELECT USING ({tenant} AND ({school} OR ({student} AND {student_batch})))')
    op.execute(f"""CREATE POLICY pin_insert ON school_batch_programs FOR INSERT WITH CHECK ({tenant} AND {school}
        AND EXISTS(SELECT 1 FROM review_batches b WHERE b.id=school_batch_programs.batch_id AND b.status IN ('DRAFT','OPEN')))""")
    op.execute(f"""CREATE POLICY programs_read ON school_program_catalogs FOR SELECT USING
        ({tenant} AND ({school} OR ({student} AND EXISTS (SELECT 1 FROM school_batch_programs b
         WHERE b.catalog_id=school_program_catalogs.id))))""")
    op.execute(f'CREATE POLICY programs_publish ON school_program_catalogs FOR INSERT WITH CHECK ({tenant} AND {school} AND published_by=app_actor_id())')
    own="EXISTS (SELECT 1 FROM theses t WHERE t.id=thesis_program_choices.thesis_id)"
    writable="""EXISTS (SELECT 1 FROM thesis_versions v JOIN theses t ON t.id=v.thesis_id
      JOIN school_batch_programs b ON b.batch_id=t.review_batch_id JOIN school_program_catalogs c ON c.id=b.catalog_id
      WHERE v.id=thesis_program_choices.version_id AND v.is_editable AND t.stage='DRAFT'
      AND c.id=thesis_program_choices.catalog_id AND c.entries ? thesis_program_choices.code
      AND c.entries->thesis_program_choices.code->>'official_code'=v.discipline_code)"""
    op.execute("""CREATE FUNCTION guard_school_choice_clone() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF app_role()='school_reviewer' AND NOT EXISTS (
            SELECT 1 FROM thesis_program_choices prev JOIN thesis_versions prior ON prior.id=prev.version_id
            JOIN thesis_versions target ON target.thesis_id=prior.thesis_id
            WHERE target.id=NEW.version_id AND prior.version_no=target.version_no-1
            AND prev.code=NEW.code AND prev.catalog_id=NEW.catalog_id
          ) THEN RAISE EXCEPTION 'school may only copy previous choice' USING ERRCODE='42501';
          END IF; RETURN NEW;
        END $$""")
    op.execute('CREATE TRIGGER school_choice_clone BEFORE INSERT ON thesis_program_choices FOR EACH ROW EXECUTE FUNCTION guard_school_choice_clone()')
    op.execute(f'CREATE POLICY choice_read ON thesis_program_choices FOR SELECT USING ({tenant} AND ({school} OR {student}) AND {own})')
    op.execute(f'CREATE POLICY choice_insert ON thesis_program_choices FOR INSERT WITH CHECK ({tenant} AND {writable} AND ({student} OR {school}))')
    op.execute(f'CREATE POLICY choice_edit ON thesis_program_choices FOR UPDATE USING ({tenant} AND {student} AND {own}) WITH CHECK ({tenant} AND {student} AND {writable})')
    url=get_settings().business_database_url
    if url:
        role=op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'GRANT SELECT, INSERT ON school_program_catalogs,school_batch_programs,thesis_program_choices TO {role}')
        op.execute(f'GRANT UPDATE(code,updated_at) ON thesis_program_choices TO {role}')


def downgrade():
    op.execute('ALTER TABLE school_program_catalogs NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(text('SELECT EXISTS(SELECT 1 FROM school_program_catalogs)')):
        raise ValueError('0028 downgrade would discard school program history')
    op.drop_table('thesis_program_choices')
    op.execute('DROP FUNCTION guard_school_choice_clone()')
    op.execute('DROP POLICY programs_read ON school_program_catalogs')
    op.drop_table('school_batch_programs')
    op.drop_constraint('uq_program_batch_tenant','review_batches',type_='unique')
    op.drop_table('school_program_catalogs')
