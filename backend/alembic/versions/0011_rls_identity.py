"""Protect identity and authentication session rows for ordinary database logins."""

from alembic import op
from sqlalchemy.engine import make_url

from app.core.config import get_settings

revision = "0011_rls_identity"
down_revision = "0010_auth_version"
branch_labels = None
depends_on = None

TABLES = ("users", "roles", "user_role_assignments", "tenant_user_memberships", "auth_sessions")


def _roles() -> tuple[str | None, str | None]:
    settings = get_settings()
    business = (make_url(settings.business_database_url).username
                if settings.business_database_url else None)
    auth = make_url(settings.auth_database_url).username if settings.auth_database_url else None
    quote = op.get_bind().dialect.identifier_preparer.quote
    return quote(business) if business else None, quote(auth) if auth else None


def _policy(table: str, name: str, command: str, predicate: str,
            *, target: str = "PUBLIC", check: str | None = None) -> None:
    sql = f"CREATE POLICY {name} ON {table} FOR {command} TO {target}"
    if command != "INSERT":
        sql += f" USING ({predicate})"
    if command in {"INSERT", "UPDATE"}:
        sql += f" WITH CHECK ({check or predicate})"
    op.execute(sql)


def upgrade() -> None:
    business, auth = _roles()
    for func_name, guc in (("app_actor_id", "app.user_id"),
                           ("app_tenant_id", "app.tenant_id")):
        op.execute(f"""
            CREATE FUNCTION {func_name}() RETURNS uuid LANGUAGE sql STABLE
            SET search_path = pg_catalog AS $$
                SELECT nullif(current_setting('{guc}', true), '')::uuid
            $$
        """)
    op.execute("""
        CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE
        SET search_path = pg_catalog AS $$
            SELECT nullif(current_setting('app.role', true), '')
        $$
    """)
    op.execute("""
        CREATE FUNCTION guard_member_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF current_setting('app.role', true) IN ('student', 'supervisor') THEN
                RAISE EXCEPTION 'member identity cannot update its membership'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER membership_self_lock_guard BEFORE UPDATE ON tenant_user_memberships
        FOR EACH ROW EXECUTE FUNCTION guard_member_write()
    """)
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    own = "users.id = app_actor_id()"
    school_member = ("app_role() = 'school_reviewer' AND EXISTS ("
                     "SELECT 1 FROM tenant_user_memberships m "
                     "JOIN user_role_assignments a ON a.user_id = m.user_id "
                     "JOIN roles r ON r.id = a.role_id "
                     "WHERE m.user_id = users.id AND m.tenant_id = app_tenant_id() "
                     "AND a.tenant_id = m.tenant_id "
                     "AND ((m.membership_type = 'STUDENT' AND r.code = 'student') OR "
                     "(m.membership_type = 'SUPERVISOR' AND r.code = 'supervisor')))")
    provisioned = ("app_role() = 'school_reviewer' "
                   "AND users.provisioned_by = app_actor_id() "
                   "AND users.provisioned_tenant_id = app_tenant_id()")
    system = "app_role() = 'system_admin' AND app_actor_id() IS NOT NULL"
    platform_expert = ("app_role() = 'platform_reviewer' AND EXISTS ("
                       "SELECT 1 FROM experts e WHERE e.user_id = users.id)")
    _policy("users", "users_business_read", "SELECT",
            f"{own} OR {school_member} OR {provisioned} OR {system} OR {platform_expert}")
    _policy("users", "users_business_insert", "INSERT",
            "users.provisioned_by = app_actor_id() AND app_actor_id() IS NOT NULL "
            "AND (app_role() = 'system_admin' OR "
            "(app_role() = 'school_reviewer' AND app_tenant_id() IS NOT NULL "
            "AND users.provisioned_tenant_id = app_tenant_id()))")
    _policy("users", "users_business_update", "UPDATE", f"{school_member} OR {system}")

    _policy("roles", "roles_business_read", "SELECT", "app_actor_id() IS NOT NULL")

    assignment_self = "user_role_assignments.user_id = app_actor_id()"
    assignment_school = ("app_role() = 'school_reviewer' AND "
                         "user_role_assignments.tenant_id = app_tenant_id()")
    _policy("user_role_assignments", "assignments_business_read", "SELECT",
            f"{assignment_self} OR {assignment_school} OR {system}")
    _policy("user_role_assignments", "assignments_business_insert", "INSERT",
            "app_actor_id() IS NOT NULL AND EXISTS (SELECT 1 FROM users u "
            "WHERE u.id = user_role_assignments.user_id AND u.provisioned_by = app_actor_id() "
            "AND u.provisioned_tenant_id = user_role_assignments.tenant_id) "
            "AND ((app_role() = 'school_reviewer' "
            "AND user_role_assignments.tenant_id = app_tenant_id() "
            "AND EXISTS (SELECT 1 FROM roles r WHERE r.id = user_role_assignments.role_id "
            "AND r.code IN ('student', 'supervisor'))) OR "
            "(app_role() = 'system_admin' AND EXISTS (SELECT 1 FROM roles r "
            "WHERE r.id = user_role_assignments.role_id AND r.code = 'school_reviewer')))")
    assignment_member_write = (f"{assignment_school} AND EXISTS (SELECT 1 FROM roles r "
                               "WHERE r.id = user_role_assignments.role_id "
                               "AND r.code IN ('student', 'supervisor'))")
    _policy("user_role_assignments", "assignments_business_update", "UPDATE",
            f"{assignment_member_write} OR {system}")

    member_self = ("tenant_user_memberships.user_id = app_actor_id() "
                   "AND tenant_user_memberships.tenant_id = app_tenant_id()")
    member_school = ("app_role() = 'school_reviewer' AND "
                     "tenant_user_memberships.tenant_id = app_tenant_id()")
    member_system = ("app_role() = 'system_admin' AND app_actor_id() IS NOT NULL "
                     "AND tenant_user_memberships.membership_type = 'STAFF'")
    member_platform = "app_role() = 'platform_reviewer' AND app_actor_id() IS NOT NULL"
    _policy("tenant_user_memberships", "memberships_business_read", "SELECT",
            f"{member_self} OR {member_school} OR {member_system} OR {member_platform}")
    matching_org = ("EXISTS (SELECT 1 FROM organizations o "
                    "WHERE o.id = tenant_user_memberships.organization_id "
                    "AND o.tenant_id = tenant_user_memberships.tenant_id)")
    matching_assignment = ("EXISTS (SELECT 1 FROM user_role_assignments a "
                           "JOIN roles r ON r.id = a.role_id "
                           "WHERE a.user_id = tenant_user_memberships.user_id "
                           "AND a.tenant_id = tenant_user_memberships.tenant_id "
                           "AND ((tenant_user_memberships.membership_type = 'STUDENT' "
                           "AND r.code = 'student') OR "
                           "(tenant_user_memberships.membership_type = 'SUPERVISOR' "
                           "AND r.code = 'supervisor') OR "
                           "(tenant_user_memberships.membership_type = 'STAFF' "
                           "AND r.code = 'school_reviewer')))")
    member_write = ("app_actor_id() IS NOT NULL AND "
                    f"({member_school} AND tenant_user_memberships.membership_type "
                    "IN ('STUDENT', 'SUPERVISOR') OR "
                    f"{member_system} AND tenant_user_memberships.membership_type = 'STAFF') "
                    f"AND {matching_org} AND {matching_assignment}")
    _policy("tenant_user_memberships", "memberships_business_insert", "INSERT", member_write)
    own_lock = ("app_role() IN ('student', 'supervisor') AND "
                "tenant_user_memberships.user_id = app_actor_id()")
    _policy("tenant_user_memberships", "memberships_business_update", "UPDATE",
            f"({member_write}) OR ({own_lock})")

    session_system = "app_role() = 'system_admin' AND app_actor_id() IS NOT NULL"
    session_school = ("app_role() = 'school_reviewer' AND EXISTS ("
                      "SELECT 1 FROM tenant_user_memberships m "
                      "WHERE m.user_id = auth_sessions.user_id "
                      "AND m.tenant_id = app_tenant_id() "
                      "AND m.membership_type IN ('STUDENT', 'SUPERVISOR'))")
    _policy("auth_sessions", "sessions_business_read", "SELECT",
            f"{session_system} OR {session_school}")
    _policy("auth_sessions", "sessions_business_update", "UPDATE",
            f"{session_system} OR {session_school}")

    if auth:
        for table in ("users", "roles", "user_role_assignments", "tenant_user_memberships", "auth_sessions"):
            _policy(table, f"{table}_auth_read", "SELECT", "true", target=auth)
        # Login and refresh lock users before rotating a session.
        _policy("users", "users_auth_update", "UPDATE", "true", target=auth)
        _policy("auth_sessions", "sessions_auth_insert", "INSERT", "true", target=auth)
        _policy("auth_sessions", "sessions_auth_update", "UPDATE", "true", target=auth)
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {auth}")
        op.execute(f"""GRANT SELECT (id, username, password_hash, auth_version,
                    status, display_name) ON users TO {auth}""")
        op.execute(f"GRANT SELECT (id, code) ON roles TO {auth}")
        op.execute(f"""GRANT SELECT (id, user_id, tenant_id, role_id, data_scope,
                    effective_from, effective_until)
                    ON user_role_assignments TO {auth}""")
        op.execute(f"""GRANT SELECT (id, user_id, tenant_id, membership_type, is_active)
                    ON tenant_user_memberships TO {auth}""")
        op.execute(f"""GRANT SELECT (id, user_id, refresh_token_hash, expires_at,
                    revoked_at, created_at, updated_at) ON auth_sessions TO {auth}""")
        op.execute(f"GRANT UPDATE (last_login_at, updated_at) ON users TO {auth}")
        op.execute(f"GRANT INSERT ON auth_sessions TO {auth}")
        op.execute(f"GRANT UPDATE (revoked_at, updated_at) ON auth_sessions TO {auth}")

    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"""GRANT SELECT (id, username, auth_version, status, display_name,
                    contact_phone, contact_email, last_login_at, provisioned_by,
                    provisioned_tenant_id,
                    created_at, updated_at)
                    ON users TO {business}""")
        op.execute(f"""GRANT INSERT (id, username, password_hash, provisioned_by,
                    provisioned_tenant_id,
                    auth_version, status,
                    display_name, contact_phone, contact_email, last_login_at)
                    ON users TO {business}""")
        op.execute(f"""GRANT UPDATE (password_hash, auth_version, status, display_name,
                    contact_phone, contact_email, last_login_at, updated_at)
                    ON users TO {business}""")
        op.execute(f"GRANT SELECT ON roles, user_role_assignments, tenant_user_memberships TO {business}")
        op.execute(f"GRANT INSERT ON user_role_assignments, tenant_user_memberships TO {business}")
        op.execute(f"GRANT UPDATE (effective_from, effective_until, updated_at) ON user_role_assignments TO {business}")
        op.execute(f"""GRANT UPDATE (is_active, display_name, source_updated_at, updated_at)
                    ON tenant_user_memberships TO {business}""")
        op.execute(f"GRANT SELECT (id, user_id, revoked_at) ON auth_sessions TO {business}")
        op.execute(f"GRANT UPDATE (revoked_at, updated_at) ON auth_sessions TO {business}")


