# 登录、双通道论文接入至结果闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user requires inline execution in the existing project directory and does not want a worktree. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成登录三入口、学生/学校双通道论文接入，并连续完成 D4 学校审核、D5 百杰派单、D6 专家评阅和 D7 结果发布的甲方演示闭环。

**Architecture:** 页面继续通过注入的 `ScenarioService` 读写统一演示场景，不直接导入 fixtures。学生提交、学校单篇代传和学校批量导入都产生统一 `DemoThesisSummary`；`submissionSource` 只记录来源，不分裂状态机。专业目录、关键词 Tag、费用规则分别由小型领域组件承载。

**Tech Stack:** Vue 3.5、TypeScript 5.9、Vue Router 5、Pinia 3、Tailwind CSS 4、Element Plus 2、Vitest 4、Vue Test Utils；不新增前端依赖。

## Global Constraints

- 直接在 `/Users/zhongxu/Desktop/0-Inbox/paper-review-platform` 和现有 `codex/frontend-client-demo` 分支工作，不创建 worktree。
- 所有行为变更严格执行 Red -> Green -> Refactor。
- 页面不设置全局 `max-width`。
- 学校页面不得出现专家身份；专家页面不得出现学生、导师、学号或原始版。
- 专业必须保存代码和名称；关键词必须保存为去重后的字符串数组。
- 学校代传无需学生确认，必须记录来源、操作人和时间。
- 费用只读展示批次规则快照，首轮不提供改价和自动支付。
- 批量导入首轮只做文件选择、解析预览和行级校验，不声称真实解析或写入 Excel。
- D4 完成后立即执行 D5、D6、D7；PAGE-014—023 不阻塞黄金闭环。

---

### Task 1: PAGE-001 登录三入口与邀请激活

**Files:**
- Modify: `frontend/src/modules/auth/pages/LoginPage.vue`
- Modify: `frontend/src/modules/auth/__tests__/LoginPage.spec.ts`
- Create: `frontend/src/modules/auth/components/LoginChannelTabs.vue`
- Create: `frontend/src/modules/auth/components/SchoolIdentityPanel.vue`
- Create: `frontend/src/modules/auth/components/InvitationActivationPanel.vue`
- Create: `frontend/src/modules/auth/__tests__/InvitationActivationPanel.spec.ts`

**Interfaces:**
- Produces: `LoginChannel = 'platform' | 'school' | 'activation'`。
- `SchoolIdentityPanel` emits `continue(schoolCode: string)`；空代码不触发。
- `InvitationActivationPanel` consumes `{ state: 'idle' | 'valid' | 'expired' | 'used'; invitation?: InvitationSummary }`。
- 演示角色入口继续调用 `authStore.loginAsDemo(role)`，正式登录按钮只显示“认证接口尚未接入”，不伪造 token。

- [ ] **Step 1: 写登录渠道与学校代码失败测试**

```ts
it('separates platform, school, and invitation activation channels', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  const wrapper = mount(LoginPage, {
    props: { demoMode: false },
    global: { plugins: [createPinia(), router] },
  })
  expect(wrapper.get('[role="tablist"]').text()).toContain('平台账号')
  await wrapper.get('button[data-channel="school"]').trigger('click')
  expect(wrapper.get('button[data-action="continue-school-sso"]').attributes('disabled')).toBeDefined()
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `pnpm --dir frontend test:unit --run src/modules/auth/__tests__/LoginPage.spec.ts src/modules/auth/__tests__/InvitationActivationPanel.spec.ts`

Expected: FAIL，因为当前没有三入口标签、学校代码和邀请状态组件。

- [ ] **Step 3: 实现三个专用面板**

```ts
export type LoginChannel = 'platform' | 'school' | 'activation'

