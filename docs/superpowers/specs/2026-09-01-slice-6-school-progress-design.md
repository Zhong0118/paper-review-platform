---
title: 切片 6 学校评审进度
status: DRAFT
version: 0.1.0
last_updated: 2026-09-01
sources:
  - docs/superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md
  - docs/02_产品设计/产品与流程设计.md
---

# 切片 6：学校评审进度

学校在确认送出之后，需要看见**本租户已送出论文的任务计数与化名状态**。切片 2 已有单篇 `GET /school-review/theses/{id}/progress`（邀请/在评/拒绝，无专家身份），PAGE-005 仍走演示假数据，真实模式菜单已把该页摘掉。本切片把它接上。

不做催审、逾期扫描、改派、费用、匿名门禁（门禁留在 PAGE-004）。

## 规则

- 列表只含已有轮次的本校论文（确认送出之后）：`READY_FOR_DISPATCH`（轮次 `CREATED`、待派）及之后阶段。草稿/准备中不出现。
- 任务化名按本轮 `invited_at` 顺序 `T-001`、`T-002`…。禁止 `expert_id`、姓名、username。
- 计数：`invited_count`、`in_review_count`、`submitted_count`、`rejected_count`。本切片无期限，`overdue` 恒为 0。
- 汇总：`waiting` = 轮次已建且尚无非终态任务（待派）；`reviewing` = invited + in_review；`completed` = submitted；`rejected` = rejected。
- 页面不可从这里确认送出、不可发催审。真实模式按钮不出现。

## API `/api/v1`

| 方法 | 路径 | 角色 |
|---|---|---|
| GET | `/school-review/progress` | 学校：本租户列表 |
| GET | `/school-review/theses/{id}/progress` | 学校：单篇；补 `submitted_count` 与 `tasks` 化名 |

单篇响应：

```json
{
  "thesis_id": "…",
  "stage": "UNDER_REVIEW",
  "round_status": "ACTIVE",
  "invited_count": 0,
  "in_review_count": 1,
  "submitted_count": 0,
  "rejected_count": 0,
  "tasks": [{ "alias": "T-001", "status": "IN_REVIEW" }]
}
```

列表响应：`{ "items": [ { 单篇字段 + title, student_name } ], "totals": { "waiting", "reviewing", "completed", "rejected", "overdue" } }`。

跨租户 404。学校可见学生姓名；载荷中不得出现专家身份。

## 前端

PAGE-005 非演示：读列表接口；统计条用 totals；任务区用 alias+status。演示模式保持现有假门禁三行（`schoolDispatch.spec` 不改 scenarioService）。`portalMenus` 真实模式加回 `/school/progress`。

## 测试

1. 确认送出未派单：waiting=1，tasks=[]
2. 派单后 invited_count=1，alias=T-001，无「周明远」
3. 接受后 in_review_count=1
4. 最终提交后 submitted_count=1
5. other.student / 百杰 403 或 404
6. 前端接线：真实队列不含演示三行论文 id

## 非目标

催审、逾期、改派、费用、多专家冲突、匿名核验按钮。
