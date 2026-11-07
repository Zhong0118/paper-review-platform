# 百杰运营与专家端交互闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将百杰运营端与专家端从静态演示骨架升级为可操作、可状态切换、可演示的完整前端交互闭环：运营完成专家库、派单、催审、改派、更正审批与结算；专家完成接单、六维评阅、更正申请、资料维护与提现。

**Architecture:** 沿用学生端架构——`ScenarioService` 为演示状态唯一来源，扩展专家档案、运营队列、更正申请、提现流水投影；运营端与专家端各增加窄化服务接口；演示控制器按角色独立装载场景。后端仍为骨架，所有数据为前端本地演示快照。

**Tech Stack:** Vue 3.5、TypeScript 5.9、Vue Router 5、Pinia 3、Element Plus 2、Vitest 4、Vue Test Utils、CSS；不新增运行时或测试依赖。

**Baseline:** 学生端 Task 1–8 已完成（分支 `codex/frontend-client-demo`，HEAD 已推送）。现有未提交工作区含两个角色的静态页面骨架（`modules/dispatch`、`modules/review`、`modules/expert-management`、`modules/finance`、`modules/system` 等）与 24 角色路由 `routes.ts`；本计划**只提交自身任务文件**，不混入用户未提交工作区内容。

## Global Constraints

- 仅实现百杰运营（platform_reviewer）与专家（expert）两个角色；不修改学校、导师、学生、系统管理员的业务功能。
- **单专家评审**：一篇论文同一时间至多一个当前有效专家任务；拒绝、超时或撤回后才允许改派。改派 = 原任务 `CANCELLED` + 同轮新建，保留历史。
- 任务状态枚举唯一：`INVITED / IN_REVIEW / SUBMITTED / REJECTED / ACCEPT_TIMEOUT / CANCELLED`；`overdue` 是布尔时限属性，不是独立状态。
- 命中回避的候选专家必须禁选并提示原因，不允许强制跳过。
- 专家接单前只见匿名基本信息（匿名题目/摘要/方向/期限/费用/说明），不接受查看完整论文；接受后（`IN_REVIEW`）才可访问完整匿名材料。
- 专家端永不出现学生/导师身份、其他专家评语、原始版；运营端可显示学生/导师与专家身份（Q-014），但不得外泄给学校侧或专家侧，且不得访问论文原始版。
- 评阅六维模板为版本化快照（演示批次：选题价值 15、文献与理论基础 15、研究设计与方法 20、研究内容与创新 25、写作规范 10、综合学术水平 15，合计 100），页面按模板数据动态渲染，不得写死；另有总体评价/主要问题/修改建议/评审结论。
- 最终提交、指派、接受、批准更正、提现、付款回填必须二次确认并防重复提交；提交后只读锁定。
- 演示控制器仅在 `VITE_DEMO_MODE=true` 时可见且可调用，其他环境完全隐藏入口；服务拒绝场景装载。
- 页面不设置全局 `max-width`；390px 宽度不得产生整页横向滚动。
- 演示文件只保存文件名、大小、MIME 类型和模拟校验状态，不读取正文。
- 不宣称真实文件上传、匿名检测、消息发送、支付或数据库已完成；收款信息脱敏展示。
- 每个业务改动先写失败测试，再写最小实现；每个任务单独验证并只提交自身文件；不混入用户未提交工作区内容。
- 提交只包含本计划任务文件；`docs/99_原始材料` 不得修改。

---

### Task 1: 运营端领域模型、允许动作与专家库

**Files:**
- Create: `frontend/src/modules/expert-management/services/platformOperationService.ts`
- Create: `frontend/src/demo/platformFixtures.ts`
- Create: `frontend/src/demo/platformPersistence.ts`（如与学生端 v1 同 schema 则合并，否则独立 key）
- Create: `frontend/src/modules/expert-management/__tests__/platformOperationService.spec.ts`
- Modify: `frontend/src/demo/types.ts`
- Modify: `frontend/src/demo/fixtures.ts`
- Modify: `frontend/src/demo/scenarioService.ts`
- Modify: `frontend/src/demo/serviceProvider.ts`

**Interfaces:**
- Produces: `PlatformOperationService`、`ExpertProfile`、`ExpertQualificationStatus`、`ExpertServiceStatus`、`ExpertMatchCandidate`、`OperationsQueue`（扩展十条队列）、`CorrectionRequest`、`WithdrawalRequest`。
- Consumes: 现有 `DemoStage`、`ReviewTaskStatus`、`ScenarioService` 跨角色状态。