export interface InvitationSummary {
  roleLabel: string
  organizationName: string
  maskedAccount: string
}
```

平台账号面板显示账号、密码、登录和忘记密码；学校面板显示学校代码和“继续学校认证”；邀请面板显示邀请编码以及有效/过期/已使用结果。演示入口独立放在三个正式渠道下方。

- [ ] **Step 4: 验证登录测试、类型和构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 2: 专业代码选择器与关键词 Tag

**Files:**
- Create: `frontend/src/modules/thesis/types.ts`
- Create: `frontend/src/modules/thesis/components/DisciplineSelector.vue`
- Create: `frontend/src/modules/thesis/components/KeywordTagInput.vue`
- Create: `frontend/src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`

**Interfaces:**
- `DisciplineOption { code: string; name: string; parentCode?: string }`。
- `DisciplineSelector` consumes `{ modelValue?: DisciplineOption; options: DisciplineOption[] }`，emits `update:modelValue`。
- `KeywordTagInput` consumes `{ modelValue: string[] }`，回车或中文/英文分号生成 Tag，去空白和完全重复。

- [ ] **Step 1: 写专业代码和值对象失败测试**

```ts
it('emits the selected discipline code and name as one value', async () => {
  const wrapper = mount(DisciplineSelector, { props: { options: [{ code: '0812', name: '计算机科学与技术' }] } })
  await wrapper.get('button[data-discipline="0812"]').trigger('click')
  expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([{ code: '0812', name: '计算机科学与技术' }])
})
```

- [ ] **Step 2: 写关键词去重失败测试**

```ts
it('trims and deduplicates keyword tags', async () => {
  const wrapper = mount(KeywordTagInput, { props: { modelValue: ['知识图谱'] } })
  await wrapper.get('input').setValue(' 知识图谱；多模态推理 ')
  await wrapper.get('input').trigger('keydown.enter')
  expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual(['知识图谱', '多模态推理'])
})
```

- [ ] **Step 3: 运行测试确认 RED，随后实现最小组件**

Run: `pnpm --dir frontend test:unit --run src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`

- [ ] **Step 4: 运行组件测试和类型检查确认 GREEN**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check`

### Task 3: 统一多论文演示模型与双通道接入

**Files:**
- Modify: `frontend/src/demo/types.ts`
- Modify: `frontend/src/demo/fixtures.ts`
- Modify: `frontend/src/demo/scenarioService.ts`
- Modify: `frontend/src/demo/__tests__/scenarioService.spec.ts`
- Modify: `frontend/src/stores/demoScenario.ts`

**Interfaces:**
- Produces: `DemoThesisSummary[]` 和 `SubmissionSource = 'STUDENT' | 'SCHOOL_MANUAL' | 'SCHOOL_BATCH'`。
- `ScenarioService.listStudentTheses()` 返回当前学生可见论文。
- `ScenarioService.listSchoolTheses()` 返回本租户论文且不包含专家身份。
- `ScenarioService.submitThesisAsSchool(input)` 创建 `SCHOOL_MANUAL` 论文并直接进入 `SUBMITTED`。
- `ScenarioService.previewBatchImport()` 返回 `BatchImportRow[]`，状态为 `VALID | DUPLICATE | UNKNOWN_DISCIPLINE | MISSING_FILE`。

```ts
interface SchoolSubmissionInput {
  studentId: string
  batchId: string
  title: string
  discipline: { code: string; name: string }
  keywords: string[]
  originalFileName: string
  anonymousFileName: string
}

interface BatchImportRow {
  rowNumber: number
  studentId: string
  title: string
  disciplineCode: string
  validationStatus: 'VALID' | 'DUPLICATE' | 'UNKNOWN_DISCIPLINE' | 'MISSING_FILE'
  reason?: string
}
```

- [ ] **Step 1: 写学校直接代传和学生可见失败测试**

```ts
it('lets school submit for a student without a second confirmation', async () => {
  const service = createScenarioService()
  const created = await service.submitThesisAsSchool({
    studentId: '20260042',
    batchId: 'batch-2026-spring',
    title: '面向复杂场景的多模态知识推理研究',
    discipline: { code: '0812', name: '计算机科学与技术' },
    keywords: ['多模态推理', '知识图谱'],
    originalFileName: '20260042.pdf',
    anonymousFileName: 'HY-2026-0042.pdf',
  })
  expect(created.stage).toBe('SUBMITTED')
  expect(created.submissionSource).toBe('SCHOOL_MANUAL')
  expect((await service.listStudentTheses()).map(item => item.id)).toContain(created.id)
})
```

