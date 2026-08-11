# Student Interactive Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将学生端从静态页面骨架升级为可保存、可提交、可撤回、可查看进度与结果、可提交异议，并支持独立演示场景切换的完整前端交互闭环。

**Architecture:** 保留现有共享 `ScenarioService` 作为演示状态唯一来源，在论文模块增加窄化的 `StudentPortalService` 接口，学生页面不再直接推断状态。演示实现通过可注入存储持久化统一快照；专业目录、表单控件、工作台、结果异议、消息和场景控制器按独立组件实现，后续可用 HTTP 适配器替换本地服务。

**Tech Stack:** Vue 3.5、TypeScript 5.9、Vue Router 5、Pinia 3、Element Plus 2、Vitest 4、Vue Test Utils、CSS；不新增运行时或测试依赖。

## Global Constraints

- 仅实现学生角色，不修改学校、百杰运营、专家、导师和系统管理员的业务功能。
- 按用户要求继续在当前 `codex/frontend-client-demo` 分支和原项目目录工作，不创建 git worktree。
- 学生业务按钮只能执行学生有权进行的动作；跨角色阶段只能由共享流程或显式演示控制器装载。
- 演示控制器仅在 `VITE_DEMO_MODE=true` 时可见且可调用，其他环境必须完全隐藏入口。
- 页面不设置全局 `max-width`；390px 宽度不得产生整页横向滚动。
- 学生端统一显示“材料准备、学校审核、送审评阅、结果处理、已完成”五阶段。
- 专业目录使用教育部《研究生教育学科专业目录（2022 年）》的 117 个一级学科和 67 个专业学位类别，共 184 个受控条目。
- 专业必须保存代码和名称，不允许自由文本；关键词最多 5 个，去空白并完全去重。
- 演示文件只保存文件名、大小、MIME 类型和模拟校验状态，不读取正文或把二进制写入 `localStorage`。
- 不宣称真实 SSO、文件上传、匿名检测、消息发送、数据库或支付已完成。
- 每个业务改动先写失败测试，再写最小实现；每个任务单独验证并只提交自身文件。

---

### Task 1: 学生领域模型、允许动作与持久化状态

**Files:**

- Create: `frontend/src/modules/thesis/services/studentPortalService.ts`
- Create: `frontend/src/demo/studentFixtures.ts`
- Create: `frontend/src/demo/studentPersistence.ts`
- Create: `frontend/src/demo/__tests__/studentPortalService.spec.ts`
- Modify: `frontend/src/demo/types.ts`
- Modify: `frontend/src/demo/fixtures.ts`
- Modify: `frontend/src/demo/scenarioService.ts`
- Modify: `frontend/src/demo/serviceProvider.ts`

**Interfaces:**

- Produces: `StudentPortalService`、`StudentThesisDetail`、`StudentEligibility`、`StudentTimelineEvent`、`StudentObjection`、`StudentNotification`、`StudentScenarioPreset`。
- Produces: `createScenarioService(options?: { storage?: StorageLike; demoMode?: boolean })`，无参数调用继续兼容现有测试。
- Consumes: 现有 `DemoStage`、`DemoThesisSummary`、`DemoPublishedResult` 与跨角色场景状态。

- [ ] **Step 1: 写学生服务状态转换失败测试**

```ts
it("allows only legal student actions and keeps related projections in sync", async () => {
  const storage = createMemoryStorage();
  const service = createScenarioService({ storage, demoMode: true });
  const draft = await service.getStudentThesis("thesis-main");
  expect(draft.allowedActions).toContain("EDIT_THESIS");

  await service.submitStudentThesis("thesis-main");
  const submitted = await service.getStudentThesis("thesis-main");
  expect(submitted.stage).toBe("SUBMITTED");
  expect(submitted.allowedActions).toContain("WITHDRAW_BEFORE_DISPATCH");
  expect((await service.listStudentNotifications())[0].kind).toBe(
    "THESIS_SUBMITTED",
  );

  await service.withdrawStudentThesis("thesis-main", "修改匿名版文件");
  expect((await service.getStudentThesis("thesis-main")).stage).toBe("DRAFT");
});
```

同时测试：学校代传记录无编辑动作；`UNDER_REVIEW` 只能创建撤回申请；`COMPLETED` 才能查看结果和提交异议；页面拿到的快照不可变。

- [ ] **Step 2: 运行测试并确认缺少学生服务能力**

Run: `npm run test:unit -- --run src/demo/__tests__/studentPortalService.spec.ts`

Expected: FAIL，提示 `getStudentThesis`、`submitStudentThesis`、`withdrawStudentThesis` 或对应类型不存在。

- [ ] **Step 3: 定义窄化接口和明确类型**

