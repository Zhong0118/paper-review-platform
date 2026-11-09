---
title: UI 重构 U4：U3 原型的真实接线计划
status: DRAFT
version: 0.1.0
last_updated: 2026-11-05
sources:
  - docs/superpowers/specs/2026-11-05-ui-redesign-u3-prototypes.md（U3，2026-11-05 用户验收）
  - docs/superpowers/specs/2026-11-04-ui-redesign-u2-plan.md（U2 的做法与验收口径，本文沿用）
  - docs/superpowers/specs/2026-11-04-ui-redesign-u0-function-map.md（深链接清单与能力矩阵）
related_documents:
  - frontend/src/prototypes/screens/（U3 原型）
---

# UI 重构 U4：U3 原型的真实接线计划

U3 的十个原型已于 2026-11-05 获用户验收，验收范围是信息顺序、操作流程和整体视觉。U4 把它们接到现有真实接口上，逐页替换旧页面。做法与 U2 相同：

- 只在真实模式替换路由（`VITE_DEMO_MODE === 'true' ? 旧页 : 新页`）；演示模式仍是旧页面，旧 spec 一行不改即通过。
- 每个切片按“规格 → 测试 → 实现”推进；旧页的接口调用、参数、幂等键与 409 处理原样沿用。只有布局确实要变时，才把旧逻辑搬进 composable，搬家前后相关旧 spec 不改一行即通过。
- 沿用现有路由与查询参数（U0 §1）。唯一新增的路由是 `/system/catalog`（§3 E10）。
- 不改后端、迁移和权限；不加前端门禁，按钮按 `allowed_actions` 出现。
- 新页面自己说明结果的请求带 `quiet`，失败文案走 `api/failure.ts`。

**前提：** U2-2～U2-6 与 U3 都还没有提交。U4 在它们之上继续写；建议先由用户确认是否把 U2、U3 分别做成本地提交，U4 各切片再各自独立提交，便于回看。未经用户要求不提交。

## 1. 现状盘点

| 原型 | 真实路由 | 旧页面（真实模式） | 旧页内的演示分支 | 覆盖旧页的 spec（条数） |
|---|---|---|---|---|
| P09 结果处理 | `/school/results?thesis=&correction=` | `result/pages/ResultProcessingPage.vue`＋`result/components/RealCorrectionPanel.vue`（school 模式） | 有（20 处） | `realResultPages`（9）、`realCorrections`（9，专家模式） |
| P11 异议 | `/school/objections?objection=` | `school/pages/ObjectionWorkbenchPage.vue` | 有（6） | `realDispatchObjections`（11，其中异议部分） |
| P12 批次与规则 | `/school/batch-rules` | `school/pages/BatchRulesPage.vue`＋`BatchCloseout`、`BatchDeadlines`、`BatchProgramPin` | 有（7） | `realBatchRules`（7）、`extensions`（3，含 `BatchDeadlines`） |
| P12 成员与资格 | `/school/members` | `school/pages/SchoolMembersPage.vue` | 无 | `realSchoolMembers`（6） |
| P12 学科与专业 | `/school/disciplines` | `school/pages/SchoolDisciplinesPage.vue`＋`ProgramCatalogImport` | 无 | `officialCatalogs`（3） |
| P12 检测词表 | `/school/sensitive-terms` | `school/pages/SensitiveTermsPage.vue` | 无 | `sensitiveLocations`（8，含词表页） |
| P13 专家库 | `/platform/experts` | `expert-management/pages/RealExpertLibraryPage.vue`（演示模式另有 `ExpertLibraryPage`） | 路由层已分 | `realExpertLibrary`（6）、`expertImport`（7） |
| P13 更正审批 | `/platform/corrections` | `expert-management/pages/CorrectionApprovalPage.vue`（真实模式渲染 `RealCorrectionPanel mode=platform`） | 有（8） | `correctionAndSettlement`（24）、`platformManagement`（2） |
| P14 学校管理＋官方目录 | `/system/tenants` | `system/pages/TenantPermissionsPage.vue`（目录导入在同一页） | 有（7） | `realTenantPermissions`（9） |

这些 spec 都直接挂载旧组件，不经路由，所以只切真实模式路由不会影响它们。

## 2. 共用准备（U4-0）

| 项 | 内容 | 影响 |
|---|---|---|
| 侧栏 | 新建 `router/workspaceNav.ts`：`workspaceNav(role, activePath, counts?, demoEnabled?)` 基于 `portalMenus` 给出分组侧栏。学校分“办理”“学校设置”两组（设置组为批次、成员、学科、词表四项），平台与系统管理各一组无标题。显示名按已验收原型：批次与规则、成员与资格、学科与专业、检测词表、派单台、更正审批；名称映射只在工作空间侧栏生效，`menusByRole` 的原名称不变（`routes.spec` 断言它）。计数只给调用方传入的项。U2 的 `SchoolPreparationPage`、`PlatformDispatchDesk` 改用它 | 已核对：U2 两页的 spec 不断言侧栏内容；改后仍须不改即过 |
| 系统管理员菜单 | `menusByRole.system_admin` 补“学校管理”（`/system/tenants`）。“官方基础目录”菜单项与 `/system/catalog` 路由在 U4-8 一起加，避免先出现落空的链接。新路由不设 `pageId`：`routes.spec` 断言恰好 27 个页面编号 | 旧 `PortalLayout` 在系统管理页也会显示这一项 |
| 清单｜对象两栏 | 新建 `components/workspace/MasterDetail.vue` 与 `components/workspace/useNarrow.ts`（行为同原型 kit 版）。U3 的共用样式以 `wsd-` 前缀并入 `styles/workspace.css`（`wsd-views`、`wsd-tlist`、`wsd-titem`、`wsd-obj`、`wsd-sec`、`wsd-banner`、`wsd-dtable`、`wsd-commit` 等），只作用于 `.ws` | 不用原型里的 `title`、`sec`、`banner` 等短类名：U2 页面已有同名私有类，全局化会串样式。已验收的原型保持原样，继续用 kit 里的副本（与 U1 kit 复制 `ConfirmDialog` 的做法一致） |
| 接口选项 | 给缺少 `options?: RequestOptions` 的函数补可选末尾参数：`startObjection`、`resolveObjection`、`updateBatch`、`saveDeadlines`、`pinPrograms`、`updateMember`、`saveDisciplineSettings`、`saveSensitiveTerms`、`updateExpert`、`reviewQualification`、`setServiceStatus`、`replaceConflicts`、`previewExpertImport`、`listCorrections`、`previewCatalogImport`、`applyCatalogImport`；`applyExpertImport`、`correctionCommand` 已有幂等键参数，再补可选 `options`，与键合并 | 已核对：断言这些函数调用参数的旧 spec（`extensions`、`realExpertLibrary`、`expertImport`、`realCorrections`、`realBatchRules`、`realSchoolMembers`、`sensitiveLocations`）都按旧参数个数断言，旧页不传新参数，断言不变 |

**U4-0 测试：** `workspaceNav`（学校分组与名称、当前项、计数只给传入项、平台与系统管理、演示模式参数）；`MasterDetail`（宽屏并排、窄屏未打开只见清单、打开后只见对象与返回、返回事件、宽屏未选中显示空态）；`useNarrow`（跟随 `matchMedia` 变化、卸载解除监听）；接口选项逐个转发到 `httpApi`（`quiet` 与幂等键同时生效）；`portalMenus('system_admin', false)`。

## 3. 原型与真实合同的差异（U4 以真实接口为准）

| # | 原型假设 | 真实接口 | U4 处理 |
|---|---|---|---|
| E1 | 每位学生一份送审资格 | 资格按批次建立：`listEligibilities(batchId)`、`createEligibility(batchId, {student_membership_id, supervisor_membership_id, degree_type})` | 成员详情的“送审资格”改为按批次列出（草稿与开放批次），每行可暂停/恢复；建立时先选批次。暂停只影响新建的口径不变 |
| E2 | 已发布行显示发布日期 | 接口不给发布日期，C-RESULT 规定不猜 | 只显示“已发布”，不显示日期 |
| E3 | 结果清单有现成的三种视图 | 清单来自 `listSchoolTheses(timeScope)` 经 `selectSchoolResultQueue` 过滤；“更正待确认”需另取 `listCorrections('school')`，按 `thesis_id` 匹配 `AWAITING_SCHOOL` | 两个请求并行；视图由两者合成，计数说明口径。发布按 `allowed_actions` 含 `PUBLISH_RESULT`；`publishThesis(version)` 409 时重读结果并提示 |
| E4 | 复核提示是中文标签 | `check_summary` 只有 `codes`／`counts` | 沿用现有 `components/app/ReviewCheckSummary.vue`（旧结果页已在用） |
| E5 | 更正审批显示专家、论文题目、学校 | 平台侧 `listCorrections('platform')` 只返回 `id`、`task_id`、`thesis_id`、`status`、`version`、`created_at`、`notes`；专家提交后还带 `revision` 内容 | 默认只显示接口已有字段：任务编号、申请时间、申请理由与处理记录（来自 `notes`）、状态。**不渲染 `revision`**（U0 §4：审批只看申请信息）。题目与专家姓名见 §5 待定 |
| E6 | 专家有“在途任务”数；回避关系直接存学校名 | `ExpertRecord` 没有在途数；回避为 `{kind: TENANT_ID|SUPERVISOR_NAME, value}`，学校名要用 `expertOptions().schools` 换算 | 去掉在途数；回避学校从 `expertOptions` 选择并显示名称 |
| E7 | “新建专家”只有按钮 | `createExpert({username, display_name, initial_password, unit, title, discipline_codes})`，密码至少 12 位 | 补新建表单（对象区新建态，同学校成员的新建写法）；密码提交后不回显 |
| E8 | 成员保存用版本号 | `updateMember` 带 `expected_updated_at` | 409 时重读该成员，列出两边差异；保留输入 |
| E9 | 学校管理员只有姓名、账号、密码 | `CreateReviewerInput` 还要 `external_id`（工号）；建校还要根组织 `external_id` | 表单补工号字段 |
| E10 | 官方基础目录是独立目的地 | 现在与学校管理在同一页 | 新增真实路由 `/system/catalog`（同为 `system_admin`，后端已授权，不扩权限）；`/system/tenants` 只留学校管理 |
| E11 | 异议对象带论文题目 | `ObjectionRow` 只有 `thesis_id`、`student_name`；旧页办结固定发 `OFFLINE` | 题目从 `listSchoolTheses` 结果关联，取不到显示“论文已不在当前范围”；渠道由用户选择（`ONLINE`/`OFFLINE`，接口已支持） |
| E12 | 开放学科按门类分组并有门类名称 | `getDisciplines()` 是平铺列表 | 按代码前两位分组；门类名称用国家学科门类表的固定常量（14 项），没有对应时只显示代码。另保留旧页的“全选/清空”，并沿用“清空并保存将停止开放新选项”的说明 |
| E13 | 词表行有 id | `SensitiveTerm` 没有 id | 编辑时在前端临时生成行 id，提交时去掉 |
| E14 | 收尾链接 | `CloseoutItem {id, thesis_id, title, status}` | 未发布 → `/school/results?thesis=`；异议 → `/school/objections?objection=`；更正 → `/school/results?thesis=&correction=`（与旧 `BatchCloseout` 相同） |
| E15 | 学校代码重复时给出已用该代码的学校 | 409 只说“学校代码已存在” | 用已加载的学校列表按代码查找；找不到时只提示换代码 |

## 4. 切片

| 顺序 | 切片 | 新页面（暂定） | 复用与搬家 | 新 spec 至少覆盖 |
|---|---|---|---|---|
| 0 | **U4-0 共用准备** | — | 见 §2 | `workspaceNav`；`MasterDetail` 宽窄屏切换 |
| 1 | U4-1 学校结果处理（P09） | `result/processing/SchoolResultsDesk.vue` | 发布与导出调用同旧页；`RealCorrectionPanel` 的 school 模式逻辑（确认/不予确认、对照、重读）搬进 `useSchoolCorrection`，旧面板改调 composable，`realCorrections` 与 `realResultPages` 不改即过 | 视图合成（E3）、发布确认与 409 重读、已发布只读、导出、更正确认与不予确认都要原因、`?thesis=&correction=` 深链 |
| 2 | U4-2 学校异议（P11） | `school/objections/SchoolObjectionsDesk.vue` | 列表、开始、办结调用同旧页 | 开始处理、办结表单必填、渠道选择、`?objection=` 深链、题目关联失败（E11） |
| 3 | U4-3 批次与规则（P12） | `school/settings/BatchSettingsPage.vue` | 期限、专业版本、收尾沿用接口；`BatchDeadlines`、`BatchProgramPin`、`BatchCloseout` 的逻辑能直接调用接口的就直接调用，旧组件保留给演示页 | 生命周期按 `allowed_actions`、409 保留编辑、期限只在草稿/开放可改、收尾链接（E14）、只读规则 |
| 4 | U4-4 成员与资格（P12） | `school/settings/MemberSettingsPage.vue` | 调用同旧页 | 新建、编辑 409（E8）、停用确认、重置密码不回显、按批次的资格（E1） |
| 5 | U4-5 学科与专业、检测词表（P12） | `school/settings/DisciplineSettingsPage.vue`、`TermSettingsPage.vue` | 校内专业导入沿用 `previewPrograms`/`publishPrograms` 的指纹流程 | 未设置口径、开放学科 409、预览≠写入、有错误不能发布、词表整表保存与 409 |
| 6 | U4-6 专家库（P13） | `expert-management/library/ExpertLibraryDesk.vue` | 列表、档案、资格、服务、回避、导入调用同 `RealExpertLibraryPage` | 三个分区各自要原因、回避学校名称（E6）、新建专家（E7）、导入预览有错/过期整批不写 |
| 7 | U4-7 更正审批（P13） | `expert-management/corrections/CorrectionApprovalDesk.vue` | `RealCorrectionPanel` 的 platform 模式决定逻辑搬进 `usePlatformCorrection` | 只显示申请信息、不渲染 `revision`（E5）、批准/驳回都要原因、409 读回 |
| 8 | U4-8 系统管理（P14） | `system/tenants/TenantDesk.vue`、`system/catalog/OfficialCatalogPage.vue` | 学校、学校管理员、目录导入调用同 `TenantPermissionsPage` | 新增学校（官方院校检索、代码重复 E15）、暂停确认、管理员工号（E9）、`/system/catalog` 路由（不设 pageId）与“官方基础目录”菜单（E10）、指纹过期只能重新预览 |

顺序理由：U4-1、U4-2 是学校办理主链的收尾，收尾链接（U4-3）要落到它们上；P13、P14 互不依赖，放在后面。每个切片验收通过后再开始下一个；旧组件在 U4 全部验收后另开清理切片统一删除。

## 5. 待定

| 编号 | 问题 | 默认做法（用户不另定时） |
|---|---|---|
| Q1 | 更正审批是否显示论文题目与专家姓名（E5） | 只显示接口已有字段。若要显示，可选：在前端用派单清单按 `thesis_id`/`task_id` 关联（平台本来可见），或请后端在投影里加字段 |
| Q2 | U2、U3 是否先做本地提交 | 等用户决定；未要求不提交 |
| Q3 | P07 专家任务、`/school/progress`、登录页 | 不在 U4；没有原型，保留旧页面 |
| — | U3 §6 留下的后端核对项（换专业版本对已建论文、目录变更对学校设置、词表改后报告是否重算） | 在对应切片的规格步骤里先读后端确认，再定文案；确认不了就不写这类承诺 |
| RISK-01／UX-01 | 同 U2 | 不变：不加门禁，不发 `null` 分数 |

## 6. 验收（每个切片）

- 1440×900、1366×768、390×844 三种尺寸；只用键盘可完成主流程；
- `vue-tsc --build` 通过；`vitest run` 在 `VITE_DEMO_MODE=true` 与不设两种情况下各跑一次，均无失败；
- 生产构建不含原型；
- 在 U2 §2 的隔离环境（5433 / `paper_review_test`）里用真实浏览器走一遍该切片的主流程；截图与文档里不出现凭据、令牌或真实论文。

## 7. 不做

不改后端、迁移与权限；不迁移演示专用入口；不补 RLS（另有延期记录，上生产前必须补）；不推送，不部署，不改 main。

## 8. U4-1 施工细则：学校结果处理（P09）

**文件**（`modules/result/processing/`）：`SchoolResultsDesk.vue`（外壳、清单、视图、深链）、`ResultObject.vue`（对象区：结果、发布、导出）、`CorrectionSection.vue`（更正待确认分区）、`useSchoolCorrection.ts`（确认/不予确认命令）、`resultView.ts`（纯函数：视图归类、结果解读、对照行）。真实模式 `/school/results` 指向 `SchoolResultsDesk`；demo 模式仍用旧 `ResultProcessingPage`。

**与 §4 的一处改动：** 旧 `RealCorrectionPanel` 不改。它同时服务专家（含草稿保存与版本对照）和平台两种模式，抽 composable 要动已修好的保存逻辑；本切片只新写学校用的命令 composable（幂等键按命令内容复用、409 重读、卸载后不回写），旧面板与 `realCorrections`、`realResultPages` 原样保留并通过。旧面板的 school 模式在真实路由下不再出现。

**数据**
- 清单：`listSchoolTheses(timeScope)` 经 `selectSchoolResultQueue`；同时 `listCorrections('school', { quiet: true })`。更正清单失败不挡论文清单：清单头说明“更正记录没有加载出来”，“更正待确认”视图不给计数。
- 视图：有 `AWAITING_SCHOOL` 更正的论文 → 更正待确认；否则 `RESULT_PROCESSING` → 待发布；`COMPLETED` → 已发布；全部。计数只数已加载集合并写明口径。侧栏“结果处理”计数 = 待发布 + 更正待确认（任一请求失败或加载中不显示）。
- 地址：`?view=`、`?thesis=`、`?correction=`。`thesis` 不在已加载集合时单独读取 `getSchoolThesis`（quiet），属于结果阶段则补进清单并注明“不在当前时间范围”；读不到或不在结果阶段 → 对象区说明“这篇论文不在本校可处理的结果中”。
- 对象：`getSchoolResults(id)`，`summary_total` 当 `total` 交给 U2-6 的 `readPublished` 解读（发布快照 v1/v2 规则一致）；`items` 为空 → “尚未收到有效评阅意见”；无法解读 → 接口错误，不显示部分内容。复核提示用 `ReviewCheckSummary`（按条目顺序取 `check_summary`）。不显示发布日期（E2）。

