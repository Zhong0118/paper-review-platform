# Task 6 实施报告：学生消息通知交互

## 当前阶段

学生端计划 Task 6 controller review round 2 已完成恢复态兼容修复与验证，等待上层任务整合；未扩展 Task 7 演示场景控制器或外部短信、邮件能力。

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
- 初始 Task 6 提交未修改生产 `frontend/src/router/index.ts`，因此工作区路由测试可以通过，但从 HEAD 启动的应用没有注册消息中心、学生工作台或学生评审结果。
- 生产路由真实引用学生工作台后，clean archive 暴露两个既存的直接构建前置依赖：`EligibilityCard.vue` 与 `StatusTag.vue` 未被此前提交跟踪；经上层任务明确授权，本轮只精确纳入这两个自包含组件，不纳入旧 24 角色 `frontend/src/router/routes.ts` 或其他旧页面。
- Round 1 提交的路由测试依赖 `createAppRouter` 命名导出，而按要求恢复的用户原 `index.ts` 只导出默认 production router；恢复态因测试越过公开默认边界而失败，并非三条路由缺失。
- 用户未跟踪的 `frontend/src/router/routes.ts` 与共享 records 的三条路由在 path、name、component、roleCodes、layout 和 pageId 上完全一致，可在不纳入其他 21 条路由的前提下安全复用共享 records。

## 修改内容

- 新增 `frontend/src/modules/shared/components/StudentNotificationList.vue`：加载学生通知，展示类型、标题、公开摘要、时间、已读状态、总数与未读数，支持单条打开、全部已读、空态和失败重试。
- 修改 `frontend/src/modules/shared/pages/NotificationCenterPage.vue`：仅学生角色使用真实学生通知服务；其他角色继续显示原有三条演示消息，且不调用学生通知服务。
- 新增 `frontend/src/modules/shared/__tests__/studentNotifications.spec.ts`：覆盖真实服务投影、先已读后导航、论文/异议目标、全部已读、空态、失败恢复、旧 v1 迁移、越权目标阻断和非学生角色隔离。
- 修改 `frontend/src/demo/types.ts`：业务通知携带 `thesisId`，并预留结果发布通知类型；数据重置通知无论文目标。
- 修改 `frontend/src/modules/thesis/services/studentPortalService.ts`：所有学生/学校业务通知写入论文 ID；学生列表和已读动作只投影、更新本人通知。
- 修改 `frontend/src/demo/studentPersistence.ts`：归一化通知并为旧 v1 业务通知从确定性旧 ID 恢复论文目标；未知或不完整通知不进入学生投影。
- 修改 Task 6 正式计划和 brief：将不可由已跟踪 `package.json` 复现的 `test:unit:run` 更正为 `npm run test:unit -- --run ...`，未修改或暂存脏 `package.json`。
- 新增 `frontend/src/router/studentNotificationRoutes.ts` 并由生产 `frontend/src/router/index.ts` 直接注册：消息中心、学生工作台和学生评审结果共用同一组生产 route records；测试不再自行复制路由定义。
- 新增 `frontend/src/router/__tests__/studentNotificationRoutes.spec.ts`：覆盖默认 production router 的真实注册与 resolve，并直接验证共享 records 的角色元数据和组件 loader；不再依赖可选 router factory。
- 增强通知测试与页面：非学生演示通知显示“已读/未读”；学校接收的异议通知不进入学生列表，学生“全部已读”不修改学校未读状态；补充 `RESULT_PUBLISHED` 到学生评审结果命名路由的映射。
- 新增 `frontend/src/styles/__tests__/notificationContrast.spec.ts`，并将通知正文、时间和读态复用 `--color-text-secondary`；该 token 在白底的小字号对比度不低于 4.5:1。
- 精确纳入 `frontend/src/components/app/StatusTag.vue` 与 `frontend/src/modules/thesis/components/EligibilityCard.vue`，仅作为既存学生工作台的 clean-build 直接前置依赖；除 Prettier 格式化外未改功能。
- Round 2 精确修改路由测试，改用默认 production router 的 `getRoutes()` / `resolve()` 验证三条路由；用户未跟踪 `routes.ts` 仅增加共享 import/spread 并删除三段等价重复 records，该文件不进入 Task 6 提交。

## 只读审查与修复

