from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from types import SimpleNamespace
from pathlib import Path
from uuid import uuid4
import os
import secrets
import subprocess
import sys
from urllib.parse import urlparse, urlunparse

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text, create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_auth_session, get_session
from app.db import models as _models  # noqa: F401
from app.main import create_app
from app.seed import seed_database

TEST_DB_NAME = "paper_review_test"


def _admin_url() -> str:
    parsed = urlparse(get_settings().database_url)
    return urlunparse(parsed._replace(path="/postgres"))


def _test_url() -> str:
    parsed = urlparse(get_settings().database_url)
    return urlunparse(parsed._replace(path=f"/{TEST_DB_NAME}"))


def _ensure_test_database() -> None:
    admin = create_engine(_admin_url().replace("+asyncpg", "+psycopg"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"),
                                  {"n": TEST_DB_NAME}).scalar()
            if not exists:
                conn.execute(text(f"CREATE DATABASE {TEST_DB_NAME}"))
    finally:
        admin.dispose()


def upgrade_test_schema(revision: str, schema: str, migration_url: str,
                        business_url: str | None = None, auth_url: str | None = None) -> None:
    migration_env = {**os.environ, "DATABASE_URL": _test_url(),
                     "MIGRATION_DATABASE_URL": migration_url,
                     "PGOPTIONS": f"-c search_path={schema}"}
    if business_url is not None:
        migration_env["BUSINESS_DATABASE_URL"] = business_url
    if auth_url is not None:
        migration_env["AUTH_DATABASE_URL"] = auth_url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=Path(__file__).resolve().parents[1],
        env=migration_env,
        check=True, capture_output=True, text=True,
    )


@contextmanager
def migrated_test_schema(revision="head", *, migration_url=None, schema_owner=None,
                         cleanup_guard: Callable[[str], None] | None = None):
    # Every run gets its own migrated schema in the dedicated test database.
    # Existing local test data is neither stamped nor dropped.
    _ensure_test_database()
    schema = "test_" + uuid4().hex
    engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
    with engine.begin() as conn:
        owner_clause = f' AUTHORIZATION "{schema_owner}"' if schema_owner else ""
        conn.execute(text(f'CREATE SCHEMA "{schema}"{owner_clause}'))
    try:
        upgrade_test_schema(revision, schema, migration_url or _test_url())
        yield schema
    finally:
        try:
            if cleanup_guard is not None:
                cleanup_guard("schema")
            with engine.begin() as conn:
                if cleanup_guard is None or conn.execute(
                    text("SELECT 1 FROM pg_namespace WHERE nspname=:schema"), {"schema": schema}
                ).scalar():
                    conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        finally:
            engine.dispose()


@dataclass(frozen=True)
class RuntimeRoles:
    schema: str
    owner_role: str
    business_role: str
    auth_role: str
    migration_url: str = field(repr=False)
    business_url: str = field(repr=False)
    auth_url: str = field(repr=False)


@contextmanager
def isolated_runtime_roles(revision="head", *, cleanup_guard: Callable[[str], None] | None = None,
                           strict_cleanup: bool = False):
    """Create three real logins for one schema in paper_review_test."""
    base_url = make_url(_test_url())
    if (base_url.host not in {"127.0.0.1", "localhost"} or base_url.port != 5433
            or base_url.database != TEST_DB_NAME):
        raise ValueError("runtime role tests require local 5433/paper_review_test")
    _ensure_test_database()
    prefix = "rls_" + uuid4().hex[:16]
    names = {kind: f"{prefix}_{kind}" for kind in ("owner", "business", "auth")}
    urls = {
        kind: base_url.set(username=name, password=secrets.token_hex(24)).render_as_string(hide_password=False)
        for kind, name in names.items()
    }
    admin = create_engine(_test_url().replace("+asyncpg", "+psycopg"), isolation_level="AUTOCOMMIT")
    created: list[str] = []
    try:
        with admin.connect() as conn:
            if not conn.execute(text("SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user")).scalar_one():
                raise RuntimeError("test database login cannot create isolated roles")
            for kind, name in names.items():
                # Both identifiers and passwords are generated from restricted alphabets.
                password = make_url(urls[kind]).password
                conn.execute(text(
                    f'CREATE ROLE "{name}" LOGIN NOSUPERUSER NOBYPASSRLS '
                    f'NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD \'{password}\''
                ))
                created.append(name)
        with migrated_test_schema("0010_auth_version", migration_url=urls["owner"],
                                  schema_owner=names["owner"], cleanup_guard=cleanup_guard) as schema:
            with admin.connect() as conn:
                conn.execute(text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{names["business"]}", "{names["auth"]}"'))
                # RLS revisions replace this pre-policy grant with narrow per-table grants.
                conn.execute(text(
                    f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "{schema}" '
                    f'TO "{names["business"]}"'
                ))
            if revision != "0010_auth_version":
                upgrade_test_schema(revision, schema, urls["owner"], urls["business"], urls["auth"])
            yield RuntimeRoles(schema, names["owner"], names["business"], names["auth"],
                               urls["owner"], urls["business"], urls["auth"])
    finally:
        try:
            if cleanup_guard is not None:
                cleanup_guard("roles")
            with admin.connect() as conn:
                for name in created:
                    if strict_cleanup:
                        active = conn.execute(text("""
                            SELECT count(*) FROM pg_stat_activity
                            WHERE datname = :database AND usename = :role AND pid <> pg_backend_pid()
                        """), {"database": TEST_DB_NAME, "role": name}).scalar_one()
                        if active:
                            raise RuntimeError("recovery role still has active connections")
                    else:
                        conn.execute(text("""
                            SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                            WHERE datname = :database AND usename = :role AND pid <> pg_backend_pid()
                        """), {"database": TEST_DB_NAME, "role": name})
                for name in reversed(created):
                    conn.execute(text(f'DROP ROLE "{name}"'))
        finally:
            admin.dispose()


@pytest.fixture
def rls_role_environment() -> Iterator[RuntimeRoles]:
    with isolated_runtime_roles() as roles:
        yield roles


@pytest_asyncio.fixture
async def runtime_business_session(rls_role_environment: RuntimeRoles) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(rls_role_environment.business_url, pool_pre_ping=True,
                                 connect_args={"server_settings": {"search_path": rls_role_environment.schema}})
    try:
        async with AsyncSession(engine) as session:
            yield session
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def runtime_auth_session(rls_role_environment: RuntimeRoles) -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(rls_role_environment.auth_url, pool_pre_ping=True,
                                 connect_args={"server_settings": {"search_path": rls_role_environment.schema}})
    try:
        async with AsyncSession(engine) as session:
            yield session
    finally:
        await engine.dispose()


@pytest.fixture
def migration_connection(rls_role_environment: RuntimeRoles):
    engine = create_engine(rls_role_environment.migration_url.replace("+asyncpg", "+psycopg"),
                           connect_args={"options": f"-c search_path={rls_role_environment.schema}"})
    try:
        with engine.connect() as conn:
            yield conn
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def test_schema():
    with migrated_test_schema() as schema:
        yield schema


@pytest_asyncio.fixture
async def test_engine(test_schema) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(_test_url(), pool_pre_ping=True,
                                 connect_args={"server_settings": {"search_path": test_schema}})
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        await seed_database(session)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(test_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with test_engine.connect() as conn:
        trans = await conn.begin()
        Session = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession,
                                     join_transaction_mode="create_savepoint")
        session = Session()
        try:
            yield session
        finally:
            await session.close()
            await trans.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_auth_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def seed() -> SimpleNamespace:
    return SimpleNamespace(password=get_settings().seed_password)