- [ ] **Step 2: 写学校投影不泄露专家身份和批量预览失败测试**

```ts
expect(JSON.stringify(await service.listSchoolTheses())).not.toContain('周明远')
expect((await service.previewBatchImport()).map(row => row.validationStatus)).toEqual([
  'VALID', 'DUPLICATE', 'UNKNOWN_DISCIPLINE', 'MISSING_FILE',
])
```

- [ ] **Step 3: 运行测试确认 RED，扩展类型、fixtures 和服务实现**

Run: `pnpm --dir frontend test:unit --run src/demo/__tests__/scenarioService.spec.ts`

- [ ] **Step 4: 验证不可变快照、身份投影和全量测试**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check`

### Task 4: PAGE-002 多论文表格与 PAGE-003 字段升级

**Files:**
- Modify: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Modify: `frontend/src/modules/thesis/pages/ThesisEditPage.vue`
- Modify: `frontend/src/modules/thesis/__tests__/studentSubmission.spec.ts`
- Create: `frontend/src/modules/thesis/components/StudentThesisTable.vue`
- Create: `frontend/src/modules/thesis/__tests__/StudentThesisTable.spec.ts`

**Interfaces:**
- `StudentThesisTable` consumes `{ rows: DemoThesisSummary[] }`。
- 操作列只根据每行 `allowedActions` 显示编辑、查看或查看结果。
- PAGE-003 使用 `DisciplineSelector` 和 `KeywordTagInput`，提交请求同时包含 `disciplineCode`、`disciplineName`、`keywords: string[]`。

- [ ] **Step 1: 写多论文、来源和动作投影失败测试**

```ts
expect(wrapper.findAll('tbody tr')).toHaveLength(3)
expect(wrapper.text()).toContain('学校代传')
expect(wrapper.findAll('[data-action="edit-thesis"]')).toHaveLength(1)
```

- [ ] **Step 2: 写 PAGE-003 专业代码和 Tag 提交失败测试并运行 RED**

Run: `pnpm --dir frontend test:unit --run src/modules/thesis/__tests__/studentSubmission.spec.ts src/modules/thesis/__tests__/StudentThesisTable.spec.ts`

- [ ] **Step 3: 实现桌面表格、移动卡片和表单字段升级**

表格列固定为论文、批次、专业代码/名称、接入来源、状态、更新时间、操作。移动端按论文分卡，不隐藏专业代码和状态。

- [ ] **Step 4: 验证学生页面与全量构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 5: PAGE-004 学校论文表格、单篇代传与批量预览（D4-1）

**Files:**
- Create: `frontend/src/modules/school/pages/PreparationListPage.vue`
- Create: `frontend/src/modules/school/components/SchoolThesisTable.vue`
- Create: `frontend/src/modules/school/components/SchoolSubmissionDrawer.vue`
- Create: `frontend/src/modules/school/components/BatchImportPreview.vue`
- Create: `frontend/src/modules/school/components/AnonymizationCheckPanel.vue`
- Create: `frontend/src/modules/school/routes.ts`
- Create: `frontend/src/modules/school/__tests__/schoolIntake.spec.ts`
- Modify: `frontend/src/router/routes.ts`

**Interfaces:**
- `SchoolSubmissionDrawer` 只能选择已同步学生、批次和专业目录。
- `BatchImportPreview` consumes `{ rows: BatchImportRow[] }` 并显示行号、学号、论文、专业代码、文件、校验状态和原因。
- PAGE-004 不渲染任何 expert 字段。

- [ ] **Step 1: 写学校直接提交无需学生确认失败测试**

```ts
await wrapper.get('button[data-action="confirm-school-submission"]').trigger('click')
expect(await service.listSchoolTheses()).toContainEqual(expect.objectContaining({
  submissionSource: 'SCHOOL_MANUAL', stage: 'SUBMITTED',
}))
```

- [ ] **Step 2: 写批量预览四类状态和身份隔离失败测试并运行 RED**

Run: `pnpm --dir frontend test:unit --run src/modules/school/__tests__/schoolIntake.spec.ts`

- [ ] **Step 3: 实现筛选表格、代传抽屉和批量预览**

顶部动作固定为“单篇代传”“批量导入”“下载导入模板”；批量预览明确标注“演示数据，不执行真实 Excel 写入”。

- [ ] **Step 4: 验证 D4-1 测试、类型、构建与桌面/移动视觉**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 6: PAGE-005 学校确认送出与进度（D4-2）

**Files:**
- Create: `frontend/src/modules/school/pages/ReviewProgressPage.vue`
- Create: `frontend/src/modules/school/components/TaskProgressSummary.vue`
- Create: `frontend/src/modules/school/__tests__/schoolDispatch.spec.ts`
- Modify: `frontend/src/router/routes.ts`

**Interfaces:**
- `FAIL` 不允许送出；`REVIEW_REQUIRED` 需要人工确认或退回；`PASS` 仍需要最终确认。
- 确认送出调用 `ScenarioService.confirmDispatch()` 并进入 `PENDING_ASSIGNMENT`。
- 任务进度只显示数量和任务化名，不显示专家姓名。

- [ ] **Step 1: 写匿名门禁与学校身份隔离失败测试**

```ts
expect(wrapper.get('[data-anonymization="FAIL"] button').attributes('disabled')).toBeDefined()
expect(wrapper.text()).not.toContain('周明远')
```

- [ ] **Step 2: 运行测试确认 RED，实施准备列表到进度页的转换**

Run: `pnpm --dir frontend test:unit --run src/modules/school/__tests__/schoolDispatch.spec.ts`

- [ ] **Step 3: 验证 D4 完成门禁**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build && git diff --check`