- [ ] **Step 1: 写专家库与动作失败测试**

```ts
it('enforces platform-only actions and projects expert profile changes', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  const profiles = await service.listExpertProfiles()
  expect(profiles).toHaveLength(3)
  const target = profiles[0]
  expect(target.allowedActions).toContain('SET_SERVICE_STATUS')

  await service.setExpertServiceStatus(target.id, 'DISABLED', '暂时满负载')
  const updated = (await service.listExpertProfiles()).find(p => p.id === target.id)
  expect(updated?.serviceStatus).toBe('DISABLED')

  await service.reviewExpertQualification(target.id, 'APPROVED', '材料齐全')
  expect((await service.listExpertProfiles()).find(p => p.id === target.id)?.qualification).toBe('APPROVED')
})
```

同时测试：非运营动作拒绝；驳回必须带原因；禁用后新任务不可指派但既有任务不受影响；快照不可变。

- [ ] **Step 2: 运行测试并确认缺少能力**

Run: `npm run test:unit -- --run src/modules/expert-management/__tests__/platformOperationService.spec.ts`

Expected: FAIL，`listExpertProfiles` 等接口不存在。

- [ ] **Step 3: 定义窄化接口与专家档案类型**

`ExpertProfile` 字段：id、name、unit、title、discipline（受控目录 code/name）、researchTags（≤8）、reviewableTypes、qualification（`APPROVED|REVIEWING|REJECTED`）、serviceStatus（`ACTIVE|DISABLED`）、avoidSchools、activeTasks、completedTasks、overdueRate、avgCompletionDays、acceptanceRate、onTimeRate、qualitySummary、feeStandard、payoutStatus（`BOUND|PENDING`）、allowedActions。

`PlatformOperationService`：`listExpertProfiles(query?)`、`createExpertProfile(input)`、`updateExpertProfile(id, patch)`、`setExpertServiceStatus(id, status, reason)`、`reviewExpertQualification(id, decision, reason)`、`listExpertMatches(thesisId)`（Task 3 用，本轮返回空实现或最小候选）。

- [ ] **Step 4: 实现专家库状态与持久化**

在 `scenarioService.ts` 中装配 `createPlatformOperationService`；平台状态与现有状态同 schema 持久化（复用 `baijie-demo-student:v1` 或新增 `baijie-demo-platform:v1`，迁移时兼容读取）。演示门禁：`demoMode=false` 时拒绝全部平台动作。

- [ ] **Step 5: 运行目标测试与回归**

Run: `npm run test:unit -- --run src/modules/expert-management/__tests__/platformOperationService.spec.ts`

Run: `npm run test:unit:run`

Run: `npm run type-check`

Expected: PASS；既有学生端测试不受影响。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/modules/expert-management/services/platformOperationService.ts frontend/src/demo/platformFixtures.ts frontend/src/demo/platformPersistence.ts frontend/src/modules/expert-management/__tests__/platformOperationService.spec.ts frontend/src/demo/types.ts frontend/src/demo/fixtures.ts frontend/src/demo/scenarioService.ts frontend/src/demo/serviceProvider.ts
git commit -m "feat: add platform operation domain model"
```

---

### Task 2: 运营端专家库页面（PAGE-006）

**Files:**
- Create: `frontend/src/modules/expert-management/__tests__/expertLibraryWorkbench.spec.ts`
- Modify: `frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue`（现有静态骨架）
- Create: `frontend/src/modules/expert-management/components/ExpertLibraryTable.vue`（现有 → 改造支持筛选/操作）
- Create: `frontend/src/modules/expert-management/components/ExpertProfileDrawer.vue`
- Modify: `frontend/src/modules/expert-management/components/ExpertLibraryTable.vue`

**Interfaces:**
- Consumes: Task 1 的 `PlatformOperationService`。
- Produces: 专家库页面完整交互。

- [ ] **Step 1: 写页面交互失败测试**

```ts
it('lists profiles, filters, and pauses/resumes with confirmation', async () => {
  const wrapper = mount(ExpertLibraryPage, { global: { provide: { [serviceKey]: service } } })
  expect(wrapper.findAll('tr')).toHaveLength(4) // 3 + header
  await wrapper.get('[data-filter="service-status"]').setValue('ACTIVE')
  expect(wrapper.findAll('tr')).toHaveLength(3)
  await wrapper.get('[data-action="pause-expert"]').trigger('click')
  // 二次确认对话框
  await wrapper.get('[data-action="confirm-pause"]').trigger('click')
  expect(service.setExpertServiceStatus).toHaveBeenCalledWith(expect.any(String), 'DISABLED', expect.any(String))
})
```

同时测试：资格驳回必须填原因；详情抽屉六个 Tab 可切换；移动端卡片渲染。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test:unit -- --run src/modules/expert-management/__tests__/expertLibraryWorkbench.spec.ts`

