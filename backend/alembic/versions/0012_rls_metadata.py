"""Protect tenant metadata, expert directory, idempotency, and audit rows."""

from alembic import op
from sqlalchemy.engine import make_url

from app.core.config import get_settings

revision = "0012_rls_metadata"
down_revision = "0011_rls_identity"
branch_labels = None
depends_on = None

TABLES = ("tenants", "organizations", "review_batches", "discipline_catalog",
          "experts", "expert_conflicts", "idempotency_keys", "audit_events")


def _roles() -> tuple[str | None, str | None]:
    settings = get_settings()
    business = make_url(settings.business_database_url).username if settings.business_database_url else None
    auth = make_url(settings.auth_database_url).username if settings.auth_database_url else None
    quote = op.get_bind().dialect.identifier_preparer.quote
    return quote(business) if business else None, quote(auth) if auth else None


def _policy(table: str, name: str, command: str, predicate: str,
            *, target: str = "PUBLIC") -> None:
    sql = f"CREATE POLICY {name} ON {table} FOR {command} TO {target}"
    if command != "INSERT":
        sql += f" USING ({predicate})"
    if command in ("INSERT", "UPDATE"):
        sql += f" WITH CHECK ({predicate})"
    op.execute(sql)


def upgrade() -> None:
    business, auth = _roles()
    op.execute("""
        CREATE FUNCTION guard_tenant_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF current_setting('app.role', true) IS DISTINCT FROM 'system_admin'
               AND NOT EXISTS (
                   SELECT 1 FROM pg_roles
                   WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
               ) THEN
                RAISE EXCEPTION 'only system admin can update tenant metadata'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER tenant_lock_guard BEFORE UPDATE ON tenants
        FOR EACH ROW EXECUTE FUNCTION guard_tenant_write()
    """)
    op.execute("""
        CREATE FUNCTION guard_batch_write() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog AS $$
        BEGIN
            IF current_setting('app.role', true) IS DISTINCT FROM 'school_reviewer'
               AND NOT EXISTS (
                   SELECT 1 FROM pg_roles
                   WHERE rolname = current_user AND (rolsuper OR rolbypassrls)
               ) THEN
                RAISE EXCEPTION 'only school reviewers can update batches'
                    USING ERRCODE = '42501';
            END IF;
            RETURN NEW;
        END
        $$
    """)
    op.execute("""
        CREATE TRIGGER batch_lock_guard BEFORE UPDATE ON review_batches
        FOR EACH ROW EXECUTE FUNCTION guard_batch_write()
    """)
    # A parent organization must belong to the same school, including owner writes.
    op.create_unique_constraint("uq_organizations_id_tenant_id", "organizations", ["id", "tenant_id"])
    op.create_foreign_key("fk_organizations_parent_same_tenant", "organizations", "organizations",
                          ["parent_id", "tenant_id"], ["id", "tenant_id"])
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    actor = "app_actor_id() IS NOT NULL"
    system = f"{actor} AND app_role() = 'system_admin'"
    platform = f"{actor} AND app_role() = 'platform_reviewer'"
    tenant_actor = (f"{actor} AND app_role() IN ('student', 'school_reviewer', 'supervisor') "
                    "AND tenant_id = app_tenant_id()")
    _policy("tenants", "tenants_business_read", "SELECT",
            f"{system} OR {platform} OR ({actor} AND app_role() IN "
            "('student', 'school_reviewer', 'supervisor') AND tenants.id = app_tenant_id())")
    _policy("tenants", "tenants_system_insert", "INSERT", system)
    _policy("tenants", "tenants_system_update", "UPDATE", system)
    school_lock = (f"{actor} AND app_role() = 'school_reviewer' "
                   "AND tenants.id = app_tenant_id()")
    _policy("tenants", "tenants_school_lock", "UPDATE", school_lock)

    _policy("organizations", "organizations_business_read", "SELECT",
            f"{system} OR {platform} OR ({tenant_actor})")
    org_write = f"{system} AND organizations.tenant_id IS NOT NULL"
    _policy("organizations", "organizations_system_insert", "INSERT", org_write)
    _policy("organizations", "organizations_system_update", "UPDATE", org_write)

    batch_school = (f"{actor} AND app_role() = 'school_reviewer' "
                    "AND review_batches.tenant_id = app_tenant_id()")
    _policy("review_batches", "batches_business_read", "SELECT",
            f"{platform} OR ({tenant_actor})")
    _policy("review_batches", "batches_school_insert", "INSERT", batch_school)
    _policy("review_batches", "batches_school_update", "UPDATE", batch_school)
    batch_student_lock = (f"{actor} AND app_role() = 'student' "
                          "AND review_batches.tenant_id = app_tenant_id()")
    _policy("review_batches", "batches_student_lock", "UPDATE", batch_student_lock)

    _policy("discipline_catalog", "discipline_business_read", "SELECT",
            f"{actor} AND (discipline_catalog.tenant_id IS NULL "
            f"OR discipline_catalog.tenant_id = app_tenant_id() OR {platform} OR {system})")
    _policy("experts", "experts_business_read", "SELECT",
            f"{platform} OR ({actor} AND app_role() = 'expert' "
            "AND experts.user_id = app_actor_id())")
    _policy("expert_conflicts", "conflicts_platform_read", "SELECT", platform)

    key_self = f"{actor} AND idempotency_keys.user_id = app_actor_id()"
    _policy("idempotency_keys", "keys_business_read", "SELECT", key_self)
    _policy("idempotency_keys", "keys_business_insert", "INSERT", key_self)

    audit_business = (f"{actor} AND audit_events.actor_id = app_actor_id() "
                      "AND audit_events.tenant_id IS NOT DISTINCT FROM app_tenant_id()")
    if business:
        _policy("audit_events", "audit_business_insert", "INSERT", audit_business,
                target=business)

    if auth:
        _policy("tenants", "tenants_auth_read", "SELECT", "true", target=auth)
        _policy("audit_events", "audit_auth_denied_insert", "INSERT",
                "audit_events.actor_id IS NULL AND audit_events.tenant_id IS NULL "
                "AND audit_events.result = 'DENIED' AND audit_events.object_type = 'file' "
                "AND audit_events.action IN ('file_read', 'file_authorize')", target=auth)
        op.execute(f"REVOKE ALL ON tenants, audit_events FROM {auth}")
        op.execute(f"GRANT SELECT (id, code, status) ON tenants TO {auth}")
        op.execute(f"""GRANT INSERT (id, tenant_id, actor_id, action, object_type,
                    object_id, result, request_id, detail) ON audit_events TO {auth}""")

    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"""GRANT SELECT ON tenants, organizations, review_batches,
                    discipline_catalog, experts, expert_conflicts, idempotency_keys TO {business}""")
        op.execute(f"GRANT INSERT, UPDATE ON tenants, organizations, review_batches TO {business}")
        op.execute(f"GRANT INSERT ON idempotency_keys, audit_events TO {business}")