**动作**
- 发布：只有 `allowed_actions` 含 `PUBLISH_RESULT` 时出现底部提交条与“发布结果”；确认框列出将公开的内容。`publishThesis(id, version, { idempotencyKey, quiet })`，同一次确认重试复用键。409 → 重读论文清单与结果，红色横幅“没有发布：评阅结果在你打开之后有变化”；其它失败在确认框内说明，可重试。成功 → 重读，提示“已发布”，切到“已发布”视图并保持选中。
- 导出：已发布时“导出评阅书”（`downloadPublishedReview`），失败就地说明。
- 更正：对象区分区显示申请理由（`EXPERT_REQUEST`）、平台意见（`PLATFORM_DECISION`）、原生效版本与待确认更正逐项对照（总分在首行，变化项标出），以及更正的复核提示。“确认更正”“不予确认”各自打开确认框，原因必填；`correctionCommand('activate'|'reject', id, { version, reason }, key, { quiet: true })`。409 → 重读并提示核对；成功 → 重读，提示结果。缺少对照内容时不能确认，仍可不予确认。深链指向的更正已处理时，只说明其当前状态。
- 学校只看到别名；更正不显示专家身份，也不猜别名。

**测试**（`modules/result/processing/__tests__/`）：`resultView.spec`（视图归类、`readSchoolResult`、对照行）；`schoolResultsDesk.spec`（视图与计数口径、更正清单失败降级、深链补读与越界说明、未就绪、发布成功/409/无权限不出按钮、导出失败、确认与不予确认要原因、409 重读、窄屏返回）。

**U4-1 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 92 个文件、720 项通过（新增 `resultView.spec` 5 项、`schoolResultsDesk.spec` 14 项）；生产构建通过。旧 `ResultProcessingPage`、`RealCorrectionPanel` 及其 spec 未改。另给 `getSchoolResults`、`getSchoolThesis`、`downloadPublishedReview` 补了可选 `options`（同 U4-0 写法，不传时实参不变）。浏览器走查未做：走查后端的登录口令读取被拒，需用户在 5196 登录后再看。

## 9. U4-2 施工细则：学校异议处理（P11）

**文件**（`modules/school/objections/`）：`SchoolObjectionsDesk.vue`（外壳、清单、视图、深链）、`ObjectionObject.vue`（对象区：学生原文、开始处理、办结表单与确认）。真实模式 `/school/objections` 指向它；demo 模式仍用旧 `ObjectionWorkbenchPage`（`realDispatchObjections` 不改即过）。

**已核对的后端事实：** `listSchoolObjections` 不分时间范围，按登记时间倒序；开始处理只允许 `SUBMITTED`；办结允许 `SUBMITTED`/`PROCESSING`，渠道只收 `ONLINE`/`OFFLINE`，结论必填。两个命令都没有版本号与幂等键：状态不符时 409。

**数据**
- 清单：`listSchoolObjections({ quiet })`；同时 `listSchoolTheses(undefined, undefined, { quiet })`（不带时间范围，即全部）只用来取题目与学号（E11）。论文请求失败不挡异议清单，题目处写“论文题目没有加载出来”；找不到对应论文写“论文已不在当前范围”。学生姓名优先用异议行的 `student_name`。
- 视图：待处理（`SUBMITTED`）、处理中（`PROCESSING`）、已办结（`RESOLVED`）；计数为已加载的全部异议。侧栏“异议处理”计数 = 待处理 + 处理中。
- 地址：`?view=`、`?objection=`（收尾清单深链，E14）。深链的异议不在清单里 → 对象区说明“这条异议不在本校的异议记录中”。
- 对象区“查看已发布结果”链到 `/school/results?view=published&thesis=`（只在找到论文时出现）。

**动作**
- 开始处理：只在待处理时出现。成功后切到“处理中”并保持选中。
- 办结：只在处理中时出现（原型已验收：先开始处理再办结）。渠道与结论都必填，未填时就地标出；确认框原样引用结论。失败时确认框内说明，输入保留。
- 409：重读清单。重读后已是目标状态（开始处理 → 处理中；办结 → 已办结且结论与本次一致）时按成功说明，避免网络重试造成的误报；否则红色横幅说明状态已变化，请核对。
- 学生原文、结论均按纯文本显示。

**测试**（`modules/school/objections/__tests__/schoolObjectionsDesk.spec.ts`）：视图与计数、题目关联与两种降级、深链与越界、开始处理、办结必填与确认、办结 409 的两种结果、开始处理 409、清单失败重试、窄屏返回。

**U4-2 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 93 个文件、732 项通过（新增 `schoolObjectionsDesk.spec` 11 项，`requestOptions.spec` 补 1 项）；生产构建通过。旧 `ObjectionWorkbenchPage` 与 `realDispatchObjections.spec` 未改。`listSchoolTheses` 补可选第三参数 `options`、`listSchoolObjections` 补可选 `options`（不传时实参不变）。浏览器走查未做，原因同 U4-1。

## 10. U4-3 施工细则：批次与规则（P12）

**文件**（`modules/school/settings/`）：`BatchSettingsPage.vue`（外壳、清单、深链）、`BatchObject.vue`（对象区）、`BatchCreate.vue`（新建态）、`batchForm.ts`（纯函数：表单与服务端值互转、差异、校验）。真实模式 `/school/batch-rules` 指向它；demo 模式仍用旧 `BatchRulesPage`。旧 `BatchDeadlines`、`BatchProgramPin`、`BatchCloseout` 不改，新页直接调用接口。

**已核对的后端事实（与原型不同处以此为准）**
- `allowed_actions`：草稿 `EDIT`、`OPEN`；开放 `CLOSE_SUBMISSIONS`；截止收件 `ARCHIVE`（本批还有未完成或未终止的论文时服务端不给）；归档无。**开放后名称与起止时间不可改**（原型写成开放也可编辑，改为只读）。
- 名称、起止时间：`updateBatch`（草稿，带 `expected_version`，开始须早于结束）。期限：`saveDeadlines`（草稿或开放，1–32767 的整数或留空）。两者各自让 `version` 加一，返回新批次。
- 校内专业目录：`pinPrograms` 只能绑定一次（草稿或开放、尚未绑定），不能更换或解绑，返回空对象。原型里“未固定（使用最新发布版本）”的选项与后端不符：未绑定时沿用官方目录。
- 新建：`createBatch` 需幂等键；代码重复 409“批次代码已存在”；起止时间可空。
- 接口不给每批论文数，对象区不显示论文计数；收尾核对 `getBatchCloseout` 给出三组事项。

**界面**
- 清单按状态排序（开放、草稿、截止收件、已归档），每行名称、代码、起止、状态。地址：`?batch=`、`?new=1`。宽屏默认选第一项，窄屏先清单。
- 对象区：头部状态与生命周期按钮（按 `allowed_actions`，各自确认框，幂等键在同一次确认重试时复用）；基本信息（草稿可编辑）；期限（草稿/开放可编辑）；校内专业目录（已绑定显示版本；可绑定时选择版本并确认“绑定后本批不再更换”；没有已发布版本时说明去“学科与专业”）；收尾核对（非草稿；链接同 E14）；评审规则只读侧栏（`getSchoolReviewRule`）。
- 保存：底部提交条一次保存基本信息与期限中有改动的部分，先基本信息后期限，第二步用第一步返回的版本。有未保存改动时生命周期按钮不可用。
- 409：重读批次，保留表单，列出“你的修改／服务端当前值”的字段对照；“用我的修改覆盖”按新版本重提，“放弃我的修改”载入服务端值。若批次已不可编辑，只能放弃。第一步成功、第二步失败时说明哪部分已保存。
- 生命周期 409：重读并提示状态已变化。

**测试**（`modules/school/settings/__tests__/`）：`batchForm.spec`（互转、差异、校验）；`batchSettings.spec`（清单排序与深链、按 `allowed_actions` 出按钮、开放后基本信息只读、两步保存与版本递交、409 对照与两种处理、生命周期确认与幂等键、绑定目录确认、收尾链接、新建校验与重复代码、窄屏）。

**U4-3 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 95 个文件、751 项通过（新增 `batchForm.spec` 5 项、`batchSettings.spec` 14 项）；生产构建通过。旧 `BatchRulesPage`、`BatchDeadlines`、`BatchProgramPin`、`BatchCloseout` 及 `realBatchRules`、`extensions` 未改。`listBatches`、`getSchoolReviewRule`、`getBatchCloseout`、`listProgramVersions` 补可选 `options`（不传时实参不变）。浏览器走查未做，原因同 U4-1。

## 11. U4-4 施工细则：成员与资格（P12）

**文件**（`modules/school/settings/`）：`MemberSettingsPage.vue`（外壳、清单、搜索、深链）、`MemberObject.vue`（对象区）、`MemberCreate.vue`（新建态）、`memberView.ts`（纯函数）。真实模式 `/school/members` 指向它；旧 `SchoolMembersPage` 与 `realSchoolMembers` 不改。

**已核对的后端事实（与原型不同处以此为准）**
- 新建成员：账号 3–64 位，只能是小写字母、数字和 `. _ -`（服务端转小写）；姓名 1–128；学号/工号 1–64；初始密码 12–128；需幂等键；重复 409“学校代码或成员信息已存在”。
- 编辑：姓名、电话（≤32）、邮箱（≤128），带 `expected_updated_at`；不一致 409。
- 停用/启用/重置密码：需幂等键；状态不符 409。停用会让本人所有会话失效。
- 资格（E1）：按批次建立，`createEligibility(batchId, {student_membership_id, supervisor_membership_id?, degree_type?})`。批次须为草稿或开放；导师与学位类型都可空（学位类型是 ≤32 的自由文本，种子数据如“工学硕士”）。原型把两项写成必选并给固定选项，改为与后端一致。409 的原因有：本批已有资格、学生已在其他开放批次、学生或导师账号不可用、批次不可建立资格——原样显示服务端说明。暂停/恢复需幂等键，状态不符 409。

**界面**
- 清单视图：学生、导师、全部，计数为已加载成员；搜索按姓名、学号/工号、账号，在已加载范围内。地址：`?view=`、`?q=`、`?member=`、`?new=1`。学生行标“已停用”“无资格”（草稿/开放批次里没有资格）“资格暂停”（有资格但都已暂停）。
- 对象区：头部状态与类型、学号/工号、账号；送审资格（仅学生）按批次列出，草稿/开放批次的资格可暂停（确认）/恢复，往期批次只读；为草稿/开放且尚无资格的批次建立资格；账号与联系方式表单；账号安全（重置密码对话框两次输入，停用确认，启用直接执行）。
- 编辑 409（E8）：重读成员，保留输入，列出“你的修改／服务端当前值”；“用我的修改覆盖”按新的 `updated_at` 重提，“放弃我的修改”载入服务端值。
- 命令 409：重读；已是目标状态按成功说明，否则提示状态已变化。成员重读后不在 → 对象区“这个成员已不在本校”。
- 密码只在输入框中，提交成功或关闭对话框即清空，不回显、不写入地址或提示。
- 资格清单读取失败只影响资格分区。

**测试**（`modules/school/settings/__tests__/`）：`memberView.spec`（资格状态、联系方式差异、新建校验、密码校验）；`memberSettings.spec`（视图与搜索、行标、按批次的资格与建立、暂停确认与恢复、编辑 409 两种处理、重置密码清空与不回显、停用确认、命令 409、新建校验与重复、成员已不在、资格读取失败降级、窄屏）。

**U4-4 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 97 个文件、770 项通过（新增 `memberView.spec` 5 项、`memberSettings.spec` 14 项）；生产构建通过。旧 `SchoolMembersPage` 与 `modules/school/__tests__` 未改。所用接口的可选 `options` 已在 U4-0 补齐，本刀未再改 `src/api`。重置密码的幂等键随输入变化换新，不由密码派生；网络或服务错误时保留键，重试同一操作。浏览器走查未做，原因同 U4-1。

## 12. U4-5 施工细则：学科与专业、检测词表（P12）

**文件**（`modules/school/settings/`）：`DisciplineSettingsPage.vue`（外壳、分区切换）、`OpenDisciplines.vue`（开放学科）、`ProgramImport.vue`（校内专业对照）、`disciplineView.ts`；`TermSettingsPage.vue`、`termsView.ts`。真实模式 `/school/disciplines`、`/school/sensitive-terms` 指向新页；旧 `SchoolDisciplinesPage`、`ProgramCatalogImport`、`SensitiveTermsPage` 不改。

**已核对的后端事实（与原型不同处以此为准）**
- 学科目录 `getDisciplines()` 每项带 `category_code`、`category_name`（14 个门类），分组直接用它；缺省时按代码前两位，名称取固定门类表，再没有就只显示代码（E12）。
- `getDisciplineSettings()` 未设置时 `configured=false、codes=[]、version=0`，此时学生可选全部启用学科。保存 `saveDisciplineSettings(codes, expected_version)`：版本不一致 409“配置已变化”；代码不在启用目录 422。已保存但目录已停用的代码（历史项）原样列出，可移除。
- 校内专业：`previewPrograms` 返回 `revision`、`retained`、`errors`、`changes[{code, action: 新增|变更|未变, before, after}]`、`fingerprint`（有错误时为 null）。`publishPrograms(body, fingerprint)` 重新核对，指纹不符 409“请重新预览”。表头固定“校内代码,校内名称,官方代码,状态”，CSV ≤512 KB、UTF-8。**发布新版本不会更换已绑定的批次**（批次只能绑定一次），原型“之后新建论文的学生会看到新目录”改为此说明。
- 词表：整表 `saveSensitiveTerms({expected_version, terms})`，版本不一致 409“词表已变化”；每词去首尾空白后 2–64 字、无控制字符、不重复，最多 200 条，说明 ≤255。检测报告记录词表版本，**改词表后已有报告过期**，待核验论文需要重新检测。严重程度显示“警告／阻断”（与核验台一致）。

**界面**
- 学科与专业：分区“开放学科｜校内专业对照”，地址 `?tab=programs`。
  - 开放学科：未设置时说明“现在开放全部 N 个学科”，勾选初始为全部，保存按钮可用（保存即生效）。按门类分组，每组显示已选/总数；搜索只过滤显示；全选、清空沿用旧页。底部保存条列出未保存的新增与取消。保存空集合先确认（学生将无学科可选）。
  - 409：重读设置，保留勾选，列出对方的改动；“在对方的结果上保留我的勾选”把我的新增与取消套到对方结果上（不自动保存），“放弃我的修改”载入对方结果。
  - 校内专业对照：已发布版本表（年度、版次、条目数、来源版本、发布日期）；导入表单（年度、校方出处、来源版本、CSV 文件）。任一项改动即作废预览。预览标“预览未写入”，统计新增、变更、未变、保留、错误；有错误时列出并禁用发布。发布先确认；409 或 422 时作废预览并提示重新预览。
- 检测词表：可编辑表（词语、严重程度、说明、删除），行 id 只在前端（E13）。保存条显示未保存的处数；保存前逐行校验（空、长度、控制字符、重复）。409：重读，保留表格，列出对方的新增、删除与修改；“在第 N 版上保留我的修改”按词语把我的增删改套到对方版本上（不自动保存），“放弃我的修改”载入对方版本。

**测试**：`disciplineView.spec`（分组与门类名、勾选差异、冲突合并）；`termsView.spec`（行校验、改动计数、对方差异、冲突合并）；`disciplineSettings.spec`（未设置口径、分组计数、保存与空集合确认、409 两种处理、422 原样提示、历史项、加载失败重试；预览≠写入、字段改动作废预览、有错误不能发布、发布确认与刷新版本、指纹 409）；`termSettings.spec`（加载与空态、增删改计数、校验阻止提交、整表保存参数、409 两种处理、上限 200）。

**U4-5 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 101 个文件、797 项通过（新增 `disciplineView.spec` 4 项、`termsView.spec` 4 项、`disciplineSettings.spec` 12 项、`termSettings.spec` 6 项，`requestOptions.spec` 补 1 项）；生产构建通过。旧 `SchoolDisciplinesPage`、`ProgramCatalogImport`、`SensitiveTermsPage` 及 `officialCatalogs`、`sensitiveLocations` 未改。`getDisciplines`、`getDisciplineSettings`、`getSensitiveTerms`、`previewPrograms`、`publishPrograms` 补可选 `options`（不传时实参不变）。浏览器走查未做，原因同 U4-1。

## 13. U4-6 施工细则：专家库（P13）

**文件**（`modules/expert-management/library/`）：`ExpertLibraryDesk.vue`（外壳、清单、筛选、深链）、`ExpertObject.vue`（对象区）、`ExpertCreate.vue`（新建态）、`ExpertImportPane.vue`（导入态）、`expertView.ts`（纯函数）。真实模式 `/platform/experts` 指向它；旧 `RealExpertLibraryPage`、`ExpertImportDialog` 与演示页不改。

**已核对的后端事实（与原型不同处以此为准）**
- 一个 `version` 管档案、资格、服务状态、回避四类修改；任何一类成功都会让其他三类的旧版本 409“数据已变更”。不存在 404。
- 资格 `reviewQualification({version, status, reason})`、服务 `setServiceStatus({version, status, reason})`：理由去空白后 1–500 字必填；后端不校验当前状态。
- 回避 `replaceConflicts({version, items})` 整组替换，最多 100 项；学校用 `expertOptions().schools` 的 id，导师姓名 1–128 字（E6）。
- 档案 `updateExpert`：单位、职称 ≤128；学科 1–20 项且须在启用目录；省份须选自 `expertOptions().provinces` 或为空；研究方向、关键词各 ≤20 项、每项 2–64 字；来源链接只收 http/https；来源说明 ≤1000。档案字段有变化时后端更新“最近人工维护”时间。
- 新建 `createExpert`（E7）：登录名 3–64 位小写字母、数字和 `. _ -`，姓名 1–128，初始密码 12–128，学科至少 1 项；需幂等键；重名 409“登录名已存在”。新专家资格为“待审核”。
- 导入只更新已有专家档案（按登录名精确匹配），不建账号、不动资格/服务/回避；CSV ≤1 MiB、≤500 行；预览 10 分钟有效；有错误、过期或期间档案/资格变化时应用 409，整批不写；应用需幂等键。
- 列表接口的筛选是整标签精确匹配；新页一次取全部专家，在已加载范围内搜索与筛选。专家没有在途任务数（E6），不显示。

