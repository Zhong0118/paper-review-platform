---
title: UI 重构 U2：真实接线计划
status: DRAFT
version: 0.2.0
last_updated: 2026-11-04
sources:
  - docs/superpowers/specs/2026-11-04-ui-redesign-u0-function-map.md（U0，§5 为修复同步状态）
  - 开发 Agent v2.1 交付（同步包 tmp/ui-agent-handoff/paper-review-ui-v2.1-a19789587d9b.zip，位于主检出内的仓库忽略目录；报告 source/docs/reviews/2026-11-04-v2.1-handoff.md）
related_documents:
  - frontend/src/prototypes/（U1 原型，已获用户验收）
---

# UI 重构 U2：真实接线计划

U1 的五组原型已在 2026-11-04 获用户验收，验收范围是信息顺序、操作流程和整体视觉。U2 把这些交互接到修复后的真实接口上，逐个替换对应的旧页面。P09、P11–P14 仍属 U3。

**依据：** 业务合同以开发 Agent 最新的 v2.1 交付为准。设计沿用新 UI 规格 v2、补充合同 v2.1，以及已确认的 U0/U1 成果；不采用开发通用交接提示词把旧设计重新做一遍。本文是 U2 唯一的计划文档，切片细则写在本文 §4 里，不另开主文档。

**前提：** U2 代码要等修复提交合并进本分支（§1）、在隔离环境验证过集成基线（§2）之后才开始写。每个切片按“规格 → 测试 → 实现”推进。

## 1. 修复代码的接入

### 1.1 同步包已核对

| 核对项 | 结果 |
|---|---|
| 压缩包 SHA-256 | `bef867a9…55bf5`，与随附 `.sha256` 一致 |
| 补丁 SHA-256 | `21d73114…167cf`，与 SYNC.md 一致 |
| 基线 | `3f40424`，tree `f03e269e`；即本 UI 分支检查点之前所在的提交 |
| 应用结果 | 在 `/tmp` 的干净基线导出上 `git apply --check --binary` 与 `git apply --binary` 均通过，重建出的 tree 为 `a19789587d9b`，与声明一致 |
| 与开发者现场是否一致 | 主检出 `codex/slice-7a1-file-integrity` 的未提交工作树与 MANIFEST 中 647 个文件的哈希逐一相同（2026-11-04 核对） |
| 迁移 | `0032_review_draft_revision`、`0033_abandoned_drafts`、`0034_public_revision_advice` |
| 与 UI 改动的重叠 | 补丁的 91 处变动不涉及 `frontend/src/router/*`、`.claude/launch.json`、`frontend/src/prototypes/` |

### 1.2 同步方式：开发提交后合并（已定）

不在本分支应用 ZIP 或补丁。开发 Agent 把修复提交为 commit 之后，按以下步骤办：

1. **核对修复提交本身。** 修复提交的 tree 应等于 `a19789587d9b`。如果不等，说明提交前又有改动，先逐项看清差异再继续。
2. **合并进本分支，UI 成果原样保留。** 保留的范围是检查点提交中的原型、路由、`launch.json` 新增项、规格和截图。合并后，本分支整体的 tree **不要求**等于纯修复 tree，二者之差应当正好是 UI 成果。
3. **合并后复核。** 确认修复相关的文件与修复提交逐一相同，再按 §2 跑集成基线。

UI Agent 不替任何人提交，不推送，不改动主检出和 `main`。

## 2. 隔离环境与集成基线

- 数据库：5433 / `paper_review_test`，开新的临时 schema，`alembic upgrade head` 到 0034。不复用 5432，不碰共享开发库。沿用开发报告中“先确认主机和端口、再切到专用库”的保护脚本。
- 存储：独立的临时目录；PDF 转换用本机隔离 Docker。
- 后端、前端各用单独端口；前端 `VITE_DEMO_MODE=false`。
- 数据：只用虚构样本和种子账号，不导入真实论文；截图和文档不出现凭据、token 或签名 URL。
- 集成基线：合并后先在该环境跑开发报告列出的后端八个测试文件（报告 74 passed）、前端三个 spec（报告 48 passed），再跑 `vue-tsc --build` 和生产构建。基线过了，才开始 U2 改动。

## 3. 原型与真实合同的差异（U2 以修复代码为准）

