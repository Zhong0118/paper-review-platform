# Task 7 实施报告：演示场景控制器和环境隔离

## 当前阶段

学生端计划 Task 7 已完成实现、审查修复、工作区验证和 clean archive 验证，等待精确提交；未扩展 Task 8 的黄金路径、视觉验收或正式页面文档回写。

## 已检查内容

- `docs/superpowers/plans/2026-08-11-student-interactive-workflow.md`
- `.superpowers/sdd/2026-08-11-student-interactive-workflow/task-7-brief.md`
- `docs/superpowers/specs/2026-08-11-student-interactive-workflow-design.md`
- `docs/01_需求分析/需求规格说明.md` 的学生权限矩阵
- `docs/02_产品设计/产品与流程设计.md` 的 FLOW-001、FLOW-002、FLOW-007、FLOW-008、FLOW-009 与状态机
- PAGE-002、PAGE-003、PAGE-012、PAGE-015 正式页面原型
- `docs/06_开发规范/开发规范.md`
- `docs/07_测试验收/测试与验收.md`
- Task 1 的 `StudentPortalService`、场景服务、v1 持久化和演示门禁
- Task 4、5、6 的学生工作台、论文编辑、结果异议和通知页面

## 主要发现

- Task 1 已实现 `demoMode=false` 时拒绝 `loadStudentScenario()`，但原装载逻辑只修改论文阶段，上一场景的结果、异议、撤回申请、通知、任务状态和评阅状态会残留。
- 原 `StudentScenarioPreset = DemoStage` 暴露内部状态名，缺少正式设计要求的 `RETURNED`、`SCHOOL_REVIEW` 和 `EXPERT_REVIEW` 六场景接口。
- 三张学生业务页没有显式 `VITE_DEMO_MODE` 入口，也没有在场景变化后重新读取真实服务投影。
- 资格和文件校验没有独立演示接口；重置会覆盖状态但不先清除 `baijie-demo-student:v1`。
- Task 7 新增通知类型后，Task 6 的通知展示穷尽映射需要同步补齐，否则类型检查和运行时渲染都会失败。
- 已跟踪的 `frontend/package.json` 只保证 `test:unit`；计划和 brief 中的 `test:unit:run` 不能作为 clean archive 可复现命令。
- 三张目标页面相对 HEAD 均无既存脏差异；`.env.example` 存在预先写入且与 Task 7 完全一致的未提交演示门禁配置，审计后原样保留并纳入本任务。
- `main.ts` 存在预先写入的场景服务注入；clean archive 审计确认 HEAD 并未提供该注入，而三张学生页面都通过 injection key 读取服务，因此将这两行原样纳入 Task 7 的最小运行闭包。

## 修改内容

- 新增 `StudentDemoScenarioController.vue`：右下浮动入口、明确权限免责声明、六个主线快照、三种资格、两种文件校验和带二次确认的一键重置。
- 将 `StudentScenarioPreset` 收窄为 `DRAFT | RETURNED | SCHOOL_REVIEW | EXPERT_REVIEW | RESULT_PROCESSING | COMPLETED`，并新增资格和文件辅助场景类型。
- 场景服务改为从固定 fixtures 原子重建论文、时间线、结果、撤回申请、异议、通知、任务和评阅投影；控制器不调用学生业务动作伪造跨角色推进。
- `RETURNED` 提供学校公开退回原因和通知；`COMPLETED` 同时提供已发布结果、结果时间线和结果通知；其他快照清除不属于该场景的旧结果、异议、撤回和通知。
- 资格场景提供有效、暂停、过期的公开投影；文件场景把主线文件元数据切换为校验成功或失败，失败在编辑页显示可恢复提示。
- 文件辅助场景在已保存草稿显式包含 `files: []` 时从固定 fixtures 恢复文件，再投影成功或失败状态，避免空数组使操作无可见效果。
- `resetStudentDemo()` 先删除 `baijie-demo-student:v1`，再重装固定 fixtures 并持久化。
- 重置确认对话框提供可访问名称、打开后的初始焦点、Tab/Shift+Tab 焦点约束和 Escape 关闭；对话框 Teleport 到页面背景之外，打开时三页统一锁定背景，取消和成功后都恢复入口焦点。
- Dashboard、Editor、Result 三页均只按 `import.meta.env.VITE_DEMO_MODE === 'true'` 传入 `enabled`，收到控制器 `changed` 后重新读取服务投影；三页在环境变量为 `false` 时均无入口且无法触达控制器。
- 新增 `vite-env.d.ts` 和 `.env.example` 的显式演示变量声明；未修改脏 `package.json`。
- 补齐 `THESIS_RETURNED`、`EXPERT_REVIEW_STARTED` 的通知持久化与展示映射。
- 将 Task 1/4 测试中的旧 `UNDER_REVIEW` 场景调用迁移为 `EXPERT_REVIEW`。
- 将正式计划和 Task 7 brief 的命令更正为可由已跟踪脚本复现的 `npm run test:unit -- --run ...`。

