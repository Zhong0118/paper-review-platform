# Slice 6 School Progress Implementation Plan

> Execute inline. TDD. Do not edit scenarioService.ts.

**Spec:** `docs/superpowers/specs/2026-09-01-slice-6-school-progress-design.md`

**Goal:** School PAGE-005 reads real progress counts and task aliases with no expert identity.

### Task 1: Extend progress API

`backend/app/modules/dispatch/service.py` `school_progress`; add `school_progress_list`; router GET `/school-review/progress`. Tests in `backend/tests/test_dispatch.py`.

### Task 2: Wire PAGE-005

`frontend/src/api/dispatch.ts`; `ReviewProgressPage.vue` live branch; `LIVE_PATHS` include `/school/progress`. Keep demo fake gate for existing spec.
