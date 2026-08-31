# Slice 3 Online Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Expert in IN_REVIEW can save a draft and submit a locked original result without moving thesis stage.

**Architecture:** New `review_drafts` / `review_result_versions`. `review` module services; dispatch only flips task status to SUBMITTED. Demo scenarioService unchanged.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-01-slice-3-online-review-design.md`
- Template keys/max from frontend `REVIEW_SCORE_TEMPLATE`
- No summary/publish/timeout
- TDD, branch `codex/frontend-client-demo`

### Task 1: Backend draft + submit-final

**Files:** alembic `0003_slice03_review.py`; `backend/app/modules/review/models.py`; `service.py`; extend `dispatch/router.py` or `review/router.py`; `tests/test_review.py`; `tests/helpers.py` add `accepted_task`

- [ ] Failing tests then implement
- [ ] pytest all pass
- [ ] Commit `feat: expert review draft and locked final submit`

### Task 2: Wire PAGE-010

**Files:** `frontend/src/api/review.ts`; `ReviewWorkspacePage.vue` demo gate; keep ReviewFormPane

- [ ] Non-demo loads draft/materials, PUT autosave, POST submit-final
- [ ] unit + type-check
- [ ] Commit `feat: wire review workspace to real APIs`