- [ ] **Step 3: 实现页面**

统计卡（总数/可派/待审/将到期/已停用）、筛选行、列表（含研究方向 Tags、服务/资格状态 Tag）、详情抽屉（基本资料/资格与材料/回避/历史任务/费用摘要/操作日志）、新增/编辑表单、暂停/恢复/资格审核二次确认。移动端表格卡片化。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue frontend/src/modules/expert-management/components/ExpertLibraryTable.vue frontend/src/modules/expert-management/components/ExpertProfileDrawer.vue frontend/src/modules/expert-management/__tests__/expertLibraryWorkbench.spec.ts
git commit -m "feat: complete expert library workbench"
```

---

### Task 3: 送审运营台（PAGE-007）：十条队列与派单闭环

**Files:**
- Create: `frontend/src/modules/dispatch/__tests__/dispatchQueue.spec.ts`
- Modify: `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue`（现有静态骨架 → 完整运营台）
- Modify: `frontend/src/modules/dispatch/components/OperationsQueueTable.vue`
- Modify: `frontend/src/modules/dispatch/components/CandidateExpertTable.vue`
- Create: `frontend/src/modules/dispatch/components/DispatchDetailPanel.vue`
- Modify: `frontend/src/demo/scenarioService.ts`（实现 `listExpertMatches`、`assignExpertToThesis`、`reassignExpertTask`、`remindExpertTask`、`extendExpertTask`）

**Interfaces:**
- Consumes: Task 1 `PlatformOperationService`；现有 `ReviewTaskStatus`/`OperationsQueue`。
- Produces: 十条运营队列、派单详情、候选专家与匹配原因、指派/改派/催审/延期。

- [ ] **Step 1: 写队列与指派失败测试**

```ts
it('projects ten queues and enforces single-expert assignment', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  const queues = await service.listOperationsQueues()
  expect(Object.keys(queues)).toHaveLength(10)

  await service.loadPlatformScenario('PENDING_DISPATCH')
  const matches = await service.listExpertMatches('thesis-main')
  const conflicted = matches.find(m => m.conflictHit)
  expect(conflicted?.selectable).toBe(false)

  await service.assignExpertToThesis('thesis-main', matches[0].id)
  const tasks = await service.listExpertTasks()
  expect(tasks.filter(t => t.thesisId === 'thesis-main' && ['INVITED','IN_REVIEW'].includes(t.status))).toHaveLength(1)
})
```

同时测试：改派先关原任务（`CANCELLED`）再建新任务；催审/延期写审计时间线；并发指派冲突返回 `VERSION_CONFLICT`；回避无法强制跳过。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现运营台**

队列区十条 Tab + 计数；待派列表；派单详情面板（专业/关键词 Tags/论文类型/回避规则/学校要求）；候选专家表（单位/职称/研究方向 Tags/关键词命中/回避禁选+原因/当前负载/历史接受率/平均完成时间/费用标准 + 可解释匹配原因）；`[指派选中专家]`（二次确认+防重复，单专家只能选 1 位）；`[改派]`（选替代专家+原因）；`[催审]` `[延期]`。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue frontend/src/modules/dispatch/components/OperationsQueueTable.vue frontend/src/modules/dispatch/components/CandidateExpertTable.vue frontend/src/modules/dispatch/components/DispatchDetailPanel.vue frontend/src/modules/dispatch/__tests__/dispatchQueue.spec.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: complete dispatch operations workbench"
```

---

### Task 4: 评阅更正审批（PAGE-020）与结算处理（PAGE-022）

