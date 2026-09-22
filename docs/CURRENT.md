---
title: 现行状态（给仓库阅读者）
status: CURRENT
version: 0.6.16
last_updated: 2026-09-22
---

# 百杰校审：现在是什么

**换 agent 接手：** 先读 [AGENT_HANDOFF.md](AGENT_HANDOFF.md)。后续 [11 项任务清单](superpowers/plans/2026-09-22-pilot-task-board.md) 和 [前三项执行说明](superpowers/plans/2026-09-22-pilot-first-three-tasks.md) 已编写，均尚未执行；默认下一项是 T01 工作树保护与基线复验。修复代码已提交为 `b92cdc2`，交接文档随其后提交；当前仅本地提交，尚未推送。

第三方多校论文盲审平台。当前审查基线分支 `codex/slice-7a1-file-integrity`。

**现在有的：** 一篇论文、一个专家、平台账密的真实 API 主链；完整角色与真实材料验收尚未通过。

**现在没有的：** 学校 SSO、代传/批量导入、超时催审、多专家、费用、通知渠道、PostgreSQL RLS、可上线的视觉。

实现依据是切片规格，不是 `docs/00`–`10` 长文档，也不是 8 月前端演示计划。

## 2026-09-21 核对与后续规划

[现状评估](reviews/2026-09-21-project-assessment-and-roadmap.md)记录了已复现问题与代码证据：[后续开发规划](superpowers/plans/2026-09-21-development-roadmap.md)规定近期顺序与验收出口。

7A-1 已修复上传所有权与文件锁定，新增 prepare 时的版本绑定；已完成文件只能新建上传替换，旧请求不会重新绑定文件。专家阅读区的真实接口与任务路由已在 7B-1 接通，原生 PDF 已在本机 Chrome 补验显示，其余浏览器兼容性未覆盖；导师结果入口已在 7B-2 修复，其余真实角色页面仍需继续验收。下述主链表示已实现的接口路径，不代表所有角色已通过浏览器完整验收。

[整体审查](reviews/2026-09-21-full-project-audit.md)已完成代码、规格及定向运行核对：发现正式评分并发覆盖、冻结元信息可改、发布结果漂移、下载授权等缺陷。其中 A1/A7 已由 7C-1 修复，A2/A6 与待送审撤回已由 7C-2 修复；A3/B2/B9 已由 7C-3 修复；A4/A5 已由 7A-3 修复；B1 已由 7A-2 修复；B6 已由 7B-1 修复，B3 已接通真实材料并由 7B-6 在本机 Chrome 完成正文渲染补验；B4/B7 已由 7B-2 修复；B5/B8 已由 7B-3 修复；B10 已由 7B-4 修复；B11 已由 7B-5 修复；本轮已登记 18 项缺陷均已修复并完成对应验证，不等于项目无缺陷或可上线。CodeGraph 与 zvec-grep 本地索引已建立，检索验证通过；zvec 当前任务的旧 MCP 连接需重连，CLI 可用。

**7C-1 已完成：评阅提交完整性。** 草稿保存/最终提交取得任务锁并刷新状态；最终提交先锁定再检查幂等缓存，摘要包含完整评分和评语。新增 13 个回归场景，后端全套 **62 passed，3 warnings**；包含独立会话旧对象、真实锁等待、首事务回滚及 HTTP 并发重试。无新增迁移。旧 submit-final 幂等记录缺少评分内容，复用旧 key 将明确冲突；不改已有正式结果。

**7C-2 已修复：论文冻结、纯草稿删除、待送审撤回。** 编辑/提交/删除/撤回共享论文锁并刷新版本；未提交草稿可删除并重新创建，保留物理文件与审计；撤回取消旧轮次，重新审核确认后绑定新版本创建新轮次。学校结果与进度只取当前版本有效轮次，历史不重复统计。新增 12 项回归，后端全套 **74 passed，3 warnings**；无新增数据库迁移。

