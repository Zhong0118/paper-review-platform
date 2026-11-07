---
title: 百杰校审平台文档导航
status: CURRENT
version: 0.6.0
last_updated: 2026-09-01
---

# 文档导航

**先读：[现行状态](CURRENT.md)** 和仓库根 [README.md](../README.md)。

实现以垂直切片为准。与 `00`–`10` 长文档冲突时，以切片规格为准。

## 现行施工规格

| 切片 | 规格 | 计划 |
|---|---|---|
| 0+1 | [auth-submit-ready](superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md) | [plan](superpowers/plans/2026-08-31-slice-0-1-auth-submit-ready.md) |
| 2 | [dispatch-accept](superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md) | [plan](superpowers/plans/2026-08-31-slice-2-dispatch-accept.md) |
| 3 | [online-review](superpowers/specs/2026-09-01-slice-3-online-review-design.md) | [plan](superpowers/plans/2026-09-01-slice-3-online-review.md) |
| 4 | [summary-publish](superpowers/specs/2026-09-01-slice-4-summary-publish-design.md) | [plan](superpowers/plans/2026-09-01-slice-4-summary-publish.md) |
| 5 | [objection](superpowers/specs/2026-09-01-slice-5-objection-design.md) | [plan](superpowers/plans/2026-09-01-slice-5-objection.md) |
| 6 | [school-progress](superpowers/specs/2026-09-01-slice-6-school-progress-design.md) | [plan](superpowers/plans/2026-09-01-slice-6-school-progress.md) |

术语：[CONTEXT.md](../CONTEXT.md)。编码约定：[AGENTS.md](../AGENTS.md)。

## 历史（不要当实现依据）

| 位置 | 说明 |
|---|---|
| `00_项目总览/` … `10_审查与决策/` | 2026-08 首版草稿与 ADR；决策编号仍可引用，规则以切片为准 |
| `engineering-specification.md`、`ui-design-system.md` | 同期工程/视觉草案 |
| `superpowers/archive/` | 8 月前端演示计划 |
| `99_原始材料/` | 只读原始需求，不删除、不改写 |
| `init.txt` | 早期备忘，无规范效力 |

本地 Postgres：`127.0.0.1:5433`，见根 README。尚未实现：SSO、代传、催审、多专家、费用、RLS。