**Files:**
- Create: `frontend/src/modules/expert-management/__tests__/correctionAndSettlement.spec.ts`
- Modify: `frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue`（现有骨架）
- Modify: `frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue`（现有骨架）
- Create: `frontend/src/modules/expert-management/components/CorrectionDetailPanel.vue`
- Create: `frontend/src/modules/finance/components/WithdrawalDetailPanel.vue`
- Modify: `frontend/src/demo/scenarioService.ts`（`listCorrectionRequests`、`decideCorrection`、`listWithdrawals`、`reviewWithdrawal`、`recordWithdrawalPayment`）

**Interfaces:**
- Produces: 更正审批（批准生成新版本/驳回留原因）、结算处理（审核/付款回填）。

- [ ] **Step 1: 写失败测试**

```ts
it('approves corrections into a new version and settles withdrawals', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  await service.loadPlatformScenario('CORRECTION_PENDING')
  const requests = await service.listCorrectionRequests()
  await service.decideCorrection(requests[0].id, 'APPROVED', '差异属实')
  expect((await service.listCorrectionRequests())[0].status).toBe('APPROVED')

  const withdrawals = await service.listWithdrawals()
  await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')
  await service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-01')
  expect((await service.listWithdrawals())[0].status).toBe('PAID')
})
```

同时测试：驳回必须原因；批准后旧评阅版本只读保留且建立版本关系；已发布结果提示影响范围；付款回填幂等防重复；收款信息脱敏。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现两页**

