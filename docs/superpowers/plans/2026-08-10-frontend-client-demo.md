# 甲方展示版前端与薄后端 Implementation Plan

> **执行约束：** 默认在当前任务中按 `superpowers:executing-plans` 逐项实施；只有用户明确要求并行代理时，才切换为 `superpowers:subagent-driven-development`。步骤使用复选框（`- [ ]`）跟踪。

**Goal:** 使用现有 Vue 3 技术栈完成可连续演示的论文盲审黄金闭环，并建立可复用到 PAGE-001—023 的设计系统、角色骨架和演示数据适配层。

**Architecture:** 前端采用“页面组件 → 领域演示服务接口 → 本地演示实现”的三层结构，页面不直接导入 fixtures；后续真实 API 只需替换服务实现。首轮后端仅落实正式 C0 健康检查、配置与统一响应，不编写临时业务接口、不接数据库。首轮演示范围为 PAGE-001—005、007—013，第二批再完成 PAGE-006、014—023。

**Tech Stack:** Vue 3.5、TypeScript 5.9、Vite 8、Vue Router 5、Pinia 3、Tailwind CSS 4、Element Plus 2、Axios、Vitest 4、Vue Test Utils；薄后端使用 Python 3.11+、FastAPI 0.139.2、Pydantic 2.13.4、Uvicorn 0.51.0、pytest 9.1.1、HTTPX 0.28.1。

## Global Constraints

- 真正写代码前必须收到用户精确口令“批准进入编码阶段”。
- 不新增前端依赖；现有依赖已经覆盖首轮展示需要。
- 所有行为变更按 Red → Green → Refactor 执行，先看见测试因缺少功能而失败。
- 页面不设置全局 `max-width`；列表、详情、PDF 评阅区使用完整可用视口。
- 学校侧不出现专家身份；专家侧不出现学生、导师或其他专家身份。
- 页面只根据服务端/演示服务返回的 `allowedActions` 渲染动作，不自行推断业务权限。
- 演示数据全部虚构，跨页面的学校、批次、论文、状态、时间和数量保持一致。
- 演示模式只能在 `VITE_DEMO_MODE=true` 下启用；生产构建不得默认启用。
- 首轮不创建数据库迁移、不实现真实 SSO、不实现文件上传到对象存储、不实现自动支付。
- 不修改 `docs/99_原始材料/`，不覆盖当前未提交的文档修改。

---

## 编码批次与验收点

| 批次 | 内容 | 页面 | 独立验收结果 |
|---|---|---|---|
| D0 | 基线、设计令牌、测试命令 | — | 构建与现有测试通过 |
| D1 | 通用组件、四类页面骨架、响应式导航 | 全局 | 可切换角色并看到正确骨架 |
| D2 | 演示数据服务、场景状态机、路由权限 | 全局 | 同一论文能跨角色连续推进 |
| D3 | 登录、学生提交 | PAGE-001—003 | 学生完成草稿、文件状态和提交 |
| D4 | 学校准备与送出 | PAGE-004—005 | 学校确认匿名版并确认送出 |
| D5 | 百杰派单 | PAGE-007 | 选择无回避专家并创建任务 |
| D6 | 专家接单与评阅 | PAGE-008—010 | 接受任务、保存草稿、最终提交 |
| D7 | 汇总、发布、结果查看 | PAGE-011—013 | 学校发布，学生/导师看到去标识结果 |
| D8 | 演示打磨与异常状态 | 黄金闭环 | 可按固定脚本稳定演示 |
| D9 | 薄后端 C0 | `/healthz`、`/readyz` | 正式 API 基础可运行，不承载演示业务 |
| D10 | 第二批支撑页面 | PAGE-006、014—023 | 23 页视觉与导航覆盖完整 |

---

### Task 1: 建立前端质量基线与视觉令牌（D0）

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/styles/theme.css`
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/__tests__/App.spec.ts`
- Create: `frontend/src/styles/element.css`

**Interfaces:**
- Produces: `test:unit:run`、全局视觉令牌、Element Plus 映射、无固定宽度的应用根容器。

