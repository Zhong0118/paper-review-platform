"""Read-review probe: records the pre-fix T05 batch/create race in an isolated schema.

Run: PYTHONPATH=backend backend/.venv/bin/python docs/reviews/probes/t05_batch_race.py
This is evidence of the observed defect, not a passing regression assertion.
"""
import asyncio

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from scripts.acceptance_server import acceptance_environment
from app.modules.thesis import service as thesis_service


async def main():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            async def login(name):
                response = await client.post("/api/v1/auth/login", json={"username": name, "password": runtime.seed_password})
                response.raise_for_status()
                return {"Authorization": "Bearer " + response.json()["data"]["access_token"]}

            student, school = await login("pilot.student"), await login("pilot.school")
            checked, resume = asyncio.Event(), asyncio.Event()
            original = thesis_service._require_discipline

            async def paused(*args):
                checked.set()
                await asyncio.wait_for(resume.wait(), 10)
                return await original(*args)

            thesis_service._require_discipline = paused
            task = asyncio.create_task(client.post("/api/v1/theses", headers=student, json={
                "title": "Race probe", "abstract": "Synthetic material", "discipline_code": "0812",
                "discipline_name": "计算机科学与技术", "keywords": ["test"],
            }))
            try:
                await asyncio.wait_for(checked.wait(), 10)
                batch = runtime.operations_ids["batch_id"]
                close = await client.post(f"/api/v1/school-admin/batches/{batch}:close-submissions",
                                          headers={**school, "Idempotency-Key": "probe-close"},
                                          json={"expected_version": 2})
                close.raise_for_status()
                archive = await client.post(f"/api/v1/school-admin/batches/{batch}:archive",
                                            headers={**school, "Idempotency-Key": "probe-archive"},
                                            json={"expected_version": close.json()["data"]["version"]})
                archive.raise_for_status()
                resume.set()
                created = await asyncio.wait_for(task, 10)
                async with runtime.session_factory() as session:
                    rows = (await session.execute(text(
                        "SELECT b.status, t.stage FROM theses t JOIN review_batches b ON b.id=t.review_batch_id"
                    ))).all()
                print({"close_http": close.status_code, "archive_http": archive.status_code,
                       "create_http": created.status_code, "batch_thesis_states": [list(row) for row in rows]})
            finally:
                resume.set()
                await asyncio.gather(task, return_exceptions=True)
                thesis_service._require_discipline = original


asyncio.run(main())
