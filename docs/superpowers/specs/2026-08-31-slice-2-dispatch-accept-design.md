---
title: 切片 2 确认送出、派单与接拒
status: DRAFT
version: 0.1.0
last_updated: 2026-08-31
sources:
  - docs/superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md
  - docs/02_产品设计/产品与流程设计.md
  - docs/05_API设计/API设计.md
  - docs/04_数据库设计/数据库设计.md
  - docs/10_审查与决策/ADR/ADR-0003-分层工作流与专家指派.md
  - docs/10_审查与决策/ADR/ADR-0004-双向盲审文件隔离与审计.md
related_documents:
  - docs/superpowers/plans/2026-08-31-slice-0-1-auth-submit-ready.md
---

# 切片 2：确认送出、人工派单、专家接拒

现行施工规格。与演示计划、空 `dispatch`/`expert` stub 冲突时以本文为准。切片 0+1 已交付提交到 `READY_FOR_DISPATCH`。

## 1. 目标

学校确认送出 → 百杰从平台专家库人工派 1 人 → 专家显式接受或拒绝。第一个有效专家任务创建后论文进入 `UNDER_REVIEW`。

完成标准：

1. `READY_FOR_DISPATCH` 上学校 `confirm-dispatch` 创建轮次，**不**单独因确认改变论文宏观阶段。
2. 百杰派种子专家成功后：任务 `INVITED`，轮次 `ACTIVE`，论文 `UNDER_REVIEW`。
3. 接受后专家可授权下载匿名版；原始版对专家、管理员、未接单专家均为不可见（对外 `RESOURCE_NOT_FOUND`）。
4. 拒绝必填原因，旧任务终态保留；可再派另一专家为新任务。
5. 学校进度投影不含专家姓名或可逆专家 id。
6. 非演示模式：学校确认送出、派单台、专家任务/邀请走真实 API。不修改 `scenarioService` 行为。

## 2. 非目标

- 在线评阅、草稿、最终提交、更正。
- Redis/Celery、接单超时自动关单、催审、延期。
- 学校账户冻余额、账单、专家费用（FLOW-003 的额度校验本切片**豁免**：确认送出写审计 `fee_freeze_skipped=slice2`，不因没钱失败，也不写假账单）。
- 自动匹配、SSO、学校代传、学生送审后撤回申请。
- RLS、MinIO。
- 填写 `review` 评阅空模块。

正式账务与超时扫描必须另开规格，本文不取消那些 P0，只延期。

## 3. 状态

论文：`READY_FOR_DISPATCH` 在创建首个非终态专家任务时 → `UNDER_REVIEW`（`workflow.transition`，action `assign_first_task`）。  
进入 `UNDER_REVIEW` 后本切片学生不可撤回（派单后撤回申请不做）。

轮次：`CREATED`（确认送出）→ `ACTIVE`（首个 INVITED）→ 本切片停止。终止论文时轮次 `CANCELLED`，未完成任务 `CANCELLED`。

任务：`INVITED` → `IN_REVIEW` | `REJECTED`。改派：旧 `CANCELLED` + 新 `INVITED`，`replaces_task_id`。不实现 `ACCEPT_TIMEOUT` 自动、`SUBMITTED` 评阅。

## 4. 规则

- 确认送出仅学校、仅 `READY_FOR_DISPATCH`、幂等、带 `version`。已有轮次则返回同一轮次。
- 派单仅百杰。一次一人。候选人按论文 `discipline_code` 与专家擅长交集过滤；无交集仍可显示但标记 `direction_mismatch`（本切片**禁止**派 mismatch，409）。
- 回避：专家展示名/档案不得等于本论文导师姓名；命中则候选 `avoided=true`，派单 409。
- 同一轮次同一专家不能有两个非终态任务。
- 未接受：邀请接口只给匿名号、专业、期限占位（本切片期限可空）、费用占位「未启用」。不给作者、学校全名、文件。
- 接受后 `materials` 只授权 `anonymous`。
- 学校 `progress`：`invited_count`、`in_review_count`、`rejected_count`，禁止 `expert_id`/`display_name`。

## 5. 数据

新建：

- `experts`：id, user_id unique, service_status, discipline_codes jsonb, timestamps
- `expert_conflicts`：id, expert_id, kind (`SUPERVISOR_NAME`), value, timestamps
- `review_rounds`：id, tenant_id, thesis_id, thesis_version_id, round_no, status, discipline_code, discipline_name, version
- `expert_tasks`：id, tenant_id, round_id, expert_id, status, replaces_task_id, invited_at, decided_at, reject_reason, version

`(thesis_id, round_no)` 唯一。任务状态枚举与产品文档第 7 节一致。

种子：`expert.zhou` 擅长 `["0812"]`；`expert.qian` 用户+档案擅长 `["0835"]`。密码同 `SEED_PASSWORD`。

## 6. API `/api/v1`

| 方法 | 路径 | 角色 |
|---|---|---|
| POST | `/school-review/theses/{id}:confirm-dispatch` | 学校 |
| GET | `/school-review/theses/{id}/progress` | 学校 |
| GET | `/platform-review/dispatch-queue` | 百杰 |
| GET | `/platform-review/dispatch-candidates?thesis_id=` | 百杰 |
| POST | `/platform-review/theses/{id}:assign` body `{expert_id, version?}` | 百杰 |
| POST | `/expert-tasks/{id}:reassign` body `{expert_id}` | 百杰 |
| GET | `/expert/tasks` | 专家 |
| GET | `/expert/tasks/{id}/invitation` | 专家本人 |
| POST | `/expert/tasks/{id}:accept` `:reject` | 专家本人 |
| GET | `/expert/tasks/{id}/materials` | 专家且 `IN_REVIEW` |

敏感资源无权限与不存在一律 `RESOURCE_NOT_FOUND`。百杰读匿名件走现有 file authorize，原件仍拒。

## 7. 前端

非演示：PAGE-004/005 确认送出与进度计数；PAGE-007 队列/候选/派单；PAGE-008/009 接拒。不接 PAGE-010。不改 `scenarioService.ts` 逻辑。

## 8. 测试

后端 pytest + 真实 Postgres：规格第 4 节规则对应 — 确认不改 stage、首派改 stage、接后匿名/原件 ACL、拒绝再派、重复派、学校投影无专家字段、跨角色/跨租户、幂等轮次、错误阶段不能送出。

## 9. 对抗性自检

| 风险 | 处理 |
|---|---|
| 确认送出误推进 UNDER_REVIEW | 仅 assign 首个有效任务时推进 |
| 费用挡住试点 | 显式豁免并审计，不写假账 |
| 未接单看全文 | invitation 无文件；materials 校验 IN_REVIEW |
| 学校看见专家 | progress 白名单字段 + 测试断言 |
| 改派覆盖旧任务 | CANCELLED + 新行 |
| 派错方向 | mismatch 409 |
| 超时没做却当已做 | 不实现 ACCEPT_TIMEOUT 写入 |