def downgrade() -> None:
    business, auth = _roles()
    op.execute("DROP TRIGGER membership_self_lock_guard ON tenant_user_memberships")
    op.execute("DROP FUNCTION guard_member_write()")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    policy_names = {
        "users": ("users_business_read", "users_business_insert", "users_business_update",
                  "users_auth_read", "users_auth_update"),
        "roles": ("roles_business_read", "roles_auth_read"),
        "user_role_assignments": ("assignments_business_read", "assignments_business_insert",
                                  "assignments_business_update", "user_role_assignments_auth_read"),
        "tenant_user_memberships": ("memberships_business_read", "memberships_business_insert",
                                    "memberships_business_update", "tenant_user_memberships_auth_read"),
        "auth_sessions": ("sessions_business_read", "sessions_business_update", "auth_sessions_auth_read",
                          "sessions_auth_insert", "sessions_auth_update"),
    }
    for table, names in policy_names.items():
        for name in names:
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    for func_name in ("app_actor_id", "app_tenant_id", "app_role"):
        op.execute(f"DROP FUNCTION {func_name}()")
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {business}")
    if auth:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {auth}")
        op.execute(f"GRANT SELECT ON {', '.join(TABLES)} TO {auth}")
        op.execute(f"GRANT UPDATE (last_login_at, updated_at) ON users TO {auth}")
        op.execute(f"GRANT INSERT, UPDATE (revoked_at, updated_at) ON auth_sessions TO {auth}")