更正审批：列表（申请号/专家/匿名论文号/时间/状态）、详情（原版本只读 Diff/原因/差异/证据）、批准（二次确认）/驳回（必填原因）、已发布影响提示。结算处理：列表（申请号/专家/金额/时间/状态）、详情（可提现依据/冻结流水/收款信息脱敏/历史）、审核通过/驳回、付款回填（成功/失败+凭证号，二次确认+幂等）。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue frontend/src/modules/expert-management/components/CorrectionDetailPanel.vue frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue frontend/src/modules/finance/components/WithdrawalDetailPanel.vue frontend/src/modules/expert-management/__tests__/correctionAndSettlement.spec.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: add correction approval and settlement workbench"
```

---

### Task 5: 专家任务列表（PAGE-008）与接单详情（PAGE-009）

**Files:**
- Create: `frontend/src/modules/review/__tests__/expertTaskFlow.spec.ts`
- Modify: `frontend/src/modules/review/pages/ExpertTasksPage.vue`（现有骨架）
- Modify: `frontend/src/modules/review/pages/InvitationPage.vue`（现有骨架）
- Modify: `frontend/src/modules/review/components/ExpertTaskTable.vue`
- Modify: `frontend/src/demo/scenarioService.ts`（`acceptExpertTask`、`rejectExpertTask`、扩展 `listExpertTasks` overdue/fee/材料）

**Interfaces:**
- Produces: 任务三主 Tab + 三辅助 Tab、接单/拒绝闭环、匿名概要。

- [ ] **Step 1: 写失败测试**

```ts
it('accepts and rejects invitations with boundary checks', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  await service.loadExpertScenario('INVITED')
  const tasks = await service.listExpertTasks()
  const invited = tasks.find(t => t.status === 'INVITED')
  expect(invited?.allowedActions).toContain('ACCEPT_TASK')

  await expect(service.rejectExpertTask(invited!.id, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await service.rejectExpertTask(invited!.id, '时间不足')
  expect((await service.listExpertTasks()).find(t => t.id === invited!.id)?.status).toBe('REJECTED')
})
```

同时测试：接受前材料不可见（`materialsVisible: false`），接受后可见；接受二次确认；接单超时任务不可再操作；仅本人任务（他人任务 `FORBIDDEN`）。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现任务列表与接单详情**

任务列表：三主 Tab（待接受/评阅中/已完成）+ 辅助（已拒绝/已撤销/需要更正）、统计行、列表列（状态 Tag/匿名编号/匿名题目/方向/接单截止/评阅截止/费用/操作）、逾期红色警告 Tag 仍可进入、状态按钮由服务端允许动作驱动。接单详情：匿名概要（题目/摘要/方向/匹配说明/截止/费用/模板说明）、拒绝原因下拉必填、`[拒绝]`/`[接受并开始评阅]`（二次确认 → `IN_REVIEW` 跳工作台）。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/review/pages/ExpertTasksPage.vue frontend/src/modules/review/pages/InvitationPage.vue frontend/src/modules/review/components/ExpertTaskTable.vue frontend/src/modules/review/__tests__/expertTaskFlow.spec.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: complete expert task list and invitation flow"
```

---

### Task 6: 在线评阅工作台（PAGE-010）：六维模板与提交闭环

**Files:**
- Create: `frontend/src/modules/review/__tests__/reviewWorkspaceFlow.spec.ts`
- Modify: `frontend/src/modules/review/pages/ReviewWorkspacePage.vue`（现有骨架）
- Modify: `frontend/src/modules/review/components/ReviewFormPane.vue`
- Modify: `frontend/src/modules/review/components/ScoreDimensionInput.vue`
- Modify: `frontend/src/modules/review/components/AnonymousDocumentPane.vue`
- Modify: `frontend/src/demo/types.ts`（六维模板类型）
- Modify: `frontend/src/demo/scenarioService.ts`（六维评分、完整性检查、`requestCorrection`）

**Interfaces:**
- Produces: 六维评分表单、自动保存草稿、暂存退出、提交前完整性检查、二次确认、提交后只读、申请更正。

- [ ] **Step 1: 写失败测试**

```ts
it('validates completeness, locks after submit, and requests correction', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  await service.loadExpertScenario('IN_REVIEW')
  const invalid = { ...incompleteInput }
  await expect(service.submitFinalReview(invalid)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

  await service.submitFinalReview(completeInput)
  const tasks = await service.listExpertTasks()
  expect(tasks[0].status).toBe('SUBMITTED')

  await service.requestCorrection(tasks[0].id, '总分计算有误')
  expect((await service.listCorrectionRequests())[0].status).toBe('PENDING')
})
```

同时测试：草稿自动保存并可在刷新后恢复；分数越界/缺项字段级报错；提交后表单只读；逾期任务仍可保存与提交；更正申请后原版本保留。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现工作台**

双栏布局（桌面）/上下（移动）；左栏匿名材料只读（不提供下载）；右栏六维评分（每维分值/评分说明/可选评价）、总体评价/主要问题/修改建议/评审结论、实时总分、完整性检查；操作区 `[保存草稿]`（自动保存指示）`[暂存退出]` `[最终提交]`（二次确认+防重复）→ 只读锁定；逾期红色警告仍可提交；提交后 `[申请更正]`（原因必填）。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/review/pages/ReviewWorkspacePage.vue frontend/src/modules/review/components/ReviewFormPane.vue frontend/src/modules/review/components/ScoreDimensionInput.vue frontend/src/modules/review/components/AnonymousDocumentPane.vue frontend/src/modules/review/__tests__/reviewWorkspaceFlow.spec.ts frontend/src/demo/types.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: complete online review workspace"
```

---

### Task 7: 专家资料与资格（PAGE-021）

**Files:**
- Create: `frontend/src/modules/review/__tests__/expertProfilePage.spec.ts`
- Modify: `frontend/src/modules/review/pages/ExpertProfilePage.vue`（现有骨架）
- Create: `frontend/src/modules/review/components/ExpertProfileForm.vue`
- Modify: `frontend/src/demo/scenarioService.ts`（`getExpertProfile`、`saveExpertProfile`）

**Interfaces:**
- Produces: 本人资料编辑、专业方向维护、资格材料。

- [ ] **Step 1: 写失败测试**

```ts
it('saves own profile with controlled discipline tags', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  const profile = await service.getExpertProfile()
  await service.saveExpertProfile({ ...profile, researchTags: ['知识图谱', '知识图谱', ' 机器学习 '] })
  expect((await service.getExpertProfile()).researchTags).toEqual(['知识图谱', '机器学习'])
  await expect(service.saveExpertProfile({ ...profile, researchTags: new Array(9).fill('x') }))
    .rejects.toMatchObject({ code: 'INVALID_INPUT' })
})
```

同时测试：姓名只读；学科受控目录（184 条目）；资格状态展示（通过/审核中/驳回+原因）；驳回后有重新提交入口；保存写审计；仅本人资料。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现资料页**

基本信息（姓名只读/联系方式/单位/职称）、评审能力（学科受控/擅长领域 Tags≤8/可评论文类型）、回避声明、资格材料（上传/状态/驳回原因/重提）、`[保存资料]`。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/review/pages/ExpertProfilePage.vue frontend/src/modules/review/components/ExpertProfileForm.vue frontend/src/modules/review/__tests__/expertProfilePage.spec.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: complete expert profile and qualification page"
```

