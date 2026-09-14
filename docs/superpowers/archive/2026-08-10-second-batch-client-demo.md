# 第二批甲方演示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有前端演示升级为一篇论文贯穿学生、学校、百杰运营和专家四端的单专家完整流程，并为各端补齐可演示的多状态管理页面。

**Architecture:** 继续使用 `ScenarioService` 作为前端演示服务边界，所有页面只读取不可变投影并通过命令推进共享场景。论文宏观状态、运营队列、专家任务和学校账单分别建模；页面按角色投影身份信息，正式模式不回落到演示数据。

**Tech Stack:** Vue 3.5、TypeScript 5.9、Pinia 3、Vue Router 5、Element Plus 2.14、Vitest 4、Vue Test Utils、Vite 8。

## Global Constraints

- 在现有分支和原项目目录内实施，不创建 worktree，不新增业务依赖。
- 论文宏观状态仅使用 `DRAFT`、`SUBMITTED`、`PREPARING`、`READY_FOR_DISPATCH`、`UNDER_REVIEW`、`RESULT_PROCESSING`、`COMPLETED`、`TERMINATED`。
- 演示批次目标专家数为 1、任务费用为 300 元、评阅模板为六维 100 分；这些值来自演示规则快照，不是平台默认值。
- 学校承担送审费；确认送审冻结额度，有效评阅后消费；学校账户与专家余额分离。
- 学生和学校分别上传原始版、匿名版；系统检测、学校确认；不宣称自动生成匿名版。
- 学生提交被退回后由学生本人修改；学校代传允许同一管理员代传、审核和确认并分别留痕。
- 百杰运营按职责可见学生、导师与专家身份，但不可读取论文原始版；学校端不得显示专家身份；专家端不得显示学生、导师身份。
- 页面根容器使用完整可用宽度，不设置全局 `max-width`。
- UI 延续学术蓝、纸张白、石墨灰和状态色；双盲信息轨道作为四端一致的标志性元素。
- 所有业务行为遵循测试先行：先看到目标测试因缺少行为而失败，再实现最小代码并运行回归。

---

### Task 1: 正式状态分层与单专家共享场景

**Files:**
- Modify: `frontend/src/demo/types.ts`
- Modify: `frontend/src/demo/fixtures.ts`
- Modify: `frontend/src/demo/scenarioService.ts`
- Modify: `frontend/src/stores/demoScenario.ts`
- Modify: `frontend/src/demo/__tests__/scenarioService.spec.ts`
- Modify: `frontend/src/demo/__tests__/goldenPath.spec.ts`

**Interfaces:**
- Produces: `ThesisStage`、`ReviewTaskStatus`、`OperationsQueue`、`SchoolBillStatus`、`ReviewScoreInput`。
- Produces: `ScenarioService.listOperationsItems()`、`listExpertTasks()`、`getSchoolAccount()`、`getSchoolBills()`、`submitFinalReview(input)`。
- Consumes: 现有 `RoleCode`、`DemoThesisSummary` 和 `createScenarioServiceProvider()`。

- [x] **Step 1: 写正式状态与单专家黄金流程失败测试**

```ts
it('uses formal thesis stages while task and billing states advance independently', async () => {
  const service = createScenarioService()
  await service.submitThesis()
  expect((await service.confirmAnonymization()).thesis.stage).toBe('READY_FOR_DISPATCH')
  expect((await service.confirmDispatch()).schoolAccount?.frozenAmount).toBe(300)
  expect((await service.assignExperts()).thesis.stage).toBe('UNDER_REVIEW')
  await service.acceptTask()
  await service.submitFinalReview(validReviewScore)
  expect((await service.getSchoolBills())[0].status).toBe('CONSUMED')
  expect((await service.publishResult()).thesis.stage).toBe('COMPLETED')
})
```

- [x] **Step 2: 运行状态测试并确认按预期失败**

Run: `npm run test:unit:run -- src/demo/__tests__/scenarioService.spec.ts src/demo/__tests__/goldenPath.spec.ts`