```ts
export type StudentVisibleStage =
  | "MATERIALS"
  | "SCHOOL_REVIEW"
  | "EXPERT_REVIEW"
  | "RESULT_PROCESSING"
  | "COMPLETED"
  | "TERMINATED";

export type StudentAction =
  | "EDIT_THESIS"
  | "DELETE_DRAFT"
  | "VIEW_THESIS"
  | "WITHDRAW_BEFORE_DISPATCH"
  | "REQUEST_WITHDRAWAL"
  | "VIEW_RESULT"
  | "SUBMIT_OBJECTION";

export interface StudentPortalService {
  listStudentTheses(query?: StudentThesisQuery): Promise<StudentThesisDetail[]>;
  getStudentThesis(id: string): Promise<StudentThesisDetail>;
  createStudentDraft(): Promise<StudentThesisDetail>;
  saveStudentDraft(
    id: string,
    input: StudentDraftInput,
  ): Promise<StudentThesisDetail>;
  submitStudentThesis(id: string): Promise<StudentThesisDetail>;
  deleteStudentDraft(id: string): Promise<void>;
  withdrawStudentThesis(
    id: string,
    reason: string,
  ): Promise<StudentThesisDetail>;
  requestStudentWithdrawal(
    id: string,
    reason: string,
  ): Promise<StudentWithdrawalRequest>;
  getStudentResult(id: string): Promise<StudentResult | null>;
  submitStudentObjection(
    id: string,
    input: StudentObjectionInput,
  ): Promise<StudentObjection>;
  listStudentNotifications(): Promise<StudentNotification[]>;
  markStudentNotificationRead(id: string): Promise<StudentNotification[]>;
  markAllStudentNotificationsRead(): Promise<StudentNotification[]>;
  loadStudentScenario(
    preset: StudentScenarioPreset,
  ): Promise<StudentThesisDetail>;
  resetStudentDemo(): Promise<void>;
}
```

`createStudentDraft()` 根据当前有效资格生成唯一草稿和空材料；无资格、资格暂停或批次过期时抛出带公开原因的 `StudentPortalError('NOT_ELIGIBLE')`。`StudentThesisDetail` 必须包含 `studentVisibleStage`、`allowedActions`、`timeline`、`submissionSource`、只读学籍信息、论文表单数据和文件元数据。

- [ ] **Step 4: 实现带版本存储和统一状态转换**

使用键 `baijie-demo-student:v1`；序列化内容包含 `schemaVersion: 1`。`createScenarioService()` 在浏览器由 provider 注入 `window.localStorage`，测试默认使用内存存储。解析失败或版本不符时装载 `studentFixtures.ts` 的确定快照并记录一次 `DEMO_DATA_RESET` 通知。

学生状态映射函数只定义一次：

```ts
export function toStudentVisibleStage(stage: DemoStage): StudentVisibleStage {
  if (stage === "DRAFT") return "MATERIALS";
  if (["SUBMITTED", "PREPARING", "READY_FOR_DISPATCH"].includes(stage))
    return "SCHOOL_REVIEW";
  if (stage === "UNDER_REVIEW") return "EXPERT_REVIEW";
  if (stage === "RESULT_PROCESSING") return "RESULT_PROCESSING";
  if (stage === "COMPLETED") return "COMPLETED";
  return "TERMINATED";
}
```

- [ ] **Step 5: 运行服务测试和现有黄金流程测试**

Run: `npm run test:unit -- --run src/demo/__tests__/studentPortalService.spec.ts src/demo/__tests__/scenarioService.spec.ts src/demo/__tests__/goldenPath.spec.ts`

Expected: PASS；现有跨角色黄金流程保持通过，刷新重建服务后学生状态不丢失。

- [ ] **Step 6: 提交学生状态基础**

```bash
git add frontend/src/modules/thesis/services/studentPortalService.ts frontend/src/demo/studentFixtures.ts frontend/src/demo/studentPersistence.ts frontend/src/demo/types.ts frontend/src/demo/fixtures.ts frontend/src/demo/scenarioService.ts frontend/src/demo/serviceProvider.ts frontend/src/demo/__tests__/studentPortalService.spec.ts
git commit -m "feat: add persistent student workflow state"
```

### Task 2: 完整专业目录和悬浮搜索选择器

**Files:**

- Create: `frontend/src/modules/thesis/data/graduate-disciplines-2022.json`
- Create: `frontend/src/modules/thesis/data/disciplineCatalog.ts`
- Create: `frontend/src/modules/thesis/__tests__/disciplineCatalog.spec.ts`
- Modify: `frontend/src/modules/thesis/types.ts`
- Modify: `frontend/src/modules/thesis/components/DisciplineSelector.vue`
- Modify: `frontend/src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`

