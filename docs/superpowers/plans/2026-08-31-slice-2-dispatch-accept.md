# Slice 2 Dispatch and Accept Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** School confirm-dispatch creates a review round; Baijie assigns one seeded expert; the expert accepts or rejects; the first live task moves the thesis to `UNDER_REVIEW`.

**Architecture:** Extend the slice 0+1 modular monolith. `dispatch` owns rounds/tasks; `expert` owns platform profiles and candidates; `workflow.transition` remains the only writer of `theses.stage`. Fee freeze is skipped with an audit flag. Demo `scenarioService` stays frozen.

**Tech Stack:** Same as slice 0+1 (FastAPI, SQLAlchemy 2, Postgres 5433, Vue 3, existing `httpApi`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md`
- Do not change `frontend/src/demo/scenarioService.ts` behaviour.
- Do not implement review scoring, Celery timeouts, or real fee freeze.
- Sensitive ACL: missing and forbidden thesis/file/task ids return `RESOURCE_NOT_FOUND` for experts/other tenants; wrong role on school/platform write APIs returns `ACCESS_DENIED` (403) as in slice 1 school-review.
- TDD; current branch `codex/frontend-client-demo`; no worktree.
- Seed password still `SEED_PASSWORD` / `ChangeMe!dev-only`.
- Add workflow allow pair `(READY_FOR_DISPATCH, UNDER_REVIEW, "assign_first_task")` and `(UNDER_REVIEW, TERMINATED, "terminate")`.

**File map:**

```
backend/alembic/versions/0002_slice02_dispatch.py
backend/app/shared/enums.py                         (modify: round/task/expert status)
backend/app/modules/expert/models.py
backend/app/modules/dispatch/models.py
backend/app/db/models.py                            (import new models)
backend/app/seed.py                                 (expert.zhou profile + expert.qian)
backend/app/modules/expert/service.py
backend/app/modules/dispatch/service.py
backend/app/modules/dispatch/router.py
backend/app/modules/thesis/router.py                (confirm-dispatch + progress)
backend/app/modules/workflow/service.py             (new transitions)
backend/app/api.py
backend/tests/helpers.py                            (ready_for_dispatch helper)
backend/tests/test_dispatch.py
frontend/src/api/dispatch.ts
frontend/src/api/expertTasks.ts
frontend/src/modules/school/pages/PreparationListPage.vue
frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue
frontend/src/modules/review/pages/ExpertTasksPage.vue
frontend/src/modules/review/pages/InvitationPage.vue
```

Overwrite empty `backend/app/modules/dispatch/model.py` / `expert/model.py` by adding `models.py` (same pattern as slice 1). Do not fill recommend/timeout/payment stubs.

---

### Task 1: Schema, seed experts, confirm-dispatch + assign + accept/reject APIs

**Files:**
- Create: `backend/alembic/versions/0002_slice02_dispatch.py`, `backend/app/modules/expert/models.py`, `backend/app/modules/dispatch/models.py`, `backend/app/modules/expert/service.py`, `backend/app/modules/dispatch/service.py`, `backend/app/modules/dispatch/router.py`, `backend/tests/test_dispatch.py`
- Modify: `backend/app/shared/enums.py`, `backend/app/db/models.py`, `backend/app/seed.py`, `backend/app/modules/workflow/service.py`, `backend/app/modules/thesis/router.py`, `backend/app/modules/thesis/service.py` (confirm_dispatch, progress), `backend/app/api.py`, `backend/tests/helpers.py`, `backend/tests/conftest.py` if metadata import needed

**Interfaces:**
- Consumes: slice 1 `create_draft`, `attach_files`, `submit`, school confirm anonymization PASS helpers.
- Produces: routes in spec §6; `assign` calls `workflow.transition(..., action="assign_first_task")` only when thesis is still `READY_FOR_DISPATCH`.

Helper in `tests/helpers.py`:

```python
async def ready_thesis(client, seed):
    student = await login(client, "student.lin", seed.password)
    school = await login(client, "school.wang", seed.password)
    thesis = await create_draft(client, student)
    await attach_files(client, student, thesis["id"])
    submitted = await client.post(
        f"/api/v1/theses/{thesis['id']}:submit",
        headers=auth(student, idempotency=f"s-{thesis['id'][:8]}"),
        json={"version": thesis["version"]},
    )
    await client.post(
        f"/api/v1/school-review/theses/{thesis['id']}:confirm-anonymization",
        headers=auth(school, idempotency=f"c-{thesis['id'][:8]}"),
        json={"decision": "PASS", "version": submitted.json()["data"]["version"]},
    )
    return student, school, submitted.json()["data"]["id"]
```

- [ ] **Step 1: Write failing tests** in `backend/tests/test_dispatch.py`

Cover spec §8:

```python
@pytest.mark.asyncio
async def test_confirm_dispatch_creates_round_without_changing_stage(client, seed):
    student, school, thesis_id = await ready_thesis(client, seed)
    res = await client.post(
        f"/api/v1/school-review/theses/{thesis_id}:confirm-dispatch",
        headers=auth(school, idempotency="cd-1"),
        json={"version": 3},  # use actual version from GET
    )
    # GET thesis first for version
```

Also: first assign → `UNDER_REVIEW`; accept → anonymous OK original 404; reject requires reason then reassign new task id; duplicate expert 409; school progress JSON has no `expert` name; platform assign as school 403; other tenant 404; idempotent confirm-dispatch same round id; DRAFT cannot confirm-dispatch.

Look up `expert.zhou` / `expert.qian` ids via `GET /platform-review/dispatch-candidates?thesis_id=`.

- [ ] **Step 2: Run, expect fail**

Run: `cd backend && python -m pytest tests/test_dispatch.py -v`

Expected: FAIL (404 or missing tables).

- [ ] **Step 3: Migration + models + services + routers**

Alembic `0002_slice02`: four tables from spec §5. `down_revision = "0001_slice01"`.

Seed after users: Expert rows for zhou (`0812`) and new user `expert.qian` / 钱教授 / `0835`.

`confirm_dispatch`: lock thesis, require school + `READY_FOR_DISPATCH`, create round if missing (`CREATED`, round_no=1, snapshot discipline from current version), audit `fee_freeze_skipped=slice2`.

`assign`: platform_reviewer only; load expert AVAILABLE; discipline codes must include thesis discipline; supervisor_name avoidance; no second non-terminal task for same expert; create `INVITED` task; if thesis `READY_FOR_DISPATCH`, transition `assign_first_task` → `UNDER_REVIEW`; round `ACTIVE`.

`accept`/`reject`: expert must own task, status `INVITED`. reject reason min 1 char.

Candidates endpoint: all AVAILABLE experts with `avoided`, `direction_mismatch` booleans; assign still 409 if those true.

- [ ] **Step 4: Pass tests**

Run: `cd backend && python -m pytest -v`

Expected: PASS (slice 1 + slice 2).

- [ ] **Step 5: Commit**

```bash
git add backend
git commit -m "feat: confirm-dispatch, assign expert, and accept or reject tasks"
```

---

### Task 2: Wire PAGE-004/007/008/009 in non-demo mode

**Files:**
- Create: `frontend/src/api/dispatch.ts`, `frontend/src/api/expertTasks.ts`, `frontend/src/modules/dispatch/__tests__/realDispatch.wiring.spec.ts`
- Modify: `PreparationListPage.vue` (confirm-dispatch button when stage READY and not demo), `DispatchWorkbenchPage.vue`, `ExpertTasksPage.vue`, `InvitationPage.vue`
- Do not modify `scenarioService.ts`

**Interfaces:**
- `confirmDispatch(id, version)`, `dispatchQueue()`, `candidates(thesisId)`, `assign(thesisId, expertId)`, `listExpertTasks()`, `acceptTask(id)`, `rejectTask(id, reason)`

- [ ] **Step 1: Failing adapter/page test**

```ts
it('maps queue item without exposing original file ids to the expert invitation view', () => {
  expect(invitationProjection.files).toBeUndefined()
})
```

Keep existing demo dispatch tests passing (they use scenarioService when demoMode true). Workbench must call `useScenarioService()` only if `demoEnabled`.

- [ ] **Step 2: Run**

`cd frontend && pnpm test:unit:run -- src/modules/dispatch/__tests__/realDispatch.wiring.spec.ts`

Expected: FAIL until files exist.

- [ ] **Step 3: Implement clients and gate pages**

Preparation: if `!demoEnabled` and selected row stage is `READY_FOR_DISPATCH`, show 确认送出 calling API with row.version.

Dispatch workbench non-demo: load queue + candidates from API; assign selected single expert; hide remind/extend/fee edit if those APIs do not exist.

Expert tasks/invitation non-demo: list/accept/reject via API; invitation copy must not render student name.

- [ ] **Step 4: Frontend tests + type-check**

`cd frontend && pnpm test:unit:run && pnpm type-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend
git commit -m "feat: wire dispatch and expert accept pages to real APIs"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| confirm-dispatch + round CREATED | 1 |
| first assign UNDER_REVIEW | 1 |
| accept/reject ACL | 1 |
| school progress no expert fields | 1 |
| fee skip audit | 1 |
| frontend pages | 2 |
| no scenarioService edits | 2 |
| no scoring/timeouts | neither |

Plan complete and saved to `docs/superpowers/plans/2026-08-31-slice-2-dispatch-accept.md`. Two execution options:

**1. Subagent-Driven** — fresh subagent per task  
**2. Inline Execution** — this session, as slice 1

Given last round, I will use **Inline** unless you say otherwise. Reply「按 inline 执行」to start Task 1.