| # | 原型假设 | 修复代码实际 | U2 处理 |
|---|---|---|---|
| D1 | 409 冲突直接带回服务器副本 | 评阅草稿 409 的 data 只有 `{expected_revision, current_revision}`，要另外 GET 草稿才能比较（`ReviewWorkspacePage.compareDraft`） | 冲突后先“核对服务器版本”（GET），再展示差异 |
| D2 | 冲突后只能复制本页或采用服务器版本 | 修复代码有“保留本地并重新保存”（`resolveConflict(true)`）；更正面板有“保留本地内容，继续编辑” | 三个选项都保留：复制、采用服务器、保留本地重新保存 |
| D3 | 原型控制器失败后直接发最新输入 | 回执丢失时，先原样重发那次未确认的快照（`attempt`），再发新输入；回执 revision 必须正好 +1；422 清掉失败的那次 | 复用修复代码，不移植原型控制器 |
| D4 | 指纹只用于论文信息保存 | **普通上传完成** `POST /files/{id}:complete` 与 **PDF 转换应用** `POST /pdf-transforms/{id}:apply` 都必须带请求头 `If-Draft-Revision`，值为最近一次确认的 `current_version.content_revision`（64 位小写十六进制）。缺头或格式错误返回 422，指纹不符返回 409 `VERSION_CONFLICT`；成功后返回新的 `content_revision`，下一次绑定要用这个新值。上传完成的回执丢失时，不得自动换新指纹重发，要先重读详情，核对 file_id、用途和输入 | 材料区每次绑定后都更新指纹；回执丢失走“重读核对” |
| D5 | 创建表单在学生门户页 | “开始送审”跳到 `/student/thesis/edit`（不带 thesisId），在编辑页建稿 | 创建表单放在编辑页的新建态，深链接不变 |
| D6 | 评阅表单只有评语与 6 项分数 | 还有 `evaluations`（分项评价）与 `strengths`；`revisionAdvice` 必填 | 表单加上分项评价；这两项都不发布 |
| D7 | `snapshot_schema_version` 放在快照层 | 版本号在响应顶层，`revision_advice` 在每个 item 上；适配器把缺失值映射成 `null`，显示“未收录” | 在适配器里补上“未知版本或结构不对 → 接口错误”（v2.1 C-RESULT 的要求，修复代码尚未实现），并补测试 |
| D8 | 最终提交只带内容 | 还要带 `expected_revision`，以及由调用方保持稳定的幂等键 | 一次提交尝试始终用同一个键 |

C-CHECK 字段与原型假设一致：`auto_conclusion`、`manual_conclusion`、`stale`、`source_metadata.uncertain_pages`；严重程度只有 WARN / BLOCK。

## 4. 切片

**原则：**
- 先打通一条真实路径，再逐条扩展。
- 外壳只做当前切片要用的部分，不先做全局重写。
- 保存逻辑在需要它的切片里**原样复用**修复代码；只有当某个切片确实要换布局时，才把那段逻辑搬进 composable。搬家前后，相关的既有 spec 必须不改一行即通过。
- 每个切片沿用现有路由和查询参数（U0 §1 的深链接清单）。切片验收通过后，才删除被替换的旧组件。

| 顺序 | 切片 | 范围 | 替换的路由 |
|---|---|---|---|
| 1 | **U2-1 学校：送审准备清单 → 匿名核验 → 返回** | 学校处理外壳、专注外壳，以及这条路径用到的主题令牌与基础组件 | `/school/preparation`、`/school/preparation?thesis=` |
| 2 | U2-2 专家专注评阅 | P08；D1、D2、D3、D6、D8；更正稿 | `/expert/review?task_id=` |
| 3 | U2-3 学生办理与编辑 | P02/P03；D4、D5；删除、撤回、上传、PDF 转换、检测 | `/student/dashboard`、`/student/thesis/edit` |
| 4 | U2-4 学校：确认送出、终止、评审进度 | 补齐 P04 的“可送出”“已退回”视图与 P05 的终止 | 同 U2-1 |
| 5 | U2-5 运营派单 | P06 | 派单台现路由 |
| 6 | U2-6 正式反馈 | P10 学生/导师；D7 | `/student/results?thesisId=`、导师结果页 |

### 4.1 U2-1 细则：学校送审准备清单 → 匿名核验 → 返回

**用户路径：**
1. 学校审核登录后进入 `/school/preparation`，看到“待核验”视图。
2. 从某一行进入该论文的核验台。
3. 查看检测发现、匿名稿与原稿，作出“通过核验”或“退回修改”。
4. 服务器确认后，进入下一篇，或返回清单；返回时，筛选、搜索、视图和选中行都保持原样。

