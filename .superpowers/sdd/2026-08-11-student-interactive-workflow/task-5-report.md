# Task 5 实施报告：结果查看和异议提交闭环

## 当前阶段

学生端计划 Task 5 及 controller review fix round 1 已完成实现与验证，等待上层任务整合；未扩展 Task 6 及后续页面。

## 已检查内容

- `docs/superpowers/plans/2026-08-11-student-interactive-workflow.md`
- `.superpowers/sdd/2026-08-11-student-interactive-workflow/task-5-brief.md`
- 正式需求、权限、FLOW-007/FLOW-009、PAGE-012/PAGE-019、开发与测试规范
- Task 1 的 `StudentPortalService`、持久化快照、结果与异议状态
- Task 3 的 `ThesisFileMeta` 六字段持久化边界与文件失败恢复规则

## 实现内容

- 结果页读取 `?thesisId=`，并提供本人论文选择器；切换时同步查询参数并重新读取同一个学生服务投影。
- 未发布论文只显示学生五阶段进度、最近公开事件和“结果尚未发布”，不展示分数、评语或异议表单。
- 已发布结果展示总分、六维评分、结论、获准公开评语、发布时间和匿名专家序号；学生结果投影只序列化公开字段，不包含专家姓名、电话、邮箱或内部记录。
- 异议理由和处理诉求均必填；附件沿用 Task 3 的六字段 `ThesisFileMeta`，固定 `purpose='OBJECTION'`，不保存 `File` 或正文。
- 附件模拟失败时保留理由与诉求，将附件标记为 `INVALID` 并展示“上传失败/重新选择附件”；在重新选择并校验成功前禁用提交。
- 提交使用独立二次确认框，防重复点击；成功后写入 `SUBMITTED` 异议，并在同一状态源分别生成学生 `OBJECTION_SUBMITTED` 和学校审核 `OBJECTION_RECEIVED` 通知。
- 服务端阻止同一论文同时存在第二个 `SUBMITTED`/`PROCESSING` 异议，并从论文 `allowedActions` 移除 `SUBMIT_OBJECTION`。
- 异议时间线支持 `SUBMITTED → PROCESSING → RESOLVED`，只展示公开学校结论；`RESOLVED` 不改变论文 `COMPLETED` 状态。
- 兼容旧 `schemaVersion: 1` 的 reason-only 异议：恢复为 `SUBMITTED`、空诉求和空附件，并继续按未解决异议阻止重复提交。

## Fix round 1

- 用 `git cat-file`/`git ls-tree` 递归核对 `StudentResultPage` 的运行依赖，将 8 个已有但原未跟踪的最小直接/间接依赖纳入 Task 5：`BlindRail`、`PageHeader`、`WorkflowSteps`、`AppHeader`、`BrandMark`、`menus.ts`、`roles.ts`、`AnonymousResultTable`。
- 去除 Task 5 发布测试对未跟踪 Task 6+ 学校/导师页面的偶然依赖，改为通过真实 `ScenarioService.publishResult()` 发布后验证学生投影。
- 二次确认成功和服务失败均走统一 `closeConfirmation()`：成功后聚焦新生成的异议时间线，失败后恢复原提交按钮焦点，均解锁背景。
- 异议必填错误按字段设置 `aria-invalid`/`aria-describedby`，并在校验失败后聚焦第一个缺失字段。
- 学校审核通知使用明确 `recipientRole='school_reviewer'` 的服务投影；学生通知列表和已读操作均过滤学校内部通知，且通知不含真实专家身份或联系方式。

## RED 证据

首次执行：

```bash
cd frontend
npm run test:unit:run -- src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts
```

结果为 2 个文件、9/9 失败，分别证明旧页面缺少论文选择器、五阶段/最近事件、六维与发布时间、异议表单、附件失败恢复、二次确认和状态时间线。

审查补强 RED：

