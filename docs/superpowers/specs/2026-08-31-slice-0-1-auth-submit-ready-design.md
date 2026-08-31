---
title: 切片 0+1 认证与提交到待送审
status: DRAFT
version: 0.1.0
last_updated: 2026-08-31
sources:
  - docs/00_项目总览/项目总览.md
  - docs/01_需求分析/需求规格说明.md
  - docs/02_产品设计/产品与流程设计.md
  - docs/03_架构设计/总体架构与安全设计.md
  - docs/04_数据库设计/数据库设计.md
  - docs/04_数据库设计/增量1_字段级数据库设计.md
  - docs/05_API设计/API设计.md
  - docs/05_API设计/增量1_API契约草案.md
  - docs/10_审查与决策/ADR/ADR-0001-模块化单体与技术栈.md
  - docs/10_审查与决策/ADR/ADR-0002-认证授权与多租户隔离.md
  - docs/10_审查与决策/问题与决策记录.md
related_documents:
  - docs/10_审查与决策/编码准入检查表.md
  - AGENTS.md
  - CONTEXT.md
---

# 切片 0+1：认证与提交到待送审

本文是**现行施工规格**。与旧演示计划、空后端骨架冲突时，以本文为准。正式长文档（`docs/00`–`10`）不在本切片重写；决策编号仍引用 Q-*/ADR-*/FR-*。

## 1. 问题与目标

仓库现状：前端是可点的演示（业务集中在 `frontend/src/demo/scenarioService.ts`），后端几乎全是空文件，没有可运行的 Postgres 配置。系统“不能用”，不是缺页面，是没有真实状态机和权限边界。

本切片交付一套**能启动、能登录、能把一篇学生自提论文送到 `READY_FOR_DISPATCH`** 的真系统。学校 SSO、派单、评阅、费用不做。

完成标准：

1. `docker compose up postgres` 后，本机 FastAPI + Vite 能跑；用种子账号走真实登录。
2. 学生建草稿 → 上传原始版与匿名版 → 提交 → 检测 → 学校通过 → `READY_FOR_DISPATCH`；库中有版本、两份文件、检测记录、工作流事件。
3. 检测明确命中身份线索时，论文自动退回 `DRAFT`（不改文件），学生能看到结构化 findings 与退回原因。
4. 另一租户账号拿同一论文/文件 id，对外表现与无权限一致。
5. 专家与系统管理员不能读原始版；百杰审核本切片不能调学校审核与学生论文写接口。
6. `VITE_DEMO_MODE=false` 时，PAGE-001/002/003/004 走真实 API，不依赖 `scenarioService`。

## 2. 非目标

- 学校 SSO、研究生系统同步、学校代传/批量导入。
- 确认送出、冻余额、派单、专家任务、评阅、汇总、发布、异议、费用、通知渠道。
- Redis、Celery、MinIO、PostgreSQL RLS（应用层租户过滤先落地）。
- 整站前端重构、继续往 `scenarioService` 加业务。
- 填 `backend/app/modules/**` 里本切片用不到的空文件。
- 删除 `docs/99_原始材料/`。

RLS 是 ADR-0002 的 P0 约束，本切片**延期而非取消**；上生产前必须补 RLS 与跨租户集成测试。

## 3. 基础设施

| 项 | 决定 |
|---|---|
| 数据库 | PostgreSQL 16+，独立 Docker 容器，**不要**复用 CRM 的 5432，**不要**用本机 Postgres |
| 端口 | 宿主机 `5433` → 容器 `5432`；库名 `paper_review`；用户/密码仅在 `.env` |
| Redis / Celery / MinIO | 本切片不起 |
| 文件 | 本地 `storage/original/` 与 `storage/anonymous/`（及 `attachment/`），对象键不暴露 |
| FastAPI | 本机 `uvicorn --reload`，默认 `8000`，连 `localhost:5433` |
| 前端 | 本机 `pnpm dev`，`VITE_API_BASE_URL=/api/v1`，Vite 代理到 `8000` |
| 密钥 | `.env` 不进 git；提供 `.env.example` |

CRM 容器继续占用 5432/6379，互不影响。

## 4. 认证