Expected: FAIL，原因包含旧的 `PENDING_ASSIGNMENT/PUBLISHED` 状态、缺少学校账户或 `submitFinalReview` 参数。

- [x] **Step 3: 建立分层类型与演示投影**

```ts
export type ThesisStage =
  | 'DRAFT' | 'SUBMITTED' | 'PREPARING' | 'READY_FOR_DISPATCH'
  | 'UNDER_REVIEW' | 'RESULT_PROCESSING' | 'COMPLETED' | 'TERMINATED'
export type ReviewTaskStatus =
  | 'INVITED' | 'IN_REVIEW' | 'SUBMITTED' | 'REJECTED' | 'ACCEPT_TIMEOUT' | 'CANCELLED'
export type SchoolBillStatus = 'FROZEN' | 'CONSUMED' | 'RELEASED' | 'CANCELLED' | 'REVERSED'
export interface ReviewScoreInput {
  topicValue: number
  literatureTheory: number
  methodology: number
  innovation: number
  resultsWorkload: number
  writingStandards: number
  recommendation: string
  strengths: string
  issues: string
  revisionAdvice: string
  overallComment: string
}
```

`confirmDispatch()` 保持论文为 `READY_FOR_DISPATCH` 并冻结 300 元；`assignExperts()` 创建唯一 `INVITED` 任务并把论文置为 `UNDER_REVIEW`；最终评阅把论文置为 `RESULT_PROCESSING` 并消费账单；`publishResult()` 才把论文置为 `COMPLETED`。

- [x] **Step 4: 运行状态与黄金流程测试**

Run: `npm run test:unit:run -- src/demo/__tests__/scenarioService.spec.ts src/demo/__tests__/goldenPath.spec.ts`

Expected: PASS，发布结果只有“专家 A”，总分为六项之和，快照中不泄露跨角色身份。

- [x] **Step 5: 运行类型检查**

Run: `npm run type-check`

Expected: PASS；旧页面对废弃状态的引用将作为本任务必须修复的编译错误，不使用兼容别名掩盖。

### Task 2: 四端导航、路由与全宽管理外壳

**Files:**
- Modify: `frontend/src/router/routes.ts`
- Modify: `frontend/src/router/menus.ts`
- Modify: `frontend/src/router/__tests__/routes.spec.ts`
- Modify: `frontend/src/layouts/AdminLayout.vue`
- Modify: `frontend/src/layouts/PortalLayout.vue`
- Modify: `frontend/src/layouts/__tests__/AdminLayout.spec.ts`
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/styles/theme.css`
- Create: `frontend/src/components/app/ScenarioStageRibbon.vue`
- Create: `frontend/src/components/app/__tests__/ScenarioStageRibbon.spec.ts`

**Interfaces:**
- Consumes: `ThesisStage` 和 `DemoScenarioSnapshot`。
- Produces: `ScenarioStageRibbon`，props 为 `{ stage: ThesisStage; taskStatus?: ReviewTaskStatus; billStatus?: SchoolBillStatus }`。
- Produces: 规格中的学生、学校、百杰、专家完整菜单与 PAGE-001—024 路由入口。

- [x] **Step 1: 写菜单、路由和状态带失败测试**

```ts
expect(menusByRole.school_reviewer?.map((item) => item.label)).toEqual([
  '送审准备', '评审进度', '结果处理', '异议处理', '批次与评审规则', '学校账户与账单', '消息通知',
])
expect(menusByRole.platform_reviewer?.[0].label).toBe('送审运营台')
expect(wrapper.get('[data-stage="UNDER_REVIEW"]').text()).toContain('送审中')
```

- [x] **Step 2: 运行路由与布局测试并确认失败**

Run: `npm run test:unit:run -- src/router/__tests__/routes.spec.ts src/layouts/__tests__/AdminLayout.spec.ts src/components/app/__tests__/ScenarioStageRibbon.spec.ts`

Expected: FAIL，缺少新菜单、PAGE-014—024 路由和 `ScenarioStageRibbon`。

- [x] **Step 3: 实现完整菜单、真实页面路由和状态带**

路由名称使用“送审运营台”“评审结果与异议”“费用与提现”“个人资料与资格”；在线评阅继续由任务进入。新增页面在对应后续任务创建，路由不得以 `DemoPendingPage` 作为最终组件。

- [x] **Step 4: 落实全宽布局与视觉令牌**

```css
.admin-layout__content,
.portal-layout__content {
  width: 100%;
  min-width: 0;
  padding: clamp(1rem, 2vw, 2rem);
}
```

保留学术蓝 `#1b4f8a`，新增账务冻结琥珀、结果处理紫灰和纸张层级令牌；不增加全局最大宽度。

