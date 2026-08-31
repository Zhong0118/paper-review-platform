from types import SimpleNamespace

from httpx import AsyncClient


def auth(tokens: dict, idempotency: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    if idempotency:
        headers["Idempotency-Key"] = idempotency
    return headers


async def login(client: AsyncClient, username: str, password: str | None = None) -> dict:
    from app.core.config import get_settings

    pwd = password or get_settings().seed_password
    res = await client.post("/api/v1/auth/login", json={"username": username, "password": pwd})
    assert res.status_code == 200, res.text
    return res.json()["data"]


async def create_draft(client: AsyncClient, tokens: dict, **overrides) -> dict:
    payload = {
        "title": "面向多校盲审的论文提交门禁",
        "abstract": "一篇不含身份线索的摘要。",
        "discipline_code": "0812",
        "discipline_name": "计算机科学与技术",
        "keywords": ["盲审", "门禁"],
    }
    payload.update(overrides)
    res = await client.post("/api/v1/theses", headers=auth(tokens), json=payload)
    assert res.status_code == 200, res.text
    return res.json()["data"]


async def attach_files(
    client: AsyncClient,
    tokens: dict,
    thesis_id: str,
    *,
    original_bytes: bytes = b"%PDF-1.4 original without names",
    anonymous_bytes: bytes = b"%PDF-1.4 anonymous text without identifiers",
    original_name: str = "original.pdf",
    anonymous_name: str = "anonymous.pdf",
    original_type: str = "application/pdf",
    anonymous_type: str = "application/pdf",
) -> None:
    for purpose, raw, name, ctype in (
        ("original", original_bytes, original_name, original_type),
        ("anonymous", anonymous_bytes, anonymous_name, anonymous_type),
    ):
        prepared = await client.post(
            "/api/v1/files:prepare-upload",
            headers=auth(tokens),
            json={"thesis_id": thesis_id, "purpose": purpose, "filename": name, "content_type": ctype},
        )
        assert prepared.status_code == 200, prepared.text
        file_id = prepared.json()["data"]["file_id"]
        upload_url = prepared.json()["data"]["upload_url"]
        put = await client.put(upload_url, headers=auth(tokens), content=raw)
        assert put.status_code == 200, put.text
        done = await client.post(f"/api/v1/files/{file_id}:complete", headers=auth(tokens))
        assert done.status_code == 200, done.text