def downgrade() -> None:
    business, auth = _roles()
    op.execute("DROP TRIGGER batch_lock_guard ON review_batches")
    op.execute("DROP FUNCTION guard_batch_write()")
    op.execute("DROP TRIGGER tenant_lock_guard ON tenants")
    op.execute("DROP FUNCTION guard_tenant_write()")
    for table in TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    policies = {
        "tenants": ("tenants_business_read", "tenants_system_insert", "tenants_system_update",
                    "tenants_school_lock",
                    "tenants_auth_read"),
        "organizations": ("organizations_business_read", "organizations_system_insert",
                          "organizations_system_update"),
        "review_batches": ("batches_business_read", "batches_school_insert", "batches_school_update",
                           "batches_student_lock"),
        "discipline_catalog": ("discipline_business_read",),
        "experts": ("experts_business_read",),
        "expert_conflicts": ("conflicts_platform_read",),
        "idempotency_keys": ("keys_business_read", "keys_business_insert"),
        "audit_events": ("audit_business_insert", "audit_auth_denied_insert"),
    }
    for table, names in policies.items():
        for name in names:
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
    op.drop_constraint("fk_organizations_parent_same_tenant", "organizations", type_="foreignkey")
    op.drop_constraint("uq_organizations_id_tenant_id", "organizations", type_="unique")
    if business:
        op.execute(f"REVOKE ALL ON {', '.join(TABLES)} FROM {business}")
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {', '.join(TABLES)} TO {business}")
    if auth:
        op.execute(f"REVOKE ALL ON tenants, audit_events FROM {auth}")