- 提交首个异议后，论文详情仍错误包含 `SUBMIT_OBJECTION`；定向测试 1/1 失败。
- 旧 v1 reason-only 异议恢复后缺少 `status/request/attachments`；定向测试 1/1 失败。
- fix round 1 行为测试首次执行为 4/10 失败：必填字段缺少 ARIA 错误关联，成功/失败确认关闭未恢复焦点，且服务缺少学校通知投影。
- fix round 1 clean-tree RED：仅从 `HEAD` 解压的临时目录中，`type-check` 因 `roles.ts`/`menus.ts` 缺失失败，Task 5 测试因 `BlindRail.vue` 等未跟踪递归依赖无法加载。

## 修改内容

### Task 5 页面、组件与测试

- `frontend/src/modules/result/components/StudentResultSelector.vue`
- `frontend/src/modules/result/components/StudentScoreDimensions.vue`
- `frontend/src/modules/result/components/StudentObjectionForm.vue`
- `frontend/src/modules/result/components/StudentObjectionTimeline.vue`
- `frontend/src/modules/result/pages/StudentResultPage.vue`
- `frontend/src/modules/result/__tests__/studentResultAndObjection.spec.ts`
- `frontend/src/modules/result/__tests__/resultPublication.spec.ts`

### Task 1 服务合同必要扩展

- `frontend/src/demo/types.ts`
- `frontend/src/demo/studentFixtures.ts`
- `frontend/src/demo/studentPersistence.ts`
- `frontend/src/demo/scenarioService.ts`
- `frontend/src/modules/thesis/services/studentPortalService.ts`
- `frontend/src/demo/__tests__/studentPortalService.spec.ts`

### Fix round 1 最小 clean-tree 依赖

- `frontend/src/components/app/AppHeader.vue`
- `frontend/src/components/app/BlindRail.vue`
- `frontend/src/components/app/BrandMark.vue`
- `frontend/src/components/app/PageHeader.vue`
- `frontend/src/components/app/WorkflowSteps.vue`
- `frontend/src/modules/result/components/AnonymousResultTable.vue`
- `frontend/src/router/menus.ts`
- `frontend/src/types/roles.ts`

## 验证结果

```bash
cd frontend
npm run test:unit:run -- src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts
npm run test:unit:run -- src/demo/__tests__/studentPortalService.spec.ts src/demo/__tests__/scenarioService.spec.ts src/demo/__tests__/goldenPath.spec.ts src/modules/thesis/__tests__/studentWorkspace.spec.ts src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts
npm run test:unit:run
npm run type-check
VITE_DEMO_MODE=true npm run build
npm exec prettier -- --check <Task 5 精确文件列表>
```

- Task 5 目标测试：2 个文件，12/12 通过。
- 相关服务、黄金路径、工作台和结果回归：6 个文件，59/59 通过。
- 全量单元测试：27 个文件，125/125 通过。
- `vue-tsc --build` 通过。
- Vite 生产构建通过。
- Task 5 精确文件 Prettier 检查通过。
- 从 Git index 用 `git checkout-index` 生成的隔离临时检出中，`type-check`、生产构建和 Task 5 两个测试文件 12/12 均通过，仅复用已安装的 `node_modules`，不读取当前工作树未跟踪源码。

## 待确认问题

无阻塞设计问题。异议期限仍按正式文档保持未配置状态，本任务未擅自设置默认期限。

## Concerns

- 当前附件处理是前端演示元数据与模拟校验，不代表真实上传、PDF 内容检查、对象存储或病毒扫描已经实现。
- 学生/学校异议通知均只写入演示服务状态，不代表真实站内信或外部渠道已经发送；本任务只增加学校可读服务投影，未增加 Task 6 通知中心 UI。
- Vitest 仍输出既有 Node `localStorage` experimental warning；构建仍输出第三方 `@vueuse/core` PURE annotation 和大 chunk 警告，均不影响退出码。

## 下一步建议

按计划进入 Task 6 学生消息通知交互，由通知中心消费本任务生成的 `OBJECTION_SUBMITTED` 通知；不得跳到 Task 7 或 Task 8。