- [ ] **Step 1: 先扩展 App 测试，要求根应用包含可访问主区域且不创建固定宽度容器**

```ts
it('renders the routed page inside the application main region', () => {
  const wrapper = mount(App, { global: { stubs: ['router-view'] } })
  expect(wrapper.get('main').attributes('id')).toBe('app-main')
  expect(wrapper.get('main').classes()).not.toContain('max-w-screen-xl')
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --dir frontend test:unit --run src/__tests__/App.spec.ts`
Expected: FAIL，因为当前 `App.vue` 没有 `main#app-main`。

- [ ] **Step 3: 实现最小根结构与视觉令牌**

`theme.css` 补齐 `--color-blind-rail: #5b6b7a`、`--color-paper: #fbfcfe`、页面背景、焦点环和中文字体栈；`main.css` 统一 `html/body/#app` 全高和完整视口；`element.css` 只做令牌映射，不覆盖业务组件内部结构。

- [ ] **Step 4: 增加稳定测试脚本并验证 GREEN**

`package.json` 新增 `"test:unit:run": "vitest run"`。运行：

```bash
pnpm --dir frontend test:unit:run
pnpm --dir frontend type-check
pnpm --dir frontend build
```

Expected: 全部退出码 0。

**执行记录（2026-08-11，Task 8 审查修复）：** 根容器以 `div#app-root` 落地于 `frontend/src/App.vue`（提交 9e6f437），与本计划早期约定的 `main#app-main` 不一致；该命名来自学生交互工作流计划 Task 8 的 App.spec 断言，且已由该计划回写。以提交内容为准，不再更改根容器命名。

### Task 2: 通用组件与四类页面骨架（D1）

**Files:**
- Create: `frontend/src/types/roles.ts`
- Create: `frontend/src/components/app/BrandMark.vue`
- Create: `frontend/src/components/app/BlindRail.vue`
- Create: `frontend/src/components/app/StatusTag.vue`
- Create: `frontend/src/components/app/WorkflowSteps.vue`
- Create: `frontend/src/components/app/PageHeader.vue`
- Create: `frontend/src/components/app/AppHeader.vue`
- Create: `frontend/src/components/app/AppSidebar.vue`
- Create: `frontend/src/layouts/AuthLayout.vue`
- Create: `frontend/src/layouts/AdminLayout.vue`
- Create: `frontend/src/layouts/PortalLayout.vue`
- Create: `frontend/src/layouts/ReviewWorkspaceLayout.vue`
- Create: `frontend/src/components/app/__tests__/StatusTag.spec.ts`
- Create: `frontend/src/layouts/__tests__/AdminLayout.spec.ts`

**Interfaces:**
- `RoleCode = 'system_admin' | 'school_reviewer' | 'platform_reviewer' | 'student' | 'supervisor' | 'expert'`。
- `StatusTag` consumes `{ status: string; overdue?: boolean; label?: string }`。
- `AdminLayout` consumes `{ variant: 'school' | 'platform' | 'system'; menuItems: NavigationItem[] }`。
- `BlindRail` consumes `{ audience: string; hiddenFrom: string; stage?: string }`。

- [ ] **Step 1: 为状态映射和逾期附加标签编写失败测试**

```ts
it('keeps IN_REVIEW as the main state and renders overdue as a warning attribute', () => {
  const wrapper = mount(StatusTag, { props: { status: 'IN_REVIEW', overdue: true } })
  expect(wrapper.text()).toContain('评阅中')
  expect(wrapper.text()).toContain('已逾期')
})
```

- [ ] **Step 2: 为后台骨架完整视口和菜单可访问性编写失败测试**

断言存在 `aside[aria-label="主导航"]`、`main` 和当前菜单 `aria-current="page"`，且主内容没有固定最大宽度类。

- [ ] **Step 3: 运行两个测试文件并确认 RED**

Run: `pnpm --dir frontend test:unit --run src/components/app/__tests__/StatusTag.spec.ts src/layouts/__tests__/AdminLayout.spec.ts`

- [ ] **Step 4: 实现组件与骨架**