- [x] **Step 5: 运行路由、布局和状态带测试**

Run: `npm run test:unit:run -- src/router/__tests__/routes.spec.ts src/layouts/__tests__/AdminLayout.spec.ts src/components/app/__tests__/ScenarioStageRibbon.spec.ts`

Expected: PASS。

### Task 3: 学生与学校管理页、学校账户

**Files:**
- Modify: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Modify: `frontend/src/modules/thesis/components/StudentThesisTable.vue`
- Modify: `frontend/src/modules/school/pages/PreparationListPage.vue`
- Modify: `frontend/src/modules/school/pages/ReviewProgressPage.vue`
- Modify: `frontend/src/modules/result/pages/ResultProcessingPage.vue`
- Create: `frontend/src/modules/school/pages/SchoolAccountPage.vue`
- Create: `frontend/src/modules/school/components/SchoolAccountSummary.vue`
- Create: `frontend/src/modules/school/components/SchoolBillTable.vue`
- Create: `frontend/src/modules/school/pages/ObjectionWorkbenchPage.vue`
- Create: `frontend/src/modules/school/pages/BatchRulesPage.vue`
- Modify: `frontend/src/modules/thesis/__tests__/StudentThesisTable.spec.ts`
- Modify: `frontend/src/modules/school/__tests__/schoolIntake.spec.ts`
- Modify: `frontend/src/modules/school/__tests__/schoolDispatch.spec.ts`
- Create: `frontend/src/modules/school/__tests__/schoolAccount.spec.ts`

**Interfaces:**
- Consumes: `ScenarioService.listStudentTheses()`、`listSchoolTheses()`、`getSchoolAccount()`、`getSchoolBills()`。
- Produces: PAGE-024 学校额度摘要和账单表；账单表只接收学校投影，不含专家字段。

- [x] **Step 1: 写学校额度、退回责任和多状态表格失败测试**

```ts
expect(wrapper.text()).toContain('可用额度')
expect(wrapper.text()).toContain('冻结额度')
expect(wrapper.text()).toContain('HY-2026-0042')
expect(wrapper.text()).not.toContain('周明远')
expect(studentRow.get('[data-source="SCHOOL_MANUAL"]').text()).toContain('学校代传')
```

- [x] **Step 2: 运行学生与学校页面测试并确认失败**

Run: `npm run test:unit:run -- src/modules/thesis/__tests__/StudentThesisTable.spec.ts src/modules/school/__tests__/schoolIntake.spec.ts src/modules/school/__tests__/schoolDispatch.spec.ts src/modules/school/__tests__/schoolAccount.spec.ts`

Expected: FAIL，缺少学校账户页、账单投影或正式状态展示。

- [x] **Step 3: 实现学生多论文和学校统一送审列表**

表格列固定为盲审编号、论文题目、批次、专业代码/名称、提交来源、当前阶段、更新时间和允许动作。学生自主提交退回显示“请修改后重新提交”；学校代传显示“学校可继续处理”，但两者不产生不同论文状态机。

- [x] **Step 4: 实现 PAGE-024、异议和批次规则页面**

学校账户页展示可用、冻结、当月和累计消费；账单详情显示规则版本、冻结、消费、释放和冲正时间线。批次规则页明确显示演示规则版本 `DEMO-2026-SPRING-v1`、专家数 1、费用 300 元和六维模板，并标注“仅当前演示批次”。