**界面**
- 清单视图：可指派（资格通过、可接单、账号正常）、待审核、不可派（其余）、全部，计数为已加载专家。搜索姓名、登录名、单位、研究方向、关键词；按学科筛选。地址：`?view=`、`?q=`、`?discipline=`、`?expert=`、`?new=1`、`?import=1`。行标：待审核、资格未通过、暂停接单、账号停用。
- 对象区：头部逐条说明能否指派（资格、服务、账号分开说，不合成一个“不可用”）与回避项数；三个分区“资格审核｜服务状态｜回避关系”。资格与服务的每次变更走确认框并要求理由；回避的添加与移除立即整组保存。档案表单在下方，标注“人工维护，未核验”与最近维护时间。
- 档案 409：重读，保留输入，列出“你的修改／当前值”；“用我的修改覆盖”按新版本重提，“放弃我的修改”载入当前值。若对方改的是资格、服务或回避，说明档案字段无冲突，可直接按新版本保存。
- 命令 409：重读；已是目标状态按成功说明，否则提示已变化。回避 409：重读后提示重新操作。
- 新建：对象区新建态，密码两次输入，提交成功即清空；成功后选中新专家（待审核视图）。
- 导入：对象区导入态；下载模板、选择文件（>1 MiB 不发送）、生成预览（标“预览未写入”与有效期）、错误逐行列出且不能应用、过期后只能重新预览、应用 409/404 作废预览、其他失败保留预览并可再次确认（同一把幂等键）。

**测试**（`modules/expert-management/library/__tests__/`）：`expertView.spec`（分组、行标、可指派说明、标签拆分、档案差异与校验）；`expertLibraryDesk.spec`（视图与搜索、学科筛选、深链与不在、资格与服务要理由并带版本、命令 409 两种结果、回避学校名称与增删、档案保存与 409 两种处理、新建校验与重名、导入预览/错误/过期/应用/409、窄屏）。

**U4-6 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 103 个文件、816 项通过（新增 `expertView.spec` 4 项、`expertLibraryDesk.spec` 14 项，`requestOptions.spec` 补 1 项）；生产构建通过。旧 `RealExpertLibraryPage`、`ExpertImportDialog`、演示页 `ExpertLibraryPage` 及 `realExpertLibrary`、`expertImport` 未改。`listExperts` 补可选第二参数 `options`、`expertOptions` 补可选 `options`（不传时实参不变）。本机负载较高（load average 约 30）时默认并发会让几个与本刀无关的旧 spec 超时；用 `--maxWorkers=4` 重跑两种模式全部通过。浏览器走查未做，原因同 U4-1。

## 14. U4-7 施工细则：更正审批（P13）

**文件**（`modules/expert-management/corrections/`）：`CorrectionApprovalDesk.vue`（外壳、清单、对象区）、`usePlatformCorrection.ts`（批准／驳回命令）、`correctionView.ts`（纯函数）。真实模式 `/platform/corrections` 指向它；旧 `CorrectionApprovalPage`、`RealCorrectionPanel` 及其 spec 不改（与 U4-1 一致：新 composable 独立，旧面板保持原样）。

**已核对的后端事实**
- `listCorrections('platform')` 返回全部更正，按申请时间倒序：`id`、`task_id`、`thesis_id`、`status`、`version`、`created_at`、`notes[{kind, reason}]`，专家提交后另有 `revision`。处理记录的 `kind` 只有 `EXPERT_REQUEST`（专家申请理由）、`PLATFORM_DECISION`（平台审批说明）、`SCHOOL_DECISION`（学校确认说明）；取消不留记录。
- `correctionCommand('decide', id, {version, decision: APPROVE|REJECT, reason}, key)`：只在 `REQUESTED` 可用；原因去空白后 1–2000 字；需幂等键。版本不一致、状态已变，或论文已不在结果处理/已完成阶段时 409。
- 平台看不到更正前后的对照（`before` 只给学校）。

**界面**
- 清单视图：待审批（`REQUESTED`）、已处理（其余），全部；侧栏“更正审批”显示待审批数。地址：`?view=`、`?correction=`。行显示任务编号（前 8 位）、申请时间、状态（E5：不显示题目、专家与学校，Q1 未定）。
- 对象区：状态、任务编号、申请时间；更正进度（专家申请 → 平台批准 → 专家提交更正稿 → 学校确认生效，驳回、取消、学校不予确认显示为终止说明）；申请理由；处理记录。**不渲染 `revision`**，说明“更正前后的内容由学校在结果处理页核对”。
- 待审批时底部出“驳回…／批准…”；确认框要求原因（专家可见），同一命令内容重试用同一把幂等键，改了原因换新键。
- 409：重读；已不是待审批时显示“这条申请已被处理，当前状态：…”；仍待审批（版本变化）时提示核对后重新操作。读回后申请不在 → “这条更正申请已不可见”。

**测试**（`modules/expert-management/corrections/__tests__/`）：`correctionView.spec`（分组、申请理由与记录标签、进度）；`correctionApprovalDesk.spec`（视图与计数、深链与不在、只显示申请信息且不渲染 revision、批准与驳回都要原因并带版本、幂等键复用与换新、409 两种结果、加载失败重试、窄屏）。

**U4-7 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 105 个文件、828 项通过（`--maxWorkers=4`；新增 `correctionView.spec` 3 项、`correctionApprovalDesk.spec` 9 项）；生产构建通过。旧 `CorrectionApprovalPage`、`RealCorrectionPanel` 及 `correctionAndSettlement`、`platformManagement`、`realCorrections` 未改；本刀未改 `src/api`。Q1（是否显示论文题目与专家姓名）仍按默认只显示接口已有字段。浏览器走查未做，原因同 U4-1。

## 15. U4-8 施工细则：系统管理（P14）

**文件**：`modules/system/tenants/` 下 `TenantDesk.vue`（外壳、学校表、深链）、`TenantObject.vue`（学校详情与学校管理员）、`TenantCreate.vue`（新增学校）、`tenantView.ts`（纯函数）；`modules/system/catalog/OfficialCatalogPage.vue`。真实模式 `/system/tenants` 指向 `TenantDesk`；新增真实路由 `/system/catalog`（`system_admin`，不设 pageId，routes.spec 的 27 个 pageId 不变）。旧 `TenantPermissionsPage`、`OfficialCatalogImport`、`InstitutionSelector` 及 `realTenantPermissions.spec` 不改。

**已核对的后端事实**
- 学校代码 2–32 位，`^[a-z0-9-]+$`，服务端转小写；重复 409“学校代码已存在”，并发唯一冲突 409“学校代码或成员信息已存在”。带 `institution_code`（10 位）时学校名称必须等于启用中的官方院校名称，否则 422。根组织编号 1–64、名称 1–128。
- 学校管理员：登录名 3–64 位小写字母、数字和 `. _ -`（服务端转小写），姓名 1–128，工号 `external_id` 1–64（E9），密码 12–128。所有命令需幂等键。
- 暂停／恢复：状态不符 409“学校当前状态不允许该操作”；暂停撤销该校全部会话。暂停中的学校新增管理员 409；停用最后一名启用中的管理员 409“不能停用最后一名学校管理员”。
- 官方目录：`previewCatalogImport()` 只读比较内置官方来源快照；已有学校专用目录时 409（原文显示）。`applyCatalogImport(fingerprint)` 只新增与更新、不停用任何条目，已开放的学科与已建学校不受影响；指纹不符 409“目录或预览已变化，请重新预览”，整批不写。

**接口补充**：`listTenants(options?)`、`listReviewers(tenantId, options?)`、`searchInstitutions(q, options?)` 补可选末尾参数（`optionArgs`，不传时实参不变），`requestOptions.spec` 补一项。

**界面**
- 学校表（`/system/tenants`）：搜索名称或代码（`?q=`）、状态筛选（`?status=ACTIVE|SUSPENDED`）；列：学校、代码、根组织、管理员数、状态、接入日期；整行可点，行内按钮可用键盘打开。空、无匹配、加载失败三种状态块。说明“系统管理员只管理学校与账号，不读论文正文”。
- 学校详情（`?tenant=`）：标题面包屑“学校管理 › 学校名”。暂停／恢复按钮按 `allowed_actions`；暂停走确认框（说明该校账号立即退出、恢复前无法登录、数据保留），恢复直接执行。409 时重读：已是目标状态按成功说明，否则显示服务端原文。管理员表：姓名、登录名、工号、状态；“重置密码…”（两次输入，提交后清空，不回显）、停用／启用（409 原文显示，例如最后一名管理员）。“新增学校管理员…”对话框含工号；学校暂停时按钮禁用并说明原因。学校不在列表 → “这所学校已不可见”。
- 新增学校（`?new=1`）：先检索官方院校（回车或按钮，最多 100 项时提示缩小范围），必须选一所；学校代码默认取院校标识码、可改（改过后再换院校不覆盖）；根组织编号与名称；首位管理员姓名、登录名、工号、密码两次。前端按后端规则校验；幂等键在两次提交之间没有任何改动时复用（任一输入变化即换新键，按改动序号判断，密码不进签名）；成功后进入新学校详情并提示“初始密码不会再显示”。409：保留全部输入、清空密码、重读学校列表，用代码在列表里找到已使用者时给“打开该校”链接（E15），找不到只提示换代码。
- 官方基础目录（`/system/catalog`）：说明全平台共用；“生成预览”只读，显示学科与院校的新增／变更／不变计数和来源（新窗口打开）；无变化时不能导入；“确认导入…”确认框说明只新增与更新、不停用、已有学校设置不受影响。导入 409：预览作废，只给“重新生成预览”；其他失败保留预览可再次确认。成功后显示导入计数。
- 菜单（E10）：真实模式系统管理员侧栏为“学校管理｜官方基础目录”；演示菜单不变。U4-0 `workspaceNav.spec` 中两条“系统管理员只有学校管理”的断言随本刀更新（新增菜单是计划内变化，不属于搬家）。

**测试**：`modules/system/tenants/__tests__/tenantView.spec`（代码与账号校验、密码校验、筛选、建校请求体）；`tenantDesk.spec`（表格与筛选、深链与不在、暂停确认与恢复、409 已达目标、管理员新增含工号与暂停时禁用、重置密码不回显、停用 409 原文、新建校验、代码默认取院校码、提交体、幂等键复用、409 保留输入并链接已使用者、成功进入详情、加载失败重试）；`modules/system/catalog/__tests__/officialCatalog.spec`（预览计数与来源、无变化不能导入、确认导入带指纹、409 只能重新预览、其他失败可重试、预览 409 原文）。

**U4-8 结果（2026-11-05）：** vue-tsc 通过；vitest 两种模式均 108 个文件、852 项通过（`--maxWorkers=4`；新增 `tenantView.spec` 4 项、`tenantDesk.spec` 13 项、`officialCatalog.spec` 6 项，`requestOptions.spec` 补 1 项）；生产构建通过，不含原型页。旧 `TenantPermissionsPage`、`OfficialCatalogImport`、`InstitutionSelector` 及 `realTenantPermissions.spec`、`routes.spec` 未改。计划内的改动：`listTenants`、`listReviewers`、`searchInstitutions` 补可选 `options`（不传时实参不变）；`router/meta.d.ts` 的 `pageId` 改为可选（仅类型；新路由 `/system/catalog` 不设 pageId，27 个 pageId 不变）；U4-0 `workspaceNav.spec` 中系统管理员菜单的两条断言改为“学校管理｜官方基础目录”，并补断言演示菜单不变。浏览器走查未做，原因同 U4-1。U4 的 8 个页面切片至此全部完成；旧组件清理按 §4 另开切片。

## 16. U4-9 清理切片（规格；D1 已定为 D1-b）

U2 计划 §4 与本文 §4 约定：页面切片验收后，统一删除被替换的旧组件。本节先盘点，再分两段：9a 不依赖演示模式的去留，可以直接做；9b 取决于 D1。

### 16.1 盘点（2026-11-05，按源码 import 图，不含测试与原型）

做法：从 `main.ts` 与两个路由文件出发，分别按演示模式（三元取旧页）和真实模式（取新页）求可达文件。

| 类别 | 文件 | 覆盖它的 spec |
|---|---|---|
| A. 两种模式都不可达（本轮改造造成） | `expert-management/pages/RealExpertLibraryPage.vue`、`components/app/ExpertImportDialog.vue` | `realExpertLibrary`（6）、`expertImport`（7） |
| B. 没有演示分支、演示菜单也不显示的旧设置页 | `school/pages/SchoolMembersPage.vue`、`SchoolDisciplinesPage.vue`（及只被它用的 `school/components/ProgramCatalogImport.vue`）、`SensitiveTermsPage.vue` | `realSchoolMembers`（6）；`officialCatalogs` 3 项中 2 项；`sensitiveLocations` 8 项中 2 项 |
| C. 只在演示模式可达 | 51 个文件约 11,600 行：12 个双模式旧页（`ThesisEditPage`、`StudentDashboardPage`、`PreparationListPage`、`ReviewWorkspacePage`、`DispatchWorkbenchPage`、`ResultProcessingPage`、`StudentResultPage`、`SupervisorResultPage`、`ObjectionWorkbenchPage`、`BatchRulesPage`、`CorrectionApprovalPage`、`TenantPermissionsPage`）、演示专用的 `ExpertLibraryPage`，以及只被它们引用的约 38 个子组件（`BatchCloseout`、`BatchDeadlines`、`BatchProgramPin`、`OfficialCatalogImport`、`InstitutionSelector`、`SchoolThesisTable`、`CandidateExpertTable`、`AnonymousDocumentPane` 等） | 约 25 个 spec，其中 `real*` 系列直接测这些页里已不会运行的真实分支 |
| D. 改造前就无人引用 | `components/app/AppSidebar.vue`、`layouts/AdminLayout.vue`、`layouts/ReviewWorkspaceLayout.vue`、`modules/auth/routes.ts`、`modules/thesis/routes.ts`、`modules/thesis/components/DemoFileUpload.vue`、`stores/demoScenario.ts` | `AdminLayout.spec`（1） |

几点核对结果：
- 新页仍复用的旧组件都在真实模式可达，不在清理范围内，例如 `RealCorrectionPanel`（`ExpertReviewDesk` 以 `mode="expert"` 使用）、`ReviewFormPane`、`ExtensionPanel`、`SensitiveFindingPanel`。`RealCorrectionPanel` 的 school、platform 两种模式现在只剩 C 类旧页在用。
- U2-2、U2-3 把旧页逻辑搬进了 `useReviewSession`、`useReviewForm`、`useThesisEditor`，新旧页共用。`realWorkspace`（24）、`studentSubmission`（14）、`realThesisIdentity`（14）等旧 spec 经由旧页测试这些 composable；删除前必须确认新页 spec 覆盖了同样的行为。
- 未改造的页面（`ReviewProgressPage`、`ExpertTasksPage`、`InvitationPage`、`ExpertFinancePage`、`ExpertProfilePage`、`SettlementWorkbenchPage`、`SchoolAccountPage`、`ExportCenterPage`、`AuditQueryPage`、`NotificationCenterPage`、`LoginPage`）两种模式都在用，里面同样有演示分支。

### 16.2 前提

- **P1 浏览器走查。** U2-2 至 U4-8 的真实浏览器走查（§6 第 4 条）都还没做。旧页是新页出问题时的回退路径，只要把三元改回去即可。9a 的 B 类和 9b 都会去掉这条回退，所以须在用户于隔离环境（5433 / `paper_review_test`）走查通过后再做，或由用户明确放弃这一前提。A 类本来就不可达，不受此限。
- **P2 先提交。** 建议先把 U2-2～U4-8 做成本地提交（Q2），清理单独成一个提交，需要时可以整体回退。未经要求不提交。

### 16.3 9a：可以直接做的部分

1. **A 类。** 删除 `RealExpertLibraryPage`、`ExpertImportDialog`，以及 `realExpertLibrary.spec`、`expertImport.spec`。同时删掉 `routes.ts`、`ExpertImportPane.vue` 注释里对它们的引用。
2. **B 类。** 先受 P1 约束。`/school/members`、`/school/disciplines`、`/school/sensitive-terms` 去掉三元，两种模式都指向新页。演示模式下的实际行为不变：旧页同样直接调用真实接口，演示菜单也不显示这三项。然后删除三张旧页和 `ProgramCatalogImport`，删除 `realSchoolMembers.spec`；`officialCatalogs.spec` 删去测 `SchoolDisciplinesPage` 的 2 项，保留测 `OfficialCatalogImport` 的 1 项（C 类旧页仍在用）；`sensitiveLocations.spec` 删去测 `SensitiveTermsPage` 的 2 项与对应 import，其余 6 项不动。
3. **覆盖对照（删除任何 spec 之前）。** 逐条列出被删的 `it`，给出新 spec 里对应的用例。没有对应、而新页仍有这一行为的，先补进新 spec，再删旧的。对照表写进本节的结果记录。已知需要核对的有：
   - 导入的三态筛选与人工编辑保留 `null`；
   - 导入对话框关闭后迟到的预览不再生效；
   - 成员新建进行中不重复提交；
   - 学科“清空选择后恢复全部”。
4. **D 类不在本切片。** 这些与改造无关，另列给用户决定，不顺手删除。

9a 验收：vue-tsc；两种模式 vitest 全部通过（预计减少约 23 项，以实际为准，并写明增减）；生产构建；`git status` 只出现本节列出的删除与修改；`routes.spec` 的 27 个 pageId 不变。

### 16.4 9b：取决于 D1

| 编号 | 问题 | 选项 |
|---|---|---|
| D1 | 演示模式（`VITE_DEMO_MODE=true` + `scenarioService`）还要不要 | **D1-a 退役：** 先另写规格再动手。范围包括：去掉全部三元；删除 C 类 51 个文件与 `src/demo/`（约 4,100 行）；把 11 个未改造页面里的演示分支剥掉；`menus.ts` 的演示分支、`RealCorrectionPanel` 的 school、platform 模式一并去掉；`realCorrections` 中经由 `ReviewWorkspacePage` 的专家模式用例改挂到 `ExpertReviewDesk`；删除演示 spec，并逐条对照真实 spec；更新 README、CURRENT。这是本轮最大的一刀，建议拆成按角色的几步。<br>**D1-b 保留：** 9a 之后停止。C 类双模式旧页里已不运行的真实分支保留为死代码，不剥离；剥离要改写全部演示页，有破坏演示的风险，收益很小。演示模式继续只代表旧界面。 |

