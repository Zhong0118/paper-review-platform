from tests.pdf_samples import pdf_bytes
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
    original_bytes: bytes = pdf_bytes(),
    anonymous_bytes: bytes = pdf_bytes(),
    original_name: str = "original.pdf",
    anonymous_name: str = "anonymous.pdf",
    original_type: str = "application/pdf",
    anonymous_type: str = "application/pdf",
) -> None:
    detail = await client.get(f"/api/v1/theses/{thesis_id}", headers=auth(tokens))
    assert detail.status_code == 200, detail.text
    revision = detail.json()["data"]["current_version"]["content_revision"]
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
        done = await client.post(f"/api/v1/files/{file_id}:complete", headers={**auth(tokens), "If-Draft-Revision": revision})
        assert done.status_code == 200, done.text
        revision = done.json()["data"]["content_revision"]


async def submit_current_draft(client, endpoint, *, headers, json):
    """Existing scenario clients read the material snapshot before confirming submission."""
    snapshot = await client.get(endpoint.removesuffix(":submit"), headers=headers)
    assert snapshot.status_code == 200, snapshot.text
    revision = snapshot.json()["data"]["current_version"]["content_revision"]
    return await client.post(endpoint, headers=headers, json={**json, "expected_content_revision": revision})


async def ready_thesis(client: AsyncClient, seed: SimpleNamespace) -> tuple[dict, dict, dict]:
    student = await login(client, "student.lin", seed.password)
    school = await login(client, "school.wang", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    submitted = await submit_current_draft(client,
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency=f"s-{thesis['id'][:8]}"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200, submitted.text
    confirmed = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",
        headers=auth(school, idempotency=f"c-{thesis['id'][:8]}"),
        json={"decision": "PASS", "version": submitted.json()["data"]["version"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    return student, school, confirmed.json()["data"]


async def accepted_task(client: AsyncClient, seed: SimpleNamespace) -> tuple[dict, dict, str]:
    from tests.test_dispatch import expert_id

    student, school, thesis = await ready_thesis(client, seed)
    platform = await login(client, "platform.chen", seed.password)
    expert_user = await login(client, "expert.zhou", seed.password)
    await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-dispatch",
        headers=auth(school, idempotency=f"cd-{thesis['id'][:8]}"),
        json={"version": thesis["version"]},
    )
    zhou = await expert_id(client, platform, thesis["id"], "zhou")
    assigned = await client.post(
        f"/api/v1/platform-review/theses/{thesis['id']}:assign",
        headers=auth(platform, idempotency=f"as-{thesis['id'][:8]}"),
        json={"expert_id": zhou},
    )
    assert assigned.status_code == 200, assigned.text
    task_id = assigned.json()["data"]["task"]["id"]
    accepted = await client.post(
        f"/api/v1/expert/tasks/{task_id}:accept",
        headers=auth(expert_user, idempotency=f"ac-{task_id[:8]}"),
    )
    assert accepted.status_code == 200, accepted.text
    return expert_user, student, task_id


async def published_thesis(client: AsyncClient, seed: SimpleNamespace) -> tuple[dict, dict, str]:
    from tests.test_review import VALID_DRAFT

    expert, student, task_id = await accepted_task(client, seed)
    school = await login(client, "school.wang", seed.password)
    await client.post(
        f"/api/v1/expert/tasks/{task_id}:submit-final",
        headers=auth(expert, idempotency=f"sf-{task_id[:8]}"),
        json=VALID_DRAFT,
    )
    theses = await client.get("/api/v1/theses", headers=auth(student))
    thesis = theses.json()["data"][0]
    await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:publish",
        headers=auth(school, idempotency=f"pub-{thesis['id'][:8]}"),
        json={"version": thesis["version"]},
    )
    return student, school, thesis["id"]
