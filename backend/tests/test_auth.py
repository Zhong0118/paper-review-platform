from types import SimpleNamespace

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_and_me(client: AsyncClient, seed: SimpleNamespace):
    res = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": seed.password},
    )
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["data"]["role"] == "student"
    assert me.json()["data"]["tenant_code"] == "demo-univ"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    res = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": "nope"},
    )
    assert res.status_code == 401
    assert res.json()["code"] == "AUTH_REQUIRED"


@pytest.mark.asyncio
async def test_logout_revokes_refresh(client: AsyncClient, seed: SimpleNamespace):
    login = await client.post(
        "/api/v1/auth/login",
        json={"username": "student.lin", "password": seed.password},
    )
    assert login.status_code == 200
    refresh = login.json()["data"]["refresh_token"]
    access = login.json()["data"]["access_token"]
    await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": refresh},
        headers={"Authorization": f"Bearer {access}"},
    )
    again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert again.status_code == 401
