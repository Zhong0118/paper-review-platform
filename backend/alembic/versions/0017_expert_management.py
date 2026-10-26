"""Narrow global-expert provisioning and operational writes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from app.core.config import get_settings

revision='0017_expert_management'
down_revision='0016_expert_operations'
branch_labels=None
depends_on=None

PLATFORM="app_actor_id() IS NOT NULL AND app_role()='platform_reviewer'"
PROVISIONED="provisioned_by=app_actor_id() AND provisioned_tenant_id IS NULL"
POLICIES={
    'users': ['users_platform_provision_read','users_platform_expert_insert'],
    'experts': ['experts_platform_insert','experts_platform_update'],
    'user_role_assignments': ['assignments_platform_expert_read','assignments_platform_expert_insert'],
    'expert_conflicts': ['conflicts_platform_insert','conflicts_platform_delete'],
}


def role():
    url=get_settings().business_database_url
    return op.get_bind().dialect.identifier_preparer.quote(make_url(url).username) if url else None


def policy(table,name,command,predicate):
    clause='WITH CHECK' if command=='INSERT' else 'USING'
    sql=f'CREATE POLICY {name} ON {table} FOR {command} {clause} ({predicate})'
    if command=='UPDATE': sql+=f' WITH CHECK ({predicate})'
    op.execute(sql)


def upgrade():
    # A separate invoker query avoids rewrite-time re-entry into assignments
    # through users_business_read. PL/pgSQL is deliberately not SQL-inlined.
    schema = op.get_bind().scalar(sa.text("SELECT current_schema()"))
    quoted_schema = op.get_bind().dialect.identifier_preparer.quote(schema)
    op.execute(f"""
        CREATE FUNCTION app_provisioned_user(target uuid, tenant uuid)
        RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER
        SET search_path = pg_catalog, {quoted_schema} AS $$
        BEGIN
            RETURN EXISTS (SELECT 1 FROM users u WHERE u.id = target
                AND u.provisioned_by = app_actor_id()
                AND u.provisioned_tenant_id IS NOT DISTINCT FROM tenant);
        END
        $$
    """)
    # Preserve the school/system policy's NULL-rejecting tenant semantics.
    op.execute("""ALTER POLICY assignments_business_insert ON user_role_assignments
        WITH CHECK (app_actor_id() IS NOT NULL AND tenant_id IS NOT NULL
        AND app_provisioned_user(user_id, tenant_id)
        AND ((app_role() = 'school_reviewer' AND tenant_id = app_tenant_id()
              AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                          AND r.code IN ('student', 'supervisor')))
             OR (app_role() = 'system_admin'
                 AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                             AND r.code = 'school_reviewer'))))""")
    policy('users','users_platform_provision_read','SELECT',f'{PLATFORM} AND {PROVISIONED}')
    policy('users','users_platform_expert_insert','INSERT',f"{PLATFORM} AND {PROVISIONED} AND status='ACTIVE'")
    owner_user=f'EXISTS (SELECT 1 FROM users u WHERE u.id=experts.user_id AND u.{PROVISIONED})'
    policy('experts','experts_platform_insert','INSERT',f'{PLATFORM} AND {owner_user}')
    policy('experts','experts_platform_update','UPDATE',PLATFORM)
    expert_role="tenant_id IS NULL AND EXISTS (SELECT 1 FROM roles r WHERE r.id=user_role_assignments.role_id AND r.code='expert')"
    own_user='app_provisioned_user(user_role_assignments.user_id, NULL)'
    expert_user='EXISTS (SELECT 1 FROM experts e WHERE e.user_id=user_role_assignments.user_id)'
    # Expert is flushed before its assignment; this also covers provisioning.
    # Do not select users here: users SELECT already traverses assignments.
    policy('user_role_assignments','assignments_platform_expert_read','SELECT',f'{PLATFORM} AND {expert_role} AND {expert_user}')
    policy('user_role_assignments','assignments_platform_expert_insert','INSERT',f'{PLATFORM} AND {expert_role} AND {own_user}')
    for command in ('INSERT','DELETE'):
        policy('expert_conflicts',f'conflicts_platform_{command.lower()}',command,
               f'{PLATFORM} AND EXISTS (SELECT 1 FROM experts e WHERE e.id=expert_conflicts.expert_id)')
    op.create_check_constraint('ck_expert_conflict_kind','expert_conflicts',"kind IN ('SUPERVISOR_NAME','TENANT_ID')")
    business=role()
    if business:
        op.execute(f'GRANT INSERT ON experts,expert_conflicts TO {business}')
        op.execute(f'GRANT UPDATE (unit,title,discipline_codes,qualification_status,service_status,version,updated_at) ON experts TO {business}')
        op.execute(f'GRANT DELETE ON expert_conflicts TO {business}')


def downgrade():
    for table in ('experts','expert_conflicts'):
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY')
    if op.get_bind().scalar(sa.text('SELECT EXISTS (SELECT 1 FROM experts) OR EXISTS (SELECT 1 FROM expert_conflicts)')):
        raise ValueError('0017 downgrade requires empty expert tables')
    for table in ('experts','expert_conflicts'):
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY')
    for table,names in POLICIES.items():
        for name in names: op.execute(f'DROP POLICY {name} ON {table}')
    op.execute("""ALTER POLICY assignments_business_insert ON user_role_assignments
        WITH CHECK (app_actor_id() IS NOT NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = user_role_assignments.user_id
                    AND u.provisioned_by = app_actor_id()
                    AND u.provisioned_tenant_id = user_role_assignments.tenant_id)
        AND ((app_role() = 'school_reviewer' AND tenant_id = app_tenant_id()
              AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                          AND r.code IN ('student', 'supervisor')))
             OR (app_role() = 'system_admin'
                 AND EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id
                             AND r.code = 'school_reviewer'))))""")
    op.execute('DROP FUNCTION app_provisioned_user(uuid, uuid)')
    op.drop_constraint('ck_expert_conflict_kind' ,'expert_conflicts',type_='check')
    business=role()
    if business:
        op.execute(f'REVOKE INSERT ON experts,expert_conflicts FROM {business}')
        op.execute(f'REVOKE UPDATE (unit,title,discipline_codes,qualification_status,service_status,version,updated_at) ON experts FROM {business}')
        op.execute(f'REVOKE DELETE ON expert_conflicts FROM {business}')
