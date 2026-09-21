---
title: 现行状态（给仓库阅读者）
status: CURRENT
version: 0.6.2
last_updated: 2026-09-21
---

# 百杰校审：现在是什么

第三方多校论文盲审平台。分支 `codex/frontend-client-demo`。

**现在有的：** 一篇论文、一个专家、平台账密的真实 API 主链；完整角色与真实材料验收尚未通过。

**现在没有的：** 学校 SSO、代传/批量导入、超时催审、多专家、费用、通知渠道、PostgreSQL RLS、可上线的视觉。

实现依据是切片规格，不是 `docs/00`–`10` 长文档，也不是 8 月前端演示计划。

## 2026-09-21 核对与后续规划

[现状评估](reviews/2026-09-21-project-assessment-and-roadmap.md)记录了已复现问题与代码证据：[后续开发规划](superpowers/plans/2026-09-21-development-roadmap.md)规定近期顺序与验收出口。

7A-1 已修复上传所有权与文件锁定，新增 prepare 时的版本绑定；已完成文件只能新建上传替换，旧请求不会重新绑定文件。尚存缺口包括真实 PDF 检测、专家阅读区仍含演示内容、导师列表入口和待送审撤回。下述主链表示已实现的接口路径，不代表所有角色已通过浏览器完整验收。

**下一工作包：7A-2 真实 PDF 校验与匿名检测。** 7A-1 已通过后端 49 项测试（含独立会话并发、真实迁移、历史文件保留与存储故障）。这些证据不代表 PDF 检测或浏览器闭环已经完成。

运行新代码前需在目标环境执行 `alembic upgrade head`（新增 `0007_file_upload_version`）。迁移不推测旧文件最初绑定的版本：保留旧文件和已有引用，旧未完成上传必须重新 prepare，已完成文件的 complete 重试不重新绑定。本次只迁移了测试库隔离 schema，未迁移开发业务库。

## 主链（接口路径）

```
学生登录 → 草稿 + 双 PDF → 提交
        → 匿名门禁（命中身份线索自动退回 DRAFT）
学校    → 核验通过 → 确认送出（建轮次，论文阶段不变）
百杰    → 按学科派 1 人（导师同名回避）
专家    → 接受 / 拒绝 → 草稿打分 → 最终提交锁定
学校    → 评审进度（任务化名 T-001，无专家姓名）
        → 发布（学生/导师只见 E-001）
学生    → 异议（不改论文阶段、不改专家分）→ 学校办结
```

状态机三层：论文 `theses.stage` / 轮次 / 专家任务。`workflow.transition` 是论文阶段唯一写入口。

真实模式菜单只露已接线页。演示模式（`VITE_DEMO_MODE=true`）仍是旧 `scenarioService`，不代表后端完成。

## 切片规格（现行）

| 切片 | 规格 | 内容 |
|---|---|---|
| 0+1 | [auth-submit-ready](superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md) | 登录、提交、匿名门禁 |
| 2 | [dispatch-accept](superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md) | 确认送出、派单、接拒 |
| 3 | [online-review](superpowers/specs/2026-09-01-slice-3-online-review-design.md) | 评阅草稿与最终提交 |
| 4 | [summary-publish](superpowers/specs/2026-09-01-slice-4-summary-publish-design.md) | 汇总与学校发布 |
| 5 | [objection](superpowers/specs/2026-09-01-slice-5-objection-design.md) | 发布后异议 |
| 6 | [school-progress](superpowers/specs/2026-09-01-slice-6-school-progress-design.md) | 学校评审进度 |
| 7A-1 | [file-integrity](superpowers/specs/2026-09-21-slice-7a1-file-integrity-design.md) | 文件归属、不可变性、版本绑定与并发保护 |

计划文件在 `docs/superpowers/plans/` 同名日期下。

## 代码落点

- 后端：`backend/app/`（FastAPI + SQLAlchemy 2 async + Alembic）。空模块目录（finance/notice/statistics/…）不是进度。
- 测试：`backend/tests/`，真实 Postgres（测试库 `paper_review_test`，宿主机 5433）。
- 前端接线：`frontend/src/api/`；页面在 `VITE_DEMO_MODE=false` 时走真实 API。
- 演示假服务：`frontend/src/demo/scenarioService.ts`，冻结，不再加业务。

种子账号密码默认 `ChangeMe!dev-only`：`student.lin`、`school.wang`、`platform.chen`、`expert.zhou`、`supervisor.zhao`、`admin.system`。

## 文档怎么读

1. 仓库根 [README.md](../README.md)（怎么跑）
2. 本文
3. 上表切片规格
4. 需要术语时再看 [CONTEXT.md](../CONTEXT.md)
5. `docs/00`–`10`、`engineering-specification.md`、`ui-design-system.md`：2026-08 草稿，**历史**
6. `docs/superpowers/archive/`：8 月前端演示规格，**历史**
7. `docs/99_原始材料/`：只读，不删、不改

## 上 GitHub 时注意

- 不要提交 `.env`、`frontend/.env.local`、`storage/` 里的论文文件、`.playwright-mcp/`。
- 当前分支领先远端；推的是 `codex/frontend-client-demo`，不是 `main`。
- 本仓库仍是施工中的垂直切片，README 不要写成已上线产品。