- 本切片**只有平台账号**（用户名+密码）。学生也走这条路。SSO 整条主链路跑通之前不做。
- `POST /api/v1/auth/login` 返回短期 access JWT；refresh 只存**哈希**在 `auth_sessions`，登出即废。
- Token 声明：`user_id`、当前 `role`、当前 `tenant_id`（平台角色可空）、`data_scope`。客户端不得传 `tenant_id`。
- 种子账号每人一个角色，不做角色切换器。
- 系统管理员默认 403 论文与文件内容（ADR-0002）。
- 密码：passlib 哈希（argon2id 优先，否则 bcrypt）。
- 前端：access 放 Pinia + `sessionStorage`（刷新不掉登录）；refresh 同策略。生产再改 httpOnly cookie，本切片不阻塞。
- 登录页：真实表单接 `/auth/login`。`VITE_DEMO_MODE=true` 时保留演示角色按钮，**验收以真实登录为准**。

学生用平台密码是 SSO 前的临时通道，不改变「学校权威主数据」——资格仍来自 `student_eligibilities` 种子，学生不能改学号/导师/批次。

## 5. 领域规则（本切片）

### 5.1 论文阶段

官方状态机保留全部枚举；本切片**可进入**的阶段：

`DRAFT` → `SUBMITTED` → `PREPARING` → `READY_FOR_DISPATCH`

以及退回/撤回 → `DRAFT`，永久终止 → `TERMINATED`。

提交在同一请求内：

1. 校验资格、文件、字段、版本 → 流转 `DRAFT` → `SUBMITTED`（写事件）；
2. 立刻跑匿名检测 → 流转 `SUBMITTED` → `PREPARING`（写事件）；
3. 若检测结论 `FAIL` → 再流转 `PREPARING` → `DRAFT`，带原因与 findings，学生可改后重提。

`SUBMITTED` 不得从库里省略，即使界面上一闪而过。学生端仍把 `SUBMITTED`/`PREPARING`/`READY_FOR_DISPATCH` 显示为「学校审核」。

`UNDER_REVIEW` 及之后本切片不可达。`workflow.transition` 是改 `theses.stage` 的唯一入口。

### 5.2 匿名门禁

与 FLOW-002 / FR-009 / FR-010 对齐，修正「一律等人审」的初稿：

| 自动结论 | 随后 |
|---|---|
| `FAIL`（正文/文件名/元数据命中姓名、学号或导师姓名） | 自动退回 `DRAFT`，学校不必先点退回 |
| `PASS` | 停在 `PREPARING`，等学校人工确认通过才到 `READY_FOR_DISPATCH` |
| `REVIEW_REQUIRED`（抽文本失败以外的弱匹配、仅元数据可疑等） | 停在 `PREPARING`，学校通过或退回 |

学校**不能**在最新检测为 `FAIL` 时点通过（请求拒绝）。系统**不改**论文文件。加密/损坏 PDF 在上传完成阶段拒绝，进不了提交。

致谢章节专项 NLP 不做；全文字符串命中即算线索。命中项结构化：`field`、`matched_text`（截断）、`location`（filename / metadata / body）。

### 5.3 提交与版本

- 来源固定 `STUDENT`。
- 同一租户、同一学生、同一批次，**非 `TERMINATED` 论文至多一篇**。`POST /theses` 冲突返回 409，带已有 `id`。
- `POST /theses` 创建论文 + 可编辑草稿版本。
- `PATCH` 只改当前草稿版本：题目、专业代码+名称（目录内）、关键词（去空白去重数组）。学校权威字段只读。
- 原始版、匿名版绑定当前草稿版本，用途枚举 `original` / `anonymous`。附件 `attachment` **本切片可选**。
- 提交后该版本不可改。撤回或退回 `DRAFT` 时**新建**可编辑版本，旧版本保留。
- 从未成功提交过的纯草稿允许 `DELETE`（软删除或标记废弃且文件解除引用）。一旦有过 `SUBMITTED` 事件，禁止删除，只能撤回后改。

### 5.4 允许动作

列表/详情必须带服务端 `allowed_actions`。前端按钮只消费该字段，不本地推状态机。