**用户决定（2026-11-05）：D1-b，保留演示模式。** 本切片只做 9a；C 类旧页及其中的真实分支保留不动，D1-a 不再列入计划。9a 的 A 类可直接执行，B 类仍等 P1（浏览器走查通过或用户明确放弃）。

### 16.5 9a-A 结果（2026-11-05）

删除 `expert-management/pages/RealExpertLibraryPage.vue`、`components/app/ExpertImportDialog.vue`、`__tests__/realExpertLibrary.spec.ts`、`__tests__/expertImport.spec.ts`（四个文件都受 git 跟踪、删除前未改动，未暂存、未提交）。同时改了 `routes.ts`、`ExpertImportPane.vue` 里提到它们的两处注释。删除前逐条对照，新 spec 没有覆盖的 6 项补进 `library/__tests__/expertLibraryDesk.spec.ts`，单独放在“carried over from the old real expert library”一组里，补进后不需要改产品代码即通过。

| 旧用例 | 新 spec 中的对应 |
|---|---|
| realExpertLibrary：读取字段、回避学校 id 显示为名称、不出现演示字段 | `splits views…`（学校名称）＋补：`does not offer a disabled account…`（演示字段） |
| realExpertLibrary：账号停用时不提供派单 | 补：`does not offer a disabled account for dispatch…` |
| realExpertLibrary：加载失败报错，不回退演示数据 | 补：`shows a load error without any expert data and recovers on retry` |
| realExpertLibrary：暂停接单带原因与版本，读回 | `requires a reason for qualification and service changes…` |
| realExpertLibrary：版本冲突读回、要求重新决定 | `rereads on a command 409…` |
| realExpertLibrary：新建失败后同一把键重试、成功后重读 | 补：`reuses the key when creating again after a network failure…`（409 换新键另见 `creates an expert…`） |
| expertImport：说明只更新已有专家；博导“未知”与“否”区分 | 补：`says the import only updates existing experts…`；档案下拉三态见 `ExpertObject` |
| expertImport：差异逐项显示，清空写明 | 补：同上（省份 北京市 → 清空，博导 未知 → 否） |
| expertImport：有行错误不能应用 | `cannot apply a preview with errors, and a 409 voids the preview` |
| expertImport：超时后同一把键、409 作废预览 | `previews without writing, applies with one key…`＋`cannot apply…a 409 voids…` |
| expertImport：三态筛选按原值发给服务端；人工编辑保留 `null` | 筛选部分**有意不沿用**：新页一次取全部专家，在本地按搜索与学科筛选（§13）；保留 `null` 补：`keeps an unknown supervisor status as null…` |
| expertImport：过期预览不显示差异、不能应用 | `treats an expired preview as unusable…` |
| expertImport：关闭后迟到的预览不生效 | 补：`drops a preview that arrives after leaving the import pane` |

验收：vue-tsc 通过；vitest 两种模式均 106 个文件、845 项通过（`--maxWorkers=4`；净减 7 项：删 13 项、补 6 项）；生产构建通过。9a-B（三张旧设置页）仍等 P1。

### 16.6 9a-B 结果（2026-11-05）

**前提 P1：** 用户在对话中要求“先继续清理”，视为明确放弃浏览器走查前提（§16.2）。被删的旧页都受 git 跟踪、删除前未改动，需要回退时可从 git 取回并恢复三元。P2（先提交）仍未做，本次改动未暂存、未提交。

**改动：**
- `/school/members`、`/school/disciplines`、`/school/sensitive-terms` 去掉三元，两种模式都指向 `school/settings/` 下的新页；三张新页头注释同步。
- 删除 `school/pages/SchoolMembersPage.vue`、`SchoolDisciplinesPage.vue`、`SensitiveTermsPage.vue`、`school/components/ProgramCatalogImport.vue`、`school/__tests__/realSchoolMembers.spec.ts`。旧页用到的 `CatalogMultiSelect`、`BlindRail`、`PageHeader` 仍有其他引用，保留。
- `officialCatalogs.spec` 只留测 `OfficialCatalogImport` 的 1 项；`sensitiveLocations.spec` 删去测 `SensitiveTermsPage` 的 2 项、辅助函数与两处 import，其余 6 项不动。

**覆盖对照：**

| 旧用例 | 新 spec 中的对应 |
|---|---|
| realSchoolMembers：一次刷新读取学生、导师与资格 | `lists students first…`、`switches views…`、`shows eligibility by batch…` |
| realSchoolMembers：新建学生，成功或失败后清空密码 | 成功清空见 `validates a new member…`；**失败后有意保留**输入（含密码），以便同一把键重试，409 后换新键（U4-4）；密码不进存储补进下一行 |
| realSchoolMembers：新建进行中不重复提交 | 补：`does not submit a new member twice while creation is pending, and keeps the password out of storage` |
| realSchoolMembers：只改可编辑字段并带 `expected_updated_at`；停用、重置密码带键 | `on an edit 409 keeps the input…`（请求体）、`disables after a confirmation…`、`resets a password through two inputs…`；重置失败后有意保留输入，同上 |
| realSchoolMembers：编辑 409 关闭并重读 | **有意不沿用**：新页保留输入、列出双方的值，可覆盖或放弃（`on an edit 409…`、`can drop the local edit…`） |
| realSchoolMembers：新建资格只提供启用的成员与草稿/开放批次 | `shows eligibility by batch…`（只列启用导师）、`memberView: offers only current batches…`；补：`does not offer a new eligibility to a disabled student` |
| officialCatalogs：保存本校范围，409 重读不重放 | `on 409 rereads, keeps my picks…`（新页有意保留勾选并可合并） |
| officialCatalogs：可显式清空并恢复全部 | 清空并确认保存见 `asks before saving an empty selection`；补：`restores every choice with 全选 after clearing…` |
| sensitiveLocations：默认 WARN、空说明，带版本保存，失败保留输入，重读恢复 | `loads the table…saves the whole list with the version`、`shows the empty state and keeps edits when saving fails`、`on 409 lists their changes…`、`can drop my edits after a 409` |
| sensitiveLocations：重复与空白在写入前校验 | `validates rows before sending`、`termsView: validates each row like the backend` |

补进的 3 项不需要改产品代码即通过。

**验收：** vue-tsc 通过；vitest 两种模式均 106 个文件、840 项通过（`--maxWorkers=4`；相对登录修复后的 107 / 847，删 10 项、补 3 项）；两种模式生产构建通过；`routes.spec` 通过（pageId 不变）。演示模式浏览器抽查：直接输入 `/school/members` 加载新页，它调用真实学校接口，演示令牌得到 401 后回到登录页；旧页调用同样的接口，表现相同，演示菜单不显示这三项。

**U4-9 到此结束。** C 类按 D1-b 保留；D 类（改造前就无人引用的 7 个文件）不在本切片，留给用户决定。

## 17. R 轮：统一设计语言与 shadcn-vue（R0–R4）

执行要求：用户 2026-11-05 提供的《统一设计语言与 shadcn-vue 重构提示词 v3》（以下称“v3”）。本节沿用本计划，不另起计划文件。U0–U4 的业务成果、测试与合同保持不变，R 轮只改视觉基础、外壳与页面结构。

### 17.1 R0 基线（2026-11-05 核对）

- 分支 `claude/laughing-vaughan-4ca76f`，HEAD `34bbbf0`，与 `origin/claude/laughing-vaughan-4ca76f` 一致，工作树干净。从这里继续，不回退，不重放历史补丁。
- 栈：Vue 3.5、Vite 8、Tailwind v4（`@tailwindcss/vite`，Preflight 已全局生效）、Pinia 3、Vue Router 5、Element Plus 2.14；包管理 pnpm（node_modules 由 pnpm 12.5.1 安装，锁文件 v9）。
- **Element Plus 实际依赖很少**（真实模式可达文件，按 import 图统计）：没有任何真实页面使用 `<el-*>` 组件。剩余三处：`api/request.ts` 的 `ElMessage` 全局错误提示；`main.ts` 的 `app.use(ElementPlus)`；`PdfTransformDialog`、`ColumnPreferences` 的 `@element-plus/icons-vue` 图标。
- **外壳四套并存**（真实模式）：`OperationsShell` 14 页、`PersonalShell` 4 页、`FocusShell` 2 页、旧 `PortalLayout` 10 页。`PortalLayout` 页里接真实接口的只有 `ReviewProgressPage`、`ExpertTasksPage`、`InvitationPage`；其余（财务、资料、通知、审计、导出、结算、学校账户）在真实模式是演示或“待接入”页，不在真实菜单里，R 轮不为它们开放入口。
- 令牌三处各自维护：`styles/theme.css`（全局 `@theme`，含宋体 display 字体）、`styles/workspace.css`（`.ws` 作用域）、`styles/element.css`（EP 变量）。

### 17.2 页面地图（真实模式；模板按 v3 §6）

| 路由 | 现页面 | 现外壳 | R 模板 | 批次 |
|---|---|---|---|---|
| `/school/preparation` | SchoolPreparationPage → PreparationQueue | Operations | data（满宽表＋可选预览） | R2 |
| `/school/preparation?thesis=` | VerifyDesk | Focus | focus | R2（R1 样板） |
| `/school/progress` | ReviewProgressPage | **PortalLayout** | data | R3-1 |
| `/school/results` | SchoolResultsDesk | Operations | queue | R3-1 |
| `/school/objections` | SchoolObjectionsDesk | Operations | queue | R3-1 |
| `/platform/dispatch` | PlatformDispatchDesk | Operations | queue＋候选比较表 | R3-2 |
| `/platform/experts` | ExpertLibraryDesk | Operations | data（R1 样板） | R3-2 |
| `/platform/corrections` | CorrectionApprovalDesk | Operations | queue | R3-2 |
| `/expert/tasks` | ExpertTasksPage | **PortalLayout** | data（任务少时同一表） | R3-3 |
| `/expert/invitation` | InvitationPage | **PortalLayout** | form（单任务详情） | R3-3 |
| `/expert/review` | ExpertReviewDesk | Focus | focus | R3-3 |
| `/student/dashboard` | StudentPortalPage | Personal | reading 宽（当前论文＋下一步） | R3-4 |
| `/student/thesis/edit` | StudentThesisEditor | Personal | form | R3-4 |
| `/student/results` | StudentFeedbackPage | Personal | reading（R1 样板） | R3-4 |
| `/supervisor/results` | SupervisorFeedbackPage | Personal | reading（与学生共用阅读组件） | R3-4 |
| `/school/batch-rules` | BatchSettingsPage | Operations | queue（批次少时索引收窄） | R3-5 |
| `/school/members` | MemberSettingsPage | Operations | data（可比较表＋详情 Sheet） | R3-5 |
| `/school/disciplines` | DisciplineSettingsPage | Operations | form | R3-5 |
| `/school/sensitive-terms` | TermSettingsPage | Operations | form（可编辑表） | R3-5 |
| `/system/tenants` | TenantDesk | Operations | data | R3-5 |
| `/system/catalog` | OfficialCatalogPage | Operations | form | R3-5 |
| `/login` | LoginPage | AuthLayout | 独立（沿用控件体系） | R3-5 |

### 17.3 旧功能去向（只列 R 轮会动到外观的入口）

| 功能 | 现位置 | R 轮去向 | 数据来源 | 验证 |
|---|---|---|---|---|
| 角色菜单 | `menus.ts` `LIVE_PATHS`＋`workspaceNav` | 同一 `AppSidebar`；菜单仍只由 `portalMenus` 决定 | 现有 | `workspaceNav.spec`＋新外壳 spec |
| 对象深链接 `?thesis=` `?expert=` `?tenant=` 等 | 各页 query | 不变；Focus 退出回到原 query | 现有 | 各页 spec |
| 确认弹窗 | `workspace/ConfirmDialog` | shadcn AlertDialog 外观，接口不变 | — | 组件 spec |
| 全局错误提示 | `request.ts` `ElMessage` | 展示适配层（`notify`），请求与错误协议不变 | 现有 | `loginFailure.spec`、request spec |
| 列设置 | `ColumnPreferences`（学校表、专家任务、候选） | 表格的“显示”弹层；本浏览器保存规则不变 | 现有 | 原 spec |
| 上传、PDF 处理 | `StudentThesisEditor`＋`PdfTransformDialog` | 只换外围控件外观；`If-Draft-Revision` 不动 | 现有 | 原 spec |
| 延期 | `ExtensionPanel`（专家）、派单台审批 | 原位置；外观统一 | 现有 | 原 spec |
| 更正 | `RealCorrectionPanel`（专家）、更正审批 | 原位置；仍手动保存 | 现有 | 原 spec |
| 导出评阅书 | 学校结果 `downloadPublishedReview` | 原位置 | 现有 | 原 spec |
| 批次收尾/归档 | `BatchObject` 收尾清单 | 原位置，危险区语义 | 现有 | 原 spec |
| 时间范围 | `TimeScopeSelect` | 筛选栏 Select（仍只有全部/近一年） | 现有 | 原 spec |

### 17.4 参考对应（已看官方帮助页截图；未登录使用参考产品）

| 参考 | 看了什么 | 借鉴的结构 | 保留的交互 | 本平台差异 |
|---|---|---|---|---|
| Attio 表视图（help: create-and-manage-table-views，`recruiting-list.png`、`view-settings.png`） | 记录表、视图选择器、View settings 列菜单、底部计数 | 一行“视图 ▾ ＋ 显示设置 ▾ … 右侧导入/新建”；第二行“排序/筛选”条件 chip；表头带图标、细竖分隔、约 36–40px 行、底部 `N 条` | 列显示与业务筛选分开；条件 chip 可逐个移除 | 不做自定义视图保存、列计算；计数来自全量加载后的本地过滤，明说“共 N 位（已全部加载）” |
| Attio 记录页（help: create-and-view-records，`full-record-page-overview.png`） | 左栏属性键值、右侧分区 | 预览 Sheet 用“键—值”两列属性，分组折叠；完整档案单独页 | 预览不是强制中间步骤，行内主动作可直达 | 不展示活动流、邮件；只展示接口给出的字段 |
| Linear Filters（help: filters，筛选条截图） | 页头下方的条件条 | 条件以“字段 是 值 ×”chip 呈现，末尾一个筛选入口 | 清除全部；条件与显示设置分层 | 无“匹配全部/任一”，条件固定为“且” |
| Linear Display options（help: display-options） | 右上 Display 弹层：分组、排序、显示属性 | 右上“显示”按钮 → 弹层里放排序和列显示 | 偏好按本浏览器保存 | 不做看板视图 |
| Linear 外壳（同上截图） | 紧凑页头、侧栏 | 页头一行：标题＋上下文＋右侧动作；侧栏短名称＋计数 | 侧栏可折叠，⌘B | 侧栏不放收藏、团队切换 |
| Overleaf 新编辑器（blog: introducing-overleafs-new-look，官方示意图 `redesigned-editor.png`） | 官方图是低保真示意；文字说明：工具集中到左侧菜单、界面去拥挤、错误日志更清楚 | Focus：左侧窄工具轨（发现、页码、对照）＋文档＋右侧判断；工具按需展开 | 文档位置不因定位发现丢失 | 只读匿名稿，没有编辑器；判断区是命令而非编辑 |

### 17.5 统一规格（R1 落地为 token 与 variant；样板验收后冻结）

- **单一 token 来源** `styles/tokens.css`：shadcn 语义变量（`--background`、`--foreground`、`--primary`、`--muted`、`--border`、`--ring`、`--sidebar-*` 等）＋本项目补充（`--warning`、`--success`、`--page`、尺寸）。`@theme inline` 映射为 Tailwind 类。旧 `--ws-*`、`theme.css` 的 `--color-*`、`--el-*` 改为指向它的别名，迁移完再删。
- 色：页面 `#F6F7F9`、内容面 `#FFFFFF`、凹面 `#F1F3F5`、边线 `#E4E7EB`／强 `#D0D5DB`、正文 `#16191D`、次要 `#5B6470`、弱 `#6B7380`、品牌 `#1B4F8A`（hover `#163F6E`、浅 `#EBF1F8`）、危险 `#B42318`、警告 `#8A5300`（浅 `#FDF3E1`）、成功 `#1E7A46`（浅 `#E8F4EC`）。文字色对白底对比度实测记录在 R1 结果里。
- 字：系统中文无衬线（`-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`）；正文 14、数据 13、辅助 12、顶栏标题 16、正文页标题 20、分区 14–15；阅读正文 16／行高 1.75；字重 400／500／600。工作页不用宋体。
- 距：4、8、12、16、24、32；控件间 8、字段间 16、分区间 24；页面边距 24／16／12。
- 控件高 36，密集行内 32，移动关键触控 44。圆角：控件 6、面板 8、Dialog/Sheet 10、标签胶囊。
- 表格行高 44 起；数字右对齐；表头 12–13/500 次要色；悬停凹面、选中品牌浅色。
- 外壳：侧栏展开 224、折叠 56、菜单行 36；顶栏 52；选中态＝凹面填充＋500 字重＋品牌色图标，不加竖线或大色块。
- 阴影只给浮层。动效 150ms，尊重 `prefers-reduced-motion`。
- 浮层统一 Teleport 到 `body`，token 定义在 `:root`，所以弹出后字体与颜色一致；不靠 `!important` 或叠 z-index。

### 17.6 依赖与迁移边界

- 新增（实际版本见 17.8）：`reka-ui`、`class-variance-authority`、`cn`（shadcn 发布的 clsx＋tailwind-merge 封装，CLI 生成代码直接引用，替代本地 `lib/utils.ts`）、`@lucide/vue`（`lucide-vue-next` 已弃用，CLI 改用它）、`@vueuse/core`、`tw-animate-css`；比较表用 `@tanstack/vue-table` v9（按 feature 组合，项目共用 `components/app/data/tableFeatures.ts`）。
- 不用 `shadcn-vue init` 改写现有 CSS/Vite 配置：手写 `components.json`，用官方 CLI 逐个 `add`，审查生成文件后再提交给页面使用。
- 分层：`components/ui/`（shadcn 源码，不调接口）→ `components/app/shell/` 等产品公共组件（AppShell、AppSidebar、PageHeader、FilterBar、DataTable、StatusBadge、SaveStatus 外观、StateBlock）→ 各模块展示 → 现有 API/stores/composables（不动）。
- Element Plus：R1 不卸载。退出条件：`request.ts` 改走展示适配层；两处图标换 Lucide；`main.ts` 移除注册后两种模式测试与构建通过。R4 再定是否从依赖中删除（演示旧页若仍依赖 EP 自动导入则保留）。
- 旧外壳：`OperationsShell`／`PersonalShell`／`FocusShell`／`PortalLayout` 在迁移期保留；页面按切片换到 `AppShell`，全部迁完后 R4 删除。

