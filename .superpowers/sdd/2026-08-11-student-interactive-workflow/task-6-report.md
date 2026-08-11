# Task 6 实施报告：学生消息通知交互

## 当前阶段

学生端计划 Task 6 已完成实现与验证，等待上层任务整合；未扩展 Task 7 演示场景控制器或外部短信、邮件能力。

## 已检查内容

- `docs/superpowers/plans/2026-08-11-student-interactive-workflow.md`
- `.superpowers/sdd/2026-08-11-student-interactive-workflow/task-6-brief.md`
- `docs/02_产品设计/页面原型/页面原型_PAGE-015_通知中心.md`
- `docs/01_需求分析/需求规格说明.md`
- `docs/05_API设计/API设计.md`
- `docs/06_开发规范/开发规范.md`
- `docs/07_测试验收/测试与验收.md`
- Task 1 的学生通知服务、v1 持久化与本人论文权限守卫
- Task 5 的学生结果、异议通知和公开投影
- 现有通知中心、路由名称、角色菜单与认证状态

## 主要发现

- Task 1 通知原先只有 `kind/message/createdAt/read`，无法可靠生成带本人论文 ID 的目标；Task 6 为业务通知补充必填 `thesisId`，系统数据重置通知保持无业务目标。
- 既有 `schemaVersion: 1` 快照可能含 Task 6 之前生成、缺少 `thesisId` 的通知，需要兼容迁移，不能因本轮字段扩展丢失可导航能力。
- 已跟踪的 `frontend/package.json` 只有 `test:unit`，工作区脏文件中的 `test:unit:run` 不能作为可复现依据。
- 非学生通知中心是现有静态演示投影，本任务必须保留，不能接入学生服务。

## 修改内容

- 新增 `frontend/src/modules/shared/components/StudentNotificationList.vue`：加载学生通知，展示类型、标题、公开摘要、时间、已读状态、总数与未读数，支持单条打开、全部已读、空态和失败重试。
- 修改 `frontend/src/modules/shared/pages/NotificationCenterPage.vue`：仅学生角色使用真实学生通知服务；其他角色继续显示原有三条演示消息，且不调用学生通知服务。
- 新增 `frontend/src/modules/shared/__tests__/studentNotifications.spec.ts`：覆盖真实服务投影、先已读后导航、论文/异议目标、全部已读、空态、失败恢复、旧 v1 迁移、越权目标阻断和非学生角色隔离。
- 修改 `frontend/src/demo/types.ts`：业务通知携带 `thesisId`，并预留结果发布通知类型；数据重置通知无论文目标。
- 修改 `frontend/src/modules/thesis/services/studentPortalService.ts`：所有学生/学校业务通知写入论文 ID；学生列表和已读动作只投影、更新本人通知。
- 修改 `frontend/src/demo/studentPersistence.ts`：归一化通知并为旧 v1 业务通知从确定性旧 ID 恢复论文目标；未知或不完整通知不进入学生投影。
- 修改 Task 6 正式计划和 brief：将不可由已跟踪 `package.json` 复现的 `test:unit:run` 更正为 `npm run test:unit -- --run ...`，未修改或暂存脏 `package.json`。

## 只读审查与修复

- 首轮只读审查发现两项 Important：业务目标通知只有颜色点而无可见/可感知的已读文字；无目标 `DEMO_DATA_RESET` 通知只能通过“全部已读”更新。另有一项 Minor：测试只验证最终结果，未锁定“先已读、后导航”的顺序。
- 先补测试并取得 2/2 定向 RED，再让所有通知始终显示“已读/未读”，为无目标未读通知增加真实单条已读动作；导航测试改用延迟完成的已读 Promise，明确断言 Promise 完成前仍停留在通知页。
- 最终复审结论为 `READY / APPROVED`，无 Critical、Important 或 Minor 遗留项。

## RED 证据

首次执行：

```bash
cd frontend
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts
```

结果：1 个文件中 7 个失败、1 个通过。失败分别证明旧页面缺少学生服务列表、已读、全部已读、跳转、未读数、空态、失败恢复和越权目标拦截；唯一通过的是非学生角色原演示投影保护测试。

旧 v1 迁移补测首次定向执行：

```bash
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts -t "restores the thesis target"
```

结果：1/1 失败，旧通知因缺少 `thesisId` 没有可打开动作。

## 验证结果

```bash
cd frontend
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts src/router/__tests__/routes.spec.ts
npm run test:unit -- --run src/demo/__tests__/studentPortalService.spec.ts src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts src/modules/thesis/__tests__/studentWorkspace.spec.ts
npm run test:unit -- --run
npm run type-check
VITE_DEMO_MODE=true npm run build
```

- Task 6 目标测试：1 个文件，11/11 通过。
- Task 6 与路由回归：2 个文件，15/15 通过。
- Task 1/4/5 相关回归：4 个文件，51/51 通过。
- 全量前端单元测试：28 个文件，136/136 通过。
- `vue-tsc --build` 通过。
- Vite 演示模式生产构建通过。
- 仅对 Task 6 源码执行 Prettier 写入并保持格式稳定，未运行会改写用户其他脏 `src/` 文件的全目录格式命令。
- 从 `git archive HEAD` 解压后只覆盖 Task 6 的 6 个源码/测试文件，复用现有 `node_modules`，再次执行已跟踪脚本下的目标测试 11/11、类型检查和生产构建，三者均通过；未复制脏 `package.json`、认证、路由或其他未跟踪源码。
- `git diff --check` 对 Task 6 精确文件通过。

## 待确认问题

无阻塞设计问题。结果发布通知类型已具备展示和目标映射，但具体由跨角色场景统一生成仍属于 Task 7，不在本任务伪造发布动作。

## Concerns

- 当前通知、已读状态和跳转均为前端演示服务与本地持久化，不代表真实 API、数据库、短信或邮件已经接入。
- 构建保留既有第三方 `@vueuse/core` PURE annotation 警告和大 chunk 警告，不影响退出码；Vitest 保留 Node `localStorage` experimental warning。
- 仓库仍有大量用户既有未提交文件；本任务只精确暂存报告列出的 Task 6 文件，不清理或提交其他改动。

## 下一步建议

按实施计划进入 Task 7 演示场景控制器和环境隔离；由统一场景快照生成结果发布通知，不得在学生通知页面伪造跨角色状态变化。