**Interfaces:**

- Produces: `DisciplineCatalogEntry { code, name, categoryCode, categoryName, type, aliases }`。
- Produces: `disciplineCatalog` 和 `searchDisciplines(query: string): DisciplineCatalogEntry[]`。
- Component contract: `v-model?: DisciplineOption`，不再要求页面传入三个硬编码 `options`。

- [ ] **Step 1: 写目录完整性和悬浮行为失败测试**

```ts
it("contains the complete controlled directory with unique codes", () => {
  expect(disciplineCatalog).toHaveLength(184);
  expect(new Set(disciplineCatalog.map((item) => item.code)).size).toBe(184);
  expect(disciplineCatalog).toContainEqual(
    expect.objectContaining({
      code: "0812",
      name: "计算机科学与技术",
      type: "ACADEMIC",
    }),
  );
});

it("opens as an overlay only after activation and closes with Escape", async () => {
  const wrapper = mount(DisciplineSelector);
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  await wrapper.get('[data-action="open-discipline"]').trigger("click");
  expect(wrapper.get('[role="listbox"]').isVisible()).toBe(true);
  expect(wrapper.get(".discipline-selector").classes()).toContain("is-open");
  await wrapper.get('input[type="search"]').trigger("keydown.esc");
  expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
});
```

增加代码搜索、名称搜索、无结果、点击外部、方向键、Enter 选择和选中值回显测试。

- [ ] **Step 2: 运行目录和输入组件测试并确认失败**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/disciplineCatalog.spec.ts src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`

Expected: FAIL，当前无目录文件，且未选值时菜单自动占据文档流。

- [ ] **Step 3: 添加带来源元数据的 184 项 JSON**

JSON 根结构固定为：

```json
{
  "version": "2022",
  "effectiveFrom": "2023-01-01",
  "source": "https://www.moe.gov.cn/srcsite/A22/moe_833/202209/t20220914_660828.html",
  "entries": [
    {
      "code": "0812",
      "name": "计算机科学与技术",
      "categoryCode": "08",
      "categoryName": "工学",
      "type": "ACADEMIC",
      "aliases": []
    }
  ]
}
```

从官方目录逐项录入并由测试校验总数、代码唯一性、四位代码格式和门类字段，不在组件内维护目录副本。

- [ ] **Step 4: 实现桌面悬浮层和移动端底部弹层**

桌面使用 `.discipline-selector__popover { position: absolute; z-index: 30; inset-inline: 0; }`，根据控制框 `getBoundingClientRect()` 和可用空间设置 `data-placement="top|bottom"`。移动端 `@media (max-width: 640px)` 改为 `position: fixed; inset: auto 0 0; max-height: 70vh`。打开时聚焦搜索框，关闭时把焦点还给控制按钮。

标签文案严格使用：`学科专业　按代码或名称搜索，请选择与论文研究内容最匹配的送审专业。`

- [ ] **Step 5: 运行组件测试和类型检查**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/disciplineCatalog.spec.ts src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`

Run: `npm run type-check`

Expected: PASS；收起状态 DOM 中无 listbox，搜索“0812”和“计算机”均返回计算机科学与技术。

- [ ] **Step 6: 提交专业目录和选择器**

```bash
git add frontend/src/modules/thesis/data frontend/src/modules/thesis/types.ts frontend/src/modules/thesis/components/DisciplineSelector.vue frontend/src/modules/thesis/__tests__/disciplineCatalog.spec.ts frontend/src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts
git commit -m "feat: add searchable graduate discipline catalog"
```

### Task 3: 可保存的论文材料编辑与文件交互

**Files:**

- Create: `frontend/src/modules/thesis/components/StudentIdentityPanel.vue`
- Create: `frontend/src/modules/thesis/components/ThesisFileField.vue`
- Create: `frontend/src/modules/thesis/components/ThesisMaterialEditor.vue`
- Create: `frontend/src/modules/thesis/__tests__/ThesisFileField.spec.ts`
- Modify: `frontend/src/modules/thesis/components/KeywordTagInput.vue`
- Modify: `frontend/src/modules/thesis/pages/ThesisEditPage.vue`
- Modify: `frontend/src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts`
- Modify: `frontend/src/modules/thesis/__tests__/studentSubmission.spec.ts`

**Interfaces:**

- Consumes: Task 1 的 `StudentPortalService.saveStudentDraft()`、`submitStudentThesis()` 和 `StudentDraftInput`。
- Consumes: Task 2 的 `DisciplineSelector`。
- Produces: `ThesisFileMeta { id, name, size, mimeType, purpose, validationStatus }`。

- [ ] **Step 1: 写表单、关键词上限和文件状态失败测试**