### 17.7 R1 交付与隔离

- 三张样板＋六角色导航示例，放在 `src/prototypes/r1/`，只在 `import.meta.env.DEV` 注册（沿用 `router/index.ts` 的原型路由机制）；生产构建不包含，用构建产物检索验证。
- 样板 fixtures 明确标注为虚构；只做类型导入（`import type`），不导入 `src/api` 运行时、不调用 stores、不发请求。纯展示函数可复用（如 `expertView.ts`、`publishedFeedback.ts`）。
- 样板使用的外壳与展示组件就是 R2/R3 要接入真实页面的那一套，不另造。
- 正式路由与页面在 R1 不改。

### 17.8 R1 结果（2026-11-05，未提交）

**入口**（只在 dev 构建注册）：`/prototype/r1`；样板 `/prototype/r1/experts`（含 `/experts/:id` 完整档案）、`/prototype/r1/verify`、`/prototype/r1/feedback`；六角色导航 `/prototype/r1/nav?role=`。每页底部虚线框“样板状态”切换加载 / 空 / 错误 / 过期 / 冲突等状态，不是产品界面。

**依赖实际版本**：reka-ui 2.11.0、class-variance-authority 0.7.1、cn 0.5.2、@lucide/vue 1.68.0、@vueuse/core 15.0.0、tw-animate-css 1.4.0、@tanstack/vue-table 9.3.1。shadcn-vue CLI 2.9.0 逐个 `add`，未运行 `init`。

**对 shadcn 生成组件的本地改动**（以后重新 `add` 时要保留）：
- sidebar：宽度 224 / 56 / 手机 280；折叠偏好改存 localStorage（`bj.sidebar.open`），新增 `persist` 属性（Focus 模式不写偏好）；去掉 cookie；菜单按钮 36px、图标 18px、激活项品牌色图标；中文无障碍文案。
- dialog / alert-dialog / sheet / popover 等：遮罩 `bg-foreground/30`，浮层统一 `shadow-float`；Dialog 圆角 10px。
- table：表头 40px / 12px 次要色，单元格 44px 允许换行，选中行 `primary-soft`。
- badge：6px 圆角，新增 neutral / brand / warning / danger / success 浅底变体。

**本轮顺带修正（影响真实页面）**：
- `theme.css` 的 `:root` 字体/颜色与全局 `:focus-visible` 原本不在层里，会盖过 tokens 与组件工具类（Teleport 浮层字体不一致、shadcn 焦点环叠加旧描边）。改为读 tokens 并放进 `@layer base`。
- `accountInitial`：姓名末尾带括注（如“（外聘）”）时头像字取括注前的最后一个字；补测试。
- `NavItem.iconKey`：链接被改写时（原型）按原路径取图标；真实页面不受影响。
- `--faint` 由 #6b7380 调为 #646c78：原值在侧栏与文档底色上只有 4.46 / 4.42:1。

**对比度实测**（WCAG，正文要求 4.5）：正文 17.6；次要文字 6.0（白）/ 5.6（页面底）/ 5.4（muted）；弱文字 5.3 / 4.95 / 4.77；品牌色字 8.3，品牌浅底上 7.3；警告 5.75、危险 5.75、成功 4.73（均在各自浅底上）；白字在主按钮上 8.3、危险按钮上 6.6。

**验证**（命令在 `frontend/`）：
- `vue-tsc --noEmit -p tsconfig.app.json`：通过。
- `VITE_DEMO_MODE=false vitest run --maxWorkers=4`：107 文件 / 843 测试通过，exit 0；`VITE_DEMO_MODE=true` 同为 107 / 843，exit 0。（新增 `prototypes/r1/__tests__/isolation.spec.ts`：沿值导入走依赖图，样板到不了 `api/request` 与 stores，且不值导入任何 `src/api` 模块；自检确认走查器能发现真实专家库页面对 HTTP 客户端的依赖。）
- `vite build`（两种模式，输出到临时目录）：exit 0；产物中检索不到 R1 代码（`MockPaper`、`r1-verify`、“样板状态”等）。
- 浏览器（5187，真实模式 dev）：核验台 1920×1080（三栏 289 / 1207 / 367px，侧栏按像素不随屏宽放大）、1440×900（287 / 727 / 368px）、1366×768（三栏）、1024×768（发现收进左侧抽屉，判断栏 340px）、390×844（发现 / 材料 / 判断标签页）；专家库与正式反馈 1440×900；六角色导航逐个切换。已点验：发现定位到页（平滑滚动后页顶距容器 14px）、写入退回原因、通过需说明、通过后单独“确认送出…”、自动不通过时禁止通过、抽屉内点发现后关闭并跳页、专家库视图计数与无结果状态、预览抽屉 440px、Teleport 浮层字体为 tokens 字体。控制台无错误。

**未覆盖 / 已知**：
- 文档区是示意页，不是真实 PDF；R2 接入受控 PDF（文件接口＋`#page`）时需要重新验证定位与并排对照。
- 键盘：只在核验台用 Tab 抽查侧栏链接（2px 品牌色焦点环、无旧描边叠加），未逐页走完整 Tab 顺序。
- 分栏宽度不跨会话保存（reka 按比例恢复会让像素侧栏在宽屏放大）；R2 如需记住宽度，自行按像素存。
- 旧页面在 tokens 生效后的视觉偏移（圆角、边框色经 `@theme inline` 覆盖）未逐页截图；R2 起按切片检查。
- 构建有既存的 >500 kB chunk 提示，与本轮无关。


## 18. R2：学校送审准备清单 → 单篇匿名核验 → 返回清单（施工规格）

用户 2026-11-05 验收 R1 样板后开始。范围只有真实模式 `/school/preparation`（`SchoolPreparationPage` / `PreparationQueue` / `VerifyDesk`）；demo 模式旧页 `PreparationListPage` 不动。

### 18.1 不变的契约（脚本逻辑原样保留，只换模板与样式）

- 清单：一次读取（时间范围 `useTimeScope`），视图计数只数已加载集合并写明口径，加载中/失败时不显示 0；视图、搜索、专业、选中行、密度都在查询参数里，进入核验台再返回时原样恢复，并带回 `sel`；选中行被筛掉时只关闭预览。
- 可送出视图的行内“确认送出…”：只看 `allowed_actions`，单独确认，一次尝试固定版本与幂等键，409/404 刷新清单并说明。
- 核验台：检测维度分开读（`checkReport.ts`）；通过/退回只按 `allowed_actions`；有学校词表警告时通过必须写说明；退回必须写原因；同一次提交重试沿用同一幂等键；409 先重读再分“已被处理 / 已更新（可载入最新材料且保留说明）/ 已不可用”；“下一篇”只在服务器确认后出现；确认送出与通过核验分开、按服务端当前版本送出；永久终止在“更多操作”里、原因必填、独立确认；重新检测匿名稿保留；退回状态只读显示学生看到的原因；PDF Blob 只在本页、离开即撤销；原稿按需读取。
- 不显示专家信息；学校本就能看学生与原稿，可见性提示照旧写明“匿名稿将交给专家 / 原稿仅本校可见”。

### 18.2 外观（R1 已验收的那一套）

- 两页都用 `AppShell`（学校导航，计数“送审准备 = 已加载的待核验数”）；退出登录用新的 `useSignOut`（调用现有 `auth.logout()` 后回登录页），AppShell 本身仍不读 store。
- 清单（queue 模板）：顶栏标题“送审准备”，页级动作放时间范围选择；`FilterBar` = `ViewTabs`（待核验 / 可送出 / 已退回 / 全部）＋“显示”菜单（紧凑行距）＋ `SearchField` ＋专业 `ComboFilter`＋已选条件；口径说明一行；shadcn `Table`；预览 ≥1180 为右侧 360px 栏，以下为右侧抽屉。状态统一用 `StatePanel`。
- 核验台（focus 模板）：顶栏返回“送审准备”、论文题目、学生与专业、“待核验 i / n”；≥1280 三栏可拖动（发现 288、材料、判断 368，像素最小宽度，不跨会话保存）；1024–1279 发现收进左侧抽屉；<1024 发现 / 材料 / 判断标签页。发现用 R1 的 `FindingsList`（来源名称改用真实页的“文件名 / 文件元数据 / 登记信息 / 标题文字核对”，分组名“阻断 / 警告”与报告依据一致）。判断栏底部固定提交条；对话框用 `AlertDialog`；“更多操作”用 `Collapsible`。
- 材料区仍是受控 PDF：`iframe` + `#page=` 跳页（R2 不换 PDF 查看器）。

### 18.3 测试

- 现有 26 条清单与核验台测试保留断言内容，只按新结构改选择器：视图改为 `aria-pressed` 按钮组；对话框经 Teleport 渲染到 body，按 document 查询；横幅用 `data-banner`；“更多操作”用 `data-more-ops`。
- jsdom 没有 `matchMedia`：断点用 `max-width` 查询，默认走宽屏布局，与旧测试一致。
- 两种模式全量测试、两种构建；浏览器在 5196（真实模式，后端 8021）走清单 → 核验 → 返回清单。

### 18.4 R2 结果（2026-11-05，未提交）

- 改动：`PreparationQueue.vue`、`VerifyDesk.vue` 换成 AppShell（queue / focus 模板），脚本逻辑未改（只把旧的 matchMedia 分栏换成 `useMediaQuery`、发现列表换成共用的 `FindingsList`）；`SchoolPreparationPage.vue` 去掉旧 `.ws` 外层与 `workspace.css`，把导航传给核验台。新增 `components/app/shell/useSignOut.ts`、`verify/findingSource.ts`（发现来源名称，纯函数）。`FindingsList` 分组名改为“阻断 / 警告”，与报告依据一致。
- 测试：原 26 条只改选择器（视图按钮 `aria-pressed`、对话框按 body 查询、`data-more-ops`、`data-back`），断言内容不变；横幅保留 `.banner` 类作钩子（未改用 data-banner）。新增 1 条：点发现后匿名稿跳到对应页并计为已查看。`vue-tsc` exit 0；`vitest run --maxWorkers=4` 两种模式均 107 文件 / 844 测试通过；两种 `vite build` exit 0，产物不含原型代码。
- 浏览器（5196 真实模式 → 后端 8021，学校审核种子账号）：清单 1440×900（视图计数、口径说明、右侧 360 预览）、点“打开”进入核验台（三栏 287 / 727 / 368，匿名稿 PDF 为本页 Blob、`#page=1`），“送审准备”返回后视图、选中行与预览原样恢复；核验台 1024×768（发现收进抽屉，判断栏 340）；清单 390×844（行改两段式、预览为抽屉，无横向溢出）。
- 未在真实后端走到：待核验论文的通过 / 退回 / 冲突 / 送出 / 终止（走查库里唯一一篇已完成）；这些由 36 条组件测试覆盖，外观见 R1 样板。首次打开 5196 时 Vite 预构建新依赖会强制刷新一次（开发环境现象）。

## 19. R3：其余真实页面并入统一外壳（施工规格）

用户 2026-11-05 要求继续 R3。按 17.2 的批次推进；每批：规格 → 测试 → 实现 → 两种模式测试与构建 → 浏览器检查。

### 19.1 R3-0 共用一步（先做，影响全部旧外壳页面）

- `OperationsShell`、`PersonalShell` 改为 `AppShell` 的薄适配层：对外 props / 插槽不变（`nav`、`account`、`org`、`#title`、`#context`、默认插槽；`width`），内部渲染 `AppShell`，退出登录走 `useSignOut`。这样所有旧外壳页面立刻共用同一侧栏、顶栏与账户入口；各批次再逐页细化。`FocusShell` 只剩专家评阅台在用（没有导航参数），留到 R3-3 单独迁移。
- `AppShell` 新增 `layout="bare"`：无内边距、不限高度，给自带 `MasterDetail` 或自带版式的旧页面用。
- `workspace.css`：`--ws-*` 全部改为读 tokens（颜色、圆角、控件高度 36、浮层阴影、字体）；共享类（`.btn`、`.input/.select/.textarea`、`wsd-views__tab`、`wsd-titem--on`、`wsd-sec`、`wsd-banner`、`wsd-dtable`）对齐 R1 规格：选中视图为中性填充＋字重，不用整块品牌浅底；小按钮 32px。只改外观，类名与结构不变，测试不受影响。
- `StateBlock` 改为 `StatePanel` 的外观（图标、居中），种类、role 与插槽不变；`StatusPill` 改为 `Badge` 的外观（保留形状记号，不只靠颜色）；`ConfirmDialog` 保留原生 `<dialog>`（不 Teleport，焦点与 Esc 行为不变），外观对齐 AlertDialog。

### 19.2 R3-1 学校：评审进度、结果处理、异议处理

- 评审进度：真实模式新页 `modules/school/progress/SchoolProgressDesk.vue`（demo 仍用 `ReviewProgressPage`）。data 模板：顶栏标题＋时间范围；原四张指标卡改为列表的工作视图（全部 / 待派论文 / 邀请中任务 / 评阅中任务 / 已提交任务，数字来自指标接口，点了即下钻，仍写 `status_filter`），指标失败时视图不显示数字并给出“重试指标”；逾期说明一行；评分分布为右侧小节（只在学校端）；列表为表格（论文、学生、阶段、任务化名·状态·截止），不显示专家身份。数据逻辑沿用 `useOperationsDashboard` 与 `schoolProgressList`，代际防晚到、下钻计数变化提示不变。
- 时间范围用原生 `<select>` 的统一控件 `ScopeSelect`（36px、tokens 外观，`data-time-scope` 不变），R2 清单同步换用，保证各页一致且键盘、手机原生。
- 结果处理、异议处理：经 19.1 进入新外壳；顶栏时间范围换 `ScopeSelect`；清单头部、对象区按 19.1 的共享类外观统一。业务与测试不变。
- 测试：`dashboardMetrics.spec` 与 `realProgress.wiring.spec` 中针对真实模式的用例改为挂新页（断言不变：指标单位、分布、下钻、失败分开重试、晚到丢弃、已选再点刷新、不含专家身份）；demo 页相关用例保留。

### 19.3 R3-0 与 R3-1 结果（2026-11-05）

做了什么：

- R3-0：`OperationsShell`、`PersonalShell` 已是 `AppShell` 的适配层（`components/workspace/`）；`AppShell` 加了 `bare` 版式。`PersonalShell` 的 `width=reading` 用阅读栏 840，`work` 用表单栏 960；菜单放进统一侧栏，不再是顶部横向导航。`StateBlock`、`StatusPill`、`ConfirmDialog` 换成 shadcn 外观，类名（`.block--*`、`.pill--*`、`.dlg`）、role 与插槽不变。
- R3-1：新页 `modules/school/progress/SchoolProgressDesk.vue`，路由按模式三元（demo 仍用 `ReviewProgressPage`）。新统一控件 `components/app/data/ScopeSelect.vue`（原生 select，36px），R2 送审准备清单与结果处理已换用。`ViewTabs` 加了 `select` 事件（再点当前视图也会发，给“已选再点＝刷新”用）和单个视图的 `attrs`。
- 测试：新增 `progress/__tests__/schoolProgressDesk.spec.ts`（8 例，含原 `dashboardMetrics` 的 5 个学校真实模式用例、原 `realProgress.wiring` 的租户用例，另加表格行内容与列表失败原位重试）；两份旧文件只留平台派单台与菜单 / 字段映射用例。

和 19.1 / 19.2 的出入：

- 适配层插槽：旧 `#context` 有的页面放说明文字、有的放按钮。现在 `#context` 是标题旁的说明（窄屏隐藏），页级控件改放新增的 `#actions`。结果处理、派单台、专家库、学校主体、批次、成员这几页（以及旧原型屏）的按钮已移到 `#actions`；派单台的说明文字与控件已拆开。
- `StatusPill` 没有保留圆点 / 菱形记号：标签文字本身说明状态，与 `StatusBadge` 统一为同一外观，不再有两种标签。
- 已有的 `components/app/TimeScopeSelect.vue`（旧页面在用，带说明块）没有改，新页面一律用 `ScopeSelect`；近一年的说明放在页面里。
- 时间范围在派单台、学生 / 导师反馈页仍是旧的原生 select，分别在 R3-2、R3-4 换。

验证：

- 两种模式各 108 个文件 / 846 例通过；`vue-tsc --build` 退出 0；两种模式 `vite build` 成功，产物不含原型代码。
- 浏览器（5196 → 8021 走查后端，学校账号）：1440 宽评审进度显示五个视图与计数、逾期说明、表格（论文、学生、阶段、任务化名与状态）、右侧评分分布；点“已提交任务”后 URL 写入 `status_filter=SUBMITTED`、视图按下、列表显示“当前 1 个任务”。结果处理（已发布对象区）、异议处理都在统一外壳内正常显示、接口全部 200。390 宽评审进度为卡片列表、无横向溢出。
- 没有走到：走查数据里没有逾期任务、没有进行中的邀请，计数变化提示（“数据已更新”）只在测试里验证。

### 19.4 R3-2 平台：派单台、专家库、更正审批（施工规格）

用户 2026-11-05 要求开始 R3-2。

**专家库**（data，按 R1 样板一，`modules/expert-management/library/ExpertLibraryDesk.vue`）：

- 没有 `expert` / `new` / `import` 参数时是清单页（`layout="data"`）：
  - 工具栏用 `FilterBar`，依次放工作视图、显示设置、搜索、筛选、已选条件。
    - 工作视图：全部 / 可指派 / 待审核 / 暂不可派，默认“全部”（R1 已确认）；写 `?view=`，默认值不写进地址。
    - 显示设置：可隐藏的列只存在本页状态里。
    - 搜索：写 `?q=`。
    - 筛选：学科 `ComboFilter`，选项只列库里出现过的学科，写 `?discipline=`；职称 `Select`，写 `?title=`；省份 `ComboFilter`，写 `?province=`。
    - 已选条件可以逐个移除，也可以一次全部清除。
  - 表格是 `ExpertTable`。
  - 表格下一行写“显示 n / m 位专家”，并说明“资料为人工维护、未核验；来源说明不代表实名认证”。
  - 点姓名打开预览 Sheet（`ExpertPreview`，只读，打开状态只在本页）；在预览里点“打开完整档案”或在表格行点“档案”，写入 `?expert=`。
  - 顶栏动作是“导入档案”“新建专家”，`data-action` 不变。
  - 清单页不再自动选中第一位专家，因为表格页没有详情栏。