学生草稿示例：`EDIT_THESIS`、`SUBMIT_THESIS`、`DELETE_DRAFT`（仅从未提交）。  
`SUBMITTED`/`PREPARING`/`READY_FOR_DISPATCH`：`WITHDRAW_BEFORE_DISPATCH`。  
学校在 `PREPARING` 且结论非 `FAIL`：`CONFIRM_ANONYMIZATION`、`REJECT_ANONYMIZATION`、`TERMINATE`。

### 5.5 文件授权

| 角色 | 原始版 | 匿名版 |
|---|---|---|
| 学生（本人） | 是 | 是 |
| 学校审核（本租户、数据范围内） | 是 | 是 |
| 百杰审核 | 否 | 本切片不开放论文读接口 |
| 专家 | 否 | 本切片无任务，全部否 |
| 系统管理员 | 否 | 否 |

下载一律 `authorize-download` 后短时令牌或经 API 流出，不返回磁盘路径。

## 6. 模块边界

只实现：`core`、`auth`、`tenant`、`user`、`thesis`、`files`、`workflow`、`audit`。

- `thesis` 不直接写 `stage`，调用 `workflow.transition`。
- `files.authorize` 在给流/签名前校验租户、角色、用途、资源关系。
- `dispatch` / `review` / `result` / `finance` / `notice` / `expert` / `integration` 本切片零实现；空 stub 文件不填、不在 `api.py` 挂路由。

前端只改：登录、学生工作台、论文编辑、学校送审准备。其它页面维持演示，不改 `scenarioService` 行为。

真实 API client 新建（例如 `frontend/src/api/http.ts`、`auth.ts`、`theses.ts`、`schoolReview.ts`、`files.ts`），页面在非演示模式走它们。

## 7. 数据模型（本切片表）

通用字段遵循正式数据库设计：UUID、`timestamptz` UTC、聚合根 `version`、业务历史不物理删。

**身份：** `tenants`、`organizations`、`review_batches`、`users`、`tenant_user_memberships`、`roles`、`user_role_assignments`、`student_eligibilities`、`auth_sessions`

**论文/文件/流程：** `theses`、`thesis_versions`、`file_objects`、`thesis_version_files`、`anonymization_checks`（`findings` 用 jsonb，不另拆表）、`workflow_events`、`termination_records`

**其它：** `audit_events`、`discipline_catalog`、`idempotency_keys`

不建：轮次、专家任务、评阅、汇总、异议、费用、通知投递、`external_sync_records`。

`theses` 关键约束：

- `tenant_id` 必填；`stage` 官方枚举；`submission_source` 本切片恒 `STUDENT`
- 有效论文唯一：`(tenant_id, student_membership_id, review_batch_id)` 在 `stage <> TERMINATED` 下唯一（部分唯一索引）
- `current_version_id` 仅读取优化

`anonymization_checks`：`thesis_version_id`、自动结论、人工结论可空、检测器版本、`findings` jsonb。

字段级类型与 C1 文档对齐；C1 未覆盖的论文表按 `docs/04_数据库设计/数据库设计.md` 第 3.2 节在迁移里写全，不另开一份平行字段文档。

## 8. API（`/api/v1`）

