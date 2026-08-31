# Slice 0+1 Auth and Submit-to-Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a runnable FastAPI + PostgreSQL backend and wire PAGE-001/002/003/004 so a seeded student can submit original+anonymous files and a school reviewer can pass anonymization to `READY_FOR_DISPATCH`.

**Architecture:** Modular monolith in-process. Session JWT carries user, role, and tenant; clients never send `tenant_id`. `workflow.transition` is the only writer of `theses.stage`. Files live on disk under `storage/{purpose}/`. Demo `scenarioService` stays frozen; non-demo pages call new HTTP clients.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL 16 (Docker host port 5433), Pydantic v2, passlib[argon2], PyJWT, pytest + httpx + pytest-asyncio. Vue 3 + Pinia + existing `frontend/src/api/request.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md`
- PostgreSQL only; never SQLite. Docker service name `postgres`, host port **5433**, db `paper_review`. Do not use CRM 5432/6379 or the host Postgres.
- No Redis, Celery, MinIO, SSO, school proxy/batch import, dispatch, review, fees, or RLS in this slice.
- Do not fill unused empty files under `backend/app/modules/{dispatch,review,result,finance,notice,expert,integration,statistics,template}`.
- Do not change behaviour of `frontend/src/demo/scenarioService.ts`.
- Do not delete `docs/99_原始材料/`.
- API prefix `/api/v1`. Envelope `{ request_id, code, message, data }`. Errors from spec section 5 of `docs/05_API设计/API设计.md`.
- Enums from `docs/02_产品设计/产品与流程设计.md` section 7. Stages reachable now: `DRAFT`, `SUBMITTED`, `PREPARING`, `READY_FOR_DISPATCH`, `TERMINATED`.
- `workflow.transition(...)` is the only mutation of `theses.stage`.
- Clients never pass `tenant_id`. Sensitive missing resources return `RESOURCE_NOT_FOUND` (HTTP 404), audit logs the real reason.
- TDD: failing test, then minimal code, then commit per task.
- Work on current branch `codex/frontend-client-demo`; no worktree unless the user asks.
- Fictional seed identities only. Passwords from env, default `ChangeMe!dev-only`.

**File map (create unless noted):**

```
docker-compose.yml
.env.example
README.md
backend/pyproject.toml
backend/.env.example
backend/alembic.ini
backend/alembic/env.py
backend/alembic/versions/0001_slice01_identity_thesis.py
backend/app/main.py                          (overwrite stub)
backend/app/api.py                           (overwrite stub)
backend/app/lifespan.py                      (overwrite stub)
backend/app/core/config.py
backend/app/core/security.py
backend/app/core/response.py
backend/app/core/exceptions.py
backend/app/core/exception_handlers.py
backend/app/core/logging.py
backend/app/db/base.py
backend/app/db/session.py
backend/app/db/mixins.py
backend/app/shared/enums.py
backend/app/shared/errors.py
backend/app/modules/auth/{models,schemas,service,router,deps}.py
backend/app/modules/tenant/models.py
backend/app/modules/user/models.py
backend/app/modules/workflow/{models,service}.py
backend/app/modules/files/{models,service,router,storage.py}
backend/app/modules/thesis/{models,schemas,service,router,detector.py}
backend/app/modules/audit/{models,service}.py
backend/app/seed.py
backend/tests/conftest.py
backend/tests/test_health.py
backend/tests/test_auth.py
backend/tests/test_thesis_submit.py
backend/tests/test_anonymization.py
backend/tests/test_isolation.py
frontend/src/api/auth.ts
frontend/src/api/theses.ts
frontend/src/api/schoolReview.ts
frontend/src/api/files.ts
frontend/src/stores/auth.ts                  (modify)
frontend/src/modules/auth/pages/LoginPage.vue
frontend/src/modules/thesis/pages/StudentDashboardPage.vue
frontend/src/modules/thesis/pages/ThesisEditPage.vue
frontend/src/modules/school/pages/PreparationListPage.vue
docs/README.md                               (modify)
```

