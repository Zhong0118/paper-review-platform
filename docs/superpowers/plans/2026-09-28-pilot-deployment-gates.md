# Pilot Deployment Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution; no automatic commit/push/deploy.

**Goal:** 在环境输入与授权满足后，依次完成 T09-B/T10-B/T11-B；当前仅交付条件化操作方案。

**Architecture:** 复用本地验证结果，以实际环境配置/离线维护/配套恢复/发布门禁收口。不预选云平台。

**Tech Stack:** 当前应用栈、部署环境选定的TLS代理/运行服务和PostgreSQL备份工具。

**Spec:** [正式环境设计](../specs/2026-09-28-pilot-deployment-gates-design.md)。

## Global Constraints

- 当前状态 ENVIRONMENT_BLOCKED；不得执行真实部署、正式数据导入或恢复破坏。
- 输入到齐后先产出具体配置供审查；授权只针对具体环境/动作，不等于允许上传秘密。
- 本地开发测试仍仅 5433/paper_review_test；真实环境动作需另行明确授权。

### T09-B1：实际运行配置与离线账号维护

**Files:** 环境输入记录 `docs/operations/pilot-environment.md`；运行说明 `docs/operations/pilot-deployment.md`；修改 `backend/app/core/config.py`、`backend/alembic/env.py`、必要的连接入口；创建 `backend/scripts/admin_maintenance.py`、`backend/tests/test_admin_maintenance.py`，补 `backend/tests/test_production_safety.py`。部署服务配置路径在选定进程/容器后明确登记，不在当前仓库猜建。

**Interfaces:** 运行配置无需 owner 凭据，迁移入口必须显式提供 owner 连接且禁止业务账号迁移；维护 CLI 只 bootstrap/reset-global-password，拒绝在线运行和非全局目标。

- [ ] 校验设计全部环境输入，缺失写具体阻断，不使用默认值拼部署命令。凭据通过秘密存储引用。
- [ ] 先写失败测试：production API 仅有business/auth也能启动；迁移缺 migration URL拒绝且不回退业务URL；运行进程不持有owner URL；既有角色分离负例不退化。固定运行/迁移入口的配置契约后最小实现，不简单删除所有production校验。
- [ ] 写维护红灯：未知已有username不升级；reset仅global expert/platform/system；口令不进argv/日志；非维护窗口拒绝；成功同事务更新auth_version/refresh撤销/审计，失败无半成账号。按设计实现，独立测试库验证。
- [ ] `backend/.venv/bin/pytest backend/tests/test_admin_maintenance.py backend/tests/test_production_safety.py backend/tests/test_rls_roles.py backend/tests/test_token_revocation.py -c backend/pyproject.toml -q --tb=short`。以实际代理/私有目录验证TLS、无query日志、无静态直链。输出部署配置与证据后取得所需部署授权，再启动目标服务。

### T10-B1：目标环境恢复和旧版本回退

**Files:** 更新 `docs/operations/pilot-recovery-runbook.md`；创建 `docs/reviews/pilot-production-recovery.md`；只修改实际部署脚本中的备份/恢复部分，不改业务模型。

**Interfaces:** 消费已批准环境、RPO/RTO和T09-B1构建；输出备份编号、恢复目标和版本、实际耗时/数据窗口、通过/拒绝证据。

- [ ] 先做安全负例：错误目标/缺少清单/文件损坏/构建版本不匹配时恢复命令未执行或不切流量；不能向在线生产覆盖验证。
- [ ] 停写后备份DB+文件，恢复到明确授权的隔离目标，普通角色复验主链、28表RLS、文件hash；JWT轮换、refresh撤销后确认旧三类token拒绝。
- [ ] 使用上一已批准构建和对应备份演练回退；实际耗时/损失窗口满足已确认RPO/RTO才PASS。实际工具命令根据环境记录无密码版本，不用本地结果代替。

### T11-B1：发布审批与正式试点

**Files:** 创建 `docs/reviews/pilot-release-decision.md`，更新 CURRENT/HANDOFF/任务板。

**Interfaces:** 消费T09-B1/T10-B1、完整本地验收、CI记录、数据授权；输出允许/拒绝放行的具体依据。

- [ ] 检查有任一阻断、未授权正式数据、未明确回滚联系人/条件即NO-GO；不以“大部分测试通过”放行。
- [ ] 目标环境用授权样本复验六角色主链与敏感负例，记实际构建/迁移/备份编号；用户确认具体试点窗口及发布动作后才切流量。
- [ ] 发布后观察错误率/核心路径/存储可用性，按预先批准的停止阈值和负责人处置；阈值在实际试点运行方案中确定，不由模型临时编造。记录T01–T11最终各自状态。