Expected: 全部退出码 0 后立即进入 Task 7，不插入 PAGE-014—023。

### Task 7: PAGE-007 百杰派单、专业匹配与费用展示（D5）

**Files:**
- Create: `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue`
- Create: `frontend/src/modules/dispatch/components/CandidateExpertTable.vue`
- Create: `frontend/src/modules/dispatch/components/ConflictReason.vue`
- Create: `frontend/src/modules/dispatch/components/FeeRuleSnapshot.vue`
- Create: `frontend/src/modules/dispatch/routes.ts`
- Create: `frontend/src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts`
- Modify: `frontend/src/router/routes.ts`

**Interfaces:**
- 候选匹配显示专业代码、专业名称、擅长领域、关键词辅助命中和回避原因。
- `conflictHit=true` 的候选不可选。
- `FeeRuleSnapshot` 只读显示金额、币种、规则版本和结算说明。
- 指派调用 `ScenarioService.assignExperts()`，重复点击不得产生重复任务。

- [ ] **Step 1: 写回避不可选、专业匹配和费用只读失败测试**

```ts
expect(wrapper.get('[data-expert="conflicted"] input').attributes('disabled')).toBeDefined()
expect(wrapper.get('[data-fee-rule]').text()).toContain('¥ 300.00')
expect(wrapper.find('input[data-field="fee"]').exists()).toBe(false)
```

- [ ] **Step 2: 运行 RED、实现工作台、运行 GREEN**

Run: `pnpm --dir frontend test:unit --run src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts`

- [ ] **Step 3: 完整验证后进入 D6**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 8: PAGE-008—010 专家接单与评阅（D6）

**Files:**
- Create: `frontend/src/modules/review/pages/ExpertTasksPage.vue`
- Create: `frontend/src/modules/review/pages/InvitationPage.vue`
- Create: `frontend/src/modules/review/pages/ReviewWorkspacePage.vue`
- Create: `frontend/src/modules/review/components/AnonymousDocumentPane.vue`
- Create: `frontend/src/modules/review/components/ReviewFormPane.vue`
- Create: `frontend/src/modules/review/components/WorkspaceSplitter.vue`
- Create: `frontend/src/modules/review/routes.ts`
- Create: `frontend/src/modules/review/__tests__/expertReview.spec.ts`
- Modify: `frontend/src/router/routes.ts`