Reuse existing empty stubs by **overwriting** them; do not leave `# 接口层` comments as the only content.

---

### Task 1: Compose, Python project, health checks

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `backend/pyproject.toml`, `backend/.env.example`, `backend/alembic.ini`, `backend/alembic/env.py`, `backend/tests/conftest.py`, `backend/tests/test_health.py`
- Overwrite: `backend/app/main.py`, `backend/app/api.py`, `backend/app/lifespan.py`, `backend/app/core/config.py`, `backend/app/core/response.py`, `backend/app/core/exceptions.py`, `backend/app/core/exception_handlers.py`, `backend/app/core/logging.py`, `backend/app/db/session.py`, `backend/app/db/base.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `Settings` from env; `create_app()`; `GET /healthz` and `GET /readyz`; envelope helper `ok(data, request_id)`; `AppError(code, http_status, message, details=None)`.
- Produces compose service `postgres` published at `127.0.0.1:5433`.

- [x] **Step 1: Write failing health test**

```python
# backend/tests/test_health.py
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app

@pytest.mark.asyncio
async def test_healthz_ok():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/healthz")
    assert res.status_code == 200
    body = res.json()
    assert body["code"] == "OK"
    assert "request_id" in body
```

- [x] **Step 2: Run test, expect import/app missing**

Run: `cd backend && python -m pytest tests/test_health.py -v`

Expected: FAIL (`No module named 'app'` or `create_app` missing). Use a venv after Step 3 if pytest is not installed yet.

- [x] **Step 3: Add project files and minimal app**

`docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: paper-review-postgres
    ports:
      - "127.0.0.1:5433:5432"
    environment:
      POSTGRES_DB: paper_review
      POSTGRES_USER: paper_review
      POSTGRES_PASSWORD: paper_review_dev
    volumes:
      - paper_review_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U paper_review -d paper_review"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  paper_review_pgdata:
```

`backend/pyproject.toml` dependencies (pin reasonably): `fastapi`, `uvicorn[standard]`, `sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `pydantic-settings`, `passlib[argon2]`, `pyjwt`, `python-multipart`, `httpx`, `pytest`, `pytest-asyncio`. Python `>=3.12`. Package dir is `app`.

`backend/app/core/config.py`: `DATABASE_URL` default `postgresql+asyncpg://paper_review:paper_review_dev@127.0.0.1:5433/paper_review`, `JWT_SECRET`, `JWT_ACCESS_TTL_SECONDS=1800`, `JWT_REFRESH_TTL_SECONDS=1209600`, `STORAGE_ROOT` default repo `storage/`, `SEED_PASSWORD`.

`GET /healthz` does not touch DB. `GET /readyz` in this task may return `OK` with `data.status=not_migrated` if DB ping fails — Task 2 tightens it to require DB.

Envelope on success:

```json
{ "request_id": "<uuid>", "code": "OK", "message": "成功", "data": {} }
```