- [x] **Step 5: 运行学生与学校测试**

Run: `npm run test:unit:run -- src/modules/thesis/__tests__ src/modules/school/__tests__ src/modules/result/__tests__`

Expected: PASS；学校页面序列化结果不包含专家姓名。

### Task 4: 百杰送审运营台与专家库

**Files:**
- Modify: `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue`
- Modify: `frontend/src/modules/dispatch/components/CandidateExpertTable.vue`
- Modify: `frontend/src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts`
- Create: `frontend/src/modules/dispatch/components/OperationsQueueTable.vue`
- Create: `frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue`
- Create: `frontend/src/modules/expert-management/components/ExpertLibraryTable.vue`
- Create: `frontend/src/modules/expert-management/components/ExpertProfileDrawer.vue`
- Create: `frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue`
- Create: `frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue`
- Create: `frontend/src/modules/expert-management/__tests__/expertLibrary.spec.ts`

**Interfaces:**
- Consumes: `ScenarioService.listOperationsItems()` 和 `listExpertDirectory()`。
- Produces: 八个运营队列筛选；候选专家字段包含单位、职称、专业、擅长领域、当前负载、接单率、按时完成率和禁用原因。

- [x] **Step 1: 写运营队列和专家库失败测试**

```ts
expect(wrapper.text()).toContain('待派单')
expect(wrapper.text()).toContain('已逾期')
expect(wrapper.text()).toContain('接单率')
expect(wrapper.get('[data-expert-id="expert-08"] input').attributes('disabled')).toBeDefined()
```

- [x] **Step 2: 运行百杰页面测试并确认失败**

Run: `npm run test:unit:run -- src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts src/modules/expert-management/__tests__/expertLibrary.spec.ts`

Expected: FAIL，当前页面仍名为“派单工作台”，且缺少队列和专家库组件。

- [x] **Step 3: 实现送审运营台**

页面首屏为队列表格，选中待派单论文后打开派单区；演示主线只允许选择一名专家。运营可看到林知远和专家真实身份，但只显示匿名版文件入口，不显示原始版文件名。

- [x] **Step 4: 实现专家库、更正审批和结算页**

专家库提供资格、服务状态和负载筛选；详情抽屉展示资料、资格、回避、任务历史、费用摘要和审计。更正审批只创建新结果版本；结算页展示专家收入与提现，不与学校额度混合。

- [x] **Step 5: 运行百杰端测试**

Run: `npm run test:unit:run -- src/modules/dispatch/__tests__ src/modules/expert-management/__tests__`

Expected: PASS；回避、资格失效和服务停用专家均不可选。

### Task 5: 专家任务表与六维评阅工作台

**Files:**
- Modify: `frontend/src/modules/review/pages/ExpertTasksPage.vue`
- Modify: `frontend/src/modules/review/pages/InvitationPage.vue`
- Modify: `frontend/src/modules/review/pages/ReviewWorkspacePage.vue`
- Modify: `frontend/src/modules/review/components/ReviewFormPane.vue`
- Modify: `frontend/src/modules/review/__tests__/expertReview.spec.ts`
- Create: `frontend/src/modules/review/components/ExpertTaskTable.vue`
- Create: `frontend/src/modules/review/components/ScoreDimensionInput.vue`
- Create: `frontend/src/modules/review/pages/ExpertFinancePage.vue`
- Create: `frontend/src/modules/review/pages/ExpertProfilePage.vue`

**Interfaces:**
- Consumes: `ScenarioService.listExpertTasks()`、`saveReviewDraft(input)`、`submitFinalReview(input)`。
- Produces: 六个评分字段，总分为 `topicValue + literatureTheory + methodology + innovation + resultsWorkload + writingStandards`。

- [x] **Step 1: 写任务表、六维计分和锁定失败测试**