**7C-3 已修复：派单与发布一致性。** 当前单专家席位检查在论文锁下执行，候选/派单共用回避规则；最终提交与接拒请求使用论文→任务锁并刷新状态。发布检查任务集合、正式结果和汇总一致，学校/学生/导师结果读取固定汇总集合；全拒绝后重新计为等待。新增 10 项回归，后端全套 **84 passed，3 warnings**。无迁移，不扩展多专家配置；未来结果更正仍需独立版本发布规格。

**7A-3 已修复：受控文件读取。** 文件专用 5 分钟 token 与登录凭据隔离，URL 可用且有效期同源；每次读取检查账号和当前专家任务/版本，撤回复用文件不再因多引用报错。成功、无权、认证失败和缺物理文件都有文件审计。新增 13 项回归，后端全套 **97 passed，3 warnings**。无迁移；旧下载链接需重新授权，普通 Bearer 读取保留。

**7A-2 已修复：真实 PDF 校验与匿名检测。** 完成上传和提交均验证结构、大小与文件摘要；正文、Info/XMP 元数据、文件名及论文元信息参与身份检查。图片（含内联图片）、空白页和不可靠提取进入人工复核，PASS 仍需学校确认。默认上限暂取可配置 50 MiB；没有引入 OCR，解析线程也不等同恶意 PDF 的进程级资源隔离。新增 22 项真实样本回归，后端全套 **119 passed，3 warnings**；无迁移。运行前更新 backend 依赖。

**7B-1 已实现：专家材料读取与准确任务路由。** 列表/接单携带 task_id；缺失、未知或不可评阅任务不回退选第一项。真实模式读取受控匿名 PDF，清理过期 Blob；保存/提交/页面刷新均隔离任务切换的旧请求。新增本人正式评阅读取，提交后只读回显，不冒用旧草稿或继续请求材料。新增前端 16 项、后端 2 项回归；前端 **377 passed（51 files）**、后端 **121 passed，3 warnings**，类型检查与真实模式构建通过。浏览器已走通登录→精确任务→草稿保存/刷新恢复→最终提交→刷新只读；内置浏览器 PDF 区域空白，打开 Blob 新窗口被浏览器安全策略拦截，**未声称 PDF 实际渲染验收通过**，须在支持原生 PDF 阅读器的常用浏览器补验。无迁移/新增依赖，未改开发业务库。

**7B-2 已修复：导师入口与真实建议。** 导师专属列表与详情共用当前租户、论文批次及有效导师关联；多批次/多校身份不再触发多行异常。学校/导师页使用服务端汇总分与专家实际建议，空建议不默认通过；加载失败与空态分离，切换移除旧结果，发布绑定已加载论文和版本。新增后端 5 项、前端 12 项回归：后端 **126 passed，3 warnings**，前端 **389 passed（52 files）**，类型检查与真实模式构建通过。独立审查通过；隔离环境浏览器已验证“发布前导师空态→学校展示并发布 80 分/不通过→导师看到同一匿名结果”。无迁移/新增依赖，未改开发业务库。

**7B-3 已修复：拒绝再派与当前异议。** 派单队列返回可派动作，专家全拒绝后可再派，已有在途/正式席位仍不可重复派；连续派单刷新恢复下一篇选择，候选错误与迟到响应不串篇。不匹配/回避/停用专家不可选。学生异议按未办结优先、创建时间和 ID 降序展示，读取失败不再伪装为空态。新增后端 2 项、前端 10 项回归；全套后端 **128 passed，3 warnings**，前端 **399 passed（53 files）**，类型检查与真实模式构建通过。独立审查发现学校演示异议缺时间字段，已补齐并验证。无迁移/新增依赖，未改开发业务库；本批无新增浏览器验收。

