---
title: 切片 4 汇总与学校发布
status: DRAFT
version: 0.1.0
last_updated: 2026-09-01
sources:
  - docs/superpowers/specs/2026-09-01-slice-3-online-review-design.md
  - docs/02_产品设计/产品与流程设计.md
  - docs/05_API设计/API设计.md
---

# 切片 4：汇总与学校发布

专家最终提交后，有效结果达到批次目标人数则进入结果处理；学校确认发布后学生与导师可查看匿名结果。不覆盖专家原始分。不做异议、费用、多专家冲突。

## 规则（种子批次）

- 目标有效专家数 = 1（与演示批次快照一致，不是平台硬编码默认）。
- 有效 = 任务 `SUBMITTED` 且存在 `is_current` 的 `review_result_versions`。
- `submit-final` 成功后若达标：`UNDER_REVIEW` → `RESULT_PROCESSING`（action `results_ready`），写入/更新 `result_summaries`。
- 汇总：本切片仅一份结果，`total` = 该份六维总分；`average_score` 同值。规则快照 jsonb 记录 `{ "required_experts": 1, "mode": "sum_dimensions" }`。
- 学校发布：`RESULT_PROCESSING` → `COMPLETED`（action `publish`）。写 `result_publications`。
- 未发布时学生/导师读结果对外 `RESOURCE_NOT_FOUND`。
- 学校/学生/导师投影：专家仅 `alias`（本轮第 N 个提交为 `E-00N`），禁止 `expert_id`、姓名、username。

## API `/api/v1`

| 方法 | 路径 | 角色 |
|---|---|---|
| GET | `/school-review/theses/{id}/results` | 学校：独立结果 + 汇总，去标识 |
| POST | `/school-review/theses/{id}:publish` | 学校，幂等 + version |
| GET | `/my/theses/{id}/published-result` | 学生本人；导师限该生 `supervisor_membership` |

## 表

`result_summaries`：thesis_id, round_id, tenant_id, total, rule_snapshot jsonb, result_task_ids jsonb, version  
`result_publications`：summary_id, published_by, published_at  

## 前端

PAGE-011 非演示：列表/详情走 school results，按钮仅 `RESULT_PROCESSING` 且服务端允许。  
PAGE-012 / PAGE-013：已发布才展示分数与评语；未发布空态。不改 scenarioService。异议表单非演示隐藏或提示未接入。

## 测试

1. 一份 submit-final → thesis `RESULT_PROCESSING`，有 summary  
2. 学校 GET 无专家姓名  
3. 发布 → `COMPLETED`；学生 GET 有 total 与评语，无专家姓名  
4. 发布前学生 GET 404  
5. 导师可看林知远；other.student 404  
6. 学校不能 PATCH 专家 scores  
7. 重复 publish 幂等  

## 非目标

异议、导出、费用、补审、冲突标记、改专家原文。