## RED 证据

首次目标测试因 `StudentDemoScenarioController.vue` 不存在而 1 个 suite 失败、0 项执行，证明测试先于组件实现。

完成服务和控制器基础后，新增三张真实页面投影测试再次取得 3/12 失败：三页均找不到演示入口。页面接入并刷新服务投影后 12/12 通过。

新增退回和送审评阅通知场景后，类型检查报告 `StudentNotificationList` 的穷尽映射缺少两个 kind；行为测试同时取得 2/14 失败并捕获运行时 `presentationByKind[notification.kind]` 为 `undefined`。补齐两个真实展示映射后 14/14 通过。

独立审查提出三项 Important 后，补强测试取得 5/22 失败：空文件草稿的 `VALID` 和 `INVALID` 两项仍为 0 个文件；重置测试两项找不到要求的 Teleport 对话框；真实 Dashboard 的背景未进入 `inert`。最小修复后 22/22 通过。补强套件还验证了六个场景在切换前确实存在旧结果、撤回、异议和通知，切换后从同一存储重建服务仍得到完整替换；重置后同样重建服务验证 fixture 恢复；三张真实页面逐一验证环境门禁关闭；服务门禁逐一拒绝四个演示动作。

## 验证结果

```bash
cd frontend
npm run test:unit -- --run src/modules/thesis/__tests__/studentDemoScenario.spec.ts
npm run test:unit -- --run src/modules/thesis/__tests__ src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/shared/__tests__/studentNotifications.spec.ts src/demo/__tests__/studentPortalService.spec.ts
npm run test:unit -- --run
npm run type-check
VITE_DEMO_MODE=true npm run build
./node_modules/.bin/prettier --write --experimental-cli <Task 7 精确源码列表>
git diff --check
```

- Task 7 目标测试：1 个文件，22/22 通过。
- 学生模块与 Task 1 服务回归：10 个文件，121/121 通过。
- 工作区全量前端单元测试：31 个文件，165/165 通过。
- `vue-tsc --build` 通过。
- Vite 演示模式生产构建通过。
- Task 7 精确源码列表已由 Prettier 格式化；未运行会改写用户其他脏 `src/` 文件的全目录格式命令。
- `git diff --check` 通过。
- 从 `git archive HEAD` 解压后叠加 Task 7 暂存补丁，只复用现有 `node_modules`，再次执行目标测试 22/22、学生模块与服务回归 121/121、archive 全量测试 129/129、类型检查、演示生产构建和精确 Prettier 检查，全部退出码为 0；未复制未跟踪源码或脏 `package.json`。

## 待确认问题

无阻塞设计问题。

## Concerns

- 当前场景、资格、文件和通知均为前端本地演示快照，不代表真实 API、数据库、文件校验、学校同步或消息发送已经接入。
- 构建保留第三方 `@vueuse/core` PURE annotation 警告和既有大 chunk 警告；Vitest 保留 Node `localStorage` experimental warning，均未影响退出码。
- 仓库仍有大量用户既有未提交文件；本任务只精确暂存报告所列 Task 7 文件，不清理或提交其他改动。

## 下一步建议

按实施计划进入 Task 8：补充学生黄金路径、桌面与移动端视觉验收，并回写正式页面和需求追踪文档；不得跳过 Task 7 的提交与审查。
