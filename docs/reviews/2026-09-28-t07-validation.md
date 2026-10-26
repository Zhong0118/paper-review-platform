# T07 专家维护本地验收

验收收束日期：2026-10-02。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；既有已跟踪及未跟踪工作全部保留，未提交、推送或部署。数据库只用本机 5433 `paper_review_test` 的独立 schema，没有迁移开发业务库。

## 交付与验证

- 真实模式 `/platform/experts` 使用独立 API 和菜单，提供专家创建、资料、资格、服务状态和学校/导师回避维护；演示模式保留原页面。创建失败重试沿用同一幂等键；版本 409 刷新服务器数据并要求操作者重新决定。账号非 ACTIVE 时不提供“前往派单”；这一点先以失败测试复现，再作最小修复。
- 候选页面读取 `qualification_status` 并说明不可选原因；服务端候选和直接派单/改派仍在锁内复核资格、状态、学科、回避和账号身份。T07-2 的 SQL/RLS、幂等与并发证据见[后端验收](2026-09-28-t07-2-validation.md)。
- `./scripts/check.sh` 完整重跑退出 0：后端 **387 passed / 2 warnings**（573.07s），前端当时 **443 passed / 61 files**，类型检查与真实模式构建退出 0。此后只改前端规则重试和专家停用账号提示；最终前端复验及 build 结果见下方补记和 [T08 记录](2026-09-28-t08-validation.md)，不把 443 当作最终前端数。
- `bash scripts/tests/check_test.sh`、`git diff --check` 均退出 0。独立 schema 中实际执行 `0015_rls_children → 0017_expert_management → 0015_rls_children → 0017_expert_management`，三个迁移命令退出 0；`experts` 仍启用 FORCE RLS。后端测试另覆盖有专家数据时拒绝降级、保留数据和 revision，以及旧任务和已发布结果不漂移。

## 实际浏览器、API、SQL 边界

| 项目 | 实际证据 | 状态 |
|---|---|---|
| 平台专家维护 | `operations` 虚构场景中，真实浏览器登录并访问 `/platform/experts`；创建 `pilot.expert.one` 为 PENDING，批准资格，编辑学校回避名称和导师姓名，暂停/恢复服务，修改单位，最后驳回资格；列表每次从服务端刷新 | PASS · 浏览器 |
| 非平台路由及创建冲突 | 路由/页面单元测试；后端身份、RLS、409、幂等与普通 SQL 负向测试 | PASS · 自动化；未单独浏览器操作 |
| 停用、回避后的直接派单/改派 | 后端 `test_expert_operations.py` 和派单并发回归覆盖真实 API 与行锁；本次 `operations` 浏览器场景没有论文，未在该服务另行手工调用直接派单/改派 | PASS · 自动化；`operations` 手工 API NOT RUN |
| RLS 与资源 | `operations` schema 直接 SQL 核对 **28/28** 表 FORCE RLS；迁移往返使用另一个自有 schema；退出后逐一核对两处精确 schema 和临时存储均不存在，8011/5186 无监听 | PASS · SQL/清理 |
| 生产和 Hosted CI | 没有目标环境或正式材料 | NOT RUN |

权限与锁序自查未发现需要偏离设计的变更：平台创建限定本人来源和全局专家角色，业务连接不能读密码哈希；配置只锁 Expert，派单保持论文→旧任务→目标 Expert；服务端每次实际指派仍重新校验，页面禁选并非授权依据。测试使用虚构数据，未证明真实旧数据可直接迁移。

## 最终前端补记（2026-10-02）

`node_modules/.bin/vitest run src/modules/expert-management/__tests__/realExpertLibrary.spec.ts --maxWorkers=4` 先退出 1（新增账号停用断言失败，1 failed/5 passed），最小修复后退出 0（6 passed）。随后全套前端、类型检查和真实模式构建重新通过；最终数量与命令记在[T08总验收](2026-09-28-t08-validation.md)。T07-4 属于**本地验证**，并不等于完整六角色浏览器验收或实际试点放行。