**路由与深链接：**
- `/school/preparation` 是清单（处理外壳）。
- `/school/preparation?thesis=<id>` 打开该论文的核验台（专注外壳）。这样，批次收口等处已有的 `?thesis=` 深链接直接落到对应论文。
- 清单状态放在查询参数里（`view`、`q`、`program`），返回时原样带回。
- 本切片不新增路由名，也不改 `menus.ts` 的入口路径。

**数据来源（修复代码现有函数，不改 `src/api` 的签名）：**

| 用途 | 函数 |
|---|---|
| 清单与时间范围 | `schoolReview.listSchoolTheses(scope)`；视图计数取已加载集合，并标明口径 |
| 核验台详情、`allowed_actions` 与版本 | `schoolReview.getSchoolThesis(id)` |
| 检测报告 | 详情中的 `anonymization`（`SensitiveReport`）；学校重检用 `sensitiveChecks.checkSensitiveThesis(id, body, true)`，仅在 `allowed_actions` 允许时出现 |
| 材料 | `files.getFileContent`；只承诺页级定位 |
| 判断 | `schoolReview.confirmAnonymization(PASS/REJECT, version, reason)` |

**展示规则：**
- 按 C-CHECK 分维度展示：
  - 自动结论：PASS / REVIEW_REQUIRED / FAIL / null 原样映射，不合成 WARN；
  - 单项严重程度：BLOCK、WARN 两组，各自计数；
  - 报告时效：`stale` 为真时显示“上次自动结论＋报告已过期”；
  - 人工结论：`manual_conclusion` 单独展示；
  - 扫描页：来自 `uncertain_pages`，单独提示。
- 按钮是否出现，只看 `allowed_actions`。RISK-01 不加前端门禁，不做 READY 假重检，也不提供强制通过。
- 学校看不到专家姓名；无权或资源已不存在时，统一按 `RESOURCE_NOT_FOUND` 显示“已不可用”。

**必须覆盖的状态：**
- 清单：加载中、空、筛选无匹配、请求失败；
- 核验台：已被他人处理（并发）、版本冲突（409，保留已写说明）、报告过期、自动不通过、需人工复核、未发现线索、深链接指向不可见的论文。

**测试（先写）：**
- 组件测试：清单视图计数与口径；返回时保留筛选与选中；核验台各检测维度的映射（含 `auto_conclusion` 为 null、`stale`、`uncertain_pages`）；有 WARN 时必须写说明；409 后说明仍在；服务器确认后才出现“下一篇”。
- 修复代码中既有的学校 spec（`realPreparationCounts` 等）继续通过；如有改动，说明原因。

**验收：**
- 在 §2 的隔离环境，用真实学校账号走完“清单 → 核验 → 通过 → 下一篇 → 返回”与“退回”两条路径；
- 双页签复现“另一人先处理”；
- 1440×900、1366×768、390×844 三种尺寸，1366×768 首屏能看到行；只用键盘可完成主流程；
- 截图存 `docs/images/`。

**不在 U2-1 做：** 确认送出、永久终止（属 U2-4）；其他角色的外壳；全局导航重写；`theme.css` 全局令牌。

### 4.2 后续切片的统一验收

- 1440×900、1366×768、390×844 三种尺寸，只用键盘可完成主流程；
- `vue-tsc --build` 通过；`vitest run` 在 `VITE_DEMO_MODE=true` 与 `false` 下各跑一次，失败数不高于基线；
- 生产构建不含原型；
- 在 §2 的环境里用真实浏览器走一遍。

## 5. 已定与仍未决

| 编号 | 内容 | 状态与 U2 做法 |
|---|---|---|
| 主色 | 学术蓝 `#1B4F8A` | **本轮已定**（用户 2026-11-04）。通过主题令牌集中管理：U2-1 把 `prototypes/kit/tokens.css` 的 `.ws` 令牌迁到正式令牌文件，各页面只引用令牌，不写死色值 |
| CHECK-01～03 | 开发报告中的三项核对 | 开发已交付；状态为**待同步代码及集成验证**，在 §2 的集成基线中核对 |
| RISK-01 | 检测冻结点 | 仍未决。按钮完全按 `allowed_actions` 出现，不加前端门禁，不扩权限 |
| UX-01 | 分数留空 | 仍未决。不提供留空，永不发送 `null`；0 是合法分数 |
| 测试环境变量 | 不设 `VITE_DEMO_MODE` 时有 81 个既有失败 | 合并后在集成基线中重新确认；不在 U2 中顺手修 |

## 6. 不做

不改后端和迁移；不迁移 demo 专用入口（学校代传、批量导入等，见 U0 §1）；不做 P09、P11–P14；不补 RLS（另有延期记录，上生产前必须补）；不推送，不部署。