- `?expert=`、`?new=1`、`?import=1` 是完整页（`layout="form"`，960 居中）：
  - 顶栏有返回链接“专家库”（`data-back`）。返回时只去掉这三个参数，视图和筛选保留。
  - 内容仍是 `ExpertObject`、`ExpertCreate`、`ExpertImportPane`，业务、命令、版本号、幂等键、409 处理都不变。
  - 专家不在库里时，提示“这位专家不在专家库中”，并给出“返回专家库”。
  - 新建成功后的地址仍是 `{ view: 'pending', expert }`。
- 窄屏：清单页的表格可以横向滚动（`DataTableShell` 已处理），完整页本来就是单栏。旧的“窄屏先显示清单、‹ 返回”行为随主从布局一起取消。
- 测试：只改清单相关的用例，选择器换成 `[data-preview]` 行、`[data-view-tabs]` 计数、`[data-search] input`、经地址设置学科筛选，并验证已选条件可以移除。窄屏用例改成“预览 → 完整档案 → 返回保留视图”。对象区、新建、导入的用例不改。

**派单台**（queue＋候选比较表）：结构与业务不变（清单｜论文需求、任务与候选表、提交条、改派确认）。

- 顶栏时间范围换成 `ScopeSelect`；“延期审批”换成 shadcn 次要按钮，保留 `aria-expanded` 与 `data-action`。
- 页内 scoped 样式按令牌对齐 R1：
  - 视图选中时用中性填充＋字重；
  - 清单选中行用中性底；
  - 候选表表头为 12px 弱色、40px 高；
  - 提交条用浮层阴影；
  - 改派确认框随 `ConfirmDialog` 统一。
- 测试不改。

**更正审批**（queue）：经 R3-0 已在统一外壳里，共享类已经对齐。本批只检查外观，必要时修页内样式，测试不改。

验收：两种模式测试、`vue-tsc --build`、两种构建；浏览器在 5196 用平台账号检查三页（1440 / 1024 / 390）；结果记在 19.5。

### 19.5 R3-2 结果（2026-11-05）

做了什么：

- 专家库按 19.4 改为“清单页（满宽比较表＋预览）｜完整页（档案 / 新建 / 导入）”。`ExpertLibraryDesk.vue` 直接用 `AppShell`，不再经 `OperationsShell` 和 `MasterDetail`；`ExpertTable`、`ExpertPreview`（R1 建的展示组件）接入真实数据；`ExpertObject`、`ExpertCreate`、`ExpertImportPane` 原样复用。
- 派单台：顶栏换成 `ScopeSelect` 和 shadcn 次要按钮；页内视图选中、清单选中行改为中性底，候选表表头 40px，提交条加了浮层阴影。
- 更正审批：没有改代码。R3-0 之后外观已经一致。
- 测试：`expertLibraryDesk.spec.ts` 改了 4 例，都是清单相关的：
  - 视图计数与默认“全部”、地址打开档案；
  - 搜索、学科筛选与已选条件移除、“清除筛选”；
  - 预览 → 完整档案 → 返回保留视图（替代原窄屏用例）；
  - 加载失败后重试，期望改为全部 4 位。
  
  对象区、新建、导入用例都没动；派单台、更正审批的测试也没动。

和 19.4 的出入：没有。

验证：

- 两种模式各 108 个文件 / 846 例通过；`vue-tsc --build` 退出 0；两种构建成功，产物不含原型代码。
- 浏览器（5196，平台账号）：
  - 专家库 1440：五列以上可比较，视图计数正确；点姓名打开预览，“打开完整档案”进入 960 居中档案页，返回链接回到清单。
  - 专家库 1024 / 390：表格在自己的容器里横向滚动，页面没有横向溢出。
  - 派单台、更正审批：在统一外壳里显示空态。
- 没有走到：走查数据里没有待派论文，也没有更正申请，所以派单台候选表、改派确认、更正审批对象区只在测试里验证过。
- 遗留（原有行为，没改）：派单台清单为空时，右侧没有任何说明。

### 19.6 R3-3 专家：任务、评审邀请、专注评阅（施工规格）

用户 2026-11-05 要求开始 R3-3。`ExpertTasksPage`、`InvitationPage` 是 demo / 真实两用的旧页（PortalLayout）。做法同 R3-1：真实模式换新页，路由按模式三元，demo 仍用旧页；旧页的真实模式用例移到新页。

**我的任务**（data，新页 `modules/review/tasks/ExpertTaskDesk.vue`）：

- 顶栏：标题“评审任务”。说明“只显示本人任务；接受前只能看到匿名概要”。右侧放 `ScopeSelect`。选“近一年”时，页内加一行说明“较早建立论文的未结任务可能未显示”。
- 工作视图（`ViewTabs`，每个视图挂 `data-tab`）：待接受 / 评阅中 / 已完成 / 已拒绝 / 已撤销 / 需要更正，都带计数。默认停在第一个有任务的视图（规则同旧页）。
- 表格（宽屏）列为：匿名任务（编号＋匿名题目）、送审方向、截止（北京时间；待接受显示接单截止，其余显示评阅截止）、状态（`StatusBadge`，另有“已逾期”“需要更正”标签）、操作。窄屏（<768）改为卡片。行与容器保留 `data-expert-task`、`data-expert-task-table`。
- 操作按服务端 `allowed_actions` 决定，规则与旧表相同：
  - 待接受：“接受”（`data-action="accept-task"`），打开确认框；
  - 评阅中：“继续评阅”链接（`continue-review`，带 `task_id`）；
  - 已提交：“查看”链接（`view-submitted`）；
  - 有评阅截止时多一个“评阅延期”，在表格下方展开 `ExtensionPanel`。
- 接受确认用 `AlertDialog`，文案与旧页相同；不显示费用；失败时错误留在框内；`data-action` 不变。
- 状态：加载中、失败（原位重试）、视图为空（“当前分组暂无任务。”）。
- 不做旧表的“列偏好”（顺序 / 显示持久化）。新表只有 5 列，没有可隐藏的必要；旧页在 demo 模式下保留这项功能。

**评审邀请**（form，新页 `modules/review/invitation/InvitationDesk.vue`）：

- 顶栏有返回链接“我的任务”（`data-back`），标题“评审邀请”。
- 和旧页一样，取本人第一个“待接受”任务并读取邀请详情。
- 内容是一张卡片：匿名任务编号＋“待接受”，下面列匿名题目、送审方向、接单截止（北京时间，逾期时标注）。
- 回避声明改为说明文字，不再用“已勾选且禁用”的复选框，因为它不是可操作的控件。
- 卡片里说明“接受前不开放论文正文”。操作有“拒绝任务”（`open-reject-dialog`）和“接受任务并开始评阅”（`accept-task`）。
- 接受确认用 `AlertDialog`，接受后进入 `/expert/review?task_id=`。
- 拒绝确认框：原因用原生 select（`data-reject-reason`），选“其他”时说明必填（`data-reject-reason-detail`），确认按钮为 `confirm-reject-task`，提交内容为“其他：说明”。拒绝后显示“当前没有待处理的评审邀请”，并给出回到任务列表的链接。
- 状态：加载中、失败、没有邀请。

**专注评阅**（focus，`ExpertReviewDesk.vue`）：

- `FocusShell` 换成 `AppShell layout="focus"`，进入时收起侧栏、不写偏好；侧栏只有“我的任务”。
- 插槽对应：
  - 返回按钮 → `#back`（`data-action="back-to-tasks"`，离开前仍先保存）；
  - 任务编号与匿名题目 → `#title`（`.code`、`.rv-title`）；
  - 截止与逾期 → `#context`；
  - `SaveStatus` → `#actions`。
- 正文布局、保存队列、冲突、提交、更正面板都不变。
- `FocusShell` 改完后不再有页面使用，先保留文件，最后的清理批次再删。

**测试**：

- 新增 `tasks/__tests__/expertTaskDesk.spec.ts`、`invitation/__tests__/invitationDesk.spec.ts`。移入的用例有：`realWorkspace.spec` 里任务列表与邀请的 5 个真实模式用例、`timeScopePages.spec` 的 3 个用例（挂新页）。
- “分组名显示在页头”这一例原来断言 BlindRail 的 stage，改为断言视图按下状态与空态文字。
- 评阅台测试不改。

验收：两种模式测试、`vue-tsc --build`、两种构建；浏览器在 5196 用专家账号检查三页（1440 / 390）；结果记在 19.7。

### 19.7 R3-3 结果（2026-11-05）

做了什么：

- 新页 `modules/review/tasks/ExpertTaskDesk.vue`、`modules/review/invitation/InvitationDesk.vue`，按 19.6 实现，路由按模式三元（demo 仍用旧页）。
- `ExpertReviewDesk.vue` 从 `FocusShell` 换到 `AppShell layout="focus"`，插槽按 19.6 对应；窄屏只在 ≤640 时隐藏题目（原来 ≤899 就隐藏，统一外壳之后顶栏有足够宽度）。
- 三页账户角色统一显示为“评阅专家”。
- 测试：
  - 新增 `tasks/__tests__/expertTaskDesk.spec.ts`（8 例）、`invitation/__tests__/invitationDesk.spec.ts`（4 例）；
  - `realWorkspace.spec` 去掉移走的 5 例；
  - `components/app/__tests__/timeScopePages.spec.ts` 的 3 例全部移到新页，原文件删除（未暂存）；
  - 评阅台测试不改。

和 19.6 的出入：没有。旧表的列偏好按 19.6 没有带到新页。

验证：

- 两种模式各 109 个文件 / 850 例通过；`vue-tsc --build` 退出 0；两种构建成功，产物不含原型代码。
- 浏览器（5196，专家账号）：
  - 1440 宽：
    - 任务页停在第一个有任务的视图（已完成 1），“查看”进入评阅台；
    - 评阅台进入时侧栏收起为图标轨，已提交意见在自己的滚动区内滚动；返回“我的任务”后侧栏恢复展开；
    - 邀请页在没有邀请时给出空态和“查看我的任务”。
  - 390 宽：任务卡片和评阅台顶栏都没有横向溢出。
- 没有走到：走查数据里这位专家没有待接受或评阅中的任务，所以接受确认、拒绝确认、邀请卡片、评阅表单与自动保存只在测试里验证过。

### 19.8 R3-4 学生与导师：首页、编辑、正式反馈（施工规格）

用户 2026-11-05 要求开始 R3-4。四页都只在真实模式使用（demo 走旧组件，路由已有三元），所以原地改，不新建页面、不动路由。

**学生首页**（`StudentPortalPage.vue`，reading）：

- 去掉 `PersonalShell`，直接用 `AppShell layout="reading"`：顶栏标题“我的送审”，`#context` 放批次名和“收件截止 …（北京时间）”；内容区不再重复 h1。
- 当前论文卡、退回原因、下一步、材料状态、处理记录、空态 / 无资格说明，内容与条件都不变，只换成令牌样式；按钮、链接换 shadcn `Button`（链接用 `as-child`）。
- “更多”菜单保留自写的小菜单（`data-action="more"` 后出现 `delete-draft` / `withdraw`），只换外观；不用 reka DropdownMenu，因为它按 pointerdown 打开、在测试和触屏上行为不同，这里两个选项不值得。
- “其他论文”的时间范围换 `ScopeSelect`；列表换令牌样式，窄屏仍折行。
- 状态换 `StatePanel`（加载、列表失败带“重新加载”、无资格用 forbidden、资格读取失败用 error）。
- 删除 / 撤回确认仍用原生 `ConfirmDialog`（R3-0 已换外观），按钮换 `Button`，`data-action` 与 `data-withdraw-reason` 不变。

**编辑页**（`StudentThesisEditor.vue`，form）：

- 直接用 `AppShell layout="form"`：`#back` 放“我的送审”链接（`data-back`）；标题按状态：新建为“开始送审”，编辑为论文题目（前面带草稿 / 已退回标签），其余为“编辑论文”；编辑态的 `SaveStatus` 放 `#actions`。内容区不再写 h1。
- 只做外壳层面的迁移：内嵌的 `ThesisMaterialEditor`、`SensitiveFindingPanel`、`DisciplineSelector`、`PdfTransformDialog` 不改（它们还依赖 `.ws` 旧样式，整页仍包在 `.ws` 里）。
- 步骤导航、三个分区卡片、冲突横幅、底部操作条换令牌样式；按钮换 `Button`，`data-*` 钩子全部不变。
- 状态换 `StatePanel`（加载、失败、不可编辑用 forbidden）；“本批次没有可选专业”用 `StatePanel compact`（kind empty）。
- 提交确认仍用原生 `ConfirmDialog`。

**学生正式反馈**（`StudentFeedbackPage.vue`，reading，按 R1 样板）：

- `AppShell layout="reading"`，标题“评阅结果”，`ScopeSelect` 放 `#actions`。
- 多篇已发布论文时，内容区顶部仍是原生论文选择（`data-thesis-picker`）。
- 正文换 `FeedbackDocument`（R1），旧 `FeedbackArticle` 不再被页面使用（文件留到清理批次）。
- 状态换 `StatePanel`，保留 `data-unpublished`、`data-feedback-invalid`、`data-action="retry-feedback"`。
- 异议区（`.objection`）：
  - 已有异议的记录（`data-objection-status`）和提示（`data-objection-notice`）始终直接显示；
  - 可以登记时，表单按 R1 收在“对这份结果有异议？”折叠里（`Collapsible`，触发按钮 `data-action="toggle-objection"`，默认收起），展开后先说明规则，再是两个必填文本框（`name` 不变）和“登记异议…”；
  - 不能登记且没有记录时，直接显示 `data-objection-closed` 说明；
  - 确认仍用 `ConfirmDialog`，幂等键与 409 处理不变。

**导师正式反馈**（`SupervisorFeedbackPage.vue`）：同上外壳，标题“学生评阅结果”；学生选择仍是原生 select（`data-student-picker`）加提示；正文用 `FeedbackDocument`，没有异议区，页面不出现“异议”。

**测试**：

- `feedbackPages.spec` 的异议用例先点开折叠（`toggle-objection`），这是设计改动带来的测试改动；其余断言不变。
- `studentWorkspace.spec` 不改：编辑页 `h1` 仍是论文题目（现在在顶栏）。
- 新增一例：学生反馈页在可登记时默认不显示表单，点开后才出现。

验收：两种模式测试、`vue-tsc --build`、两种构建；浏览器在 5196 用学生、导师账号检查（1440 / 390）；结果记在 19.9。

### 19.9 R3-4 结果（2026-11-05）

做了什么：

- `StudentFeedbackPage.vue`、`SupervisorFeedbackPage.vue`：
  - 改用 `AppShell layout="reading"`，标题分别为“评阅结果”“学生评阅结果”，`ScopeSelect` 放在 `#actions`；
  - 正文换成 `FeedbackDocument`；状态换成 `StatePanel`；
  - 学生异议表单收进 `Collapsible`（`toggle-objection`），记录与提示始终显示；
  - 导师的“只列出你指导的……”提示移到 `#context`。
- `StudentPortalPage.vue`：
  - 改用 `AppShell layout="reading"`，标题“我的送审”，批次和截止放 `#context`；
  - 当前论文卡、下一步、材料、处理记录、其他论文换成令牌样式；“更多”改为图标按钮，菜单点外面会关闭（`onClickOutside`）；
  - `ScopeSelect`、`StatePanel`、`Button` 都已替换；两个确认框的按钮换成 `Button`；
  - 测试用的类名钩子 `.current`、`.empty`、`.returned`、`.materials`、`.others` 保留。
- `StudentThesisEditor.vue`：
  - 改用 `AppShell layout="form"`；`#back` 链接回“我的送审”（`data-back`）；
  - 编辑态的 `#title` 显示状态标签和论文题目，`#actions` 放 `SaveStatus`；
  - 状态改用 `StatePanel`，12 个按钮换成 `Button`，并显式写了 `type`；
  - 内嵌的旧组件和分区样式没有改。
- 测试：
  - `feedbackPages.spec` 里的异议用例先点开折叠；
  - 新增一例：表单默认收起；
  - `studentWorkspace.spec` 没有改。

和 19.8 的出入：编辑页顶栏标题在非编辑态显示“送审材料”，不是“开始送审”。新建卡片保留自己的标题“开始送审”（`#create-h`，测试会读它），这样顶栏和卡片不会重复同一句话。

验证：

- 两种模式各 109 个文件 / 851 例通过；`vue-tsc --build` 退出 0；两种构建成功，产物不含原型代码。
- `FeedbackArticle` 现在没有页面使用（只在 `FeedbackDocument` 的注释里提到），文件留到清理批次再删。
- 浏览器：**还没有做。** 5196 上要用学生和导师的种子账号登录，但本轮会话没有权限读取测试口令。浏览器里现在登录的是专家账号。

### 19.10 R3-5 设置、系统、登录（施工规格）

用户 2026-11-06 要求开始 R3-5（R3-4 的浏览器检查按用户决定跳过）。七页都已经通过 R3-0 的适配层进入统一外壳，共享类也已经读令牌，所以这一批做页面层：

- 不再经过 `OperationsShell`，直接用 `AppShell`：标题用 `title` 属性（不再写 `h1.wsd-title`），说明放 `#context`，页级按钮放 `#actions`；
- 状态换 `StatePanel`，页面上的按钮换 `Button`；
- 内嵌的对象组件不改结构，只靠已有的共享类外观：`BatchObject`、`BatchCreate`、`MemberObject`、`MemberCreate`、`OpenDisciplines`、`ProgramImport`、`TenantObject`、`TenantCreate`。

逐页：

- **批次与规则**（`BatchSettingsPage`，queue）：
  - `layout="bare"`，仍用 `MasterDetail`（清单 300 宽）；
  - 清单项保留 `wsd-titem`；“新建批次”在 `#actions`（`data-action="new-batch"`）。