```ts
it("saves a complete draft and reports the saved time", async () => {
  await wrapper.get('textarea[name="abstract"]').setValue("研究摘要");
  await wrapper.get('[data-action="save-draft"]').trigger("click");
  await flushPromises();
  expect(saveSpy).toHaveBeenCalledWith(
    "thesis-main",
    expect.objectContaining({
      abstract: "研究摘要",
      discipline: { code: "0812", name: "计算机科学与技术" },
    }),
  );
  expect(wrapper.get("[data-save-status]").text()).toContain("已保存");
});

it("stops at five keywords with an actionable message", async () => {
  const wrapper = mount(KeywordTagInput, {
    props: { modelValue: ["一", "二", "三", "四", "五"] },
  });
  await wrapper.get("input").setValue("六");
  await wrapper.get("input").trigger("keydown.enter");
  expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  expect(wrapper.text()).toContain("最多填写 5 个关键词");
});
```

文件测试覆盖选择 PDF、模拟进度、失败、删除、重新选择，以及本地存储数据不含 `File` 或二进制内容。编辑页测试还需让 `saveStudentDraft()` 拒绝一次，断言摘要和文件元数据仍保留、保存状态显示“保存失败，请重试”，再次点击可以成功。

- [ ] **Step 2: 运行编辑页测试并确认失败**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentSubmission.spec.ts src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts src/modules/thesis/__tests__/ThesisFileField.spec.ts`

Expected: FAIL，当前缺少摘要、只读学籍、保存草稿、文件状态和 5 个关键词限制。

- [ ] **Step 3: 实现只读学籍、材料编辑和文件元数据组件**

`StudentIdentityPanel` 展示学校、学院、学号、姓名、培养层次、学位类型、导师、批次和截止时间。`ThesisFileField` 只把以下元数据写入草稿：

```ts
const meta: ThesisFileMeta = {
  id: crypto.randomUUID(),
  name: file.name,
  size: file.size,
  mimeType: file.type,
  purpose: props.purpose,
  validationStatus: "VALID",
};
```

文件名包含学生姓名、学号或“致谢”时，匿名版标记 `REVIEW_REQUIRED` 并显示“请检查文件名和正文中的身份线索”，但仍明确正文尚未自动检测。

- [ ] **Step 4: 实现脏状态、保存和提交校验**

编辑页加载 `route.query.thesisId` 指定的论文；当值为 `new` 时先调用 `createStudentDraft()` 并以返回的真实 ID 替换路由查询参数。表单变化设置 `dirty=true`；保存成功设置最后保存时间；路由离开时仅在 `dirty` 为真时确认。提交错误顺序固定为题目、摘要、专业、关键词、原始版、匿名版；确认提交后调用 `submitStudentThesis(id)`，防止重复点击并返回工作台。保存失败保留本地表单并提供原动作名称“重新保存”。

- [ ] **Step 5: 运行编辑页测试和类型检查**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentSubmission.spec.ts src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts src/modules/thesis/__tests__/ThesisFileField.spec.ts`

Run: `npm run type-check`

Expected: PASS；校验失败聚焦首个错误，成功提交只调用一次服务动作。

- [ ] **Step 6: 提交材料编辑闭环**

```bash
git add frontend/src/modules/thesis/components/StudentIdentityPanel.vue frontend/src/modules/thesis/components/ThesisFileField.vue frontend/src/modules/thesis/components/ThesisMaterialEditor.vue frontend/src/modules/thesis/components/KeywordTagInput.vue frontend/src/modules/thesis/pages/ThesisEditPage.vue frontend/src/modules/thesis/__tests__/ThesisFileField.spec.ts frontend/src/modules/thesis/__tests__/disciplineAndKeywords.spec.ts frontend/src/modules/thesis/__tests__/studentSubmission.spec.ts
git commit -m "feat: complete student thesis material editor"
```

### Task 4: 论文工作台、五阶段进度和状态动作

**Files:**

- Create: `frontend/src/modules/thesis/components/StudentThesisFilters.vue`
- Create: `frontend/src/modules/thesis/components/StudentThesisDetailDrawer.vue`
- Create: `frontend/src/modules/thesis/components/StudentProgressTimeline.vue`
- Create: `frontend/src/modules/thesis/__tests__/studentWorkspace.spec.ts`
- Modify: `frontend/src/modules/thesis/components/StudentThesisTable.vue`
- Modify: `frontend/src/modules/thesis/components/ThesisStageRail.vue`
- Modify: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Modify: `frontend/src/modules/thesis/__tests__/StudentThesisTable.spec.ts`

**Interfaces:**

- Consumes: Task 1 的列表、详情、删除草稿、派单前撤回和派单后撤回申请。
- Produces: `selectedThesisId` 驱动的表格、进度和详情一致投影。

