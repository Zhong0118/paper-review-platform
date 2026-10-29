"""Manually maintained expert profiles and actor-owned import previews."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision = '0027_expert_profiles'
down_revision = '0026_pdf_transforms'
branch_labels = depends_on = None

PROFILE_COLUMNS = ('province_name','doctoral_supervisor','masters_supervisor','research_directions',
                   'keywords','source_url','source_note','source_checked_at')


def upgrade():
    for column in (
        sa.Column('province_name',sa.String(128)),
        sa.Column('doctoral_supervisor',sa.Boolean()),sa.Column('masters_supervisor',sa.Boolean()),
        sa.Column('research_directions',JSONB,nullable=False,server_default='[]'),
        sa.Column('keywords',JSONB,nullable=False,server_default='[]'),
        sa.Column('source_url',sa.String(2048)),sa.Column('source_note',sa.String(1000)),
        sa.Column('source_checked_at',sa.DateTime(timezone=True)),
    ): op.add_column('experts',column)
    for name in ('research_directions','keywords'):
        op.create_check_constraint('ck_expert_'+name,'experts',f"jsonb_typeof({name})='array' AND jsonb_array_length({name})<=20")
    op.create_table('expert_import_previews',
        sa.Column('id',sa.Uuid(),primary_key=True),
        sa.Column('actor_id',sa.Uuid(),sa.ForeignKey('users.id'),nullable=False),
        sa.Column('expires_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('payload_hash',sa.String(64),nullable=False),
        sa.Column('canonical_changes',JSONB,nullable=False),
        sa.Column('status',sa.String(16),nullable=False),
        sa.Column('created_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.Column('updated_at',sa.DateTime(timezone=True),server_default=sa.func.now(),nullable=False),
        sa.CheckConstraint("status IN ('READY','INVALID','APPLIED')",name='ck_expert_import_status'))
    op.execute('ALTER TABLE expert_import_previews ENABLE ROW LEVEL SECURITY')
    op.execute('ALTER TABLE expert_import_previews FORCE ROW LEVEL SECURITY')
    own="app_actor_id() IS NOT NULL AND app_role()='platform_reviewer' AND actor_id=app_actor_id()"
    op.execute(f'CREATE POLICY expert_import_read ON expert_import_previews FOR SELECT USING ({own})')
    op.execute(f"CREATE POLICY expert_import_insert ON expert_import_previews FOR INSERT WITH CHECK ({own} AND status IN ('READY','INVALID'))")
    op.execute(f"CREATE POLICY expert_import_update ON expert_import_previews FOR UPDATE USING ({own}) WITH CHECK ({own})")
    op.execute("""CREATE FUNCTION guard_expert_import_update() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
             OR OLD.status<>'READY' OR NEW.status<>'APPLIED' THEN
            RAISE EXCEPTION 'immutable expert import or invalid transition';
          END IF;
          RETURN NEW;
        END $$""")
    op.execute('CREATE TRIGGER expert_import_update_guard BEFORE UPDATE ON expert_import_previews FOR EACH ROW EXECUTE FUNCTION guard_expert_import_update()')
    url=get_settings().business_database_url
    if url:
        role=op.get_bind().dialect.identifier_preparer.quote(make_url(url).username)
        op.execute(f'GRANT SELECT,INSERT ON expert_import_previews TO {role}')
        op.execute(f'GRANT UPDATE(status,updated_at) ON expert_import_previews TO {role}')
        op.execute(f"GRANT UPDATE({','.join(PROFILE_COLUMNS)}) ON experts TO {role}")


def downgrade():
    op.execute('ALTER TABLE expert_import_previews NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS(SELECT 1 FROM expert_import_previews)')):
        raise ValueError('0027 downgrade would discard expert import provenance')
    op.execute('ALTER TABLE experts NO FORCE ROW LEVEL SECURITY')
    empty = " AND ".join(f"{name}='[]'::jsonb" if name in ('research_directions','keywords') else f'{name} IS NULL' for name in PROFILE_COLUMNS)
    if op.get_bind().scalar(sa.text(f'SELECT EXISTS(SELECT 1 FROM experts WHERE NOT ({empty}))')):
        raise ValueError('0027 downgrade would discard expert profile data')
    op.execute('ALTER TABLE experts FORCE ROW LEVEL SECURITY')
    for name in ('research_directions','keywords'): op.drop_constraint('ck_expert_'+name,'experts',type_='check')
    for name in reversed(PROFILE_COLUMNS): op.drop_column('experts',name)
    op.drop_table('expert_import_previews')
    op.execute('DROP FUNCTION guard_expert_import_update()')