统一包装：`{ request_id, code, message, data }`。命令接口要 `Idempotency-Key`；更新带 `version`，冲突 `VERSION_CONFLICT`。

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/healthz` `/readyz` | 公开；readyz 探 Postgres + 迁移头 |
| POST | `/auth/login` `/auth/refresh` `/auth/logout` | 登录公开 |
| GET | `/me` | 已登录 |
| GET | `/me/eligibility` | 学生 |
| GET/POST | `/theses` | 学生本人 |
| GET/PATCH/DELETE | `/theses/{id}` | 学生本人；DELETE 仅从未提交草稿 |
| POST | `/theses/{id}:submit` | 学生 |
| POST | `/theses/{id}:withdraw` | 学生，派单前 |
| GET | `/school-review/theses` | 学校审核 |
| GET | `/school-review/theses/{id}` | 学校审核（学生身份 + findings，无专家字段） |
| POST | `/school-review/theses/{id}:confirm-anonymization` | 学校审核。body：`decision=PASS\|REJECT`，`REJECT` 必填 `reason`，带 `version` |
| POST | `/school-review/theses/{id}:terminate` | 学校审核，必填原因 |
| POST | `/files:prepare-upload` | 须带 `thesis_id` + `purpose`，校验草稿所有权或学校读权 |
| POST | `/files/{id}:complete` | 校验大小/类型/可读/未加密，写 sha256 |
| POST | `/files/{id}:authorize-download` | 按第 5.5 节 |

无权限与不存在，对敏感对象同一对外 code（如 `NOT_FOUND`），审计记真实原因。

本切片不做：`confirm-dispatch`、代传、导入、学校同步、专家与评阅全部 API。

## 9. 种子数据

开发库可重复执行的 seed：

- 租户 `demo-univ`、`other-univ`，均为 `ACTIVE`
- 各一个 `OPEN` 批次、一个学院组织、若干 `discipline_catalog`
- `demo-univ`：学生资格（含虚构姓名、学号、导师姓名供检测）；账号：学生、学校审核、百杰审核、专家、系统管理员，外加一条导师 membership（供检测，不必登录）
- `other-univ`：另一个学生账号
- 密码来自环境变量，代码与文档不写生产口令；示例可用 `ChangeMe!dev-only`

全部虚构身份。

## 10. 测试

后端：pytest，**真实 Postgres**（独立 test database 或 compose 同实例不同 db），不用 SQLite。

必须覆盖：

1. 登录与 `/me` 角色、租户
2. 无资格不能创建/提交
3. 草稿 → 双文件 → 提交 → `PREPARING`；版本与 check 落库；`SUBMITTED` 事件存在
4. 匿名版文件名或正文含学号 → `FAIL` → 自动 `DRAFT`，findings 非空
5. `PASS` 后学校通过 → `READY_FOR_DISPATCH`；退回 → `DRAFT` + 原因
6. 派单前撤回 → `DRAFT`，旧版本仍在
7. 跨租户 thesis/file id 拒绝
8. 专家/管理员授权下载原始版 403
9. 同一 `Idempotency-Key` 重复 submit 不产生第二提交版本
10. 检测 `FAIL` 时学校 PASS 被拒
11. 已提交过的论文不能 DELETE

前端：vitest 对登录/学生提交/学校通过的服务层或页面做最小路径；不把全站 E2E 当本切片门禁。演示测试保持原样。

## 11. 文档处置（本切片一并做）

- **不删** `docs/99_原始材料/`。
- 在 `docs/README.md` 增加「现行施工规格」指向本文；旧 `docs/superpowers/plans/*` 与 frontend-client-demo 计划标为**演示历史**，不再当实现依据。
- `docs/09_项目管理/实施计划.md` 仍是全 P0 总图，本切片不替换它，只在 README 声明执行顺序改为垂直切片。
- 空的根 `README.md` 写成能 clone 后按 compose + uvicorn + pnpm 跑起来的最短说明。

## 12. 对抗性自检（已消化）

| 风险 | 处理 |
|---|---|
| 跳过官方 `SUBMITTED` | 同请求内仍写该阶段与事件 |
| 检测失败仍等人审，与 FLOW-002 冲突 | `FAIL` 自动退回；学校不能覆盖 FAIL |
| 结束在待送审却误做「确认送出」 | `confirm-dispatch` 明确排除 |
| 删除已有提交历史的草稿 | 仅从未提交可删 |
| 复用 CRM 的 5432 | 独立容器 5433 |
| 用 SQLite 顶替 | 禁止 |
| 客户端传 tenant_id | 禁止；上下文来自会话 |
| 百杰看到原始版 | 本切片不给论文读；永久禁止原件 |
| 系统管理员当超级读论文 | 403 |
| 一篇批次多论文 | 部分唯一索引 + 409 |
| 撤回覆盖旧版本 | 新版本，旧只读 |
| 孤儿文件上传 | prepare 必须 thesis_id + purpose |
| 把空模块目录当进度 | 不填、不挂路由 |
| 先重构演示层 | 禁止改 scenarioService 行为 |
| 把延期 RLS 当成取消 | 第 2 节写明生产前必补 |

## 13. 后续切片（不在本文实现）

1. 学校确认送出（额度先可做成固定规则或跳过真资金，另开规格）
2. 专家库 + 人工派单 + 接拒
3. 在线评阅与锁定
4. 汇总发布
5. 异议
6. 费用提现
7. RLS + MinIO + Redis/Celery

每片独立规格与计划。