- [ ] **Step 1: 写选中论文和允许动作失败测试**

```ts
it("changes progress and actions when a thesis row is selected", async () => {
  await wrapper.get('[data-thesis-id="thesis-completed"]').trigger("click");
  expect(
    wrapper.get("[data-selected-thesis]").attributes("data-selected-thesis"),
  ).toBe("thesis-completed");
  expect(wrapper.get('[data-student-stage="COMPLETED"]').exists()).toBe(true);
  expect(wrapper.get('[data-action="view-result"]').exists()).toBe(true);
  expect(wrapper.find('[data-action="edit-thesis"]').exists()).toBe(false);
});

it("withdraws before dispatch after confirmation", async () => {
  await wrapper
    .get('[data-action="withdraw-before-dispatch"]')
    .trigger("click");
  await wrapper.get('[data-action="confirm-withdrawal"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('[data-student-stage="MATERIALS"]').exists()).toBe(true);
});
```

增加筛选统计、搜索、删除草稿、学校代传只读、送审中撤回申请和抽屉时间线测试。

增加两个可恢复错误测试：`listStudentTheses()` 加载失败时显示“重新加载”且不清空页面标题；撤回时服务返回 `STATE_CONFLICT`，页面重新获取详情并显示“论文状态已更新，本次操作未执行”。

- [ ] **Step 2: 运行工作台测试并确认失败**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentWorkspace.spec.ts src/modules/thesis/__tests__/StudentThesisTable.spec.ts`

Expected: FAIL，当前表格行不能选中，进度固定绑定主线状态，撤回和详情动作不存在。

- [ ] **Step 3: 实现筛选、统计和选中论文状态**

筛选值固定为 `ALL | NEEDS_ACTION | IN_REVIEW | COMPLETED`；搜索匹配论文题目、盲审编号和专业代码/名称。统计从过滤前的服务结果计算，不写死数字。页面首次加载选择“待我处理”中的第一篇，否则选择第一篇论文；无论文时不渲染进度条并显示“新建论文”，点击后调用 `createStudentDraft()` 并进入 `/student/thesis/edit?thesisId=<返回ID>`。资格无效时禁用该动作并展示服务返回的公开原因。

- [ ] **Step 4: 实现五阶段进度、详情抽屉和状态动作**

`ThesisStageRail` 只接收 `StudentVisibleStage`，展示五个学生阶段。详情抽屉显示公开时间线、退回原因、材料元数据和允许动作。派单前撤回必须填写原因并二次确认；`UNDER_REVIEW` 的撤回只创建申请，提示“已提交学校处理”，不改变论文阶段。

- [ ] **Step 5: 运行工作台回归和移动布局组件测试**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentWorkspace.spec.ts src/modules/thesis/__tests__/StudentThesisTable.spec.ts`

Run: `npm run type-check`

Expected: PASS；学校代传记录不出现编辑按钮，选择不同论文时进度与动作同步变化。

- [ ] **Step 6: 提交学生论文工作台**

```bash
git add frontend/src/modules/thesis/components/StudentThesisFilters.vue frontend/src/modules/thesis/components/StudentThesisDetailDrawer.vue frontend/src/modules/thesis/components/StudentProgressTimeline.vue frontend/src/modules/thesis/components/StudentThesisTable.vue frontend/src/modules/thesis/components/ThesisStageRail.vue frontend/src/modules/thesis/pages/StudentDashboardPage.vue frontend/src/modules/thesis/__tests__/studentWorkspace.spec.ts frontend/src/modules/thesis/__tests__/StudentThesisTable.spec.ts
git commit -m "feat: add interactive student thesis workspace"
```

### Task 5: 结果查看和异议提交闭环

**Files:**

- Create: `frontend/src/modules/result/components/StudentResultSelector.vue`
- Create: `frontend/src/modules/result/components/StudentScoreDimensions.vue`
- Create: `frontend/src/modules/result/components/StudentObjectionForm.vue`
- Create: `frontend/src/modules/result/components/StudentObjectionTimeline.vue`
- Create: `frontend/src/modules/result/__tests__/studentResultAndObjection.spec.ts`
- Modify: `frontend/src/modules/result/pages/StudentResultPage.vue`
- Modify: `frontend/src/modules/result/__tests__/resultPublication.spec.ts`

**Interfaces:**

- Consumes: Task 1 的 `getStudentResult(id)`、`submitStudentObjection(id, input)` 和论文列表。
- Produces: `StudentObjectionInput { reason, request, attachments }`；异议状态 `SUBMITTED | PROCESSING | RESOLVED`。

- [ ] **Step 1: 写未发布、已发布和重复异议失败测试**

