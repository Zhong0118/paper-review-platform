import asyncio
import json

import pytest
from httpx import ASGITransport, AsyncClient

from scripts.acceptance_server import acceptance_environment
from tests.helpers import auth, login
from tests.test_review import VALID_DRAFT


@pytest.mark.asyncio
async def test_restricted_review_draft_compare_retry_and_submit():
    async with acceptance_environment("accepted") as runtime:
        url = f"/api/v1/expert/tasks/{runtime.task_id}/draft"
        final = f"/api/v1/expert/tasks/{runtime.task_id}:submit-final"
        # Separate HTTP requests acquire independent restricted business sessions.
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as a, AsyncClient(
            transport=ASGITransport(app=runtime.app), base_url="http://test"
        ) as b:
            user = await login(a, "expert.zhou", runtime.seed_password)
            headers = auth(user)
            bodies = [{**VALID_DRAFT, "strengths": label, "expected_revision": 0} for label in ("first", "second")]
            first, second = await asyncio.gather(
                a.put(url, headers=headers, json=bodies[0]), b.put(url, headers=headers, json=bodies[1]),
            )
            assert sorted([first.status_code, second.status_code]) == [200, 409]
            won = 0 if first.status_code == 200 else 1
            conflict = [second, first][won].json()
            assert conflict["code"] == "VERSION_CONFLICT"
            assert conflict["data"] == {"expected_revision": 0, "current_revision": 1}
            print(json.dumps({**conflict, "request_id": "[redacted]"}, ensure_ascii=False))
            # Response lost: repeating the exact first write returns its acknowledgement.
            replay = await b.put(url, headers=headers, json=bodies[won])
            assert replay.status_code == 200 and replay.json()["data"]["revision"] == 1
            assert (await a.get(url, headers=headers)).json()["data"]["strengths"] == bodies[won]["strengths"]
            updated = await a.put(url, headers=headers, json={**bodies[1-won], "expected_revision": 1})
            assert updated.status_code == 200 and updated.json()["data"]["revision"] == 2
            retry = await b.put(url, headers=headers, json=bodies[won])
            assert retry.status_code == 409 and retry.json()["code"] == "VERSION_CONFLICT"
            assert retry.json()["data"] == {"expected_revision": 0, "current_revision": 2}
            assert (await a.get(url,headers=headers)).json()["data"] == updated.json()["data"]
            # Even an intervening save with identical text is a different revision.
            same = await a.put(url,headers=headers,json={**bodies[won],"expected_revision":2})
            assert same.status_code == 200 and same.json()["data"]["revision"] == 3
            stale = await b.put(url,headers=headers,json=bodies[won])
            assert stale.status_code == 409 and stale.json()["data"]["current_revision"] == 3
            assert (await a.get(url,headers=headers)).json()["data"] == same.json()["data"]
            for old in ({}, {"expected_revision": 1}):
                stale_final = await b.post(final, headers=auth(user, idempotency="stale-final"), json={**VALID_DRAFT, **old})
                assert stale_final.status_code == 409 and stale_final.json()["code"] == "VERSION_CONFLICT"
            body = {**VALID_DRAFT, "expected_revision": 3}
            for _ in range(2):
                done = await a.post(final, headers=auth(user, idempotency="confirmed-final"), json=body)
                assert done.status_code == 200 and done.json()["data"]["status"] == "SUBMITTED"
            late = await a.put(url, headers=headers, json={**VALID_DRAFT, "expected_revision": 2})
            assert late.status_code == 409 and late.json()["code"] == "STATE_TRANSITION_DENIED"


@pytest.mark.asyncio
async def test_absent_review_draft_has_revision_zero_and_put_requires_it(client, seed):
    from tests.helpers import accepted_task
    expert, _, task_id = await accepted_task(client, seed)
    url = f"/api/v1/expert/tasks/{task_id}/draft"
    assert (await client.get(url, headers=auth(expert))).json()["data"] == {"revision": 0}
    missing = await client.put(url, headers=auth(expert), json=VALID_DRAFT)
    assert missing.status_code == 422
    assert (await client.get(url, headers=auth(expert))).json()["data"] == {"revision": 0}
