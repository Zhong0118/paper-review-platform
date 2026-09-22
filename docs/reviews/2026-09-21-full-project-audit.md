# 项目整体审查：2026-09-21

## 结论与范围

现有模块化单体、论文版本、评审轮次、专家任务的分层可以保留；已有真实 API 主链，但尚未满足现行切片的完整交付要求。建议先修复数据完整性与授权缺陷，再完成真实材料和角色页面。无需推倒重写，也不宜直接扩展多专家、费用、SSO。

基线：分支 `codex/slice-7a1-file-integrity`，提交 `12ab023ba8fe43a8bbf2f1e53dc47bdb10f0ff5b`。对照 `main` 的 merge-base 为 `62461f1570b24887e98242646e9117139d7ee392`；本次结论针对当前项目，不把所有问题归因于最近的 7A-1。

依据：`docs/CURRENT.md`、现行切片 0+1、2–6、7A-1、`CONTEXT.md`、真实模式页面及后端调用链。历史长文档仅作背景。审查覆盖身份/租户、文件与版本、派单、评阅、发布、异议、角色入口、迁移和测试；没有逐页浏览器验收、生产负载测试，也没有宣称逐行检查全部文件或穷尽所有漏洞。

本轮只初始化本地索引、验证、记录审查及调整计划；未修复下列业务缺陷，未修改原始材料或迁移开发业务库。

## 修复跟踪

审查之后，7C-1 已修复 A1/A7，并同时锁定草稿写入以防提交后的旧请求继续保存。新增 13 项回归，全套后端 62 项通过；详见 [7C-1 执行记录](../superpowers/plans/2026-09-21-slice-7c1-review-integrity.md)。7C-2 随后修复 A2/A6、待送审撤回与新旧轮次关联，并防止学校进度重复统计；后端 74 项通过，详见 [7C-2 修复记录](../superpowers/plans/2026-09-21-slice-7c2-thesis-integrity.md)。7C-3 已修复 A3/B2/B9，并保护延迟接拒请求；后端 84 项通过，见 [7C-3 修复记录](../superpowers/plans/2026-09-21-slice-7c3-dispatch-result-integrity.md)。7A-3 已修复 A4/A5，包含令牌隔离、版本关系读取和文件审计；后端 97 项通过，见 [7A-3 修复记录](../superpowers/plans/2026-09-21-slice-7a3-file-access.md)。7A-2 随后修复 B1，使用真实 PDF 样本覆盖结构、身份检测及人工复核；见 [7A-2 执行记录](../superpowers/plans/2026-09-21-slice-7a2-pdf-validation.md)。7B-1 已修复 B6，并将 B3 的材料接口与阅读组件接通；浏览器 PDF 实际渲染尚未验收，不能将 B3 视为完整关闭。前端 377 项、后端 121 项通过，见 [7B-1 执行记录](../superpowers/plans/2026-09-21-slice-7b1-expert-workspace.md)。7B-2 已修复 B4/B7，包含导师列表/详情同源权限和结果页面错误、切换状态；前端 389 项、后端 126 项通过，学校发布→导师查看已在隔离真实 API 浏览器环境验证。见 [7B-2 执行记录](../superpowers/plans/2026-09-21-slice-7b2-supervisor-results.md)。7B-3 已修复 B5/B8：可派动作投影、连续派单及候选失败/迟到保护、当前异议排序和时间、异议错误不吞掉；后端 128 项、前端 399 项通过，类型检查与构建通过。见 [7B-3 执行记录](../superpowers/plans/2026-09-21-slice-7b3-dispatch-objection.md)。7B-4 已修复 B10，包含终止、保留旧任务的改派、真实页面入口和并发幂等保护；后端 141 项、前端 401 项通过，类型检查与真实模式构建通过。见 [7B-4 执行记录](../superpowers/plans/2026-09-22-slice-7b4-termination-reassignment.md)。7B-5 已修复 B11，按实际接口的最近一次自动检测记录统计，说明跨版本限制并隔离加载错误；前端 405 项、类型检查和真实构建通过，见 [7B-5 记录](../superpowers/plans/2026-09-22-slice-7b5-preparation-counts.md)。7B-6 已在本机 Chrome 验证 B3 的原生内嵌 PDF 实际中文正文、页码与已加载状态，见 [验收记录](../superpowers/plans/2026-09-22-slice-7b6-pdf-browser-acceptance.md)。当前 18/18 项已修复并完成对应验证；其他浏览器和复杂材料兼容性未因此宣称覆盖。下文保留审查时证据；批次规则可配置化与其他问题未因此自动解决。

