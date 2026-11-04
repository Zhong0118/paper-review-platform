---
title: UI 重构 U0：功能去向、页面状态与接口合同差异
status: DRAFT
version: 0.2.2
last_updated: 2026-11-04
sources:
  - 《02 UI Agent 项目背景与重构规格 v2》（v2 交接规格，用户提供，不在仓库内）
  - 《百杰校审｜修复后 UI 同步补充与收口核对 v2.1》（用户在会话中提供；下文记作 [v2.1]）
  - 开发 Agent 交付报告（经 [v2.1] 转述；下文记作 [D1]，本工作树未核对）
  - frontend/src/router/routes.ts、studentNotificationRoutes.ts、menus.ts
  - frontend/src/api/*、frontend/src/modules/**/pages/*.vue
  - backend/app/modules/{thesis,result,review,files}/*
related_documents:
  - docs/superpowers/specs/2026-11-04-ui-agent-brief.md
  - docs/superpowers/specs/2026-11-04-agent-ui-design-guide.md
  - docs/superpowers/specs/2026-11-04-ui-redesign-u2-plan.md
---

# UI 重构 U0：功能去向、页面状态与接口合同差异

**核对基线：** `3f40424`（`codex/slice-7a1-file-integrity` 同一提交），本工作树 `claude/laughing-vaughan-4ca76f`。
**范围：** 只读源码得出的盘点。本轮（U0＋U1）不改业务页面、`src/api`、后端；没有运行后端测试或真实 API。表中“已实现”指源码中存在接线，**不是本轮重新验收**。

**本轮已定：** 方案 A（`src/prototypes/` 原型 kit，仅 dev 路由挂载）；主色为学术蓝 `#1B4F8A`，本轮已定（见 §5.5）；不沿用旧页面布局。

**U1 验收（0.2.1）：** 用户于 2026-11-04 验收 U1 五组原型的信息顺序、操作流程和整体视觉，可以进入 U2 计划，见 [U2 计划](2026-11-04-ui-redesign-u2-plan.md)。主色随后由用户定为学术蓝 `#1B4F8A`（见 §5.5）。U2 的同步方式与切片顺序以 U2 计划为准。

**v2.1 同步（0.2.0）：** 开发 Agent 报告 BUG-01～09 与 DOC-01 已在**另一工作树**修复并本地验收 [D1]。`3f40424` 不是修复提交，本工作树看不到这些修复。因此本文不再把它们写成“未实现”，也不写成“本工作树已验收”。§5 分三列记录：开发报告状态、本工作树是否可见、本轮 UI 验收。保存、创建、删除、发布字段等行为以 [v2.1] 补充合同为准；原型只按该合同模拟交互，不另立一套业务规则。

---

## 1. 全部入口清单（含内部入口与深链接）

“真实菜单”= `menus.ts:LIVE_PATHS` 在 `VITE_DEMO_MODE=false` 时出现在导航里的项。“内部入口”= 不在菜单、但真实流程会跳到或外部可深链进入的地址。

| 地址 / query | 角色 | 类型 | 现有进入方式（源码位置） | 新工作空间 | 新位置 |
|---|---|---|---|---|---|
| `/login`（`?redirect=`） | 全部 | 真实 | 路由守卫未登录跳转 `router/index.ts:35` | 无外壳 | P01 登录 |
| `/student/dashboard` | 学生 | 真实菜单 | 默认路由 | 个人门户 | P02 我的送审 |
| `/student/thesis/edit?thesisId=` | 学生 | 内部入口/深链 | 新建后 `StudentDashboardPage:208`、继续编辑 `:346`；编辑页内 `router.replace` 写回 `thesisId` `ThesisEditPage:155,173` | 个人门户（编辑密度） | P03 论文编辑 |
| `/student/results?thesisId=` | 学生 | 真实菜单＋深链 | 工作台“查看结果” `StudentDashboardPage:348`；页内切换论文 `StudentResultPage:162,175` | 个人门户（阅读版心） | P10 正式反馈＋P11 异议 |
| `/supervisor/results` | 导师 | 真实菜单 | 默认路由 | 个人门户 | P10 只读版 |
| `/expert/tasks` | 专家 | 真实菜单 | 默认路由；评阅页返回 `ReviewWorkspacePage:273,388`；邀请页返回 `InvitationPage:234` | 个人门户（任务清单） | P07 我的任务 |
| `/expert/invitation?task_id=` | 专家 | 内部入口/深链 | 任务表“接受” `ExpertTaskTable:32` | 个人门户 | P07 内的邀请详情（保留 URL） |
| `/expert/review?task_id=` | 专家 | 内部入口/深链 | 任务表“继续评阅/查看” `ExpertTaskTable:35,38`；接受后 `ExpertTasksPage:175`、`InvitationPage:138` | 专注 | P08 专注评阅 / 已提交只读 / 更正 |
| `/expert/review`（无 task_id） | 专家 | 深链异常 | 真实模式显示“请从任务列表选择”`ReviewWorkspacePage:92-95`（`InvitationPage:142` 无 id 跳转仅在 demo 分支） | 专注 | 保持不任取任务；新设计给“返回我的任务” |
| `/school/preparation?thesis=` | 学校 | 真实菜单＋深链 | 批次收尾跳转 `BatchCloseout:19`；`PreparationListPage:27` 读取 | 处理 | P04 队列 → P05 核验台 |
| `/school/progress` | 学校 | 真实菜单 | — | 处理 | 进度视图 |
| `/school/results?thesis=&correction=` | 学校 | 真实菜单＋深链 | 收尾跳转 `BatchCloseout:17,18`；`ResultProcessingPage:25,214` | 处理 | P09 结果处理（发布/更正确认） |
| `/school/objections?objection=` | 学校 | 真实菜单＋深链 | 收尾跳转 `BatchCloseout:16`；`ObjectionWorkbenchPage:15` | 处理 | P11 校方异议 |
| `/school/batch-rules` | 学校 | 真实菜单 | — | 处理（学校设置组） | P12 批次 |
| `/school/members` | 学校 | 真实菜单 | 菜单在 `portalMenus` 中追加 | 处理（学校设置组） | P12 成员与资格 |
| `/school/disciplines` | 学校 | 真实菜单 | 同上 | 处理（学校设置组） | P12 学科与专业 |
| `/school/sensitive-terms` | 学校 | 真实菜单 | 同上 | 处理（学校设置组） | P12 检测词表 |
| `/platform/dispatch` | 运营 | 真实菜单 | 默认路由；专家库返回 `RealExpertLibraryPage:200` | 处理 | P06 派单台（含延期） |
| `/platform/dispatch?expertId=` | 运营 | demo 专用 | 仅 demo 专家库 `ExpertLibraryPage:339` | — | 不迁移为真实深链 |
| `/platform/experts` | 运营 | 真实菜单 | demo/真实分两套组件 `routes.ts:37` | 处理 | P13 专家库 |
| `/platform/corrections` | 运营 | 真实菜单 | 真实模式只渲染 `RealCorrectionPanel mode=platform` | 处理 | P13 更正审批 |
| `/system/tenants` | 系统管理员 | 真实菜单 | 默认路由；**现无菜单项**（`menusByRole` 缺 system_admin） | 处理 | P14 学校管理＋官方目录 |
| `/notifications`、`/exports`、`/audit` | 多角色 | demo 页 | 路由存在，不在 LIVE_PATHS | — | **不进入新导航**（规格 §7） |
| `/expert/finance`、`/expert/profile`、`/platform/settlements`、`/school/account` | 各自 | demo 页 | 路由存在，不在 LIVE_PATHS | — | **不进入新导航**；路由保持，U2 不接新外壳 |

**页内对象入口（非 URL）**：学生论文详情抽屉 `StudentThesisDetailDrawer`；学校论文详情/核验 `AnonymizationCheckPanel` + `SensitiveFindingPanel`；派单详情 `DispatchDetailPanel` + 候选表；延期 `ExtensionPanel`（运营审批、专家申请两处复用）；更正 `RealCorrectionPanel`（expert/platform/school 三种 mode）；批次收尾 `BatchCloseout`；PDF 变换 `PdfTransformDialog`；专家导入 `ExpertImportDialog`；官方目录 `OfficialCatalogImport`；校内专业 `ProgramCatalogImport`、`BatchProgramPin`。

**深链兼容要求（U2 起执行）**：上表所有 query 键名保持不变；新子视图另加的 query（如 `view=`）必须可缺省；无 `task_id`/`thesisId` 或对象不可见时显示统一“不可见或已变更”安全文案并给返回，不暗换对象。

---

## 2. 旧功能 → 新位置 → 数据源 → 验收用例

“数据源”列为现有前端 API 函数（`src/api/*`）。验收用例编号对应规格 §16，`AC-` 为本表新增细化。

### 2.1 学生

| 现有能力 | 现位置 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|---|
| 读资格与批次 | `EligibilityCard` | P02 页头“当前批次”与无资格空态 | `auth.fetchEligibility` | AC-S1 无资格时显示原因，不出现“开始送审”主按钮 |
| 新建论文 | 工作台按钮，直接 POST 固定学科 | P02 → 最小创建表单（题目/关键词/受控专业/摘要） | `theses.createThesis`（`POST /theses`）、`GET /catalog/student-programs`、`GET /catalog/my-disciplines` | §16“学生绑定校内目录新建”；按 C-CREATE：真实题目、1–5 个去重关键词、`program: {catalog_id, code}` 或合法学科；已有论文冲突用 `data.id` 定位后重读真实状态 |
| 继续编辑 | 表格行 / 详情抽屉 | P02 当前论文主动作“继续编辑” | `theses.getThesis`（`allowed_actions` 含 `EDIT_THESIS`） | AC-S2 只在 allowed_actions 允许时出现 |
| 删除纯草稿 | 确认对话框 `DELETE_DRAFT` | P02 当前论文“更多”内 → 确认 → 删除后空态“已从列表移除，可重新建稿” | `theses.deleteThesis` | 按 C-DELETE：检测/变换后同样可删；固定确认文案；无回收站/恢复；已提交过的稿件不出现 |
| 派前撤回 | 确认对话框 `WITHDRAW_BEFORE_DISPATCH`，需理由 | P02 当前论文“更多”内，独立确认 | `theses.withdrawThesis(version, reason)` | AC-S3 失败保留理由 |
| 多篇/历史论文 | `StudentThesisTable` | P02 次级“其他论文”列表 | `theses.listTheses(scope)` | AC-S4 多篇不丢失 |
| 时间范围 全部/近一年 | `TimeScopeSelect` | P02 次级列表工具栏 | `timeScope` | 口径沿用“论文创建日、北京时间” |
| 进度时间轴 | `StudentProgressTimeline` | P02 当前论文状态行＋“处理记录”（只展示有可靠事件的节点） | `toStudentThesisDetail` | 不伪造日期/百分比 |
| 编辑题目/摘要/关键词/专业 | `ThesisMaterialEditor` | P03“论文内容”分区（P02 草稿内有简版样例） | `theses.patchThesis` | 按 C-SAVE：`content_revision` 不透明字符串原样回传；冲突时本页/服务器对照，先复制再选用服务器版本 |
| 上传原稿/匿名稿 | `ThesisFileField` | P03“材料”分区，分用途 | `files.uploadThesisFile`（prepare→PUT→complete） | 上传中/校验中/未绑定/锁定不统称成功 |
| PDF 合并/提取/删页 | `PdfTransformDialog` | P03“材料”分区内，预览→确认 | `pdfTransforms.*` | 环境不可用明确报错，保留源文件 |
| 匿名检测 | `SensitiveFindingPanel` | P03“提交检查”分区 | `sensitiveChecks.checkSensitiveThesis` | 报告过期显示 stale |
| 提交 | 编辑页按钮 | P03“提交检查”分区，冻结内容预览→提交 | `theses.submitThesis(version)` | 缺项不可绕过 |
| 读正式反馈 | `StudentResultPage` | P10 阅读版心 | `results.getPublishedResult` | 按 C-RESULT：schema v1“未收录修改建议”、v2 空串“未填写修改建议”、未知/格式错误按接口错误；不发布 strengths/分项评价 |
| 登记异议 | `StudentObjectionForm` | P10 底部异议区 | `objections.createObjection`、`listMyObjections` | 已有未结异议时不重复登记 |

### 2.2 导师

| 现有能力 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|
| 受指导学生已发布论文列表 + 时间范围 | P10 只读版顶部选择器 | `results.listSupervisedPublishedTheses(scope)` | 只列合法指导关系 |
| 读发布件 | P10 只读版，无异议按钮 | `results.getPublishedResult` | 同 C-RESULT；导师只读，不出现异议入口 |

### 2.3 学校审核

| 现有能力 | 现位置 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|---|
| 送审准备列表 + 时间范围 + 列设置 | `SchoolThesisTable` + `ColumnPreferences` | P04 队列（视图：待核验/可送出/已退回/全部；列设置在表工具栏） | `schoolReview.listSchoolTheses(scope)`、`adapters.toSchoolRow` | §16 1366×768 首屏有行；视图计数=已加载集合，标明口径 |
| 论文详情 | 页内选中详情 | P04 非模态预览 → P05 核验台 | `schoolReview.getSchoolThesis` | 返回保留筛选与选中 |
| 匿名检测/重检 | `AnonymizationCheckPanel` | P05 判断区“当前报告依据” | `sensitiveChecks.checkSensitiveThesis(…, school=true)` | stale 不可放行 |
| 页级发现定位 | `SensitiveFindingPanel` + PDF | P05 左侧发现目录 → PDF 跳页 | `files.getFileContent` | 只承诺页级定位 |
| 原稿/匿名稿切换 | 核验面板 | P05 文档台顶部分段切换；对照按需开启 | `files.getFileContent` | — |
| 通过核验 / 退回修改（理由） | 核验面板 | P05 底部判断栏 | `schoolReview.confirmAnonymization(PASS/REJECT, version, reason)` | §16“另一人先处理”；成功才推进下一篇 |
| 确认送出 | 列表/详情按钮 | P04“可送出”视图行动作 + P05 通过后提示 | `dispatch.confirmDispatch(version)` | 不与通过核验合并为一个按钮 |
| 永久终止 | 详情危险按钮 | P05“更多操作”独立确认 | `schoolReview.terminateThesis(version, reason)` | 不与退回同等突出 |
| 学校代传/批量导入 | `SchoolSubmissionDrawer`、`BatchImportPreview` | **不迁移**（demo 专用，规格 §2） | — | 新导航不出现 |
| 评审进度 + 状态筛选 + 时间范围 | `ReviewProgressPage` + `TaskProgressSummary` | 处理空间“评审进度”视图，计数可下钻 | `dispatch.schoolProgressList(scope, status)` | overdue 为 null 显示“未配置” |
| 结果核对、首次发布 | `ResultProcessingPage` | P09 结果处理：发布前展示“将公开的内容” | `results.getSchoolResults`、`publishThesis(version)` | 发布后读回快照 |
| 导出有效发布评阅书 | `ResultProcessingPage` | P09 已发布对象的次要动作 | `results.downloadPublishedReview` | — |
| 更正确认/不予确认 | `RealCorrectionPanel mode=school` | P09 对象内“更正待确认”分区 | `corrections.*` | §16 已发布论文更正：自动追加发布记录，无额外发布步骤 |
| 异议列表、开始处理、办结（线上/线下＋结论） | `ObjectionWorkbenchPage` | P11 校方异议队列 + 对象详情 | `objections.listSchoolObjections`、`startObjection`、`resolveObjection` | — |
| 批次新建/编辑/开放/截止收件/归档 | `BatchRulesPage` | P12 学校设置 → 批次列表 → 批次详情 | `schoolOperations.createBatch/updateBatch/openBatch/closeBatch/archiveBatch` | 409 刷新后保留编辑内容 |
| 接单/评阅期限 | `BatchDeadlines` | P12 批次详情“期限” | `schoolOperations.saveDeadlines` | — |
| 批次固定校内专业版本 | `BatchProgramPin` | P12 批次详情“专业目录版本” | `schoolPrograms.listProgramVersions/pinPrograms` | — |
| 批次收尾核对（跳转四类） | `BatchCloseout` | P12 批次详情“收尾”，链接保持原深链 | `schoolOperations.getBatchCloseout` | 链接落到 P04/P09/P11 正确对象 |
| 评审规则（只读） | `BatchRulesPage` | P12 批次详情侧栏 | `schoolOperations.getSchoolReviewRule` | — |
| 成员新建/编辑/启停/重置密码 | `SchoolMembersPage` | P12 成员列表 → 成员详情 | `schoolOperations.createMember/updateMember/enable/disable/resetMemberPassword` | 密码不回显 |
| 送审资格建立/暂停/恢复 | 同上 | P12 成员详情“送审资格” | `schoolOperations.createEligibility/suspend/resume` | 暂停不禁用既有草稿继续办理 |
| 本校开放学科 | `SchoolDisciplinesPage` | P12 学科与专业 → 开放学科 | `catalogs.getDisciplines/getDisciplineSettings/saveDisciplineSettings` | — |
| 校内专业 CSV 预览/发布 | `ProgramCatalogImport` | P12 学科与专业 → 校内专业对照 | `schoolPrograms.previewPrograms/publishPrograms` | 预览≠写入 |
| 检测词表 | `SensitiveTermsPage` | P12 检测词表 | `sensitiveChecks.getSensitiveTerms/saveSensitiveTerms(expected_version)` | 版本冲突 |

### 2.4 平台运营

| 现有能力 | 现位置 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|---|
| 派单队列 + 状态筛选 + 时间范围 | `OperationsQueueTable` | P06 左侧论文清单（视图：待指派/进行中/需跟进） | `dispatch.dispatchQueue(scope, status)` | — |
| 论文上下文 + 任务进度 | `DispatchDetailPanel`、`TaskProgressSummary` | P06 右上“当前论文与轮次” | 同上 | — |
| 候选排序、匹配依据、负荷、不可派原因、列设置 | `CandidateExpertTable` | P06 候选比较表（单选） | `dispatch.dispatchCandidates`、`candidateUnavailableReason` | §16 无候选/全员不可派区分 |
| 指派 | 候选行动作 | P06 底部“已选专家 → 确认指派” | `dispatch.assignExpert(…, expectedExpertVersion)` | §16 候选档案确认前变化 |
| 改派（INVITED/IN_REVIEW） | 候选行动作 | P06 改派确认（旧任务/新专家/后果） | `dispatch.reassignExpert(taskId, …)` | REJECTED 不走 reassign，走 assign |
| 延期审批 | `ExtensionPanel` | P06 当前任务上下文内 | `taskTiming` + `httpApi` 直接调用 | 原截止与已批准截止分开 |
| 专家档案列表/筛选/新建/编辑/回避/资格/服务状态 | `RealExpertLibraryPage` | P13 专家库列表 → 详情 | `expertOperations.listExperts/createExpert/updateExpert/replaceConflicts/reviewQualification/setServiceStatus` | 三种“不可用”语义分开 |
| 专家 CSV 导入 | `ExpertImportDialog` | P13 专家库工具栏“导入档案” | `expertOperations.previewExpertImport/applyExpertImport/downloadExpertTemplate` | — |
| 更正审批 | `RealCorrectionPanel mode=platform` | P13 更正审批队列 → 详情 | `corrections.listCorrections('platform')`、`correctionCommand` | 不显示学校专属 before/after |

### 2.5 专家

| 现有能力 | 现位置 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|---|
| 任务列表 + 分组 + 时间范围 + 列设置 | `ExpertTaskTable` | P07 视图：待回应/评阅中/已提交（拒绝/取消在“历史”） | `expertTasks.listExpertTasks(scope)` | 期限未配置显示“未配置” |
| 邀请详情、接受、拒绝（理由） | `InvitationPage`、任务页确认框 | P07 邀请详情（保留 `/expert/invitation?task_id=`） | `expertTasks.getInvitation/acceptTask/rejectTask` | 接受前不请求 PDF |
| 延期申请 | `ExtensionPanel` | P07 任务行“更多”+ P08 任务栏 | `taskTiming` | — |
| 匿名稿阅读 | `RealAnonymousDocumentPane` | P08 左侧阅读器 | `expertTasks.getMaterials`、`files.getFileContent` | 已提交不再请求 |
| 评分 + 评语 + 自动保存 + 手动保存 | `ReviewFormPane` | P08 右侧评阅区（评语/评分/提交检查） | `review.getReviewRules/getReviewDraft/saveReviewDraft` | 按 C-SAVE：整数 `revision`（无草稿为 0）→ `expected_revision`；冲突列出两边差异、暂停自动保存 |
| 暂存退出 | `exitToTasks` 直接跳转 | P08“保存并退出”：flush 后才离开 | 同上 | §16 输入后 100ms 退出；失败/冲突留在本页（BUG-01） |
| 评语检查（规则＋本人历史相似） | `ReviewCheckPanel` | P08“提交检查”页签 | `reviewChecks.getReviewChecks` | ACK 绑定同一内容 |
| 最终提交 | 表单按钮 | P08 检查并提交确认 | `review.submitFinalReview(payload, ack)` | 提交后只读 |
| 已提交只读 + 更正申请/编辑/提交 | `RealCorrectionPanel mode=expert` | P08 已提交态右侧；更正稿手动保存 | `corrections.*` | §16 更正保存 500/409 不卸载表单；版本条件为更正申请 `version`，不自动保存、不自动重试（BUG-09） |
| 分栏调整 | `WorkspaceSplitter` | P08 分栏 + 键盘替代 | — | — |

### 2.6 系统管理员

| 现有能力 | 新位置 | 数据源 | 验收用例 |
|---|---|---|---|
| 学校列表、新建（官方院校检索）、暂停/恢复 | P14 学校管理表 → 新增学校 / 学校详情 | `systemOperations.listTenants/createTenant/suspendTenant/resumeTenant`、`catalogs.searchInstitutions` | 暂停二次确认 |
| 学校管理员新建/启停/重置密码 | P14 学校详情“学校管理员” | `systemOperations.listReviewers/createReviewer/enable/disable/resetReviewerPassword` | 密码不进日志/截图 |
| 官方目录联合预览/确认 | P14 “官方基础目录”独立目的地 | `catalogs.previewCatalogImport/applyCatalogImport` | 预览指纹过期需重新预览 |

### 2.7 公共

| 现有能力 | 新位置 | 数据源 |
|---|---|---|
| 真实退出（`auth.logout`） | 所有外壳右上账户菜单 | `stores/auth` |
| 本人信息 | 账户菜单只读（姓名/用户名、角色、学校代码） | `auth` 读取本人接口 |
| 列设置（学校论文、专家任务、候选专家三张表） | 各表工具栏，偏好按身份/角色/租户/视图隔离 | `composables/useColumnPreferences` |

---

## 3. 页面状态表

✓=必须设计并在原型中可切换；○=必须设计、本轮原型以说明替代；—=不适用。

| 页面 | 加载 | 空集合 | 筛选无匹配 | 请求失败 | 无权/不可见 | 版本冲突 | 报告过期 | 未配置 | 危险确认 | 其他关键状态 |
|---|---|---|---|---|---|---|---|---|---|---|
| P01 登录 | ○ | — | — | ○ | ○（无权深链） | — | — | — | — | 会话失效、禁用账号 |
| P02 学生办理 | ✓ | ✓（无论文/无资格/删除后） | — | ✓ | ○ | ✓（论文信息另一页签已保存） | — | ○（批次未开） | ✓（删除）○（撤回） | 已退回、等待、已发布 |
| P03 论文编辑 | ○ | — | — | ○ | ○ | ○ | ○ | — | — | dirty、材料未就绪 |
| 学生创建表单 | ✓ | ✓（无专业选项） | — | ✓（保留输入） | — | ✓（已有论文冲突） | — | ✓（校方未维护目录） | — | 校内目录/官方学科两种口径 |
| P04 学校队列 | ✓ | ✓ | ✓ | ✓ | — | — | ✓（行内标记） | — | — | 跨版本报告 |
| P05 学校核验 | ✓ | — | — | ✓ | ✓（已被他人处理） | ✓ | ✓ | — | ✓（永久终止） | 自动结论 PASS/REVIEW_REQUIRED/FAIL/null、阻断/警告计数、上次通过＋已过期、扫描页（uncertain_pages） |
| P06 运营派单 | ✓ | ✓（无记录） | ✓（全员不可派） | ✓ | — | ✓（候选档案变化） | — | — | ✓（改派） | 已被占位、拒绝后空席 |
| P07 专家任务 | ○ | ○ | — | ○ | — | — | — | ○（期限未配置） | ○（拒绝） | 待接/在评/已提交/取消 |
| P08 专注评阅 | ✓ | — | — | ✓（保存失败） | ✓（任务已取消） | ✓（另一页签） | — | — | ✓（最终提交） | 未保存/保存中/已保存/锁定；更正稿手动保存/失败/冲突 |
| P09 学校结果 | ○ | ○ | — | ○ | — | ○ | — | — | ○（发布） | 更正中、已发布 |
| P10 正式反馈 | ✓ | ✓（未发布） | — | ✓ | ✓ | — | — | — | — | v2 含建议、v2 未填写、v1 未收录、格式无法识别、更正待确认、更正已确认、导师只读 |
| P11 异议 | ○ | ○ | — | ○ | — | — | — | — | — | 已有未结异议 |
| P12 学校配置 | ○ | ○ | ○ | ○ | ○ | ○ | — | ○ | ○ | 导入预览未写入 |
| P13 专家库/更正 | ○ | ○ | ○ | ○ | ○ | ○ | — | — | ○ | 失效候选 |
| P14 系统资源 | ○ | ○ | ○ | ○ | — | — | — | — | ○（暂停学校） | 重复学校 |

---

## 4. 能力矩阵（界面可见性；服务端仍为最终依据）

| 对象/动作 | 学生 | 导师 | 学校审核 | 平台运营 | 专家 | 系统管理员 |
|---|---|---|---|---|---|---|
| 学生/导师身份 | 本人 | 本人学生 | 本校 | 授权范围 | ✗ | ✗ |
| 专家身份 | ✗ | ✗ | ✗（只有别名 E-001） | ✓ | 本人 | ✗ |
| 原稿 | 本人 | ✗ | 本校 | ✗ | ✗ | ✗ |
| 匿名稿 | 本人 | ✗ | 本校 | ✓ | 接单后、提交前 | ✗ |
| 检测报告 | 本人 | ✗ | 本校 | ✗ | ✗ | ✗ |
| 评阅草稿 | ✗ | ✗ | ✗ | ✗ | 本人 | ✗ |
| 正式评阅结果 | 发布快照 | 发布快照 | 匿名结果 | ✗（审批只看申请信息） | 本人 | ✗ |
| 核验/退回/送出/终止 | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 派单/改派/延期审批 | ✗ | ✗ | ✗ | ✓ | 申请延期 | ✗ |
| 更正 | ✗ | ✗ | 确认/不予确认 | 批准/驳回 | 申请/提交 | ✗ |
| 发布 | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| 异议 | 登记 | ✗ | 处理 | ✗ | ✗ | ✗ |
| 学校/账号/官方目录 | ✗ | ✗ | 本校成员 | 专家档案 | ✗ | ✓ |

---

## 5. 修复同步状态与接口合同（[v2.1]）

### 5.1 三列状态

- **开发报告状态**：来自 [D1]，本工作树没有复现。
- **本工作树可见**：`3f40424` 中能否看到修复。“否”表示仍是修复前代码，证据为 0.1.0 版只读核对时的位置。
- **本轮 UI 验收**：U1 原型对目标交互的覆盖情况。真实验收一律在 U2 完成。

| 编号 | 问题 | 开发报告状态 | 本工作树可见 | 本轮 UI 验收 |
|---|---|---|---|---|
| BUG-01 | 保存并退出不等保存完成 | 已修复，本地验收 [D1] | 否：`ReviewWorkspacePage.vue:272-274` 仍直接 `router.push` | P08 原型：flush 确认后才离开，失败/冲突留在本页（`draftController` 单测覆盖） |
| BUG-02 | 评阅草稿并发覆盖 | 已修复 [D1] | 否：`api/review.ts:27-29` 无版本条件 | P08 原型：整数 revision 条件，冲突列出差异、暂停自动保存 |
| BUG-03 | 论文草稿并发覆盖（指纹） | 已修复 [D1] | 否：`api/theses.ts:65-67` 无 revision | P02 原型：不透明 `content_revision`，冲突对照，不自动重新套用指纹 |
| BUG-04 | 修改建议未进入发布件 | 已修复 [D1] | 否：`result/service.py:251-286` 只发 recommendation/overall/issues | P10 原型：schema v1/v2 四种显示 |
| BUG-05 | 不支持的附件类型 | 已修复 [D1] | 否（未逐项核对） | 原型不提供通用附件上传，只有原稿/匿名稿两种用途 |
| BUG-06 | 演示语义混入真实入口 | 已修复 [D1] | 否（未逐项核对） | 演示专用入口不进新导航（§1）；原型页标注“虚构数据” |
| BUG-07 | 新建论文固定学科与占位题目 | 已修复 [D1] | 否：`StudentDashboardPage.vue:197-205` 固定 0812 | P02 原型：创建表单与无选项/失败/已有论文状态 |
| BUG-08 | 检测/变换后删除草稿失败 | 已修复 [D1] | 否：`thesis/service.py:509-526` 未处理引用 | P02 原型：确认文案与删除后空态 |
| BUG-09 | 更正稿保存失败丢输入 | 已修复 [D1] | 否（未逐项核对） | P08 原型：更正稿手动保存，500/409 保留输入 |
| DOC-01 | RLS 描述不准确 | 已修正文档 [D1] | 否 | 无 UI 影响；RLS 仍延期，上生产前必须补（AGENTS.md） |

### 5.2 补充合同摘要（原型据此模拟，字段名以修复快照的接口类型为准）

| 合同 | 要点 | 原型落点 |
|---|---|---|
| C-CREATE | 选项来自 `GET /catalog/student-programs`、`GET /catalog/my-disciplines`；`POST /theses` 带真实题目、1–5 个去重关键词、合法学科或 `program: {catalog_id, code}`；已有论文冲突用 `data.id` 定位并重读真实状态；暂停的资格只影响新建 | `StudentPortal.vue` create-* 状态 |
| C-SAVE | 三种版本条件分开：论文草稿 `content_revision`（不透明字符串，不 `parseInt`、不 +1）；普通评阅草稿整数 `revision`（无草稿为 0）；更正稿用更正申请 `version`，手动保存。每个对象各自的 transport | `kit/draftController.ts`（泛型 R、`autosave:false`）、`data/fakeTransports.ts` |
| C-DELETE | 固定确认文案：“删除后，该草稿将从你的论文列表移除，可以重新建稿；必要的检测、材料处理与审计记录仍按平台规则保留。此操作不提供自助恢复。”不出现回收站、恢复、“永久终止”字样 | `StudentPortal.vue` delete / deleted |
| C-RESULT | v1（无标记）→“此历史发布版本未收录修改建议”；v2（`snapshot_schema_version: 2`）空串 →“未填写修改建议”；未知/格式错误 → 接口错误，整页不展示；不发布 strengths、分项评价、完整评语；纯文本渲染；不猜发布日期；更正确认后自动追加发布 | `FeedbackReader.vue` |
| C-CHECK | `auto_conclusion` PASS / REVIEW_REQUIRED / FAIL / null；单项严重程度只有 WARN / BLOCK；`stale` 独立；人工结论独立；扫描页来自 `source_metadata.uncertain_pages`。过期时显示“上次自动结论＋报告已过期”，不保留无时效说明的绿色“通过”；不做 READY 假重检、不假强制通过 | `SchoolQueue.vue` 检测列、`SchoolVerify.vue` 依据区 |

### 5.3 仍未决或仍缺口（不在本轮处理）

| 编号 | 内容 | 本轮做法 |
|---|---|---|
| RISK-01 | 检测冻结点：已通过核验后报告过期的合法动作 | 不加前端门禁、不扩权限；按钮出现与否以 `allowed_actions` 为准 |
| UX-01 | 分数留空 | 不提供“暂不评分”，永不发送 `null`；0 是合法分数，不视为缺项 |
| CHECK-01～03 | 开发报告中的三项核对 | 开发已交付；代码已于合并提交 `2010321` 同步，自动化集成基线通过（U2 计划 §2.1）；浏览器级验证随 U2-1 |
| GAP-VER | DB 有 `version_no`，接口未投影 | 原型不显示“材料第 N 版” |
| GAP-EVT | `recent_events` 不带时间 | 原型“处理记录”只列先后，不编造时间 |
| C-ACCOUNT | 系统管理员无菜单项；真实模式顶栏无退出入口（`menus.ts:21-52`、`AppHeader.vue`） | 原型外壳统一有账户菜单；U2 接线，无需新接口 |

### 5.4 U2 前置条件

1. 取得开发 Agent 的完整修复快照，核对它覆盖 BUG-01～09、DOC-01。本轮不合并、不覆盖其他 Agent 的工作。**已完成核对**：同步包补丁在 `3f40424` 上重建出 tree `a19789587d9b`，与主检出现场的 647 个文件一致；修复尚未提交。同步方式已定为“开发提交后合并”，不在本分支应用 ZIP，见 U2 计划 §1.2。
2. 合并后，在新的隔离环境验证集成基线：独立 Postgres（5433 / `paper_review_test` 的临时 schema），迁移到 0034（含 0032～0034）。
3. 优先复用快照中已修好的保存与冲突处理逻辑。用其回归测试证明行为不变，原型 `draftController` 不替换它。
4. RISK-01、UX-01 仍未决，U2 中不擅自决定；CHECK-01～03 随集成基线验证。

### 5.5 主色记录

**本轮已定（用户 2026-11-04）：主色为学术蓝 `#1B4F8A`。** 颜色不属于修复合同，通过主题令牌集中管理：原型里是 `prototypes/kit/tokens.css` 的 `.ws` 变量；U2-1 把它们迁到正式令牌文件，页面只引用令牌、不写死色值，日后调色只改令牌。

### 5.6 测试环境发现

`3f40424` 干净基线下，`vitest run` 在没有 `VITE_DEMO_MODE=true` 时有 81 个既有失败；设为 true 后 550 个全部通过。主检出里未跟踪的 `.env.local` 设了该变量。这是既有环境依赖，与原型无关，U2 需决定测试是否显式设定该变量。

---

## 6. U1 原型清单

全部位于 `frontend/src/prototypes/`，只在 `import.meta.env.DEV` 时注册 `/prototype/*` 路由；不引入 `src/api`、`src/stores`；页面显著标注“虚构样例”。状态可用页面顶部切换条或 URL `?state=` 切换，便于截图复现。

| 原型 | 路由 | 工作空间 | 可切换状态 |
|---|---|---|---|
| 学校核验 | `/prototype/school`（队列）→ `/prototype/school/verify` | 处理 → 专注 | 队列：正常/空/筛选无匹配/加载失败；核验：自动需人工复核/自动未发现线索/自动不通过/上次通过＋报告过期/已被他人处理/版本冲突/终止确认 |
| 运营派单 | `/prototype/dispatch` | 处理 | 正常/无专家记录/全员不可派/请求失败/档案已变冲突/改派确认 |
| 专家评阅 | `/prototype/review` | 专注 | 已保存/有修改/保存中/保存失败/版本冲突/提交确认/已提交只读/任务已不在名下/更正稿手动保存/更正失败/更正冲突 |
| 学生办理与创建 | `/prototype/student` | 个人门户 | 无论文/创建表单（校内目录/官方学科/无选项/失败/已有论文冲突）/草稿/草稿保存冲突/删除确认/删除后/已退回/等待/已发布/无资格 |
| 正式反馈 | `/prototype/feedback` | 个人门户（阅读） | v2 含建议/v2 未填写/v1 历史/格式无法识别/更正待确认/更正已确认/已有异议/导师只读/未发布 |
| 索引 | `/prototype` | — | 五组入口与说明 |

**截图**：`docs/images/2026-11-04-u1/`，六个页面（学校队列、核验台、派单台、专注评阅、学生办理草稿、正式反馈）各有 1440×900、1366×768、390×844 三种尺寸，共 18 张。截图用 CDP 做设备尺寸仿真，并隐藏开发服务器注入的 Vue DevTools 浮钮与原型控制条；其余状态请在原型中切换查看。

**本轮不做**：真实 API 接线、替换现有布局/页面、修改 `theme.css` 全局令牌、P09/P11–P14 的可交互样例（U3）。