设计签名只使用一次：关键业务页标题下方展示“双盲信息轨道”；其余区域保持克制。品牌标题使用系统中文衬线栈，正文与数据使用系统中文无衬线栈，不下载外部字体。

- [ ] **Step 5: 验证组件测试、类型和构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 3: 演示数据服务与场景状态机（D2）

**Files:**
- Create: `frontend/src/demo/types.ts`
- Create: `frontend/src/demo/fixtures.ts`
- Create: `frontend/src/demo/scenarioService.ts`
- Create: `frontend/src/demo/serviceProvider.ts`
- Create: `frontend/src/demo/__tests__/scenarioService.spec.ts`
- Create: `frontend/src/stores/demoScenario.ts`
- Modify: `frontend/.env.example`

**Interfaces:**
- `DemoRoleContext { role: RoleCode; displayName: string; tenantName?: string }`。
- `DemoThesis { id; anonymousId; title; stage; roundStatus?; taskProgress; allowedActions }`。
- `ScenarioService` produces `loginAs(role)`, `submitThesis()`, `confirmAnonymization()`, `confirmDispatch()`, `assignExperts()`, `acceptTask()`, `saveReviewDraft()`, `submitFinalReview()`, `publishResult()`, `reset()`。
- 所有命令返回新的不可变场景快照，不允许页面直接改 fixtures。

- [ ] **Step 1: 编写黄金闭环状态转换失败测试**

```ts
it('moves one thesis through the approved golden path without leaking identities', async () => {
  const service = createScenarioService()
  await service.submitThesis()
  await service.confirmAnonymization()
  await service.confirmDispatch()
  await service.assignExperts()
  const expertView = await service.loginAs('expert')
  expect(JSON.stringify(expertView)).not.toContain('林同学')
})
```

- [ ] **Step 2: 运行测试并确认因服务不存在而 RED**

Run: `pnpm --dir frontend test:unit --run src/demo/__tests__/scenarioService.spec.ts`

- [ ] **Step 3: 实现统一虚构场景**

固定演示对象：`海岳大学`、`2026 年春季硕士论文盲审`、匿名论文号 `HY-2026-0042`。学生名只进入学校/学生/导师投影；专家名只进入百杰/专家本人投影。

- [ ] **Step 4: 实现环境选择**

`serviceProvider.ts` 仅在 `import.meta.env.VITE_DEMO_MODE === 'true'` 返回演示服务；否则返回调用正式 API 的接口壳并明确抛出“真实服务尚未配置”，不得静默回落到假数据。

- [ ] **Step 5: 验证场景测试与全量测试**

Run: `pnpm --dir frontend test:unit:run`

### Task 4: 路由、菜单、角色切换与登录入口（D2/D3）

**Files:**
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/stores/auth.ts`
- Create: `frontend/src/router/routes.ts`
- Create: `frontend/src/router/menus.ts`
- Create: `frontend/src/router/__tests__/routes.spec.ts`
- Create: `frontend/src/components/app/DemoPersonaSwitch.vue`
- Create: `frontend/src/modules/auth/pages/LoginPage.vue`
- Create: `frontend/src/modules/auth/routes.ts`
- Create: `frontend/src/modules/auth/__tests__/LoginPage.spec.ts`

**Interfaces:**
- Route meta contains `{ roleCodes: RoleCode[]; layout: 'auth' | 'admin' | 'portal' | 'review'; pageId: string }`。
- Demo login calls `authStore.loginAsDemo(role)` and routes to the role default page。

- [ ] **Step 1: 编写路由覆盖和角色入口失败测试**

断言 PAGE-001—013 黄金闭环路由具有唯一 `pageId`，专家无法进入学校页面，学校无法进入专家评阅页面。

- [ ] **Step 2: 编写登录页角色演示入口失败测试并运行 RED**

Run: `pnpm --dir frontend test:unit --run src/router/__tests__/routes.spec.ts src/modules/auth/__tests__/LoginPage.spec.ts`

- [ ] **Step 3: 实现路由、菜单和演示角色切换**

登录页保留账号/密码与学校 SSO 的正式视觉，同时在演示模式显示“切换演示角色”面板；非演示模式不渲染该面板。

- [ ] **Step 4: 验证登录、路由和全量构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend build`