- **成员与资格**（`MemberSettingsPage`）：
  - `layout="bare"`，仍用 `MasterDetail`；
  - 成员类型视图换 `ViewTabs`（学生 / 导师 / 全部，带计数）；
  - 搜索保留原生输入，只用令牌外观。
  - 和 17.2 的出入：不改成“可比较表＋详情 Sheet”。成员对象区里有资格的新建、编辑和停用表单，放进 Sheet 会让表单变窄，而且会遮住清单；成员清单本身只有姓名、类型、编号、账号四项，用不上表格比较。清单｜对象两栏已经满足“边看清单边处理”。
- **学科与专业**（`DisciplineSettingsPage`，form 960）：两个分区换 `ViewTabs`，每项挂 `data-tab`；地址里的 `?tab=` 规则不变。
- **检测词表**（`TermSettingsPage`，form 960）：
  - 版本与条数放在 `#context`；
  - 可编辑表、冲突横幅、底部提交条（`.wsd-commit`）结构不变，按钮换 `Button`。
- **学校管理**（`TenantDesk`）：
  - 清单页 `layout="data"`：工具条（搜索、状态，原生控件，`data-field` 不变）；表格改为令牌样式，整行可点，名称按钮可用键盘操作；底部是数量说明；
  - 详情页和新增页 `layout="form"`：`#back` 放“学校管理”（`data-action="to-list"`），标题为学校名称或“新增学校”。
- **官方基础目录**（`OfficialCatalogPage`，form 960）：预览、差异计数表、来源、确认导入的流程不变，外观换令牌；确认仍用 `ConfirmDialog`。
- **登录**（`LoginPage`、`AuthLayout`、三个登录方式面板、`LoginChannelTabs`）：
  - 全部改为令牌颜色和 shadcn 控件（`Input`、`Button`、`Label`）；
  - 去掉英文大写眉题（ACCOUNT ACCESS / DOUBLE-BLIND REVIEW）；左侧品牌区用主色，不再用硬编码的渐变色值；
  - 结构、文案主体、`role="tablist"` / `tabpanel` 语义、`autocomplete`、`name`、`data-*` 钩子、演示入口都不变。

**测试**：

- `memberSettings.spec` 里的视图用例改用 `ViewTabs` 的钩子（`[data-view]` 和按钮内的计数），这是设计改动带来的测试改动；
- 其余测试不改。

验收：

- 两种模式测试、`vue-tsc --build`、两种构建；
- 浏览器：登录页 1440 / 390（不需要账号）；其余页面需要学校或系统管理员登录，本会话没有权限读取测试口令，能做多少记多少，结果记在 19.11。

### 19.11 R3-5 结果（2026-11-06）

做了什么：

- 批次与规则、成员与资格、学科与专业、检测词表、学校管理、官方基础目录这六页不再经过 `OperationsShell`，直接用 `AppShell`：
  - 标题走 `title` 属性，说明放 `#context`，页级按钮放 `#actions`；
  - 状态换 `StatePanel`（`nomatch` 对应 `noresult`，`unconfigured` 对应 `empty`）；
  - 页面上的按钮换 `Button` 并显式写 `type`；状态面板里的“重试”统一用 outline。
- 成员类型视图、学科分区都换成 `ViewTabs`。学科分区保留 `data-tab`，`?tab=` 规则不变。
- 学校管理：
  - 清单页 `layout="data"`：工具条用令牌外观的原生控件，表格是令牌样式，整行可点，名称按钮有焦点环，底部是数量说明（`data-count`）；“只管理学校与账号、不读正文”改放 `#context`；
  - 详情页和新增页：`#back` 是“学校管理”（`data-action="to-list"`），标题为学校名或“新增学校”；
  - 列表失败时的重试按钮加了 `data-action="retry-tenants"`。
- 登录：
  - `AuthLayout` 左侧品牌区用主色，标题用宋体，去掉了两处英文大写眉题，补了一句双盲说明；窄屏时品牌区收成顶部一条，表单贴着它从上往下排；
  - `LoginPage` 换 `Input`、`Button`、`Label`，演示入口换令牌样式；
  - 三个登录方式面板和 `LoginChannelTabs`：硬编码色值全部换成令牌，控件高 40，并加了焦点环；
  - 结构、`role`、`autocomplete`、`name`、`data-*` 都没变，测试钩子 `.login-form__notice` 保留。
- 测试：
  - `memberSettings.spec` 的视图用例改用 `[data-view]`；
  - `tenantDesk.spec` 的重试改用 `retry-tenants`，原来靠的是 `.btn--primary` 类；
  - 其余测试没有改。

和 19.10 的出入：

- 学科与专业、检测词表、官方基础目录用的是 `layout="bare"`，不是 `form`。这三页的 `.wsd-obj` 自带内边距，提交条是贴底的满宽条；用 `form` 会让内边距加倍，提交条也会被压进 960 栏里。现在的做法是内容居中 960（`margin-inline: auto`），提交条仍然满宽贴底。学校管理的详情页和新增页同样处理。
- 成员页没有改成表格加 Sheet，原因见 19.10。

验证：

- 两种模式各 109 个文件 / 851 例通过；`vue-tsc --build` 退出 0；两种构建成功，产物不含原型代码。
- 浏览器（5187，登录页不需要账号）：
  - 1440：两栏，空提交时提示“请输入账号和密码。”；
  - 390：品牌条在上，表单紧跟在下面，切到“学校统一认证”正常，没有横向溢出；
  - 第一次检查时窄屏表单在剩余高度里垂直居中，上方空出一大块，已改为从上往下排。
- 没有走到：其余六页需要学校或系统管理员登录，本会话没有权限读取测试口令，只在测试里验证过。

### 19.12 R4 清理（施工规格）

用户 2026-11-06 要求开始清理批次。按 17.6，R4 要删除旧外壳，并决定 Element Plus 的去留。演示模式按 D1-b 保留（§16.4），只在演示模式可达的旧页和 `PortalLayout` 都不在本批范围内。

盘点（按源码 import，不含测试）：

| 对象 | 现在谁在用 | 本批处理 |
|---|---|---|
| `OperationsShell` | 真实页：结果处理、异议处理、派单台、更正审批；U3 原型屏 11 个 | 四个真实页改为直接用 `AppShell`，之后只剩原型屏在用 |
| `PersonalShell`、`FocusShell` | 只有 U3 原型屏（学生门户、反馈阅读、学校核验、专家评阅） | 不动，见下文“待用户决定” |
| `PortalLayout` | 演示旧页，以及两种模式都还在用的未改造页（财务、档案、通知、导出、审计、学校账户） | 保留 |
| `FeedbackArticle` | 没有页面使用 | 删除 |
| `StateBlock`、`StatusPill`、`MasterDetail`、`useNarrow`、`ConfirmDialog` | 真实页仍在用（R3-0 已换外观） | 保留 |
| Element Plus | `main.ts` 全局注册；`request.ts` 的 `ElMessage`；`PdfTransformDialog`、`ColumnPreferences` 各用了一组图标。没有任何模板用到 `el-*` 组件，`components.d.ts` 里也没有 El 组件 | 按 17.6 的退出条件移除 |

做法：

1. **四个真实页**（`SchoolResultsDesk`、`SchoolObjectionsDesk`、`PlatformDispatchDesk`、`CorrectionApprovalDesk`）：
   - 和 R3-5 一样直接用 `AppShell layout="bare"`：标题走 `title`，说明放 `#context`，页级按钮放 `#actions`；
   - 状态换 `StatePanel`，页面层的按钮换 `Button`；
   - `MasterDetail` 和对象组件不动。
2. **全局错误提示**：
   - 新增 `components/app/notify/`：`notify.ts` 是一个响应式队列，对外只有 `notify.error(text)`；同一句话正在显示时不会再叠一条，5 秒后自动消失；`AppToaster.vue` 放在 `App.vue`，是顶部居中的提示区（`role="status"`、`aria-live="polite"`），颜色读令牌；
   - `request.ts` 的 `ElMessage.error` 改为 `notify.error`，文案和触发条件不变；
   - `quietErrors.spec`、`loginFailure.spec` 改为 mock 这个模块。
3. **图标**：两处 `@element-plus/icons-vue` 换成 `@lucide/vue`。
4. **去掉注册与依赖**：
   - `main.ts` 不再注册 Element Plus；`vite.config.ts` 去掉 `ElementPlusResolver`，两个 unplugin 保留，它们还负责本地组件的自动注册；
   - 从依赖里删除 `element-plus`、`@element-plus/icons-vue`；
   - 构建产物里不再出现 element-plus。
5. **删除** `modules/result/feedback/FeedbackArticle.vue`。`FeedbackDocument` 注释里提到它的那句一并改掉。

**待用户决定（本批不做）：**

- U3 原型屏 `src/prototypes/screens/`（16 个文件，只在开发模式注册）已经被真实新页和 R1 样板取代；
- 它们是 `OperationsShell`、`PersonalShell`、`FocusShell` 的最后使用者；
- 删掉它们，三个旧外壳就可以一起删除；
- 这是删除已有成果，所以先列出来，由用户决定。

验收：

- 两种模式测试、`vue-tsc --build`、两种构建；
- 产物里检索不到 element-plus；
- 浏览器（5187 登录页，不需要账号）：空提交仍是页内提示，不弹全局提示。

结果记在 19.13。

### 19.13 R4 清理结果（2026-11-06）

做了什么：

- 结果处理、异议处理、派单台、更正审批四页改为直接用 `AppShell layout="bare"`；状态换 `StatePanel`，页面层的按钮换 `Button`（派单台已有的 `Button` 导入没有重复）。现在所有真实页面都不经过 `OperationsShell`。
- 全局提示：
  - 新增 `components/app/notify/notify.ts` 和 `AppToaster.vue`，并挂在 `App.vue`；
  - `request.ts` 改用 `notify.error`，文案和触发条件不变；
  - 新增 `notify/__tests__/notify.spec.ts`（1 例：同一句不重复、能手动关闭、5 秒后自动消失）；
  - `quietErrors.spec`、`loginFailure.spec` 改为 mock 这个模块。
- Element Plus：
  - `main.ts` 不再注册；`vite.config.ts` 去掉 `ElementPlusResolver`，两个 unplugin 保留；
  - 两处图标换成 Lucide（`ArrowUp`、`ArrowDown`、`X`、`Plus`、`GripVertical`）；
  - `pnpm remove element-plus @element-plus/icons-vue`（离线完成，lockfile 同步，少了 12 个包）；
  - 删除 `styles/element.css` 及其在 `main.css` 里的引入，`main.css`、`tokens.css` 的注释同步。
- 删除 `modules/result/feedback/FeedbackArticle.vue`，`FeedbackDocument` 的注释同步。

所有删除都是受 git 跟踪、删除前未改动的文件，都没有暂存。

和 19.12 的出入：`styles/element.css` 不在原来的盘点里。浏览器检查时发现页面仍带着 `--el-*` 变量，追查到这个文件，就一并删除了。

验证：

- 两种模式各 110 个文件 / 852 例通过（比 R3-5 多 1 个文件 1 例，就是 `notify.spec`）；
- `vue-tsc --build` 退出 0；两种构建成功；产物里检索不到 `element-plus`、`--el-`，也没有原型代码；
- 浏览器（5187 登录页）：页面正常，空提交仍是页内提示，没有弹全局提示；提示区已挂载；样式表里没有 `--el-*`；控制台没有错误。

仍然保留：

- `OperationsShell`、`PersonalShell`、`FocusShell` 只剩 U3 原型屏（`src/prototypes/screens/`，16 个文件，只在开发模式注册）在用，等用户决定（见 19.12）；
- `PortalLayout`、演示旧页、`TimeScopeSelect` 按 D1-b 保留；
- `StateBlock`、`StatusPill`、`MasterDetail`、`useNarrow`、`ConfirmDialog` 仍被真实页使用。

### 19.14 R4 补充：删除 U3 原型屏与旧外壳（2026-11-06）

用户确认删除（对 19.13 末尾待决事项的答复）。

先更正 19.13 的说法：U3 原型屏引用的是 `src/prototypes/kit/` 里的外壳副本，不是 `components/workspace/` 下的那三个。后者在 R4 前四页迁走后已经没有任何引用。

删除（均未暂存，可从 git 恢复）：

- `src/prototypes/screens/`（17 个文件，含 `PrototypeIndex.vue`）；
- `src/prototypes/kit/`、`src/prototypes/data/`：只被 U3 屏使用，R1 样板一个都没引用，连同 `kit/__tests__/draftController.spec.ts`；
- `components/workspace/` 下的 `OperationsShell`、`PersonalShell`、`FocusShell`，以及只被它们用到的 `AccountMenu`、`WorkspaceBrandMark`。

改动：

- `prototypes/routes.ts`：去掉 17 条 U3 路由，`/prototype` 改为重定向到 `/prototype/r1`；
- `workspace.css`、`useSignOut.ts`、`useNarrow.ts` 里提到已删文件的注释同步修改。

保留：R1 样板（`src/prototypes/r1/`），以及仍被真实页使用的 `StateBlock`、`StatusPill`、`MasterDetail`、`SplitPane`、`SaveStatus`、`ConfirmDialog`、`useNarrow`、`accountInitial`、`types`。

验证：

- 两种模式各 109 个文件 / 838 例通过。比 19.13 少 1 个文件 14 例，就是随 kit 删除的 `draftController.spec`；
- `vue-tsc --build` 退出 0，两种构建成功；
- 浏览器（5187）：`/prototype` 重定向到 R1 索引，R1 专家库样板和登录页正常，控制台没有错误。

## 20. 全站一致性验收（v3 §14，施工规格）

基线：`bfcb314`（R1–R4 已提交，未推送）。只验收，不改代码；发现的问题记入 20.3，另开修正批次，先写规格再修。

### 20.1 环境

- 真实模式 vite 5196，代理到 walk 后端 8021。8021 用的是 5433 / `paper_review_test` 里的临时 schema 和临时存储，不碰共享开发库，也不碰 5432。
- 登录用 `backend/app/seed.py` 的种子账号，由用户授权读取。密码不写进文档、截图说明或对话。
- 浏览器：Claude 桌面应用内置浏览器（Chromium）。尺寸用视口模拟：1366×768、1440×900、1920×1080、1024×768、390×844。面板比模拟尺寸小时会按比例缩放，截图如实注明。

### 20.2 范围

| 角色 | 账号 | 页面 |
|---|---|---|
| 学校审核 | `school.wang` | 送审准备、单篇核验、评审进度、结果处理、异议处理、批次与规则、成员、学科与专业、敏感词 |
| 百杰审核 | `platform.chen` | 派单台、专家库（含专家详情）、更正审批 |
| 专家 | `expert.zhou` | 我的任务、评审邀请、专注评阅 |
| 学生 | `student.lin` | 我的送审、编辑或送审材料、评阅结果 |
| 导师 | `supervisor.zhao` | 学生评阅结果 |
| 系统管理员 | `admin.system` | 学校与租户、官方目录 |
| 未登录 | — | 登录页的三个页签 |

每页按 v3 §14.1 的表逐项看：同一产品、空间、密度、筛选、文档、交互、内容、生产边界。具体做法：

- 五种尺寸各截一张图。1366×768 下要一眼看到主要内容和动作；390×844 下不能横向溢出，侧栏要收起；
- 键盘 Tab 能走到主要动作，焦点看得见；
- 不改数据的交互都实际点一遍：筛选、搜索无结果、页签、打开再关闭弹窗、展开和收起、切换身份、退出登录；
- 会写数据的动作（提交、接受、保存、发布）只在 walk 的临时 schema 里做，并且逐项先问用户；
- 隐私边界：学校的页面上不出现专家姓名；专家的页面上不出现作者和原文。

浏览器里自然到达不了的状态，标 NOT RUN 并注明已有哪些组件测试覆盖，不拿测试结果冒充浏览器验收。这类状态包括：500、409、报告过期、双页签冲突，以及 walk 数据里没有的长标题、长评语。

### 20.3 结果（2026-11-06，基线 `bfcb314`）

环境：Claude 桌面应用内置浏览器（Chromium），5196 → walk 8021。浏览器面板当时是隐藏状态，模拟尺寸比面板大时按比例缩小。登录用用户在对话里给的测试密码，文档里不记录。

**覆盖**

六个角色共 21 个页面状态，外加登录页三个页签，每个都在 1366×768、1440×900、1920×1080、1024×768、390×844 下打开过：

| 角色 | 页面 |
|---|---|
| 学校审核 | 送审准备（含"全部"视图）、单篇核验、评审进度、结果处理（含已发布对象）、异议处理（含对象）、批次与规则、成员与资格、学科与专业、检测词表 |
| 百杰审核 | 派单台、专家库、专家档案、更正审批 |
| 专家 | 评审任务、评审邀请（空态）、专注评阅（已提交只读） |
| 学生 | 我的送审、送审材料（不可编辑态）、评阅结果（异议已登记） |
| 导师 | 学生评阅结果 |
| 系统管理员 | 学校管理、学校对象、官方基础目录 |

每个尺寸都用脚本量了 `scrollWidth`、超出视口的元素和标题位置；1366×768 和 390×844 每页截图，其余尺寸抽样截图。

**通过的项**

- 横向溢出：所有页面、所有尺寸都没有页面级横向溢出。390 下侧栏收起，列表改成卡片，核验页改成"发现 / 材料 / 判断"三段切换；1024 下核验页的发现栏收成按钮。
- 同一产品：六个角色用的是同一套外壳（侧栏、账户菜单、标题栏）。专注模式是同一外壳的窄侧栏变体。
- 隐私边界：
  - 学校的结果、进度、异议页只出现专家代号（E-001、T-001），没有专家姓名；
  - 专家的任务页和评阅页没有学生姓名、学校或原文入口，已提交的任务明确写着"不再读取论文材料"；
  - 学生和导师看到的是"1 位匿名专家"。
- 交互：
  - 送审准备搜索无结果时显示 noresult 状态，"清除筛选"可以恢复；
  - 键盘 Tab 能走到侧栏项，焦点环看得见；
  - 账户菜单能打开，六个角色都能退出登录并回到登录页；
  - 登录失败（用不存在的测试账号）在页内显示"用户名或密码错误"，没有弹全局提示；
  - 学生端异议已登记时只显示记录，不再出现新的表单。
- 控制台：只有 401，来自会话过期跳回登录页，以及故意做的登录失败测试，没有其他错误。