## 索引初始化

| 工具 | 结果 | 验证 |
|---|---|---|
| CodeGraph 1.5.0 | `.codegraph/`；557 文件、3,513 节点、9,978 关系 | `codegraph status .` 显示 up to date；MCP explore 返回源码及关系 |
| zvec-grep 0.2.2 | `.zvec-grep/`；654/654 文件、2,825 entities、无待处理或失败队列 | `zg status <root> --check-ready` 成功；中文混合检索命中切片 3 规格 |

zvec 使用本地 `local/potion-code-16m-v2`（256 维），排除 `storage/**` 和 `frontend/pnpm-lock.yaml`，遵循忽略文件。最初尝试的多语言模型下载未采用。两个索引均加入 `.gitignore`。统计是报告写入前的初始化快照，100% 指所选索引范围，不是全项目已审查或验收完成。

重启 zvec 后，本任务原有 MCP transport 返回 `Transport closed`；共享服务已恢复，CLI 检索可用，后续可在新会话重新连接 MCP。没有将 CLI 成功说成原 MCP 连接已恢复。

在仓库根目录维护：

```sh
codegraph sync .
zg index /Users/zhongxu/Desktop/0-Inbox/paper-review-platform
zg status /Users/zhongxu/Desktop/0-Inbox/paper-review-platform --check-ready
zg query '论文评审最终提交后锁定结果 submit_final' --fts submit_final --fuse --limit 3
```

索引帮助定位和建立关联，不能自动证明设计正确。一次查询也可能命中历史规格，必须按 CURRENT 的优先级判断。

## Standards：不变量与实现正确性

P1 表示应优先修复、阻碍可信闭环；P2 表示现行功能缺陷。复现指在测试库隔离 schema 上观察到；静态指已检查调用链，尚未做对应运行复现。代码位置均相对于仓库根、行号基于上述提交。

| ID / 级别 | 问题、触发与影响 | 代码证据 | 验证 |
|---|---|---|---|
| A1 / P1 | 最终提交未锁定并刷新任务。两个会话先后读取 IN_REVIEW 后提交，第二次仍成功；正式结果从 80 改为 69，汇总仍为 80。违反最终提交锁定。 | `backend/app/modules/review/service.py:75` | 独立会话控制交错复现 |
| A2 / P1 | PATCH 草稿未与提交串行化。会话持有旧 DRAFT 对象，另一会话提交后，旧请求仍可修改冻结版本标题、学科；甚至能在匿名检查后补入身份。7A-1 的文件字节保护没有覆盖这一入口。 | `backend/app/modules/thesis/service.py:323` | 独立会话控制交错复现 |
| A3 / P1 | 只阻止同一专家重复在途任务，没有执行当前单专家边界；允许同时派两个匹配专家。先发布第一份 80 分，再由第二人提交 69 分，对外结果自动从一项变两项、汇总仍为 80。发布读取当前任务集合，未固定发布所依据的结果集合。 | `backend/app/modules/dispatch/service.py:143`；`backend/app/modules/result/service.py:121` | API 复现；第二位测试专家配置为匹配学科 |
| A4 / P1 | 下载授权用通用 access token，仅将用途写入 data_scope。返回的令牌可作为 Bearer 调用 `/me`；仅带 query token 的授权 URL 本身反而 401。响应声称 5 分钟，实际使用通用 access token 有效期。其风险是文件链接携带调用者会话级凭据，不是凭空升级为其他角色。授权和读取也未产生文件审计记录。 | `backend/app/modules/files/service.py:192`；`backend/app/modules/auth/deps.py:29`；`backend/app/core/security.py:26`；files/router.py | token 复用、URL 失效及审计缺失已复现；有效期差异静态确认 |
| A5 / P1 | 撤回克隆版本会复用已完成文件；专家文件授权却假设 file_id 只有一个版本引用。正常提交→撤回→重提→派单→接单后，授权下载触发 MultipleResultsFound，成为 500。 | `backend/app/modules/files/service.py:165` | API 复现 |
| A6 / P2 | 从未提交的全新草稿也无法删除：已有初始 thesis_version 引用，直接 DELETE thesis 触发外键异常。 | `backend/app/modules/thesis/service.py:475` | API 复现，thesis_versions_thesis_id_fkey |
| A7 / P2 | submit-final 的幂等哈希只有任务 id。相同 key 改变评分仍返回原 200，而不是识别请求体冲突；用户无法知道新评分未提交。 | `backend/app/modules/dispatch/router.py:143` | API 复现 |