### Task 5: 学生提交闭环 PAGE-002—003（D3）

**Files:**
- Create: `frontend/src/modules/thesis/pages/StudentDashboardPage.vue`
- Create: `frontend/src/modules/thesis/pages/ThesisEditPage.vue`
- Create: `frontend/src/modules/thesis/components/EligibilityCard.vue`
- Create: `frontend/src/modules/thesis/components/ThesisStageRail.vue`
- Create: `frontend/src/modules/thesis/components/DemoFileUpload.vue`
- Create: `frontend/src/modules/thesis/routes.ts`
- Create: `frontend/src/modules/thesis/__tests__/studentSubmission.spec.ts`

**Interfaces:**
- 页面只调用 `ScenarioService.submitThesis()`；提交成功回学生工作台。
- `DemoFileUpload` 只模拟文件选择、进度、成功/失败状态，不创建真实对象存储行为。

- [ ] **Step 1: 编写学生从草稿提交后回工作台的失败测试**
- [ ] **Step 2: 运行单测确认 RED**
- [ ] **Step 3: 实现资格卡、论文列表、编辑表单、原始版/匿名版分区和二次确认**
- [ ] **Step 4: 验证学生页面测试、移动端 DOM 顺序和全量构建**

Run: `pnpm --dir frontend test:unit:run && pnpm --dir frontend type-check && pnpm --dir frontend build`

### Task 6: 学校材料审核与送出 PAGE-004—005（D4）

**Files:**
- Create: `frontend/src/modules/school/pages/PreparationListPage.vue`
- Create: `frontend/src/modules/school/pages/ReviewProgressPage.vue`
- Create: `frontend/src/modules/school/components/AnonymizationCheckPanel.vue`
- Create: `frontend/src/modules/school/components/TaskProgressSummary.vue`
- Create: `frontend/src/modules/school/routes.ts`
- Create: `frontend/src/modules/school/__tests__/schoolDispatch.spec.ts`

**Interfaces:**
- `FAIL` 不进入确认队列；`REVIEW_REQUIRED` 可人工确认或退回；`PASS` 仍需最终确认。
- 学校页面只显示任务数量/化名，不显示专家姓名。

- [ ] **Step 1: 编写匿名检测分流和专家身份不泄露的失败测试**
- [ ] **Step 2: 运行单测确认 RED**
- [ ] **Step 3: 实现准备列表、检查详情、确认送出和分层状态进度**
- [ ] **Step 4: 验证页面不包含专家 fixtures 字段并运行全量测试**

### Task 7: 百杰派单工作台 PAGE-007（D5）

**Files:**
- Create: `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue`
- Create: `frontend/src/modules/dispatch/components/CandidateExpertTable.vue`
- Create: `frontend/src/modules/dispatch/components/ConflictReason.vue`
- Create: `frontend/src/modules/dispatch/routes.ts`
- Create: `frontend/src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts`

**Interfaces:**
- 候选项包含 `conflictHit` 和 `conflictReason`；命中回避时禁选，不能强制绕过。
- 指派调用 `ScenarioService.assignExperts()`，成功后论文进入 `UNDER_REVIEW`。

- [ ] **Step 1: 编写回避命中不可勾选和重复指派不产生重复任务的失败测试**
- [ ] **Step 2: 运行单测确认 RED**
- [ ] **Step 3: 实现待派单表、候选表、回避说明和指派确认**
- [ ] **Step 4: 验证测试、类型和构建**

### Task 8: 专家接单与全视口评阅 PAGE-008—010（D6）

**Files:**
- Create: `frontend/src/modules/review/pages/ExpertTasksPage.vue`
- Create: `frontend/src/modules/review/pages/InvitationPage.vue`
- Create: `frontend/src/modules/review/pages/ReviewWorkspacePage.vue`
- Create: `frontend/src/modules/review/components/AnonymousDocumentPane.vue`
- Create: `frontend/src/modules/review/components/ReviewFormPane.vue`
- Create: `frontend/src/modules/review/components/WorkspaceSplitter.vue`
- Create: `frontend/src/modules/review/routes.ts`
- Create: `frontend/src/modules/review/__tests__/expertReview.spec.ts`

