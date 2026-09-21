from collections.abc import AsyncIterator
from contextlib import contextmanager
from types import SimpleNamespace
from pathlib import Path
from uuid import uuid4
import os
import subprocess
import sys
from urllib.parse import urlparse, urlunparse

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text, create_engine
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_session
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


@contextmanager
def migrated_test_schema(revision="head"):
    # Every run gets its own migrated schema in the dedicated test database.
    # Existing local test data is neither stamped nor dropped.
    admin = create_engine(_admin_url().replace("+asyncpg", "+psycopg"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": TEST_DB_NAME}).scalar()
        if not exists:
            conn.execute(text(f"CREATE DATABASE {TEST_DB_NAME}"))
    admin.dispose()
    schema = "test_" + uuid4().hex
    engine = create_engine(_test_url().replace("+asyncpg", "+psycopg"))
    with engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", revision],
            cwd=Path(__file__).resolve().parents[1],
            env={**os.environ, "DATABASE_URL": _test_url(), "PGOPTIONS": f"-c search_path={schema}"},
            check=True, capture_output=True, text=True,
        )
        yield schema
    finally:
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
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
        Session = async_sessionmaker(bind=conn, expire_on_commit=False, class_=AsyncSession)
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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def seed() -> SimpleNamespace:
    return SimpleNamespace(password=get_settings().seed_password)