---

### Task 8: 费用与提现（PAGE-014）

**Files:**
- Create: `frontend/src/modules/review/__tests__/expertWithdrawalFlow.spec.ts`
- Modify: `frontend/src/modules/review/pages/ExpertFinancePage.vue`（现有骨架）
- Modify: `frontend/src/demo/scenarioService.ts`（`listExpertLedger`、`submitWithdrawal`、扩展 `getExpertAccount`）

**Interfaces:**
- Produces: 本人账户、费用流水、提现申请。

- [ ] **Step 1: 写失败测试**

```ts
it('submits withdrawals within balance and appends ledger only', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  const account = await service.getExpertAccount()
  await expect(service.submitWithdrawal(account.availableAmount + 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  await service.submitWithdrawal(100)
  const ledger = await service.listExpertLedger()
  expect(ledger.at(-1)?.kind).toBe('WITHDRAWAL')
  expect(ledger.filter(l => l.kind === 'WITHDRAWAL')).toHaveLength(1)
})
```

同时测试：金额必填且 ≤ 可提现；二次确认；提交后只能查看状态不能自改；流水只追加不可覆盖；驳回展示可公开原因。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现提现页**

我的账户（可提现/冻结）、申请提现（金额 ≤ 可提现 + 二次确认）、提现记录（时间/金额/状态/付款时间/备注）、费用流水（只读只追加）。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/review/pages/ExpertFinancePage.vue frontend/src/modules/review/__tests__/expertWithdrawalFlow.spec.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: complete expert fee and withdrawal page"
```

---

### Task 9: 两角色消息通知与路由接入

**Files:**
- Create: `frontend/src/modules/shared/__tests__/roleNotifications.spec.ts`
- Modify: `frontend/src/modules/shared/components/StudentNotificationList.vue`（支持 platform_reviewer/expert 角色投影）
- Modify: `frontend/src/modules/shared/pages/NotificationCenterPage.vue`
- Modify: `frontend/src/router/studentNotificationRoutes.ts`（改名/扩展为角色通知路由，或新增）
- Modify: `frontend/src/demo/scenarioService.ts`（任务/更正/提现/催审通知事件）

**Interfaces:**
- Produces: 两角色通知隔离、未读/全部已读、跳转关联页面。

- [ ] **Step 1: 写失败测试**

```ts
it('isolates notifications by recipient role and routes to pages', async () => {
  const service = createScenarioService({ storage, demoMode: true })
  await service.loadExpertScenario('INVITED')
  const expertNotices = await service.listRoleNotifications('expert')
  expect(expertNotices.some(n => n.kind === 'TASK_INVITED')).toBe(true)

  await service.loadPlatformScenario('PENDING_DISPATCH')
  const platformNotices = await service.listRoleNotifications('platform_reviewer')
  expect(platformNotices.every(n => n.recipientRole === 'platform_reviewer')).toBe(true)
})
```

同时测试：学校通知不可见；标记已读只影响本角色；跳转路由正确（任务页/运营台）。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现通知与路由**

扩展 `StudentNotificationList` 为角色通用（或保持组件名、参数化 recipientRole）；通知中心按当前角色投影；路由 `/notifications` 已存在（复用），跳转目标扩展 `/expert/tasks`、`/platform/dispatch` 等。

- [ ] **Step 4: 运行目标测试与回归**

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/shared/components/StudentNotificationList.vue frontend/src/modules/shared/pages/NotificationCenterPage.vue frontend/src/modules/shared/__tests__/roleNotifications.spec.ts frontend/src/router/studentNotificationRoutes.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: connect role notifications to workflows"
```

---

### Task 10: 演示场景控制器（运营端 + 专家端）与环境隔离