**7B-4 已修复：终止与改派。** 学校本校未完成论文可填原因、二次确认终止，工作流/有效轮次及未完成专家任务同步关闭；已提交评审保留，已发布论文禁止终止。百杰可将待接/评阅中的任务改派给另一合格专家，旧任务取消、新任务记录替换关系；新专家校验失败整体回滚。真实页面已接对应入口，操作区移除演示固定费用。论文锁内处理幂等查询，同键并发重放、不同键竞争只创建一个替代任务，旧专家延迟写入被拒。新增后端 13 项、前端 2 项回归；全套后端 **141 passed，3 warnings**，前端 **401 passed（53 files）**，类型检查及真实模式构建通过。独立审查发现的并发幂等问题已复现、修复并复核。无迁移/新增依赖，未改开发业务库；本批未新增浏览器验收。

**7B-5 已修复：学校准备页固定统计。** 真实模式按本校每篇论文最近一次自动检测记录统计 PASS/REVIEW_REQUIRED/FAIL，无记录/未知不计入；人工结论与搜索不改分类。独立复核确认该接口跨版本取最近检测，因此页面明确提示旧版本记录不代表当前版本已通过。加载、错误与刷新失败隐藏旧统计/表格/操作，提供重试；审核/送出/终止统一刷新。新增前端 4 项回归，全套 **405 passed（54 files）**，类型检查和真实模式构建通过。本批未修改后端（最近后端全套 141 passed，3 warnings），未修改数据库/依赖，未新增浏览器验收。

**7B-6 已补验：Chrome PDF 正文渲染。** 隔离真实 API/测试库、种子专家登录，从任务列表进入本人工作台；Chrome 原生内嵌阅读器显示页码 1/1、PDF 已加载完毕，并实际呈现中文测试正文。未修改业务代码、未改安全设置、未绕过此前内置浏览器 Blob 导航限制，临时环境已清理。证据及边界见 [7B-6 验收记录](superpowers/plans/2026-09-22-slice-7b6-pdf-browser-acceptance.md)。

**下一步：开发验收版收口。** 当前审查清单 **18/18 项完成（100%）**，统计仅针对已登记缺陷。继续整理多角色真实流程验收和启动/测试基线；跨浏览器、手机及复杂 PDF 兼容性尚未完整覆盖。新发现问题追加登记，不能据此宣称完整平台开发完成或达到生产上线标准。

运行新代码前需在目标环境执行 `alembic upgrade head`（新增 `0007_file_upload_version`）。迁移不推测旧文件最初绑定的版本：保留旧文件和已有引用，旧未完成上传必须重新 prepare，已完成文件的 complete 重试不重新绑定。本次只迁移了测试库隔离 schema，未迁移开发业务库。

## 主链（接口路径）

```
学生登录 → 草稿 + 双 PDF → 提交
        → 匿名门禁（命中身份线索自动退回 DRAFT）
学校    → 核验通过 → 确认送出（建轮次，论文阶段不变）
百杰    → 按学科派 1 人（导师同名回避）
专家    → 接受 / 拒绝 → 草稿打分 → 最终提交锁定
学校    → 评审进度（任务化名 T-001，无专家姓名）
        → 发布（学生/导师只见 E-001）
学生    → 异议（不改论文阶段、不改专家分）→ 学校办结
```

状态机三层：论文 `theses.stage` / 轮次 / 专家任务。`workflow.transition` 是论文阶段唯一写入口。

真实模式菜单只露已接线页。演示模式（`VITE_DEMO_MODE=true`）仍是旧 `scenarioService`，不代表后端完成。

## 切片规格（现行）

