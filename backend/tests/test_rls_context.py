from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
import pytest
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.security import create_access_token, create_download_token
from app.db.rls_context import bind_candidate_identity, verified_access_claims
from app.db.session import get_auth_session, get_session
from app.main import create_app
from app.modules.auth.deps import get_current_user
from app.modules.audit import service as audit_service
from scripts.acceptance_server import acceptance_environment


def _bearer(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _request() -> Request:
    return Request({"type": "http", "headers": []})


async def _seed_claims(runtime, username):
    async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/login", json={
            "username": username, "password": runtime.seed_password,
        })
    assert response.status_code == 200
    return verified_access_claims(response.json()["data"]["access_token"])


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_claim", [{"role": "unrecognized_role"}, {"sub": 123}])
async def test_signed_invalid_role_is_rejected_before_identity_query(invalid_claim):
    async with acceptance_environment("empty") as runtime:
        claims = await _seed_claims(runtime, "student.lin")
        async with runtime.session_factory() as session:
            now = datetime.now(timezone.utc)
            payload = {
                "sub": str(claims.user_id), "role": "student", "tenant_id": str(claims.tenant_id),
                "auth_version": claims.auth_version,
                "iat": int(now.timestamp()), "exp": int((now + timedelta(minutes=5)).timestamp()),
            }
            payload.update(invalid_claim)
            token = jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")

            with pytest.raises(AppError) as error:
                await get_current_user(_request(), _bearer(token), session)
            assert error.value.code == "AUTH_REQUIRED"
            assert session.in_transaction() is False


@pytest.mark.asyncio
async def test_stale_verified_identity_rolls_back_before_business_service():
    async with acceptance_environment("empty") as runtime:
        claims = await _seed_claims(runtime, "student.lin")
        async with runtime.session_factory() as session:
            token = create_access_token(user_id=claims.user_id, role="student",
                                        tenant_id=claims.tenant_id, auth_version=claims.auth_version + 1)

            with pytest.raises(AppError) as error:
                await get_current_user(_request(), _bearer(token), session)
            assert error.value.code == "AUTH_REQUIRED"
            assert session.in_transaction() is False


@pytest.mark.asyncio
async def test_invalid_signature_never_sets_database_context():
    async with acceptance_environment("empty") as runtime:
        statements = []

        def observe(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(runtime.engine.sync_engine, "before_cursor_execute", observe)
        try:
            now = datetime.now(timezone.utc)
            token = jwt.encode({
                "sub": str(uuid4()), "role": "student", "tenant_id": str(uuid4()),
                "auth_version": 1, "iat": int(now.timestamp()),
                "exp": int((now + timedelta(minutes=5)).timestamp()),
            }, "invalid-signature-test-key-at-least-32-bytes", algorithm="HS256")
            async with runtime.session_factory() as session:
                with pytest.raises(AppError) as error:
                    await get_current_user(_request(), _bearer(token), session)
                assert error.value.code == "AUTH_REQUIRED"
                assert session.in_transaction() is False
        finally:
            event.remove(runtime.engine.sync_engine, "before_cursor_execute", observe)
        assert not any("set_config" in statement for statement in statements)


@pytest.mark.asyncio
async def test_transaction_context_does_not_leak_after_commit_rollback_or_savepoint(rls_role_environment):
    roles = rls_role_environment
    engine = create_async_engine(
        roles.business_url, pool_size=1, max_overflow=0,
        connect_args={"server_settings": {"search_path": roles.schema}},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    def claims(user_id):
        token = create_access_token(user_id=user_id, role="student", tenant_id=uuid4(), auth_version=1)
        return verified_access_claims(token)

    try:
        actor_a, actor_b = uuid4(), uuid4()
        async with sessions() as session:
            await bind_candidate_identity(session, claims(actor_a))
            assert (await session.scalar(text("SELECT current_setting('app.user_id', true)"))) == str(actor_a)
            nested = await session.begin_nested()
            await nested.rollback()
            assert (await session.scalar(text("SELECT current_setting('app.user_id', true)"))) == str(actor_a)
            await session.commit()

        async with sessions() as session:
            assert await session.scalar(text("SELECT nullif(current_setting('app.user_id', true), '')")) is None
            await bind_candidate_identity(session, claims(actor_b))
            assert (await session.scalar(text("SELECT current_setting('app.user_id', true)"))) == str(actor_b)
            await session.rollback()
            assert await session.scalar(text("SELECT nullif(current_setting('app.user_id', true), '')")) is None

        async with sessions() as session:
            assert await session.scalar(text("SELECT nullif(current_setting('app.user_id', true), '')")) is None
            with pytest.raises(TypeError):
                await bind_candidate_identity(session, {"sub": str(actor_a)})
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_login_uses_auth_session_without_opening_business_session(db_session, seed):
    app = create_app()

    async def forbidden_business_session():
        raise AssertionError("login opened business session")
        yield

    async def auth_session():
        yield db_session

    app.dependency_overrides[get_session] = forbidden_business_session
    app.dependency_overrides[get_auth_session] = auth_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/auth/login", json={
            "username": "student.lin", "password": seed.password,
        })
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_acceptance_login_uses_distinct_auth_database_role():
    async with acceptance_environment("empty") as runtime:
        auth_role = make_url(get_settings().auth_database_url).username
        business_role = make_url(get_settings().business_database_url).username
        assert auth_role != business_role
        auth_engine = create_async_engine(
            get_settings().auth_database_url,
            connect_args={"server_settings": {"search_path": runtime.schema}},
        )
        try:
            async with auth_engine.connect() as conn:
                row = (await conn.execute(text("""
                    SELECT current_user,
                           has_column_privilege(current_user, 'users', 'password_hash', 'SELECT'),
                           has_table_privilege(current_user, 'theses', 'SELECT'),
                           has_table_privilege(current_user, 'audit_events', 'SELECT')
                """))).one()
            assert row == (auth_role, True, False, False)
        finally:
            await auth_engine.dispose()
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            response = await client.post("/api/v1/auth/login", json={
                "username": "student.lin", "password": runtime.seed_password,
            })
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_system_login_with_null_tenant_can_use_business_session():
    async with acceptance_environment("empty") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            login = await client.post("/api/v1/auth/login", json={
                "username": "admin.system", "password": runtime.seed_password,
            })
            assert login.status_code == 200
            token = login.json()["data"]["access_token"]
            response = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_unauthenticated_file_denials_use_auth_session_after_business_rollback(monkeypatch):
    async with acceptance_environment("empty") as runtime:
        expected_role = make_url(get_settings().auth_database_url).username
        seen_roles = []
        original_record = audit_service.record

        async def observed_record(session, **kwargs):
            seen_roles.append(await session.scalar(text("SELECT current_user")))
            return await original_record(session, **kwargs)

        monkeypatch.setattr(audit_service, "record", observed_record)
        file_id = uuid4()
        expert = await _seed_claims(runtime, "expert.zhou")
        stale_grant, _ = create_download_token(
            user_id=expert.user_id, role="expert", tenant_id=None, file_id=file_id,
            auth_version=expert.auth_version + 1,
        )
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            authorize = await client.post(f"/api/v1/files/{file_id}:authorize-download")
            read = await client.get(f"/api/v1/files/{file_id}/content")
            stale = await client.get(f"/api/v1/files/{file_id}/content", params={"token": stale_grant})
        assert authorize.status_code == 401
        assert read.status_code == 401
        assert stale.status_code == 401
        assert seen_roles == [expected_role, expected_role, expected_role]