```ts
it("shows six dimensions only for a published result", async () => {
  await service.loadStudentScenario("COMPLETED");
  const wrapper = await mountStudentResult(service, "thesis-main");
  expect(wrapper.findAll("[data-score-dimension]")).toHaveLength(6);
  expect(wrapper.text()).toContain("专家 A");
  expect(wrapper.text()).not.toContain("周明远");
});

it("submits one objection and blocks a duplicate while unresolved", async () => {
  await wrapper.get('textarea[name="reason"]').setValue("对评价依据存在疑问");
  await wrapper.get('textarea[name="request"]').setValue("申请学校复核处理");
  await wrapper.get('[data-action="submit-objection"]').trigger("click");
  await wrapper.get('[data-action="confirm-objection"]').trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("异议已提交");
  expect(wrapper.find('[data-action="submit-objection"]').exists()).toBe(false);
});
```

- [ ] **Step 2: 运行结果异议测试并确认失败**

Run: `npm run test:unit -- --run src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts`

Expected: FAIL，当前页面没有论文选择、六维投影和异议表单。

- [ ] **Step 3: 实现论文选择和结果投影**

工作台以 `?thesisId=` 进入；一级导航进入时显示本人论文选择器。未发布时仅显示五阶段进度和最近公开事件；已发布时显示总分、六维评分、结论、公开评语、发布时间和匿名专家序号，不序列化真实专家信息。

- [ ] **Step 4: 实现异议表单、附件元数据和状态时间线**

理由和诉求均必填；附件使用 Task 3 相同的文件元数据规则，`purpose='OBJECTION'`。附件模拟失败时保留理由和诉求，只把该附件标记为“上传失败”，提供“重新选择附件”，未恢复前禁用最终提交。提交二次确认后创建 `SUBMITTED` 记录并生成通知。存在 `SUBMITTED` 或 `PROCESSING` 异议时隐藏新建表单，展示处理时间线；`RESOLVED` 后允许查看结论但不改变论文 `COMPLETED` 阶段。

- [ ] **Step 5: 运行结果、隐私和类型检查**

Run: `npm run test:unit -- --run src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/result/__tests__/resultPublication.spec.ts`

Run: `npm run type-check`

Expected: PASS；学生序列化结果不包含专家真实姓名、电话、邮箱和内部处理记录。

- [ ] **Step 6: 提交结果与异议闭环**

```bash
git add frontend/src/modules/result/components/StudentResultSelector.vue frontend/src/modules/result/components/StudentScoreDimensions.vue frontend/src/modules/result/components/StudentObjectionForm.vue frontend/src/modules/result/components/StudentObjectionTimeline.vue frontend/src/modules/result/pages/StudentResultPage.vue frontend/src/modules/result/__tests__/studentResultAndObjection.spec.ts frontend/src/modules/result/__tests__/resultPublication.spec.ts
git commit -m "feat: add student results and objection workflow"
```

### Task 6: 学生消息通知交互

**Files:**

- Create: `frontend/src/modules/shared/components/StudentNotificationList.vue`
- Create: `frontend/src/modules/shared/__tests__/studentNotifications.spec.ts`
- Create: `frontend/src/router/studentNotificationRoutes.ts`
- Create: `frontend/src/router/__tests__/studentNotificationRoutes.spec.ts`
- Create: `frontend/src/styles/__tests__/notificationContrast.spec.ts`
- Create: `frontend/src/components/app/StatusTag.vue`（既存学生工作台的直接构建前置依赖）
- Create: `frontend/src/modules/thesis/components/EligibilityCard.vue`（既存学生工作台的直接构建前置依赖）
- Modify: `frontend/src/modules/shared/pages/NotificationCenterPage.vue`
- Modify: `frontend/src/router/index.ts`

**Interfaces:**

- Consumes: Task 1 的 `listStudentNotifications()`、`markStudentNotificationRead()`、`markAllStudentNotificationsRead()`。
- Produces: 通知目标 `{ routeName, query: { thesisId } }`，只跳转到本人论文、结果或异议页面。

- [ ] **Step 1: 写消息已读和跳转失败测试**

```ts
it("marks a notification read and navigates to its thesis target", async () => {
  await wrapper
    .get(
      '[data-notification-id="notice-result"] [data-action="open-notification"]',
    )
    .trigger("click");
  await flushPromises();
  expect(
    (await service.listStudentNotifications()).find(
      (item) => item.id === "notice-result",
    )?.read,
  ).toBe(true);
  expect(router.currentRoute.value).toMatchObject({
    path: "/student/results",
    query: { thesisId: "thesis-main" },
  });
});
```

增加全部已读、空消息和非学生角色继续使用原页面投影的测试。

