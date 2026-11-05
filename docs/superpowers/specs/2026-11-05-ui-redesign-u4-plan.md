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