**Files:**
- Create: `frontend/src/modules/dispatch/components/PlatformDemoScenarioController.vue`
- Create: `frontend/src/modules/expert-management/components/ExpertDemoScenarioController.vue`
- Create: `frontend/src/modules/dispatch/__tests__/platformDemoScenario.spec.ts`
- Create: `frontend/src/modules/expert-management/__tests__/expertDemoScenario.spec.ts`
- Modify: `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue`
- Modify: `frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue`
- Modify: `frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue`
- Modify: `frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue`
- Modify: `frontend/src/modules/review/pages/ExpertTasksPage.vue`
- Modify: `frontend/src/modules/review/pages/ReviewWorkspacePage.vue`
- Modify: `frontend/src/modules/review/pages/ExpertProfilePage.vue`
- Modify: `frontend/src/modules/review/pages/ExpertFinancePage.vue`
- Modify: `frontend/src/demo/types.ts`（`PlatformScenarioPreset`、`ExpertScenarioPreset`）
- Modify: `frontend/src/demo/scenarioService.ts`（`loadPlatformScenario`、`loadExpertScenario`、`reset`）

**Interfaces:**
- Consumes: Task 1–9 的服务与页面。
- Produces: 运营端与专家端独立场景控制器、一致快照、一键重置。

- [ ] **Step 1: 写环境门禁与一致快照失败测试**

```ts
it("does not render without explicit demo mode", () => {
  const wrapper = mount(PlatformDemoScenarioController, { props: { enabled: false } })
  expect(wrapper.html()).toBe("<!--v-if-->")
})

it("loads a completed operations snapshot with queues and notifications", async () => {
  const wrapper = mount(PlatformDemoScenarioController, { props: { enabled: true }, global: { provide: { [key]: service } } })
  await wrapper.get('[data-scenario="COMPLETED"]').trigger("click")
  await flushPromises()
  const queues = await service.listOperationsQueues()
  expect(queues.completed).toBeGreaterThan(0)
})
```

同时测试：专家端快照（待接受/评阅中/逾期/已提交/需要更正/已拒绝）原子替换任务、草稿、结果与通知；重置二次确认并清除持久化；关闭演示模式无入口且服务拒绝装载。

- [ ] **Step 2: 运行场景控制器测试并确认失败**

Run: `npm run test:unit -- --run src/modules/dispatch/__tests__/platformDemoScenario.spec.ts src/modules/expert-management/__tests__/expertDemoScenario.spec.ts`

Expected: FAIL，控制器与场景快照接口尚不存在。

- [ ] **Step 3: 实现两个控制器**

右下浮动入口、明确"仅用于演示"免责声明、主线场景按钮组、资格/状态辅助场景、一键重置（二次确认 + Teleport 对话框 + 焦点管理）。页面按 `VITE_DEMO_MODE === 'true'` 传入 `enabled`；控制器 `changed` 事件后页面重读服务投影。

- [ ] **Step 4: 运行控制器测试与学生端回归**

Run: `npm run test:unit -- --run src/modules/dispatch/__tests__/platformDemoScenario.spec.ts src/modules/expert-management/__tests__/expertDemoScenario.spec.ts`

Run: `npm run test:unit:run`

Run: `npm run type-check`

- [ ] **Step 5: 提交**

```bash
git add frontend/src/modules/dispatch/components/PlatformDemoScenarioController.vue frontend/src/modules/expert-management/components/ExpertDemoScenarioController.vue frontend/src/modules/dispatch/__tests__/platformDemoScenario.spec.ts frontend/src/modules/expert-management/__tests__/expertDemoScenario.spec.ts frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue frontend/src/modules/review/pages/ExpertTasksPage.vue frontend/src/modules/review/pages/ReviewWorkspacePage.vue frontend/src/modules/review/pages/ExpertProfilePage.vue frontend/src/modules/review/pages/ExpertFinancePage.vue frontend/src/demo/types.ts frontend/src/demo/scenarioService.ts
git commit -m "feat: add isolated platform and expert demo scenarios"
```

---

### Task 11: 黄金路径、视觉验收和文档回写