**Interfaces:**
- 接单前只能读取匿名概要；接受后才能进入评阅工作台。
- `IN_REVIEW + overdue=true` 仍可保存和提交，逾期不成为独立状态。
- PDF 区首轮使用本地虚构文档占位视图，不实现真实 PDF 下载授权。

- [ ] **Step 1: 编写接单前材料隔离、逾期附加标签和最终提交锁定测试**
- [ ] **Step 2: 运行单测确认 RED**
- [ ] **Step 3: 实现任务列表、邀请详情、可拖动双栏、动态评阅表和固定操作区**
- [ ] **Step 4: 验证桌面双栏、窄屏双 Tab、测试和构建**

### Task 9: 汇总发布与学生/导师查看 PAGE-011—013（D7）

**Files:**
- Create: `frontend/src/modules/result/pages/ResultProcessingPage.vue`
- Create: `frontend/src/modules/result/pages/StudentResultPage.vue`
- Create: `frontend/src/modules/result/pages/SupervisorResultPage.vue`
- Create: `frontend/src/modules/result/components/AnonymousResultTable.vue`
- Create: `frontend/src/modules/result/components/ResultSummaryPanel.vue`
- Create: `frontend/src/modules/result/routes.ts`
- Create: `frontend/src/modules/result/__tests__/resultPublication.spec.ts`

**Interfaces:**
- 未发布时学生/导师投影为空；发布后只显示匿名结果标识、分数和获准评语。
- 学校页面不出现专家身份，不提供直接创建补审任务按钮。

- [ ] **Step 1: 编写发布前不可见、发布后可见和专家身份不泄露的失败测试**
- [ ] **Step 2: 运行单测确认 RED**
- [ ] **Step 3: 实现汇总、冲突/补审进度、确认发布及两个查看端**
- [ ] **Step 4: 运行黄金闭环全量测试、类型检查和构建**

### Task 10: 演示脚本、异常状态与视觉验收（D8）

**Files:**
- Create: `frontend/src/demo/DemoControlPanel.vue`
- Create: `frontend/src/demo/__tests__/goldenPath.spec.ts`
- Create: `docs/09_项目管理/甲方演示脚本.md`
- Modify: `frontend/README.md`

**Interfaces:**
- 控制面板只在演示模式出现，提供角色切换、当前阶段和“重置演示数据”。
- 演示脚本固定页面顺序、点击动作、讲解重点、备用异常状态和预计时长。

- [ ] **Step 1: 编写从学生提交到学生查看结果的完整场景测试**
- [ ] **Step 2: 运行测试确认 RED**
- [ ] **Step 3: 实现控制面板、空/错/逾期/冲突状态和演示脚本**
- [ ] **Step 4: 启动本地站点并逐页截图检查桌面与移动视口**

Run: `pnpm --dir frontend dev --host 127.0.0.1`

- [ ] **Step 5: 完整验证**

```bash
pnpm --dir frontend test:unit:run
pnpm --dir frontend type-check
pnpm --dir frontend build
git diff --check
```