| 切片 | 规格 | 内容 |
|---|---|---|
| 0+1 | [auth-submit-ready](superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md) | 登录、提交、匿名门禁 |
| 2 | [dispatch-accept](superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md) | 确认送出、派单、接拒 |
| 3 | [online-review](superpowers/specs/2026-09-01-slice-3-online-review-design.md) | 评阅草稿与最终提交 |
| 4 | [summary-publish](superpowers/specs/2026-09-01-slice-4-summary-publish-design.md) | 汇总与学校发布 |
| 5 | [objection](superpowers/specs/2026-09-01-slice-5-objection-design.md) | 发布后异议 |
| 6 | [school-progress](superpowers/specs/2026-09-01-slice-6-school-progress-design.md) | 学校评审进度 |
| 7A-1 | [file-integrity](superpowers/specs/2026-09-21-slice-7a1-file-integrity-design.md) | 文件归属、不可变性、版本绑定与并发保护 |
| 7C-1 | [review-integrity](superpowers/specs/2026-09-21-slice-7c1-review-integrity-design.md) | 评阅写入锁定、最终提交并发与完整请求幂等 |
| 7C-2 | [thesis-integrity](superpowers/specs/2026-09-21-slice-7c2-thesis-integrity-design.md) | 论文冻结、草稿删除、待送审撤回与新旧轮次 |
| 7C-3 | [dispatch-result-integrity](superpowers/specs/2026-09-21-slice-7c3-dispatch-result-integrity-design.md) | 单专家占位、回避、发布集合与拒绝后等待 |
| 7B-2 | [supervisor-results](superpowers/specs/2026-09-21-slice-7b2-supervisor-results-design.md) | 导师结果列表/关联权限与真实建议 |
| 7B-3 | [dispatch-objection](superpowers/specs/2026-09-21-slice-7b3-dispatch-objection-design.md) | 拒绝后再派入口与当前异议 |
| 7B-4 | [termination-reassignment](superpowers/specs/2026-09-22-slice-7b4-termination-reassignment-design.md) | 终止/改派命令、权限并发及真实页面 |
| 7B-5 | [preparation-counts](superpowers/specs/2026-09-22-slice-7b5-preparation-counts-design.md) | 学校真实检测统计及加载/错误/刷新 |
| 7B-1 | [expert-workspace](superpowers/specs/2026-09-21-slice-7b1-expert-workspace-design.md) | 专家任务路由、受控阅读与本人正式意见（PDF 渲染待补验） |
| 7A-2 | [pdf-validation](superpowers/specs/2026-09-21-slice-7a2-pdf-validation-design.md) | 真实 PDF 校验、大小限制与匿名检测 |
| 7A-3 | [file-access](superpowers/specs/2026-09-21-slice-7a3-file-access-design.md) | 专用文件令牌、当前任务授权、读取审计 |

计划文件在 `docs/superpowers/plans/` 同名日期下。

## 代码落点

- 后端：`backend/app/`（FastAPI + SQLAlchemy 2 async + Alembic）。空模块目录（finance/notice/statistics/…）不是进度。
- 测试：`backend/tests/`，真实 Postgres（测试库 `paper_review_test`，宿主机 5433）。
- 前端接线：`frontend/src/api/`；页面在 `VITE_DEMO_MODE=false` 时走真实 API。
- 演示假服务：`frontend/src/demo/scenarioService.ts`，冻结，不再加业务。

种子账号密码默认 `ChangeMe!dev-only`：`student.lin`、`school.wang`、`platform.chen`、`expert.zhou`、`supervisor.zhao`、`admin.system`。

## 文档怎么读

1. 仓库根 [README.md](../README.md)（怎么跑）
2. 本文
3. 上表切片规格
4. 需要术语时再看 [CONTEXT.md](../CONTEXT.md)
5. `docs/00`–`10`、`engineering-specification.md`、`ui-design-system.md`：2026-08 草稿，**历史**
6. `docs/superpowers/archive/`：8 月前端演示规格，**历史**
7. `docs/99_原始材料/`：只读，不删、不改

## 上 GitHub 时注意

- 不要提交 `.env`、`frontend/.env.local`、`storage/` 里的论文文件、`.playwright-mcp/`。
- 当前审查基线为 `codex/slice-7a1-file-integrity`；推送前核对实际分支与远端，不直接把施工状态写入 `main`。
- 本仓库仍是施工中的垂直切片，README 不要写成已上线产品。