- [ ] **Step 2: 运行消息测试并确认失败**

Run: `npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts`

Expected: FAIL，当前通知由页面常量生成，按钮不改变服务状态也不导航。

- [ ] **Step 3: 实现学生通知列表和角色分支**

学生角色从服务加载通知，展示类型、标题、公开摘要、时间和已读状态；点击先标记已读再导航。其他角色保持现有演示内容，避免本轮扩展其业务范围。全部已读调用一次服务动作并同步未读计数。

- [ ] **Step 4: 运行消息及路由回归**

Run: `npm run test:unit -- --run src/modules/shared/__tests__/studentNotifications.spec.ts src/router/__tests__/studentNotificationRoutes.spec.ts src/styles/__tests__/notificationContrast.spec.ts`

Expected: PASS（3 个文件、18 个测试）；生产路由真实注册消息中心及两个学生目标，消息目标始终携带本人论文标识。

- [ ] **Step 5: 提交学生消息交互**

```bash
git add frontend/src/components/app/StatusTag.vue frontend/src/modules/thesis/components/EligibilityCard.vue frontend/src/modules/shared/components/StudentNotificationList.vue frontend/src/modules/shared/pages/NotificationCenterPage.vue frontend/src/modules/shared/__tests__/studentNotifications.spec.ts frontend/src/router/index.ts frontend/src/router/studentNotificationRoutes.ts frontend/src/router/__tests__/studentNotificationRoutes.spec.ts frontend/src/styles/__tests__/notificationContrast.spec.ts
git commit -m "fix: integrate student notification routes"
```

### Task 7: 演示场景控制器和环境隔离

**Files:**

- Create: `frontend/src/modules/thesis/components/StudentDemoScenarioController.vue`
- Create: `frontend/src/modules/thesis/__tests__/studentDemoScenario.spec.ts`
- Modify: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Modify: `frontend/src/modules/thesis/pages/ThesisEditPage.vue`
- Modify: `frontend/src/modules/result/pages/StudentResultPage.vue`
- Modify: `frontend/.env.example`
- Modify: `frontend/src/vite-env.d.ts`

**Interfaces:**

- Consumes: Task 1 的 `loadStudentScenario(preset)` 和 `resetStudentDemo()`。
- Produces: `StudentScenarioPreset = 'DRAFT' | 'RETURNED' | 'SCHOOL_REVIEW' | 'EXPERT_REVIEW' | 'RESULT_PROCESSING' | 'COMPLETED'`。

- [ ] **Step 1: 写环境门禁和一致快照失败测试**

```ts
it("does not render without explicit demo mode", () => {
  const wrapper = mount(StudentDemoScenarioController, {
    props: { enabled: false },
  });
  expect(wrapper.html()).toBe("<!--v-if-->");
});

it("loads a completed snapshot with result, timeline and notification", async () => {
  const wrapper = mount(StudentDemoScenarioController, {
    props: { enabled: true },
    global: { provide: { [studentPortalServiceKey as symbol]: service } },
  });
  await wrapper.get('[data-scenario="COMPLETED"]').trigger("click");
  await flushPromises();
  expect((await service.getStudentThesis("thesis-main")).stage).toBe(
    "COMPLETED",
  );
  expect(await service.getStudentResult("thesis-main")).not.toBeNull();
  expect(await service.listStudentNotifications()).toContainEqual(
    expect.objectContaining({ kind: "RESULT_PUBLISHED" }),
  );
});
```

- [ ] **Step 2: 运行场景控制器测试并确认失败**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentDemoScenario.spec.ts`

Expected: FAIL，控制器和场景快照接口尚不存在。

- [ ] **Step 3: 实现显式环境门禁和六个一致快照**

页面按 `const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'` 传入 `enabled`。控制器放在业务页面右下方独立浮动入口中，展开后标注“仅用于演示，不代表学生拥有该操作权限”。关闭演示模式时不渲染入口，服务也拒绝 `loadStudentScenario()`。

每个快照同时替换论文阶段、时间线、结果、撤回/异议和通知，不调用学生业务动作伪造跨角色权限。

- [ ] **Step 4: 实现资格、文件失败和重置辅助场景**

控制器附加选择“资格有效/暂停/过期”和“文件校验成功/失败”，以及“一键恢复默认数据”。重置需二次确认并清除 `baijie-demo-student:v1` 后重新装载固定 fixtures。