- [x] **Step 4: Install, run health test**

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
python -m pytest tests/test_health.py -v
```

Expected: PASS.

- [x] **Step 5: Start Postgres and document run commands in root README.md**

```bash
docker compose up -d postgres
docker compose ps
```

Expected: `paper-review-postgres` healthy, port 5433. Root README: compose up, backend uvicorn on 8000, frontend pnpm dev, demo vs real login. Do not claim SSO or dispatch exist.

- [x] **Step 6: Commit**

```bash
git add docker-compose.yml .env.example README.md backend/pyproject.toml backend/.env.example backend/alembic.ini backend/alembic/env.py backend/app backend/tests
git commit -m "feat: boot FastAPI health checks and isolated Postgres on 5433"
```

---

### Task 2: Identity schema, seed, login

**Files:**
- Create: `backend/alembic/versions/0001_slice01_identity_thesis.py` (identity tables first; thesis tables may be empty stubs in this revision or split — prefer **one revision** with all slice tables so later tasks do not fight migrations. Include thesis/file/workflow/audit tables from spec §7 even if unused until Task 3.)
- Create: `backend/app/db/mixins.py`, `backend/app/shared/enums.py`, models under auth/tenant/user/workflow/files/thesis/audit, `backend/app/modules/auth/{schemas,service,router,deps}.py`, `backend/app/seed.py`, `backend/tests/test_auth.py`
- Overwrite: `backend/app/core/security.py`, `backend/app/db/session.py`
- Modify: `backend/app/api.py`, `backend/tests/conftest.py`

**Interfaces:**
- Produces: `POST /api/v1/auth/login` `{ username, password }` → `{ access_token, refresh_token, token_type, expires_in, user }`; `POST /api/v1/auth/refresh`; `POST /api/v1/auth/logout`; `GET /api/v1/me`.
- Produces: `CurrentUser` dep: `id: UUID`, `role: RoleCode`, `tenant_id: UUID | None`, `data_scope: dict`.
- Produces seed usernames: `student.lin`, `school.wang`, `platform.chen`, `expert.zhou`, `admin.system`, `other.student`. Password: `SEED_PASSWORD`.
- Consumes: Task 1 `create_app`, Settings, envelope.

Table columns follow `docs/04_数据库设计/增量1_字段级数据库设计.md` for identity; thesis tables follow spec §7. `auth_sessions`: `id`, `user_id`, `refresh_token_hash`, `expires_at`, `revoked_at`, timestamps. `idempotency_keys`: `key`, `user_id`, `route`, `request_hash`, `response_code`, `response_body`, `created_at`. Partial unique index on theses: unique `(tenant_id, student_membership_id, review_batch_id)` WHERE `stage <> 'TERMINATED'`.

- [x] **Step 1: Write failing login tests**

```python
@pytest.mark.asyncio
async def test_login_and_me(client, seed):
    res = await client.post("/api/v1/auth/login", json={"username": "student.lin", "password": seed.password})
    assert res.status_code == 200
    token = res.json()["data"]["access_token"]
    me = await client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["data"]["role"] == "student"
    assert me.json()["data"]["tenant_code"] == "demo-univ"

@pytest.mark.asyncio
async def test_login_wrong_password(client):
    res = await client.post("/api/v1/auth/login", json={"username": "student.lin", "password": "nope"})
    assert res.status_code == 401
    assert res.json()["code"] == "AUTH_REQUIRED"

@pytest.mark.asyncio
async def test_logout_revokes_refresh(client, seed):
    login = await client.post("/api/v1/auth/login", json={"username": "student.lin", "password": seed.password})
    refresh = login.json()["data"]["refresh_token"]
    await client.post("/api/v1/auth/logout", json={"refresh_token": refresh}, headers={"Authorization": f"Bearer {login.json()['data']['access_token']}"})
    again = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert again.status_code == 401
```

`conftest.py`: session-scoped engine against `paper_review_test` on 5433 (create DB if missing), run alembic upgrade, seed, function-scoped ASGI client, rollback or truncate between tests.

- [x] **Step 2: Run tests, expect 404 / missing tables**

Run: `cd backend && python -m pytest tests/test_auth.py -v`

Expected: FAIL.

- [x] **Step 3: Implement models, migration, security, auth service, seed**

- Argon2 hashes via passlib. JWT `sub=user_id`, claims `role`, `tenant_id` (omit or null for `system_admin`/`expert` if no tenant — **expert has no tenant**; `platform_reviewer` is platform-scoped: `tenant_id` null, `is_platform` true).
- Seed `demo-univ` and `other-univ` as spec §9. Student eligibility on demo: name `林知远`, student no `20260042`, supervisor `赵文博` (fictional, matches current demo copy so detector tests can reuse).
- `GET /readyz` now pings DB and checks alembic version.

- [x] **Step 4: Pass auth tests**

Run: `cd backend && python -m pytest tests/test_auth.py tests/test_health.py -v`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: add identity schema, seed accounts, and JWT login"
```

---

### Task 3: Files + thesis draft/submit + detector + school confirm