**Files:**
- Create: `frontend/src/modules/review/__tests__/platformExpertGoldenPath.spec.ts`
- Modify: `frontend/src/__tests__/App.spec.ts`（如需要）
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-006_平台专家库.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-007_平台派单工作台.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-008_专家任务列表.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-009_专家接单详情.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-010_在线评阅工作台.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-014_提现与结算.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-020_评阅更正审批.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-021_专家资料与资格.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-022_结算处理工作台.md`
- Modify: `docs/10_审查与决策/需求追踪矩阵.md`
- Modify: `docs/10_审查与决策/编码准入检查表.md`
- Modify: `docs/superpowers/plans/2026-08-12-platform-expert-workflow.md`

**Interfaces:**
- Consumes: Task 1–10 的服务与页面。
- Produces: 可重复执行的验收证据；不改变其他角色完成状态。

- [x] **Step 1: 写两角色黄金路径测试**

```ts
it('persists the complete platform dispatch to expert review path', async () => {
  const storage = createMemoryStorage()
  const service = createScenarioService({ storage, demoMode: true })
  await service.loadPlatformScenario('PENDING_DISPATCH')
  const matches = await service.listExpertMatches('thesis-main')
  await service.assignExpertToThesis('thesis-main', matches.find(m => !m.conflictHit)!.id)
  const tasks = await service.listExpertTasks()
  expect(tasks.find(t => t.thesisId === 'thesis-main')?.status).toBe('INVITED')

  await service.acceptExpertTask(tasks.find(t => t.thesisId === 'thesis-main')!.id)
  await service.submitFinalReview(completeInput)
  expect((await service.listExpertTasks()).find(t => t.thesisId === 'thesis-main')?.status).toBe('SUBMITTED')

  const restored = createScenarioService({ storage, demoMode: true })
  expect((await restored.listExpertTasks()).find(t => t.thesisId === 'thesis-main')?.status).toBe('SUBMITTED')
})
```

同时测试：运营派单 → 专家接受 → 六维评阅 → 最终提交 → 更正申请 → 审批 → 提现申请的完整跨角色持久化。

- [x] **Step 2: 运行黄金路径和全量单元测试**

Run: `npm run test:unit -- --run src/modules/review/__tests__/platformExpertGoldenPath.spec.ts`

Run: `npm run test:unit:run`

Expected: PASS；所有测试 0 failures，现有学生端测试不得因本计划改造而失败。

- [x] **Step 3: 运行类型检查和生产构建**

Run: `npm run type-check`

Run: `VITE_DEMO_MODE=true npm run build`

Expected: 两个命令退出码 0。

- [x] **Step 4: 浏览器检查桌面和移动端关键流程**

Run: `npm run dev -- --host 127.0.0.1`

在 1440×900、1920×1080 和 390×844 检查：运营登录 → 专家库（筛选/详情/暂停）→ 运营台（队列切换/派单/改派/催审）→ 更正审批 → 结算处理；专家登录 → 任务列表（Tab/接受/拒绝）→ 在线评阅（六维/草稿/提交/只读/申请更正）→ 资料与提现 → 消息跳转 → 场景切换和重置。确认队列/表格在移动端卡片化，390px 无整页横向滚动，焦点与 Esc 行为正确。

- [x] **Step 5: 回写正式文档的真实完成边界**

PAGE-006/007/008/009/010/014/020/021/022 文档补充已实现交互；需求追踪矩阵只标记两角色前端演示证据；编码准入检查表注明真实 API、数据库、SSO、文件解析、通知发送、支付仍未实现。不得把其他角色静态页面标记为交互闭环完成。

- [x] **Step 6: 检查补丁与原始材料边界**

Run: `git diff --check`

Run: `git diff --name-only -- docs/99_原始材料`

Expected: 第一条无输出并退出 0；第二条无输出，证明未修改原始材料。

- [x] **Step 7: 提交验收与文档证据**

```bash
git add frontend/src/modules/review/__tests__/platformExpertGoldenPath.spec.ts docs/02_产品设计/页面原型/页面原型_PAGE-006_平台专家库.md docs/02_产品设计/页面原型/页面原型_PAGE-007_平台派单工作台.md docs/02_产品设计/页面原型/页面原型_PAGE-008_专家任务列表.md docs/02_产品设计/页面原型/页面原型_PAGE-009_专家接单详情.md docs/02_产品设计/页面原型/页面原型_PAGE-010_在线评阅工作台.md docs/02_产品设计/页面原型/页面原型_PAGE-014_提现与结算.md docs/02_产品设计/页面原型/页面原型_PAGE-020_评阅更正审批.md docs/02_产品设计/页面原型/页面原型_PAGE-021_专家资料与资格.md docs/02_产品设计/页面原型/页面原型_PAGE-022_结算处理工作台.md docs/10_审查与决策/需求追踪矩阵.md docs/10_审查与决策/编码准入检查表.md docs/superpowers/plans/2026-08-12-platform-expert-workflow.md
git commit -m "test: verify platform and expert interactive workflow"
```