这组问题主要需要事务边界、状态刷新、约束和授权契约的针对性修复；不需要新增通用工作流框架。

## Spec：现行需求与真实流程

以下与 A 组重复的后果不再计数，例如“最终结果未锁定”已由 A1 覆盖。

| ID / 级别 | 未满足的行为与依据 | 代码证据 | 验证 |
|---|---|---|---|
| B1 / P1 | 匿名检测将 PDF 字节按 UTF-8/Latin-1 解码，没有解析正文/元数据；未检出字符串不等于匿名合格，压缩文本和无可靠文本仍可能 PASS。文件校验依赖声明 MIME 与简单字节匹配。对应 0+1 匿名门禁，已列入原 7A-2。 | `backend/app/modules/thesis/detector.py:41`；`backend/app/modules/files/service.py:119` | 静态；本轮未补真实 PDF 样本矩阵 |
| B2 / P1 | 候选列表检查 ExpertConflict 导师回避，真正 assign 只检查展示名。直接调用接口可绕过档案回避。切片 2 §4 要求“展示名/档案”均受约束。 | `backend/app/modules/dispatch/service.py:95`、`:133` | 静态 |
| B3 / P1 | 真实专家阅读区仍有固定文件名、86 页、演示摘要，没有接入材料读取。评分 API 存在不代表能阅读被派论文。切片 3 要求真实材料与草稿。 | `frontend/src/modules/review/components/AnonymousDocumentPane.vue:34`；ReviewWorkspacePage.vue | 静态 |
| B4 / P2 | 导师页调用学生专属 listTheses，403 被吞为空列表，导致已发布也像“暂无结果”。切片 4 明确导师入口。 | `frontend/src/modules/result/pages/SupervisorResultPage.vue:26`；`backend/app/modules/thesis/router.py:34` | 静态 |
| B5 / P2 | 唯一专家拒绝后，真实派单台仍把 UNDER_REVIEW 映射为 IN_REVIEW，没有重新启用派单。后端可另派，页面走不通。切片 2 要求拒绝后可派新专家。 | `frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue:111`、`:196` | 静态 |
| B6 / P2 | 进入评阅页未携带 task_id；页面选择第一个 IN_REVIEW 或 SUBMITTED，旧已提交任务可能挡住新接任务。单篇单专家不等于专家永远只有一篇任务。 | `frontend/src/modules/review/pages/ReviewWorkspacePage.vue:45`；`frontend/src/modules/review/pages/ExpertTasksPage.vue:161` | 静态 |
| B7 / P2 | 学校处理页、导师结果页写死“建议通过”，未忠实呈现专家建议。对应切片 4 的真实结果投影。 | `frontend/src/modules/result/pages/ResultProcessingPage.vue:106`；SupervisorResultPage.vue:49 | 静态 |
| B8 / P2 | 第一条异议办结后允许第二次提交，但列表无明确排序、学生页取 objections[0]，仍展示旧办结单。对应切片 5 当前异议状态。 | `backend/app/modules/result/objection_service.py:88`；`frontend/src/modules/result/pages/StudentResultPage.vue:72` | API 列表顺序已复现；页面取值静态确认 |
| B9 / P2 | 学校待派统计把 rejected_count 算入 open_tasks，全拒绝后等待数仍为 0。切片 6 的等待含义为没有非终态任务的待安排论文。 | `backend/app/modules/dispatch/service.py:334` | 静态 |
| B10 / P2 | 现行 0+1/2 规格中的终止、改派取消旧任务行为和 `:reassign` 接口尚未交付；不能仅因枚举/空 router 存在就算完成。 | `backend/app/modules/thesis/router.py`；`backend/app/modules/dispatch/router.py:18` | 静态检查路由与 CANCELLED 写入 |