- [ ] **Step 5: 运行演示控制器和学生模块回归**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__ src/modules/result/__tests__/studentResultAndObjection.spec.ts src/modules/shared/__tests__/studentNotifications.spec.ts`

Run: `npm run type-check`

Expected: PASS；`enabled=false` 时 DOM 和可调用服务中都没有场景切换能力。

- [ ] **Step 6: 提交演示状态控制器**

```bash
git add frontend/src/modules/thesis/components/StudentDemoScenarioController.vue frontend/src/modules/thesis/pages/StudentDashboardPage.vue frontend/src/modules/thesis/pages/ThesisEditPage.vue frontend/src/modules/result/pages/StudentResultPage.vue frontend/src/modules/thesis/__tests__/studentDemoScenario.spec.ts frontend/.env.example frontend/src/vite-env.d.ts
git commit -m "feat: add isolated student demo scenarios"
```

### Task 8: 学生黄金路径、视觉验收和文档回写

**Files:**

- Create: `frontend/src/modules/thesis/__tests__/studentGoldenPath.spec.ts`
- Modify: `frontend/src/__tests__/App.spec.ts`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-002_学生论文工作台.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-003_论文编辑与上传.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-012_学生结果与异议.md`
- Modify: `docs/10_审查与决策/需求追踪矩阵.md`
- Modify: `docs/10_审查与决策/编码准入检查表.md`
- Modify: `docs/superpowers/plans/2026-08-11-student-interactive-workflow.md`

**Interfaces:**

- Consumes: Tasks 1—7 的学生服务和页面。
- Produces: 可重复执行的学生端验收证据；不改变其他角色完成状态。

- [ ] **Step 1: 写学生角色黄金路径测试**

```ts
it("persists the complete legal student path", async () => {
  const storage = createMemoryStorage();
  const service = createScenarioService({ storage, demoMode: true });
  await service.saveStudentDraft("thesis-main", completeDraft);
  await service.submitStudentThesis("thesis-main");
  expect(
    (await service.getStudentThesis("thesis-main")).studentVisibleStage,
  ).toBe("SCHOOL_REVIEW");

  await service.loadStudentScenario("COMPLETED");
  await service.submitStudentObjection("thesis-main", {
    reason: "对评价依据存在疑问",
    request: "申请学校复核处理",
    attachments: [],
  });

  const restored = createScenarioService({ storage, demoMode: true });
  expect((await restored.getStudentThesis("thesis-main")).stage).toBe(
    "COMPLETED",
  );
  expect(
    (await restored.getStudentResult("thesis-main"))?.objection?.status,
  ).toBe("SUBMITTED");
});
```

- [ ] **Step 2: 运行学生黄金路径和全量单元测试**

Run: `npm run test:unit -- --run src/modules/thesis/__tests__/studentGoldenPath.spec.ts`

Run: `npm run test:unit -- --run`

Expected: PASS；所有测试 0 failures，现有学校、运营和专家测试不得因学生服务改造而失败。

- [ ] **Step 3: 运行类型检查和生产构建**

Run: `npm run type-check`

Run: `VITE_DEMO_MODE=true npm run build`

Expected: 两个命令退出码 0；构建警告可记录，但不得有 TypeScript 错误或未处理构建错误。

- [ ] **Step 4: 浏览器检查桌面和移动端关键流程**

Run: `npm run dev -- --host 127.0.0.1`

在 1440×900、1920×1080 和 390×844 检查：登录学生、选择不同论文、打开详情、编辑材料、悬浮专业搜索、关键词达到 5 个、文件失败/重试、保存、提交、撤回、结果、异议、消息跳转、场景切换和重置。确认专业浮层不挤压布局，390px 无整页横向滚动，焦点与 Esc 行为正确。

- [ ] **Step 5: 回写正式文档的真实完成边界**

PAGE-002/003/012 文档补充已实现交互；需求追踪矩阵只标记学生前端演示证据。编码准入检查表注明真实 API、数据库、SSO、文件解析、通知发送仍未实现。不得把其他角色静态页面标记为交互闭环完成。

- [ ] **Step 6: 检查补丁与原始材料边界**

Run: `git diff --check`

Run: `git diff --name-only -- docs/99_原始材料`

Expected: 第一条无输出并退出 0；第二条无输出，证明未修改原始材料。

- [ ] **Step 7: 提交学生端验收与文档证据**

```bash
git add frontend/src/modules/thesis/__tests__/studentGoldenPath.spec.ts frontend/src/__tests__/App.spec.ts docs/02_产品设计/页面原型/页面原型_PAGE-002_学生论文工作台.md docs/02_产品设计/页面原型/页面原型_PAGE-003_论文编辑与上传.md docs/02_产品设计/页面原型/页面原型_PAGE-012_学生结果与异议.md docs/10_审查与决策/需求追踪矩阵.md docs/10_审查与决策/编码准入检查表.md docs/superpowers/plans/2026-08-11-student-interactive-workflow.md
git commit -m "test: verify interactive student workflow"
```
