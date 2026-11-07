#!/usr/bin/env python3

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import shutil
import signal
import sys
import tempfile
import threading
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import AsyncIterator, Callable, Sequence
from urllib.parse import urlparse, urlunparse
from uuid import UUID

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import get_settings

SCENARIOS = ("empty", "accepted", "published", "operations")
DEFAULT_PORT = 8011
OPERATIONS_PASSWORD = "PilotOnly!2026Test"


@dataclass(frozen=True)
class ScenarioState:
    task_id: str | None = None
    thesis_id: str | None = None
    operations_ids: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class AcceptanceRuntime:
    app: FastAPI
    engine: AsyncEngine
    auth_engine: AsyncEngine
    session_factory: async_sessionmaker[AsyncSession]
    scenario: str
    schema: str
    storage_root: Path
    resource_id: str
    task_id: str | None
    thesis_id: str | None
    seed_password: str
    operations_ids: dict[str, str]


async def _prepare_operations(client: AsyncClient, sessions: async_sessionmaker[AsyncSession]) -> ScenarioState:
    from app.db.rls_context import bind_candidate_identity, verified_access_claims
    from app.modules.audit import service as audit_service
    from app.modules.auth.deps import CurrentUser
    from app.modules.tenant import service as tenant_service
    from app.modules.tenant.schema import CreateBatchInput, CreateEligibilityInput, CreateTenantInput
    from app.modules.user import service as user_service
    from app.modules.user.models import User
    from app.modules.user.schema import CreateTenantUserInput

    password = OPERATIONS_PASSWORD
    admin_login = await client.post("/api/v1/auth/login", json={
        "username": "admin.system", "password": get_settings().seed_password,
    })
    admin_login.raise_for_status()
    admin_claims = verified_access_claims(admin_login.json()["data"]["access_token"])
    async with sessions() as session:
        await bind_candidate_identity(session, admin_claims)
        system_actor = CurrentUser(id=admin_claims.user_id, role="system_admin", tenant_id=None, data_scope={})
        tenant = await tenant_service.create_tenant(
            session, system_actor,
            CreateTenantInput.model_validate({
                "code": "pilot-operations", "name": "试点验收大学",
                "organization": {"external_id": "pilot-college", "name": "试点学院"},
                "reviewer": {"username": "pilot.school", "display_name": "试点学校管理员",
                             "external_id": "pilot-school", "password": password},
            }), "acceptance-operations-tenant",
        )
        organization = await tenant_service.root_organization(session, tenant.id)
        await session.commit()

    school_login = await client.post("/api/v1/auth/login", json={
        "username": "pilot.school", "password": password,
    })
    school_login.raise_for_status()
    school_claims = verified_access_claims(school_login.json()["data"]["access_token"])
    async with sessions() as session:
        await bind_candidate_identity(session, school_claims)
        school_actor = CurrentUser(id=school_claims.user_id, role="school_reviewer",
                                   tenant_id=tenant.id, data_scope={})
        batch = await tenant_service.create_batch(
            session, school_actor, CreateBatchInput(code="pilot-2026", name="试点验收批次")
        )
        student = await user_service.create_tenant_user(
            session, school_actor, tenant.id, organization.id,
            CreateTenantUserInput(username="pilot.student", display_name="试点学生",
                                  external_id="PILOT-STUDENT", password=password),
            role_code="student", membership_type="STUDENT",
        )
        supervisor = await user_service.create_tenant_user(
            session, school_actor, tenant.id, organization.id,
            CreateTenantUserInput(username="pilot.supervisor", display_name="试点导师",
                                  external_id="PILOT-SUPERVISOR", password=password),
            role_code="supervisor", membership_type="SUPERVISOR",
        )
        for created in (student, supervisor):
            await audit_service.record(session, user=school_actor, action="create_member",
                                       object_type="user", object_id=str(created.user.id))
        eligibility = await tenant_service.create_eligibility(
            session, school_actor, batch.id,
            CreateEligibilityInput(student_membership_id=student.membership.id,
                                   supervisor_membership_id=supervisor.membership.id,
                                   degree_type="硕士"),
            "acceptance-operations-eligibility",
        )
        await tenant_service.change_batch_status(session, school_actor, batch.id, "OPEN", batch.version)
        school_member_id = (await tenant_service.list_reviewers(session, tenant.id))[0][0].id
        await session.commit()
        return ScenarioState(operations_ids={
            "tenant_id": str(tenant.id), "batch_id": str(batch.id),
            "school_member_id": str(school_member_id),
            "student_member_id": str(student.membership.id),
            "supervisor_member_id": str(supervisor.membership.id),
            "eligibility_id": str(eligibility.id),
        })