```ts
expect(wrapper.findAll('[data-score-dimension]')).toHaveLength(6)
expect(wrapper.get('[data-total-score]').text()).toContain('86 / 100')
await wrapper.get('[data-action="submit-final-review"]').trigger('click')
expect(wrapper.get('[data-review-locked="true"]').exists()).toBe(true)
```

- [x] **Step 2: 运行专家评阅测试并确认失败**

Run: `npm run test:unit:run -- src/modules/review/__tests__/expertReview.spec.ts`

Expected: FAIL，当前表单只有单一综合分，任务页不是多状态表格。

- [x] **Step 3: 实现专家任务管理表和费用/资格页**

任务表按待接单、评阅中、即将截止、已逾期、已提交筛选；接单前只显示匿名概要、专业、期限、费用和要求。费用页显示 300 元待入账/已入账和提现状态；资格页显示专家本人资料与资格审核状态。

- [x] **Step 4: 实现六维动态评阅表**

六项上限依次为 15、15、20、25、15、10；任何单项越界或必填评语为空时禁用最终提交。保存草稿保留输入；最终提交二次确认后锁定。

- [x] **Step 5: 运行专家端测试**

Run: `npm run test:unit:run -- src/modules/review/__tests__`

Expected: PASS；专家页面序列化结果不包含学生、学号、导师和原始版文件名。

### Task 6: 黄金流程、视觉检查与文档回写

**Files:**
- Modify: `frontend/src/demo/__tests__/goldenPath.spec.ts`
- Modify: `frontend/src/__tests__/App.spec.ts`
- Modify: `docs/10_审查与决策/需求追踪矩阵.md`
- Modify: `docs/10_审查与决策/编码准入检查表.md`
- Modify: `docs/superpowers/plans/2026-08-10-second-batch-client-demo.md`

**Interfaces:**
- Consumes: Tasks 1—5 的服务与页面。
- Produces: 可重复重置的甲方演示路径和实现证据。

- [x] **Step 1: 扩展黄金流程测试**

```ts
expect((await service.getSchoolAccount()).frozenAmount).toBe(300)
expect((await service.listPublishedResults())).toHaveLength(1)
expect((await service.getSchoolBills())[0]).toMatchObject({ amount: 300, status: 'CONSUMED' })
expect((await service.getExpertAccount()).availableAmount).toBe(300)
```

- [x] **Step 2: 运行全量测试、类型检查和生产构建**

Run: `npm run test:unit:run`

Run: `npm run type-check`

Run: `npm run build`

Expected: 三个命令均退出码 0，无未处理异常或 TypeScript 错误。

- [x] **Step 3: 启动演示并检查关键视口**

Run: `npm run dev -- --host 127.0.0.1`

在 1440×900、1920×1080、390px 宽度检查登录、学生论文、学校送审准备、学校账户、送审运营台、专家任务、在线评阅和学生结果。确认页面无全局最大宽度、表格不截断关键操作、键盘焦点可见、移动端核心流程可操作。

- [x] **Step 4: 回写实现证据**

在需求追踪矩阵中只将实际通过自动测试和人工检查的前端演示证据标记为已实现；真实 API、数据库迁移、SSO、文件解析和支付继续标为未实现。更新本计划复选框和验证命令结果。

- [x] **Step 5: 检查补丁完整性**

Run: `git diff --check`

Expected: PASS；不修改 `docs/99_原始材料/`，不混入无关文件。

## 执行记录（2026-08-10）

- 黄金流程覆盖学校额度冻结与消费、单专家评阅、结果发布和专家 300 元入账。
- PAGE-015—018 已由通用占位页替换为消息中心、导出中心、租户与权限、审计查询演示页。
- `npm run test:unit:run`、`npm run type-check`、`npm run build` 均通过；最终测试数量以收尾验证输出为准。
- 浏览器检查覆盖桌面端全宽布局和 390px 移动端；学校账单表已修为容器内横向滚动，不再撑宽整页。
- 本计划只完成前端演示与内存场景服务，真实 API、数据库迁移、SSO、文件解析、通知发送、导出生成和支付结算不在本次实现范围。