**Files:**
- Create: `backend/app/modules/files/{storage.py,service.py,router.py}`, `backend/app/modules/workflow/service.py`, `backend/app/modules/thesis/{schemas.py,service.py,router.py,detector.py}`, `backend/app/modules/audit/service.py`, `backend/tests/test_thesis_submit.py`, `backend/tests/test_anonymization.py`, `backend/tests/test_isolation.py`
- Modify: `backend/app/api.py`, models if Task 2 left columns incomplete

**Interfaces:**
- Produces `workflow.transition(session, *, thesis, to_stage, action, actor, reason=None, expected_version=None) -> Thesis` raising `AppError("STATE_TRANSITION_DENIED"|"VERSION_CONFLICT")`, appends `workflow_events`.
- Produces file API: `POST /api/v1/files:prepare-upload` body `{ thesis_id, purpose }` purpose in `original|anonymous|attachment` → `{ file_id, upload_url }` where upload is `PUT /api/v1/files/{id}/content` (same-origin, auth required) — keep it simple; do not implement S3 presign.
- Produces `POST /api/v1/files/{id}:complete` then `POST /api/v1/files/{id}:authorize-download` → `{ url, expires_at }` pointing at `GET /api/v1/files/{id}/content?token=`.
- Produces thesis API as spec §8. Student list/detail include `stage`, `allowed_actions`, `version`, `anonymization` summary, `current_version`.
- Produces detector `run_anonymization_check(version, eligibility, files) -> (PASS|FAIL|REVIEW_REQUIRED, findings)`.
- Consumes: `CurrentUser`, seed eligibility fields `student_name`, `student_no`, `supervisor_name`.

**Submit algorithm (one request, one DB transaction except file IO already on disk):**

1. Lock thesis row (`SELECT ... FOR UPDATE`).
2. Validate eligibility `ELIGIBLE`, batch `OPEN`, original+anonymous completed, discipline in catalog, keywords 1–5 unique.
3. `transition` to `SUBMITTED`.
4. Run detector on anonymous file (filename, PDF metadata if pdf, extracted text; for `.txt` in tests use utf-8 body).
5. `transition` to `PREPARING`.
6. If auto conclusion `FAIL`, `transition` to `DRAFT` with reason `ANONYMIZATION_FAILED`, clone a new editable `thesis_versions` row copying metadata (files stay on old version; new version starts with no files so student re-uploads — **simpler alternative allowed**: keep files attached to new draft version via new `thesis_version_files` rows pointing at same `file_objects`). Prefer **reuse file_objects on the new draft version**.
7. Persist `anonymization_checks` on the **submitted** version.

School `confirm-anonymization`:
- `PASS` only if latest check is not `FAIL` and stage is `PREPARING` → `READY_FOR_DISPATCH`.
- `REJECT` requires `reason` → `DRAFT` + new editable version.

Withdraw before dispatch: stage in `SUBMITTED|PREPARING|READY_FOR_DISPATCH` → `DRAFT` + new version.

Delete: only if no `workflow_events` action `submit` exists.

- [x] **Step 1: Write failing tests (copy into the three test modules)**