def validate_database_target(database_url: str) -> str:
    parsed = urlparse(database_url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("database port must be 5433") from exc
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("acceptance database must use a loopback host")
    if port != 5433:
        raise ValueError("acceptance database must use host port 5433")
    if not parsed.scheme.startswith("postgresql"):
        raise ValueError("acceptance database must use PostgreSQL")
    return urlunparse(parsed._replace(path="/paper_review_test"))


def validate_port(port: int | str) -> int:
    value = int(port)
    if not 1024 <= value <= 65535:
        raise ValueError("port must be between 1024 and 65535")
    return value


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run an isolated blind-review acceptance server")
    parser.add_argument("--scenario", choices=SCENARIOS, default="empty")
    parser.add_argument("--port", type=validate_port, default=DEFAULT_PORT)
    return parser.parse_args(argv)


async def _task_for_thesis(
    sessions: async_sessionmaker[AsyncSession], thesis_id: str, token: str
) -> str | None:
    from app.modules.dispatch.models import ExpertTask, ReviewRound
    from app.db.rls_context import bind_candidate_identity, verified_access_claims

    async with sessions() as session:
        await bind_candidate_identity(session, verified_access_claims(token))
        task_id = (
            await session.execute(
                select(ExpertTask.id)
                .join(ReviewRound, ReviewRound.id == ExpertTask.round_id)
                .where(ReviewRound.thesis_id == UUID(thesis_id))
                .order_by(ExpertTask.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    return str(task_id) if task_id else None


async def _thesis_for_task(
    sessions: async_sessionmaker[AsyncSession], task_id: str, token: str
) -> str | None:
    from app.modules.dispatch.models import ExpertTask
    from app.db.rls_context import bind_candidate_identity, verified_access_claims

    async with sessions() as session:
        await bind_candidate_identity(session, verified_access_claims(token))
        thesis_id = (
            await session.execute(
                select(ExpertTask.thesis_id)
                .where(ExpertTask.id == UUID(task_id))
            )
        ).scalar_one_or_none()
    return str(thesis_id) if thesis_id else None


async def _prepare_scenario(
    scenario: str,
    client: AsyncClient,
    sessions: async_sessionmaker[AsyncSession],
) -> ScenarioState:
    from tests.helpers import accepted_task, published_thesis

    seed = SimpleNamespace(password=get_settings().seed_password)
    if scenario == "empty":
        return ScenarioState()
    if scenario == "operations":
        return await _prepare_operations(client, sessions)
    if scenario == "accepted":
        expert, _student, task_id = await accepted_task(client, seed)
        return ScenarioState(
            task_id=task_id,
            thesis_id=await _thesis_for_task(sessions, task_id, expert["access_token"]),
        )
    _student, school, thesis_id = await published_thesis(client, seed)
    return ScenarioState(
        task_id=await _task_for_thesis(sessions, thesis_id, school["access_token"]),
        thesis_id=thesis_id,
    )


def _restore_environment(name: str, value: str | None) -> None:
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


@asynccontextmanager
async def acceptance_environment(
    scenario: str = "empty", *, cleanup_guard: Callable[[str], None] | None = None,
    strict_cleanup: bool = False,
) -> AsyncIterator[AcceptanceRuntime]:
    if scenario not in SCENARIOS:
        raise ValueError(f"unsupported scenario: {scenario}")

    original_database = os.environ.get("DATABASE_URL")
    original_migration_database = os.environ.get("MIGRATION_DATABASE_URL")
    original_business_database = os.environ.get("BUSINESS_DATABASE_URL")
    original_auth_database = os.environ.get("AUTH_DATABASE_URL")
    original_storage = os.environ.get("STORAGE_ROOT")
    original_seed_password = os.environ.get("SEED_PASSWORD")
    test_url = validate_database_target(get_settings().database_url)
    os.environ["DATABASE_URL"] = test_url
    if scenario == "operations":
        os.environ["SEED_PASSWORD"] = OPERATIONS_PASSWORD
    get_settings.cache_clear()

    engine: AsyncEngine | None = None
    auth_engine: AsyncEngine | None = None
    owner_engine: AsyncEngine | None = None
    app: FastAPI | None = None
    storage_context: tempfile.TemporaryDirectory[str] | None = None
    storage_root: Path | None = None
    api_module = None
    original_api_engine = None
    get_session_dependency = None
    get_auth_session_dependency = None

    try:
        from tests.conftest import isolated_runtime_roles, upgrade_test_schema

        with isolated_runtime_roles(revision="0010_auth_version", cleanup_guard=cleanup_guard,
                                    strict_cleanup=strict_cleanup) as roles:
            schema = roles.schema
            os.environ["MIGRATION_DATABASE_URL"] = roles.migration_url
            os.environ["BUSINESS_DATABASE_URL"] = roles.business_url
            os.environ["AUTH_DATABASE_URL"] = roles.auth_url
            if strict_cleanup:
                storage_root = Path(tempfile.mkdtemp(prefix=f"paper-review-acceptance-{schema}-"))
            else:
                storage_context = tempfile.TemporaryDirectory(
                    prefix=f"paper-review-acceptance-{schema}-"
                )
                storage_root = Path(storage_context.name)
            os.environ["STORAGE_ROOT"] = str(storage_root)
            get_settings.cache_clear()

            owner_engine = create_async_engine(
                roles.migration_url,
                pool_pre_ping=True,
                connect_args={"server_settings": {"search_path": schema}},
            )
            owner_sessions = async_sessionmaker(owner_engine, expire_on_commit=False, class_=AsyncSession)

            from app.seed import seed_database

            async with owner_sessions() as session:
                await seed_database(session)
            async with owner_engine.begin() as conn:
                # Temporary pre-RLS grants; later policy migrations can narrow them.
                await conn.execute(text(
                    f'GRANT SELECT ON users, roles, user_role_assignments, tenants, '
                    f'tenant_user_memberships, auth_sessions TO "{roles.auth_role}"'
                ))
                await conn.execute(text(
                    f'GRANT UPDATE (last_login_at, updated_at) ON users TO "{roles.auth_role}"'
                ))
                await conn.execute(text(
                    f'GRANT INSERT, UPDATE (revoked_at, updated_at) ON auth_sessions TO "{roles.auth_role}"'
                ))
                await conn.execute(text(f'GRANT INSERT ON audit_events TO "{roles.auth_role}"'))
            upgrade_test_schema("head", schema, roles.migration_url)
            await owner_engine.dispose()
            owner_engine = None

            engine = create_async_engine(
                roles.business_url,
                pool_pre_ping=True,
                connect_args={"server_settings": {"search_path": schema}},
            )
            sessions = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
            auth_engine = create_async_engine(
                roles.auth_url,
                pool_pre_ping=True,
                connect_args={"server_settings": {"search_path": schema}},
            )
            auth_sessions = async_sessionmaker(auth_engine, expire_on_commit=False, class_=AsyncSession)

            from app.db.session import get_auth_session, get_session
            from app.main import create_app
            import app.api as api_module_ref

            get_session_dependency = get_session
            get_auth_session_dependency = get_auth_session
            api_module = api_module_ref
            original_api_engine = api_module.engine
            api_module.engine = engine
            app = create_app()

            async def isolated_session() -> AsyncIterator[AsyncSession]:
                async with sessions() as session:
                    try:
                        yield session
                    except Exception:
                        await session.rollback()
                        raise

            async def isolated_auth_session() -> AsyncIterator[AsyncSession]:
                async with auth_sessions() as session:
                    try:
                        yield session
                    except Exception:
                        await session.rollback()
                        raise

            app.dependency_overrides[get_session] = isolated_session
            app.dependency_overrides[get_auth_session] = isolated_auth_session
            try:
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://acceptance"
                ) as client:
                    state = await _prepare_scenario(scenario, client, sessions)
                settings = get_settings()
                yield AcceptanceRuntime(
                    app=app,
                    engine=engine,
                    auth_engine=auth_engine,
                    session_factory=sessions,
                    scenario=scenario,
                    schema=schema,
                    storage_root=storage_root,
                    resource_id=schema,
                    task_id=state.task_id,
                    thesis_id=state.thesis_id,
                    seed_password=settings.seed_password,
                    operations_ids=state.operations_ids,
                )
            finally:
                app.dependency_overrides.pop(get_session, None)
                app.dependency_overrides.pop(get_auth_session, None)
                api_module.engine = original_api_engine
                await engine.dispose()
                engine = None
                await auth_engine.dispose()
                auth_engine = None
    finally:
        if app is not None and get_session_dependency is not None:
            app.dependency_overrides.pop(get_session_dependency, None)
        if app is not None and get_auth_session_dependency is not None:
            app.dependency_overrides.pop(get_auth_session_dependency, None)
        if api_module is not None and original_api_engine is not None:
            api_module.engine = original_api_engine
        if engine is not None:
            await engine.dispose()
        if auth_engine is not None:
            await auth_engine.dispose()
        if owner_engine is not None:
            await owner_engine.dispose()
        if storage_context is not None:
            if cleanup_guard is not None:
                cleanup_guard("storage")
            storage_context.cleanup()
        elif strict_cleanup and storage_root is not None:
            if cleanup_guard is not None:
                cleanup_guard("storage")
            if storage_root.exists():
                shutil.rmtree(storage_root)
        _restore_environment("DATABASE_URL", original_database)
        _restore_environment("MIGRATION_DATABASE_URL", original_migration_database)
        _restore_environment("BUSINESS_DATABASE_URL", original_business_database)
        _restore_environment("AUTH_DATABASE_URL", original_auth_database)
        _restore_environment("STORAGE_ROOT", original_storage)
        _restore_environment("SEED_PASSWORD", original_seed_password)
        get_settings.cache_clear()


async def serve(scenario: str, port: int) -> None:
    import uvicorn
    from uvicorn.server import HANDLED_SIGNALS

    class AcceptanceServer(uvicorn.Server):
        @contextlib.contextmanager
        def capture_signals(self):
            if threading.current_thread() is not threading.main_thread():
                yield
                return
            original_handlers = {
                handled: signal.signal(handled, self.handle_exit) for handled in HANDLED_SIGNALS
            }
            try:
                yield
            finally:
                for handled, handler in original_handlers.items():
                    signal.signal(handled, handler)

    validate_port(port)
    interrupted = False
    async with acceptance_environment(scenario) as runtime:
        print(f"acceptance_url=http://127.0.0.1:{port}", flush=True)
        print(f"scenario={runtime.scenario}", flush=True)
        print(f"resource_id={runtime.resource_id}", flush=True)
        print(f"storage_root={runtime.storage_root}", flush=True)
        if runtime.task_id:
            print(f"task_id={runtime.task_id}", flush=True)
        if runtime.thesis_id:
            print(f"thesis_id={runtime.thesis_id}", flush=True)
        for name, value in runtime.operations_ids.items():
            print(f"{name}={value}", flush=True)
        config = uvicorn.Config(
            runtime.app,
            host="127.0.0.1",
            port=port,
            log_level="info",
        )
        server = AcceptanceServer(config)
        await server.serve()
        interrupted = bool(server._captured_signals)
    if interrupted:
        raise KeyboardInterrupt


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        asyncio.run(serve(args.scenario, args.port))
    except KeyboardInterrupt:
        return 130
    except ValueError as exc:
        print(f"acceptance server configuration error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"acceptance server failed: {type(exc).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