**Interfaces:**
- 接受前只显示匿名概要、绝对期限、费用和说明；接受后开放匿名材料。
- `IN_REVIEW + overdue=true` 仍可保存和提交。
- 最终提交锁定结果；专家投影不得出现学号、学生、导师和原始版。

- [ ] **Step 1: 写接单隔离、逾期附加标记和最终锁定失败测试**

```ts
expect(beforeAccept.text()).not.toContain('匿名版全文')
expect(JSON.stringify(expertSnapshot)).not.toMatch(/林知远|赵文博|20260042/)
expect(afterSubmit.get('[data-review-locked="true"]').exists()).toBe(true)
```

- [ ] **Step 2: 运行 RED、实现任务/邀请/双栏评阅、运行 GREEN**

Run: `pnpm --dir frontend test:unit --run src/modules/review/__tests__/expertReview.spec.ts`

- [ ] **Step 3: 验证桌面双栏、窄屏双 Tab 和全量构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 9: PAGE-011—013 汇总发布与匿名结果（D7）

**Files:**
- Create: `frontend/src/modules/result/pages/ResultProcessingPage.vue`
- Create: `frontend/src/modules/result/pages/StudentResultPage.vue`
- Create: `frontend/src/modules/result/pages/SupervisorResultPage.vue`
- Create: `frontend/src/modules/result/components/AnonymousResultTable.vue`
- Create: `frontend/src/modules/result/components/ResultSummaryPanel.vue`
- Create: `frontend/src/modules/result/routes.ts`
- Create: `frontend/src/modules/result/__tests__/resultPublication.spec.ts`
- Create: `frontend/src/demo/__tests__/goldenPath.spec.ts`
- Modify: `frontend/src/router/routes.ts`

**Interfaces:**
- 未发布时学生/导师结果为空；发布后只显示匿名专家序号、分数和获准评语。
- 学校只看到任务化名和汇总，不出现专家姓名。
- 发布调用 `ScenarioService.publishResult()`，重复请求保持幂等。

- [ ] **Step 1: 写发布前不可见、发布后可见和三端身份隔离失败测试**

```ts
expect(studentBefore.find('[data-result-row]').exists()).toBe(false)
await service.publishResult()
expect(studentAfter.get('[data-result-row]').text()).toContain('专家 A')
expect(JSON.stringify(studentSnapshot)).not.toContain('周明远')
```

- [ ] **Step 2: 运行 RED、实现三端页面、运行 GREEN**

Run: `pnpm --dir frontend test:unit --run src/modules/result/__tests__/resultPublication.spec.ts`

- [ ] **Step 3: 运行学生提交到结果发布的黄金闭环测试**

Run: `pnpm --dir frontend test:unit --run src/demo/__tests__/goldenPath.spec.ts`

- [ ] **Step 4: 完整验证 D0—D7**

```bash
pnpm --dir frontend test:unit:run
pnpm --dir frontend type-check
pnpm --dir frontend build
git diff --check
```

### Task 10: 正式文档同步

**Files:**
- Modify: `docs/10_审查与决策/问题与决策记录.md`
- Modify: `docs/02_产品设计/产品与流程设计.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-001_登录与学校入口.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-002_学生论文工作台.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-003_论文编辑与上传.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-004_学校送审准备列表.md`
- Modify: `docs/05_API设计/API设计.md`
- Modify: `docs/10_审查与决策/需求追踪矩阵.md`

**Interfaces:**
- 记录 Q-002 的增量变更：统一论文记录、学校直接代传、学生无需二次确认。
- 明确专业代码/名称、关键词数组、接入来源和代传审计字段。
- 不把前端演示预览写成已经完成的真实批量 API。

- [ ] **Step 1: 同步正式文档并保持状态为 `DRAFT`**
- [ ] **Step 2: 搜索旧的“仅学生提交”和“学生只有一篇论文”表述并消除冲突**

Run: `rg -n '仅学生|唯一论文|单篇论文|学生确认' docs/01_需求分析 docs/02_产品设计 docs/05_API设计 docs/10_审查与决策`

- [ ] **Step 3: 检查文档链接、需求编号和差异格式**

Run: `git diff --check`
