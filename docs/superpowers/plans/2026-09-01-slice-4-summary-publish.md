# Slice 4 Summary and Publish Implementation Plan

> **For agentic workers:** Execute inline. TDD. Do not edit scenarioService.ts.

**Goal:** After one expert submits, thesis enters RESULT_PROCESSING; school publish makes anonymous results visible to student and supervisor.

**Spec:** `docs/superpowers/specs/2026-09-01-slice-4-summary-publish-design.md`

### Task 1: Backend summary + publish

Files: alembic `0004_slice04_results.py`; `result/models.py`; `result/service.py`; school/my routers; workflow allow `UNDER_REVIEW→RESULT_PROCESSING` (`results_ready`) and `RESULT_PROCESSING→COMPLETED` (`publish`); hook from `review.submit_final`; `tests/test_publish.py`

- [ ] Failing tests then implement
- [ ] pytest pass
- [ ] Commit `feat: summarize one expert result and school publish`

### Task 2: Wire PAGE-011/012/013

Files: `frontend/src/api/results.ts`; ResultProcessingPage, StudentResultPage, SupervisorResultPage demo gates

- [ ] unit + type-check
- [ ] Commit `feat: wire result publish pages to real APIs`
