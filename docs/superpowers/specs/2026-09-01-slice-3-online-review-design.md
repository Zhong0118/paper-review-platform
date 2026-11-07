---
title: 切片 3 专家在线评阅
status: DRAFT
version: 0.1.0
last_updated: 2026-09-01
sources:
  - docs/superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md
  - docs/02_产品设计/产品与流程设计.md
related_documents:
  - frontend/src/demo/types.ts
---

# 切片 3：在线评阅

专家 `IN_REVIEW` 后可暂存与最终提交。任务进入 `SUBMITTED` 并锁定。本切片单独看时论文宏观阶段仍为 `UNDER_REVIEW`。**切片 4 叠加后**：种子批次目标有效专家数为 1，因此 `submit-final` 达标即触发 `results_ready`，论文进入 `RESULT_PROCESSING`。不做发布、更正、催审。

## 模板（种子，本切片唯一）

与演示 `REVIEW_SCORE_TEMPLATE` 相同六维，满分合计 100：topicValue 15、literatureTheory 15、methodology 20、innovation 25、writingStandards 10、resultsWorkload 15。必填：各维分数在区间内、总体评语 `overallComment`、主要问题 `issues`。总分 = 六维之和。

## API

- `GET /expert/tasks/{id}/draft`
- `PUT /expert/tasks/{id}/draft` body scores + texts；仅 `IN_REVIEW`
- `POST /expert/tasks/{id}:submit-final` 幂等；校验失败 422；成功任务 `SUBMITTED`，追加 `review_result_versions`（`is_current=true`）
- 已提交后再 PUT/POST → 409 `STATE_TRANSITION_DENIED`
- 非本人 / 未接单 → `RESOURCE_NOT_FOUND`
- 材料仍走现有 materials + 匿名文件授权

## 表

`review_drafts`：task_id unique, payload jsonb, updated_at  
`review_result_versions`：task_id, version_no, scores jsonb, total, comments jsonb, is_current, submitted_at

## 前端

PAGE-010 非演示：读 materials/draft，autosave PUT draft，提交 POST submit-final。不改 scenarioService。

## 测试

接单后存草稿再读回；提交锁定且再改 409；缺评语 422；另一专家 404。单独验收本切片时 thesis.stage 仍为 `UNDER_REVIEW`；与切片 4 联测时一份有效结果即进入 `RESULT_PROCESSING`。