```python
@pytest.mark.asyncio
async def test_student_submit_pass_then_school_confirms(client, seed, tmp_storage):
    student = await login(client, "student.lin")
    school = await login(client, "school.wang")
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"], original_bytes=b"%PDF-1.4 ok", anonymous_bytes=b"%PDF-1.4 anonymous text without identifiers")
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency="sub-1"),
        json={"version": thesis["version"]},
    )
    assert submitted.status_code == 200
    assert submitted.json()["data"]["stage"] == "PREPARING"
    events = submitted.json()["data"]["recent_events"]
    assert "SUBMITTED" in {e["to_stage"] for e in events}

    confirmed = await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",
        headers=auth(school, idempotency="cfm-1"),
        json={"decision": "PASS", "version": submitted.json()["data"]["version"]},
    )
    assert confirmed.json()["data"]["stage"] == "READY_FOR_DISPATCH"

@pytest.mark.asyncio
async def test_failing_detection_returns_to_draft(client, seed):
    student = await login(client, "student.lin")
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"], anonymous_name="20260042.pdf", anonymous_bytes=b"author 林知远 20260042 赵文博")
    res = await client.post(f"/api/v1/theses/{thesis['id']}:submit", headers=auth(student, idempotency="sub-fail"), json={"version": thesis["version"]})
    assert res.json()["data"]["stage"] == "DRAFT"
    assert res.json()["data"]["anonymization"]["auto_conclusion"] == "FAIL"
    assert res.json()["data"]["anonymization"]["findings"]

@pytest.mark.asyncio
async def test_school_cannot_pass_failed_check(client):
    ...  # submit failing paper, school PASS -> 409 STATE_TRANSITION_DENIED or 422 ANONYMIZATION_FAILED

@pytest.mark.asyncio
async def test_idempotent_submit(client):
    ...  # same Idempotency-Key twice -> same thesis version id

@pytest.mark.asyncio
async def test_other_tenant_cannot_read(client):
    student = await login(client, "student.lin")
    other = await login(client, "other.student")
    thesis = await create_draft(client, student)
    res = await client.get(f"/api/v1/theses/{thesis['id']}", headers=auth(other))
    assert res.status_code == 404
    assert res.json()["code"] == "RESOURCE_NOT_FOUND"

@pytest.mark.asyncio
async def test_expert_cannot_download_original(client):
    ...  # student uploads original, expert authorize-download -> 404 or 403 mapped to RESOURCE_NOT_FOUND for original

@pytest.mark.asyncio
async def test_ineligible_cannot_create(client, seed_revoke_or_extra_user):
    ...

@pytest.mark.asyncio
async def test_cannot_delete_after_submit(client):
    ...
```

Helper `login`/`create_draft`/`attach_files` live in `backend/tests/conftest.py`. For PDFs, detector must also treat raw bytes as text if pdf parse fails — so the FAIL test can use a `.txt` anonymous file **or** PDF with plaintext stream. Allow MIME `application/pdf` and `text/plain` in tests; production upload still accepts pdf/docx. Spec: reject encrypted PDFs — if pypdf says encrypted, `FILE_NOT_READY`/`VALIDATION_FAILED` on complete.

- [x] **Step 2: Run tests, expect 404**

Run: `cd backend && python -m pytest tests/test_thesis_submit.py tests/test_anonymization.py tests/test_isolation.py -v`

Expected: FAIL.

- [x] **Step 3: Implement storage, detector, workflow, thesis/school routers**

Detector hits if any of student name, student no, supervisor name appear in filename, metadata dict values, or extracted text (case-sensitive for Chinese, case-insensitive for ASCII). Findings: `{ "field": "student_no", "matched_text": "20260042", "location": "filename"|"metadata"|"body" }`.

`allowed_actions` computed server-side from stage + role + check conclusion.

Platform reviewer hitting `/school-review/*` or student write APIs: 403 `ACCESS_DENIED`. System admin same for thesis content.

- [x] **Step 4: Pass all backend tests**