**发现的问题**（另开修正批次，先写规格再修）

| 编号 | 问题 | 位置 | v3 §14.1 对应项 |
|---|---|---|---|
| A1 | 侧栏顶部显示学校代码 `demo-univ`，不是学校名称"演示大学" | 学校审核、学生、导师的外壳 | 内容 |
| A2 | 清单栏只有 300px 宽，视图页签挤成两行 | 结果处理、派单台 | 筛选 |
| A3 | 结果处理和异议处理的视图页签还是旧的 `wsd-views__tab`，没换成 `ViewTabs`，外观相近但不是同一个组件 | 结果处理、异议处理 | 同一产品 |
| A4 | 清单为空时右侧对象区整块空白、底色也不一致（派单台白，更正审批灰）；结果处理同样情况下会写"从左侧选择一篇论文" | 派单台、更正审批 | 内容／一致性 |
| A5 | 侧栏名称和页面标题不一致："我的论文"／"我的送审"／"查看我的论文"，"我的任务"／"评审任务"，"评审结果与异议"／"评阅结果"，"学生评审结果"／"学生评阅结果"；"评审"和"评阅"混用 | 学生、专家、导师 | 同一产品 |
| A6 | 产品名不一致：登录页写"百杰盲审"，浏览器标题和侧栏写"百杰校审" | 登录页 | 同一产品 |
| A7 | 时间格式有三种：`2026/11/6 10:17:51`、`2026-11-05`、`05/11/2026, 10:57:23`（最后一种来自评语规则检查） | 评审进度、异议处理、结果对象 | 内容 |
| A8 | 结果对象里直接显示内部规则标识（`review-checks-v2:…` 加两段长哈希） | 结果处理对象区 | 内容 |
| A9 | 1024×768 下数据表在表格内出现横向滚动条（送审准备、专家库）；页面本身不溢出 | 送审准备、专家库 | 空间 |
| A10 | 学校管理的搜索框和状态筛选是原生样式，没有搜索图标，和其他页的筛选条不一样 | 学校管理 | 筛选 |

A9 是表格列多造成的，是否要处理（比如在 1024 隐藏低优先级列）需要先定。A1 要看登录接口有没有返回学校名称，可能要动前端怎么取数。

**不算问题的现象**

- 截图里视图页签的高亮偶尔和表格对不上：查下来是面板隐藏时不渲染新帧，颜色过渡卡在 `currentTime 0`，`aria-pressed` 和表格内容一直是对的。
- 批次页的时间输入框显示 `dd/mm/yyyy`，那是浏览器原生 `datetime-local` 跟着浏览器语言显示的格式。
- 底部的 Vue 图标是开发模式自带的 DevTools，生产构建里没有。

**NOT RUN**

这些在 walk 数据里到达不了，或者需要写数据，这次没有在浏览器里验证：

- 写数据的动作：接受或拒绝邀请、评阅保存与提交、核验判断、送出、发布、异议受理、更正、派单、成员和批次的保存；
- 出错与冲突：500、409、报告过期、双页签冲突、即时保存后退出、材料绑定旧指纹被拒；
- 内容和状态：长中文标题、长学校名、多人名单、多页论文、长评语、公开反馈 v1/v2、学生编辑态、待接受的邀请；
- 浏览器放大和深色模式。

这些项已有的组件测试覆盖见 R3 各批的结果记录，不拿测试结果代替浏览器验收。

## 21. 验收修正批次 F1（对应 20.3 的 A1–A10，施工规格）

只修 20.3 记下的问题，不改业务流程和接口语义。

| 项 | 做法 |
|---|---|
| A1 学校名 | 后端 `/auth/login` 返回的 `user` 加 `tenant_name`，与 `/me` 已有字段一致，只增不改；`TokenUser` 同步。前端 `LoginUser`、`AuthUser` 加 `tenantName`，登录时保存。学校审核、学生、导师外壳的 `org` 改用 `tenantName || tenantCode`，旧会话没有这个字段时退回学校代码。抽一个 `schoolOrg(user)`，各页共用 |
| A2 页签换行 | `ViewTabs` 加 `size="sm"`（h-7、px-2、text-sm），并且不换行，放不下时横向滚动、隐藏滚动条。清单栏里的页签都用 sm；结果处理清单宽改为 340px |
| A3 旧页签 | 结果处理、异议处理、更正审批、派单台的视图切换都换成 `ViewTabs`（sm）。计数规则不变：未知时不显示。测试改用 `[data-view]` 和 `aria-pressed` |
| A4 空对象区 | 派单台宽屏未选论文时也出一个对象区，底色和 `MasterDetail` 空态一致（`--ws-page`）；清单有论文时提示"从左侧选择一篇论文"，清单为空时只留底色 |
| A5 名称 | 侧栏短名称：学生"我的送审""评阅结果"，导师"学生评阅结果"。专家任务页标题改为"我的任务"。送审材料页的按钮改为"返回我的送审"。导师页的加载和空态文案"学生评审结果"改为"学生评阅结果"。`menusByRole` 原名不动（旧外壳与 routes.spec 在用） |
| A6 产品名 | 登录页品牌改为"百杰校审" |
| A7 时间 | `taskTiming` 加 `beijingDate`（zh-CN、北京时区、只有日期）。`slice(0, 10)` 截日期的四处换成它，顺带修掉按 UTC 截日期的偏差。`ReviewCheckSummary` 和评审进度里重复写的格式化换成 `beijingTime`。批次页的日期和时间补上北京时区 |
| A8 规则标识 | `ReviewCheckSummary` 不再显示完整规则标识，改为"专家确认于 {北京时间}"；完整标识放进 `title` 留作核对 |
| A9 表格宽 | 送审准备表格最小宽度从 760 降到 720，1024 下不再横向滚动。专家库 9 列，保留表格内滚动，用户可用"显示"菜单隐藏列 |
| A10 学校筛选 | 学校管理的搜索框加搜索图标，尺寸、字号、焦点环与 `SearchField` 一致；状态下拉同高同字号。`data-field` 钩子保留 |

测试：

- 后端：`test_login_and_me` 断言登录响应带 `tenant_name`；
- 前端：
  - 新增 `schoolOrg` 用例：有名称用名称，没有退回代码；
  - `beijingDate` 用例：UTC 晚上的时间算北京次日；
  - `ViewTabs` 用例：sm 尺寸不换行；
  - 受影响的页面测试同步更新选择器和文案。

验收：两种模式全量测试、`vue-tsc --build`、两种构建。浏览器里在 1366 和 1024 下复查 A1–A10 涉及的页面（walk 后端需要重启才能带上 A1 的字段）。

### 21.1 F1 结果（2026-11-06，基线 `bfcb314`，未提交）

A1 换了做法，和上面的表格不一致：

- 原方案是给 `/auth/login` 加 `tenant_name`，实施时跑不通。
  - 登录走受限的 auth 数据库角色，这个角色对 `tenants` 只有 id、code、status 三列的 SELECT 权限。
  - 登录身份查询读 `Tenant.name` 时报 `permission denied for table tenants`，并发登录用例跟着失败。
  - 放宽列权限要写迁移，属于安全决定，这一批不做。后端改动已全部撤回，`backend/` 无改动。
- 现做法：只改前端。
  - 登录成功、保存会话后，前端用 `fetchMe({ quiet: true })` 读一次 `/me`，取已有的 `tenant_name` 写进 `AuthUser.tenantName` 并持久化。
  - 读取失败时不报错，继续显示学校代码。
  - 没有学校的角色（百杰、系统管理员）不发这次请求。
  - 代价：有学校的角色每次登录多一个请求。
- 测试相应调整：
  - 不再加后端断言；
  - 新增 `stores/__tests__/authTenantName.spec.ts`：登录后补上学校名、`/me` 失败时退回学校代码、无学校角色不调 `/me`。

其余各项按表格实施。新增的测试：

- `schoolOrg.spec`
- `taskTiming.spec`（UTC 晚上的时间算北京次日）
- `viewTabs.spec`（sm 尺寸、不换行、计数）
- `reviewCheckSummary.spec`（不显示规则标识，`title` 留标识）

结果处理、异议、派单台、更正审批、学校管理、导师反馈的页面测试，已同步更新选择器、文案和日期格式。

自动验证：

- 前端测试：demo 模式和真实模式各 114 个文件、850 个用例，全部通过。
- 不稳定用例：
  - demo 模式有一次全量运行中，`schoolProgressDesk` 和 `expertTaskDesk` 各超时一次，重跑通过；判断是负载下的偶发超时，与本批改动无关。
  - 后端相关子集有一次慢运行出现 1 个原因不明的失败，之后两次重跑都是 56 passed。
- `vue-tsc --build` 退出码 0，两种模式的构建都成功。

浏览器复查（5196 真实模式 → 8021 walk 后端，平台账密逐个角色登录）：

| 项 | 结果 |
|---|---|
| A1 | 通过。学校审核、学生、导师的侧栏都显示"演示大学"，不再是学校代码 |
| A2 / A3 | 通过。结果处理（340px 清单栏）、异议处理、派单台、更正审批的页签都在一行内（高 24.5px），不横向溢出；页面里已经没有 `.wsd-views` 和 `.views__tab` |
| A4 | 通过。派单台未选论文时出现对象区，底色是 `--ws-page`。本次数据里派单台清单为空，所以只看到底色；"从左侧选择一篇论文"由单测覆盖 |
| A5 | 通过。导航和标题：学生"我的送审""评阅结果"，导师"学生评阅结果"，专家"我的任务" |
| A6 | 通过。登录页品牌为"百杰校审" |
| A7 | 通过。结果处理里的确认时间是北京时间（2026/11/5 10:57:23）。异议登记日期、学校管理的接入日期是北京日期。页面里没有 ISO 时间串 |
| A8 | 通过。确认行只显示"专家确认于 …"，规则标识只在 `title` 里 |
| A9 | 通过。1024 下送审准备表格宽 750，等于容器宽，表格内不横向滚动 |
| A10 | 通过。搜索框带图标、宽 280，和状态下拉同高、同字号 |

保留不改：结果对象头部显示"评审规则 pilot-single-v1，满分 100"。规则除了版本号没有别的显示名，批次页的只读规则区也用版本号，所以版本号就是规则对外的名字。A8 只针对确认行里重复出现的完整标识。

没有覆盖：

- 派单台清单有论文时的空对象区提示，本次数据里没有这种情况；
- 窄屏（< 768）复查；
- 学校账号会话已存在时的刷新路径：旧会话里没有 `tenantName`，会退回学校代码，重新登录后才显示学校名。

## 22. 已迁移页面整理批次 P1（oil-ui-pro 诊断，施工规格）

**意图**：优化 UI 里的“整理”档，用现行规范，就是 R1–R4 定下、用户认可的设计语言。不换字体、颜色和组件的样子，不改流程。

**诊断**：2026-11-09 做的。在 1366×768 下按六个角色看了 18 个真实页面，用 walk 后端的 published 场景，学生账号登记了一条测试异议。诊断共 5 条，用户回复“全部照做”。

| 项 | 问题 | 做法 |
|---|---|---|
| P1-1 评审内容三种排法 | 学生、导师看的 `FeedbackDocument` 用小标题；学校的 `ResultObject` 把标签放左栏；专家提交后的只读页把标签放在值上面，分项分没有条形。分项条有两套代码：学生页 `bg-primary/70`，学校页是 `--ws-action` 渐变 | 新增 `components/app/review/ReviewVerdict.vue`（结论徽章、总分、可选的专家建议，以及“修改后通过”的说明）和 `ReviewOpinion.vue`（按顺序列出各段文字，缺省时用虚线框说明；分项评分表，条形统一用 `bg-muted` 轨道加 `bg-primary` 填充，可附分项备注）。三处页面都改用这两个组件，各页外面那一圈不动：学生的异议入口、学校的导出与复核提示、专家的“内容已锁定”与更正面板。专家页把“主要优点（不发布）”作为一段传入，分项评价作为分项备注传入，只在专家自己的页面出现。学校页缺省文案统一为“未填写修改建议。”。保留 `data-outcome`、`data-total`、`data-advice` 钩子 |
| P1-2 专家库筛选与空值 | “学科”“省份”显示成灰色占位字，“全部职称”是深色的值；表格空值有“—”“未填”“未知 / 未知”三种写法 | 共享组件 `ComboFilter` 改为：调用方给了 `placeholder`（如“全部学科”）时，按值的样子显示成前景色；只有退回显示 `label` 时才是灰色。专家库传 `placeholder="全部学科"`、`"全部省份"`。表格空值统一为浅色“—”；博导 / 硕导两项都未知时显示一个“—”，只有一项已知时未知的那项写“—”。详情抽屉里“未知（档案未填写）”保留，那里有解释 |
| P1-3 学科与专业对齐与首屏 | 页签容器限宽 960 居中，内容区覆盖成 1080，左边缘差 36px；“尚未设置开放学科”用空状态块，占了首屏约 150px | 页签放进与内容同宽、同内边距的容器（1080、左右各 24px），左边缘与卡片内边对齐。未配置的提示改成卡片上方的一行横幅（`wsd-banner`），文字不变，合成一段 |
| P1-4 内部编号 | 专家任务清单和评阅页抬头只写“0d313ef8”；学生的评阅结果写“评分规则 pilot-single-v1” | 实施时查明：这 8 位是后端给的 `anonymous_id`（任务 ID 前 8 位），平台的更正审批、延期面板引用同一任务时用的也是它。学校看到的 T-001 是按论文内序号另编的，平台认不出来。所以不改成 T-001，也不隐藏，改为带标签的“任务编号 0d313ef8”，评阅页抬头写“任务 0d313ef8”。学生和导师的反馈页抬头去掉规则版本，只写“N 位匿名专家评阅”。学校结果头部的规则版本按 21.1 保留 |
| P1-5 异议标题兜底 | 本校论文列表没取到时，大标题显示“论文题目没有加载出来”，也没有重试 | 列表加载失败时，对象区标题位置显示灰色的“题目暂时没有取到”，旁边放“重试”，重新读取异议与论文列表。清单里的同一行也用这句。论文已取到、但这篇不在列表里时，仍显示“论文已不在当前范围” |

不做：

- 论文列表接口慢：本地要 3–12 秒，前端 15 秒超时。这是后端问题。
- 设置页的两种保存方式。
- 官方基础目录页缺当前目录信息，要看接口。
- 评审进度页重复写的更新时间。

这几项都记在诊断里，等用户另行决定。

测试：

- 新增 `reviewVerdict` / `reviewOpinion` 用例：
  - 缺省文案、虚线框；
  - 条形宽度按比例并封顶 100%；
  - 分项备注；
  - 修改后通过的说明。
- 新增 `ComboFilter` 用例：给了 placeholder 时是前景色，没给时退回 label、为灰色。
- 页面测试：
  - 学校结果、专家评阅页、学生反馈的断言随新结构更新；
  - 专家任务清单断言“任务编号”；
  - 学科页断言横幅；
  - 异议页断言“题目暂时没有取到”和重试会重新请求。

验收：

- 两种模式全量测试、`vue-tsc --build`；
- 浏览器在 1366×768 下复看学生反馈、学校结果、专家只读评阅、专家库、学科与专业、异议处理。

### 22.1 P1 结果（2026-11-09，基线 `026c801`，未提交）

五项都按 22 节表格实施。P1-4 按表里“实施时查明”那一行处理，没有改成 T-001。

改动：

- **新增**：
  - `components/app/review/ReviewVerdict.vue`、`ReviewOpinion.vue`
  - 测试 `review/__tests__/reviewParts.spec.ts`、`data/__tests__/comboFilter.spec.ts`
- **改用共享组件**：
  - `FeedbackDocument`（学生 / 导师）
  - `ResultObject`（学校）：删去旧的 `.verdict`、`.opinion__body`、`.scores`、`.bar` 样式
  - `ExpertReviewDesk` 只读分支：删去 `.final__body`、`.final__scores`
- **其余各项**：
  - `ComboFilter`：给了 placeholder 时显示为前景色
  - 专家库：传入“全部学科”“全部省份”；`ExpertTable` 的空值统一为浅色“—”
  - `DisciplineSettingsPage`：页签放进与内容同宽、同内边距的容器
  - `OpenDisciplines`：未配置提示改为 `wsd-banner`
  - `ExpertTaskDesk`：编号写成“任务编号 …”；`ExpertReviewDesk` 抬头写成“任务 …”
  - `ObjectionObject`、`SchoolObjectionsDesk`：题目兜底改为“题目暂时没有取到”，加重试
- **页面测试**：学校结果、专家评阅页、专家任务清单、专家库、学科页、异议页的断言已同步更新。

自动验证：

- 前端测试：真实模式和 demo 模式各 116 个文件、860 个用例，全部通过，比 F1 多 10 个。
- 这次全量用的是 `--testTimeout=30000`。机器负载平均值在 38–44 之间，默认 5 秒超时下，`expertTaskDesk`、`invitationDesk` 有 4 个用例超时；单独放宽时限后都通过，没有断言失败。
- `vue-tsc --build` 退出码 0。

浏览器复看（1366×768，5196 真实模式 → 8021 walk 后端 published 场景）：

| 项 | 结果 |
|---|---|
| P1-1 | 通过。学生评阅结果、学校结果对象区、专家只读评阅是同一结构：结论一行，下面是小标题段落和同一种分项条（`bg-primary`）。专家页另有“主要优点（不发布）”和分项说明，学生和学校页面没有 |
| P1-2 | 通过。专家库三个筛选都写成“全部学科 / 全部职称 / 全部省份”，表格空值都是“—” |
| P1-3 | 通过。页签与“官方学科”卡片的左边缘都在 271.5px；未配置提示高 66px，原空状态块约 150px，学科清单回到首屏 |
| P1-4 | 通过。专家任务清单写“任务编号 0d313ef8”，评阅页抬头写“任务 0d313ef8”；学生页抬头为“1 位匿名专家评阅” |
| P1-5 | 由单测覆盖：列表失败时题目位置显示灰色说明和“重试”，重试后显示真实题目。浏览器里没有复现这种失败 |

控制台没有错误。

没有覆盖：

- 窄屏（< 768）；
- 导师页（与学生共用 `FeedbackDocument`，没有单独复看）；
- 多位专家的结果：数据里只有一位专家。

独立评审：没做。这个环境要求用户提出后才派子代理，所以这次由主 Agent 对照截图自查。