### Task 11: 正式薄后端 C0（D9）

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/response.py`
- Modify: `backend/app/core/exception_handlers.py`
- Modify: `backend/app/core/middleware.py`

**Interfaces:**
- `GET /healthz` 返回存活状态；`GET /readyz` 返回尚未配置依赖时的明确就绪状态。
- 统一响应为 `{ request_id, code, message, data }`。
- 不提供演示业务写接口，前端演示继续使用隔离的本地服务。

- [ ] **Step 1: 创建 `backend/pyproject.toml` 并锁定薄后端依赖**

运行时依赖固定为 FastAPI 0.139.2、Pydantic 2.13.4、Uvicorn 0.51.0；测试依赖固定为 pytest 9.1.1、HTTPX 0.28.1，Python 要求为 3.11+。如本机 Python 不满足要求，停止安装并记录环境阻塞，不改用其他版本。
- [ ] **Step 2: 编写 `/healthz` 与响应包装的失败测试**
- [ ] **Step 3: 运行 pytest 确认 RED**
- [ ] **Step 4: 实现最小 FastAPI 应用、request_id 中间件和统一响应**
- [ ] **Step 5: 运行后端测试并确认 GREEN**

Run: `cd backend && pytest -q`

### Task 12: 第二批页面视觉覆盖（D10）

**Files:**
- Create: `frontend/src/modules/expert/pages/ExpertLibraryPage.vue`（PAGE-006）
- Create: `frontend/src/modules/finance/pages/ExpertAccountPage.vue`（PAGE-014）
- Create: `frontend/src/modules/notice/pages/NotificationCenterPage.vue`（PAGE-015）
- Create: `frontend/src/modules/export/pages/ExportCenterPage.vue`（PAGE-016）
- Create: `frontend/src/modules/system/pages/TenantPermissionPage.vue`（PAGE-017）
- Create: `frontend/src/modules/audit/pages/AuditSearchPage.vue`（PAGE-018）
- Create: `frontend/src/modules/result/pages/ObjectionWorkbenchPage.vue`（PAGE-019）
- Create: `frontend/src/modules/review/pages/CorrectionApprovalPage.vue`（PAGE-020）
- Create: `frontend/src/modules/expert/pages/ExpertProfilePage.vue`（PAGE-021）
- Create: `frontend/src/modules/finance/pages/SettlementWorkbenchPage.vue`（PAGE-022）
- Create: `frontend/src/modules/school/pages/BatchRulesPage.vue`（PAGE-023）
- Create: `frontend/src/modules/expert/__tests__/expertLibrary.spec.ts`
- Create: `frontend/src/modules/finance/__tests__/expertAccount.spec.ts`
- Create: `frontend/src/modules/notice/__tests__/notificationCenter.spec.ts`
- Create: `frontend/src/modules/export/__tests__/exportCenter.spec.ts`
- Create: `frontend/src/modules/system/__tests__/tenantPermission.spec.ts`
- Create: `frontend/src/modules/audit/__tests__/auditSearch.spec.ts`
- Create: `frontend/src/modules/result/__tests__/objectionWorkbench.spec.ts`
- Create: `frontend/src/modules/review/__tests__/correctionApproval.spec.ts`
- Create: `frontend/src/modules/expert/__tests__/expertProfile.spec.ts`
- Create: `frontend/src/modules/finance/__tests__/settlementWorkbench.spec.ts`
- Create: `frontend/src/modules/school/__tests__/batchRules.spec.ts`

**Interfaces:**
- 每页复用 D1 组件和 D2 服务接口；不得在页面内新增第二套状态映射、颜色或角色判断。

- [ ] **Step 1: 按 PAGE-006、014—023 分别编写最小渲染与权限投影失败测试**
- [ ] **Step 2: 分模块实现页面，每完成一个模块运行对应测试**
- [ ] **Step 3: 确认 PAGE-001—023 路由和导航索引均唯一**
- [ ] **Step 4: 运行前后端完整验证并执行视觉检查**

---

## 第一轮编码实际修改范围

第一轮只执行 Task 1—10，目标是甲方可演示。Task 11 的薄后端在前端黄金闭环稳定后执行；Task 12 不阻塞第一次展示。

第一轮精确范围：修改 9 个现有前端文件，创建 63 个前端源码/测试文件和 1 份演示脚本文档，共创建 64 个文件。不修改数据库，不安装前端依赖，不触碰原始材料。

## 每批完成标准

1. 对应失败测试确实因功能缺失而失败；
2. 最小实现后对应测试通过；
3. `pnpm --dir frontend test:unit:run` 通过；
4. `pnpm --dir frontend type-check` 通过；
5. `pnpm --dir frontend build` 通过；
6. 桌面与移动关键页面完成截图检查；
7. 双盲投影和角色路由检查无泄露；
8. `git diff --check` 通过；
9. 页面/API/测试文档随实际变化同步；
10. 未经用户要求不提交、不推送、不创建 PR。