Run: `cd backend && python -m pytest -v`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: submit thesis through anonymization gate to ready-for-dispatch"
```

---

### Task 4: Frontend real API on PAGE-001/002/003/004

**Files:**
- Create: `frontend/src/api/auth.ts`, `frontend/src/api/theses.ts`, `frontend/src/api/schoolReview.ts`, `frontend/src/api/files.ts`, `frontend/src/modules/auth/__tests__/realLogin.spec.ts`, `frontend/src/modules/thesis/__tests__/realSubmit.wiring.spec.ts` (mock httpApi)
- Modify: `frontend/src/stores/auth.ts`, `frontend/src/modules/auth/pages/LoginPage.vue`, `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`, `frontend/src/modules/thesis/pages/ThesisEditPage.vue`, `frontend/src/modules/school/pages/PreparationListPage.vue`
- Modify: `docs/README.md` — add “现行施工规格” pointing at the slice spec; mark `docs/superpowers/plans/2026-08-10-*.md` and `2026-08-11-*` / `2026-08-12-*` as demo history
- Do **not** modify `frontend/src/demo/scenarioService.ts`

**Interfaces:**
- Consumes: existing `httpApi` in `frontend/src/api/request.ts`.
- Produces: `loginWithPassword(username, password)`, persist access+refresh in `sessionStorage` keys `pr.access_token` / `pr.refresh_token` / `pr.user`, restore on store init.
- Produces: when `import.meta.env.VITE_DEMO_MODE !== 'true'`, student/school pages call HTTP APIs; demo controllers remain hidden (already gated).
- `LoginPage` `submitFormalLogin` calls real login and `router.push(defaultRouteByRole[role])`. School SSO tab stays “not connected” copy.

- [ ] **Step 1: Failing tests**

```ts
it('logs in with password API and stores session', async () => {
  // mock httpApi.post to return student token
  // mount LoginPage demoMode=false, fill account/password, submit
  // expect useAuthStore().user.role === 'student'
})
```

Keep existing LoginPage demo tests passing.

- [ ] **Step 2: Run**

Run: `cd frontend && pnpm test:unit:run -- src/modules/auth/__tests__/realLogin.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement clients and wire pages**

Auth store: `hydrateFromStorage()`, `loginWithPassword`, `logout` calls API then `clearSession`.

Student dashboard: `listTheses`, `getEligibility`, `createDraft`, `withdraw`; buttons from `allowed_actions`.

Edit page: load thesis by query `thesisId`; save PATCH; upload via prepare → PUT content → complete for original and anonymous; submit with idempotency key (`crypto.randomUUID()`).

School preparation: `listSchoolTheses` (filter PREPARING), detail with findings, confirm PASS/REJECT. Hide or disable 代传/批量 buttons when not demo mode (those APIs do not exist). Do not call `service.loginAs('school_reviewer')` in non-demo — that currently impersonates inside the demo service.

- [ ] **Step 4: Run frontend unit tests**

Run: `cd frontend && pnpm test:unit:run`

Expected: existing demo tests still PASS; new wiring tests PASS.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && pnpm type-check`

Expected: PASS.

- [ ] **Step 6: Manual golden path (required evidence)**

```bash
docker compose up -d postgres
cd backend && source .venv/bin/activate && alembic upgrade head && python -m app.seed
uvicorn app.main:app --reload --port 8000
# other terminal
cd frontend && VITE_DEMO_MODE=false pnpm dev
```

Log in `student.lin` / seed password → create draft → upload two files (anonymous without identifiers) → submit → log in `school.wang` → pass → stage ready. Then repeat with anonymous filename containing `20260042` and confirm auto return to draft.

- [ ] **Step 7: Commit**

```bash
git add frontend docs/README.md
git commit -m "feat: wire login and submit-ready pages to real APIs"
```

---

## Spec coverage

| Spec section | Task |
|---|---|
| §3 infra 5433, no Redis | 1 |
| §4 auth JWT, seed roles | 2 |
| §5.1 SUBMITTED then PREPARING | 3 |
| §5.2 FAIL auto draft | 3 |
| §5.3 one thesis per batch, delete rule | 3 |
| §5.4 allowed_actions | 3–4 |
| §5.5 file ACL | 3 |
| §6 modules | 1–3 |
| §7 tables | 2 |
| §8 APIs | 2–3 |
| §9 seed | 2 |
| §10 tests | 2–4 |
| §11 docs | 1, 4 |
| §2 RLS deferred | noted, no task (intentional) |

## Placeholder / consistency notes

- Upload uses authenticated `PUT /files/{id}/content` instead of S3 presign (YAGNI, spec allowed local storage).
- Platform reviewer `tenant_id` is null; school isolation tests use two student tenants.
- Detector accepts `text/plain` so tests do not depend on a PDF parser being perfect.
- Confirm-dispatch is not implemented.

Plan complete and saved to `docs/superpowers/plans/2026-08-31-slice-0-1-auth-submit-ready.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