- 首轮只读审查发现两项 Important：业务目标通知只有颜色点而无可见/可感知的已读文字；无目标 `DEMO_DATA_RESET` 通知只能通过“全部已读”更新。另有一项 Minor：测试只验证最终结果，未锁定“先已读、后导航”的顺序。
- 先补测试并取得 2/2 定向 RED，再让所有通知始终显示“已读/未读”，为无目标未读通知增加真实单条已读动作；导航测试改用延迟完成的已读 Promise，明确断言 Promise 完成前仍停留在通知页。
- 最终复审结论为 `READY / APPROVED`，无 Critical、Important 或 Minor 遗留项。
- Controller review round 1 复核 1 项 Critical、4 项 Important 和 1 项 Minor：生产路由改为真实注册三条目标记录；验证命令只使用 HEAD 已存在的 `test:unit`；非学生读态、跨角色已读隔离和 AA 对比度均由回归测试覆盖；`RESULT_PUBLISHED` 映射由真实命名路由测试锁定。
- Controller review round 2 复核 1 项 Important：测试只依赖默认 production router 这一个提交态/恢复态共同公开边界；用户完整路由通过共享 records 消除三条定义分叉，其余 21 条保持原内容。

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

Controller review round 1 使用 `git archive HEAD` 加入仅本轮测试和 route records 复现 RED：3 个文件共 18 项中 4 项失败、14 项通过。失败精确证明生产 router 的 route list 为空、非学生通知没有可见读态、旧小字号颜色未使用 AA token，以及可复用生产 router factory 缺失。

Controller review round 2 在恢复用户原 `index.ts` 后复现 RED：生产路由测试 4 项中 1 项失败、3 项通过，唯一失败为 `createAppRouter is not a function`；证明默认 router 的三条注册已存在，失败来自测试依赖了恢复态不承诺的命名导出。

## 验证结果

```bash
cd frontend
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts
npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts src/router/__tests__/studentNotificationRoutes.spec.ts src/styles/__tests__/notificationContrast.spec.ts
npm run test:unit -- --run
npm run type-check
VITE_DEMO_MODE=true npm run build
npx prettier --check <Task 6 精确源码列表>
```

- Task 6 目标、真实生产路由、权限隔离与颜色回归：3 个文件，18/18 通过。
- 全量前端单元测试：30 个文件，143/143 通过。
- `vue-tsc --build` 通过。
- Vite 演示模式生产构建通过。
- Task 6 与两个直接前置依赖的精确源码列表通过 Prettier 检查，未运行会改写用户其他脏 `src/` 文件的全目录格式命令。
- 从 `git archive HEAD` 解压后只覆盖本轮精确源码/测试文件与两个已授权的直接前置依赖，复用现有 `node_modules`，再次执行目标测试 18/18、archive 全量测试 107/107、类型检查、演示生产构建和精确格式检查；未复制脏 `package.json`、认证、旧 24 角色路由或其他未跟踪源码。
- Round 2 恢复态目标测试 18/18、`vue-tsc --build`、完整用户路由生产构建和两文件 Prettier 检查通过；从 `0bf8ddd` clean archive 只覆盖 tracked 测试补丁后，目标测试 18/18、类型检查、生产构建和格式检查同样通过。
- `git diff --check` 对 Task 6 精确文件通过。

## 待确认问题

无阻塞设计问题。结果发布通知类型已具备展示和目标映射，但具体由跨角色场景统一生成仍属于 Task 7，不在本任务伪造发布动作。

## Concerns

- 当前通知、已读状态和跳转均为前端演示服务与本地持久化，不代表真实 API、数据库、短信或邮件已经接入。
- 构建保留既有第三方 `@vueuse/core` PURE annotation 警告和大 chunk 警告，不影响退出码；Vitest 保留 Node `localStorage` experimental warning。
- `EligibilityCard.vue` 与 `StatusTag.vue` 原属于 2026-08-10 客户端计划的未跟踪工作；本轮因真实生产路由使其成为 clean-build 直链前置依赖，经明确授权后纳入，未连带纳入其旧计划测试或其他角色页面。
- 用户 `frontend/src/router/routes.ts` 仍为未跟踪文件；Round 2 仅在工作区保留共享三条 records 的复用差异，原文件已备份至 `/private/tmp/task6-router-routes-before-round2.ts`，不强制纳入 Task 6 提交。
- 仓库仍有大量用户既有未提交文件；本任务只精确暂存报告列出的 Task 6 文件，不清理或提交其他改动。

## 下一步建议

按实施计划进入 Task 7 演示场景控制器和环境隔离；由统一场景快照生成结果发布通知，不得在学生通知页面伪造跨角色状态变化。