后续浏览器补充发现（7B-2 验收，未在该批顺手修改）：**B11 / P2**，学校准备页真实模式的匿名检测概览仍固定 18/3/1；隔离测试环境只有一篇论文，页面却显示这些数字。源码 `frontend/src/modules/school/pages/PreparationListPage.vue:117` 直接传固定计数。纳入角色页面收尾，不能当成真实业务统计。

另有规则配置差距：`result/service.py:17` 的 REQUIRED_EXPERTS=1 是全局常量；切片 4 明确这是种子批次快照，不是平台默认。当前不要求开发完整多专家配置后台，但需在派单与结果固定工作包统一当前人数边界，避免“限制一份汇总却允许多份在途”。

## 各切片覆盖判断

| 切片 | 可保留成果 | 未达到的验收点 |
|---|---|---|
| 0+1 | 平台登录、论文/版本、提交与学校门禁、workflow 入口 | A2/A6、真实 PDF；前次评估记录的待送审撤回仍需修复 |
| 2 | 确认送出、候选、派单、接拒、匿名投影 | A3/A5、回避一致性、拒绝后再派 UI、改派/终止 |
| 3 | 草稿和评分计算、正式结果模型 | A1/A7、真实文档、准确 task_id |
| 4 | 结果汇总、学校发布、受限结果 API | A3、导师入口、真实结论、人数规则来源 |
| 5 | 异议创建、处理、原评分保留 | 当前异议选择与排序 |
| 6 | 学校队列及化名任务进度 | 拒绝后等待统计 |
| 7A-1 | 上传所有权、prepare 版本绑定、文件完成不可变、文件写入与提交/撤回锁定、迁移测试 | 本片成果保留；不据此推断元信息、读取或评阅提交也已安全 |

SSO、费用、通知、自动超时、多专家完整流程和 RLS 是明确延期项，不作为本次“现行切片遗漏”计数；RLS 仍是真实数据上线前必须补齐的门禁。空模块目录不计进度。

## 验证证据与局限

- 后端既有套件：**49 passed，3 warnings**；真实独立 Postgres（宿主机 5433 / paper_review_test），迁移隔离 schema。
- 前端既有套件：**50 files / 361 tests passed**。
- `pnpm build`：类型检查与生产构建通过；仍有第三方 PURE 注释与包体积提示。
- 额外诊断：**8 passed，2 warnings**，用例的“通过”表示预期缺陷被观察到，绝不表示修复通过。两份脚本及原始输出保留在 [probes](probes/README.md)。其中发布变化与删除异常还保留了打印证据，不能用这些诊断脚本替代严格回归测试。
- 并发诊断用独立会话预加载旧对象并控制交错，验证可发生的请求状态竞争；没有冒充真实浏览器压力测试。
- 原有部分测试只覆盖顺序成功路径或演示状态。例如拒绝后再派测试接受 200 或 409，不证明新专家真的派成功。应修正断言，并补充跨请求、真实 PDF、真实角色页面证据。

## 后续执行建议

保留 7A-1。将原计划最后才补的“关键并发与一致性”前移；“发布后不漂移”也必须在 M1 完成，不能留到多专家阶段。

1. **7C-1 评阅提交完整性**：A1/A7；同任务不同 key 并发最多一份正式结果，同 key 改内容应冲突，汇总与正式分一致。
2. **7C-2 论文冻结与草稿生命周期**：A2/A6，加上已记录的待送审撤回；提交、PATCH、撤回使用一致状态和锁定边界，不改冻结版本，不破坏历史。
3. **7C-3 派单与发布一致性**：A3、B2、B9；人数、回避在服务端统一检查，已发布输出固定到实际发布的结果集合。无需同时实现完整多专家产品。
4. **7A-3 受控读取提前**：A4/A5；文件专用短期授权、有效期与契约一致、按任务/版本授权、文件审计，覆盖撤回复用文件。
5. **7A-2 真实 PDF**：格式/大小/加密/损坏/文本抽取与人工复核策略；真实样本验收。
6. **7B 真实角色闭环**：真实阅读与 task_id、导师入口、真实建议、拒绝再派、当前异议；补现行终止/改派后逐角色浏览器验收。

每包先写规格与失败回归，再最小修复、验证、更新 CURRENT。先让第一条真实业务链可信，再按既有 M2–M5 路线增加运营能力。
