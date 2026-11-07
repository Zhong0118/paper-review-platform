---
title: API 设计
status: DRAFT
version: 0.2.0
last_updated: 2026-08-10
sources:
  - docs/01_需求分析/需求规格说明.md
  - docs/02_产品设计/产品与流程设计.md
  - docs/04_数据库设计/数据库设计.md
related_documents:
  - docs/03_架构设计/总体架构与安全设计.md
  - docs/07_测试验收/测试与验收.md
---

# API 设计

## 1. API 边界

对外提供版本化 REST API，建议基线路径 `/api/v1`。API 文档描述资源、动作、权限、并发和错误语义；具体请求模型与 OpenAPI 文件在实施计划确定后生成，不以当前文档替代代码契约。

所有业务权限在服务端执行。前端隐藏按钮不能构成授权控制。学校审核端、百杰审核端、学生、导师和专家即使调用同一资源，也必须使用不同的数据投影，避免通过字段过滤失误泄露盲审身份。

## 2. 通用协议

### 2.1 身份与上下文

- 每个请求必须具有已认证主体、当前租户上下文和角色/数据范围；平台专家处理任务时由任务确定租户上下文。
- 客户端不得通过自由传入 `tenant_id` 获得访问范围；服务端从可信身份和任务关系解析。
- 高风险管理操作要求重新认证或等价的强校验，并写审计日志。

### 2.2 响应、分页和时间

- 时间使用 ISO 8601 并带时区，服务端存储 UTC。
- 列表统一使用游标分页；确需页码跳转的后台列表可提供页码分页，但同一接口不得混用。
- 排序字段采用白名单；默认稳定排序包含唯一键，防止翻页重复或遗漏。
- 空集合返回空数组；缺失资源与无权限资源对敏感对象使用一致的外部响应，降低枚举风险。

### 2.3 幂等与并发

提交、撤回申请、指派、接受/拒绝、最终提交、发布、异议、提现等命令要求 `Idempotency-Key`。资源响应返回版本或 ETag；更新命令携带预期版本，冲突返回 `409 CONFLICT`。重复请求返回原结果，不重复创建任务、账务或通知。

### 2.4 文件协议

客户端先申请受限上传凭证，再完成上传确认。下载必须调用授权接口获得短时签名地址，禁止返回永久对象地址。原件、匿名件、异议附件、资质文件和导出文件使用不同用途声明，服务端验证大小、类型、摘要、扫描状态和授权范围。

## 3. 接口目录

### 3.1 认证、租户与学校同步

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-001 | `POST /auth/login`、`POST /auth/refresh`、`POST /auth/logout` | 登录会话 | 全部用户 |
| API-002 | `GET /me`、`GET /me/contexts` | 当前主体和可用上下文 | 全部用户 |
| API-003 | `/admin/tenants` | 租户启停和基础配置 | 系统管理员 |
| API-004 | `/admin/users`、`/admin/role-assignments` | 账户与五类角色授权 | 系统管理员（受范围限制） |
| API-005 | `POST /integrations/school/sync-jobs`、`GET /integrations/school/sync-jobs/{id}` | 学校身份、组织、批次和资格同步 | 可信系统主体、系统管理员查看状态 |

同步接口必须鉴别来源、校验签名、记录源版本并支持安全重放。学校权威字段不提供普通人工修改 API。

### 3.2 论文提交与匿名化

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-006 | `GET/POST /theses`、`GET/PATCH /theses/{id}` | 创建和维护草稿（含送审专业方向） | 学生 |
| API-007 | `POST /theses/{id}/versions` | 创建论文版本并关联上传文件 | 学生 |
| API-008 | `POST /theses/{id}:submit` | 提交当前版本 | 学生 |
| API-009 | `POST /theses/{id}:withdraw`、`POST /withdrawal-requests/{id}:decide`、`POST /school-review/theses/{id}:terminate` | 送审前撤回、送审后申请审批或学校永久终止 | 学生、学校审核人员 |
| API-010 | `GET /school-review/theses`、`POST /school-review/theses/{id}:confirm-anonymization`、`POST /school-review/theses:batch-confirm-anonymization`、`POST /school-review/theses/{id}:confirm-dispatch` | 材料和匿名件确认、逐项返回的批量确认、学校确认送出 | 学校审核人员 |
| API-011 | `POST /files:prepare-upload`、`POST /files/{id}:complete`、`POST /files/{id}:authorize-download` | 文件上传确认和授权下载 | 按资源权限 |
| API-036 | `POST /school-review/theses` | 学校为已同步学生单篇代传并直接提交 | 学校审核人员 |
| API-037 | `POST /school-review/thesis-imports:preview`、`POST /school-review/thesis-imports/{id}:commit` | 批量导入预检与确认写入 | 学校审核人员 |

匿名检查失败必须返回结构化检查项；未确认匿名件不得进入 `READY_FOR_DISPATCH`。批量确认逐项返回成功/失败，不执行无解释的部分提交。学校确认送出后才允许百杰创建首个送审轮次。学校审核投影允许识别学生，不返回专家身份。

学校代传请求必须包含已同步 `student_id`、`batch_id`、`discipline_code`、`discipline_name`、`keywords: string[]` 及原始/匿名文件引用，并记录 `submission_source=SCHOOL_MANUAL` 和操作审计。批量导入预检逐行返回 `VALID/DUPLICATE/UNKNOWN_DISCIPLINE/MISSING_FILE`；只有显式确认后才允许有效行写入并记为 `SCHOOL_BATCH`。当前代码仅提供前端演示预览，API-036/037 是待后端实现的正式契约，不得据此宣称真实 Excel 解析或批量写入已经完成。

### 3.3 专家与送审

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-012 | `/platform-review/experts`、`/experts/{id}/qualifications`、`GET/PATCH /experts/me` | 平台专家库、资格审核与专家本人资料维护 | 百杰审核人员；专家仅维护本人资料 |
| API-013 | `GET /platform-review/dispatch-candidates` | 按送审专业方向、学科与回避条件检索候选专家 | 百杰审核人员 |
| API-014 | `POST /review-rounds` | 为已确认论文版本创建轮次并携带送审专业方向 | 百杰审核人员 |
| API-015 | `POST /review-rounds/{id}/tasks` | 人工指派专家 | 百杰审核人员 |
| API-016 | `POST /expert-tasks/{id}:reassign`、`POST /review-rounds/{id}:supplement` | 改派或补审 | 百杰审核人员 |
| API-017 | `POST /expert-tasks/{id}:remind`、`POST /expert-tasks/{id}:extend`、`POST /expert-tasks/{id}:cancel` | 催审、延期、取消 | 百杰审核人员 |

候选和任务响应面向百杰审核人员时，可返回匿名论文、学科/送审专业方向、专家身份，以及派单、进度和费用管理所必需的学生/导师身份；不得返回论文原始版或超出当前租户与职能范围的身份信息，敏感访问必须审计。学校审核人员的进度接口使用任务化名或数量统计，不返回专家身份。

### 3.4 专家评阅

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-018 | `GET /expert/tasks`、`GET /expert/tasks/{id}/invitation` | 邀请和任务列表 | 专家 |
| API-019 | `POST /expert/tasks/{id}:accept`、`POST /expert/tasks/{id}:reject` | 显式接受或拒绝 | 专家 |
| API-020 | `GET /expert/tasks/{id}/materials` | 接受后获取完整匿名材料 | 专家本人 |
| API-021 | `PUT /expert/tasks/{id}/draft` | 保存评阅草稿 | 专家本人 |
| API-022 | `POST /expert/tasks/{id}:submit-final` | 最终提交并锁定；按模板评分模式校验（分项平均或总分+评语） | 专家本人 |
| API-023 | `POST /expert/tasks/{id}/correction-requests`、`GET /correction-requests`、`GET /correction-requests/{id}`、`POST /correction-requests/{id}:decide` | 结果更正申请、范围化查询与批准 | 专家提交本人申请；百杰审核人员查询和决定 |

接受前只返回匿名基本信息、学科、期限和说明。拒绝必须填写原因。超期不自动删除草稿；任务被取消后草稿只读。最终提交请求必须以模板版本校验所有必填项和分数范围。

### 3.5 汇总、发布、异议与查看

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-024 | `GET /school-review/results` | 查看去标识的独立结果、汇总和冲突 | 学校审核人员 |
| API-025 | `POST /result-summaries/{id}:publish` | 确认发布 | 学校审核人员 |
| API-026 | `GET /my/theses/{id}/published-result` | 查看已发布分数、可发布评语和汇总 | 学生；导师限本人学生 |
| API-027 | `POST /my/theses/{id}/objections`、`GET /objections/{id}`、`GET /school-review/objections` | 提交、本人跟踪和学校范围化查询异议 | 学生、学校审核人员 |
| API-028 | `POST /objections/{id}:record-resolution` | 回填线上或线下处理结论 | 学校审核人员 |

无汇总规则时只返回各独立结果，不生成推测性结论。冲突规则命中只产生标记和补审流程，不允许审核人员修改专家原始结果。

### 3.6 通知、费用、审计与导出

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-029 | `GET /notifications`、`POST /notifications/{id}:read` | 站内通知 | 全部用户 |
| API-030 | `GET /expert/account`、`GET /expert/ledger` | 费用与余额 | 专家本人 |
| API-031 | `POST /expert/withdrawals`、`GET /expert/withdrawals/{id}` | 在线提现申请 | 专家本人 |
| API-032 | `GET /finance/withdrawals`、`GET /finance/withdrawals/{id}`、`POST /finance/withdrawals/{id}:review`、`POST /finance/withdrawals/{id}:record-payment` | 范围化查询、人工审核和线下付款回填 | 授权财务处理范围；不新增核心角色 |
| API-033 | `GET /audit-events` | 范围化审计查询 | 经授权的系统管理员或审核人员 |
| API-034 | `POST /exports`、`GET /exports/{id}` | 异步生成评阅书和统计导出 | 按数据范围 |
| API-038 | `GET /school-review/account`、`GET /school-review/bills`、`GET /school-review/bills/{id}`、`POST /finance/school-accounts/{tenantId}:record-credit` | 学校查看额度与送审账单；百杰录入线下充值或合同额度 | 学校审核人员只读本校；百杰授权财务职能写入 |

财务操作权限通过现有角色的数据范围或职能权限赋予，不为此新增第六个核心角色。P0 不提供自动支付供应商调用接口。学校确认送出必须在同一业务事务中校验费用快照并冻结额度；未配置规则或额度不足时不创建轮次/任务。有效评阅后，学校冻结额度转消费账单，专家收入由同一业务事件幂等入账。

### 3.7 批次与评审规则

| 编号 | 方法与资源 | 用途 | 主要角色 |
|---|---|---|---|
| API-035 | `GET /school-review/batches`、`GET/POST /school-review/batches/{id}/rule-versions`、`PATCH /school-review/batches/{id}/rule-versions/{version}`、`POST /school-review/batches/{id}/rule-versions/{version}:activate` | 查看学校权威批次，维护并启用评审规则版本 | 具备批次配置权限的学校审核人员；普通学校审核人员只读 |

批次名称、起止时间、组织和提交资格等学校权威字段只读。规则版本覆盖目标专家人数、接单/评阅期限、评阅模板及评分模式、汇总模式、冲突条件、异议期限和通知策略；不得提供未经学校确认的默认业务值。新版本先保存草稿并校验，启用后不可原地修改；创建送审轮次时固化规则快照。所有创建、修改和启用命令要求幂等、乐观锁和审计。

## 4. 业务投影与敏感字段

| 调用方 | 可返回 | 必须排除 |
|---|---|---|
| 学校审核人员 | 学生身份、匿名检查、任务进度、去标识结果 | 专家真实身份和联系方式 |
| 百杰审核人员 | 匿名论文、学科/送审专业方向、专家身份、学生/导师身份（运营需要）、任务和结果版本 | 原始版、跨校业务数据 |
| 专家 | 自己接受后的匿名论文、模板、本人草稿和结果 | 作者、导师身份及其他专家评语 |
| 学生 | 本人论文、已发布分数/评语/汇总、异议状态 | 专家身份、未发布结果、其他学生数据 |
| 导师 | 自己学生的已发布结果 | 专家身份、未发布结果、非本人学生数据 |
| 系统管理员 | 租户、账号、配置、运行状态 | 默认不得读取业务内容和盲审映射 |

## 5. 错误码基线

| 错误码 | HTTP | 含义 |
|---|---:|---|
| `AUTH_REQUIRED` | 401 | 未认证或会话失效 |
| `ACCESS_DENIED` | 403 | 已认证但无权执行动作 |
| `RESOURCE_NOT_FOUND` | 404 | 资源不存在或敏感资源不可见 |
| `VALIDATION_FAILED` | 422 | 字段或模板校验失败 |
| `STATE_TRANSITION_DENIED` | 409 | 当前状态不允许该动作 |
| `VERSION_CONFLICT` | 409 | 乐观锁或资源版本冲突 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一幂等键用于不同请求 |
| `ANONYMIZATION_FAILED` | 422 | 匿名检查未通过 |
| `FILE_NOT_READY` | 409 | 文件未完成、扫描失败或用途不符 |
| `CONFLICT_RULE_TRIGGERED` | 409 | 结果冲突，需补审或处理 |
| `FEE_RULE_MISSING` | 409 | 当前批次缺少可用于送审的费用规则快照 |
| `INSUFFICIENT_SCHOOL_BALANCE` | 409 | 学校账户可用额度不足，不能确认送审 |
| `RATE_LIMITED` | 429 | 请求频率超过限制 |
| `INTEGRATION_UNAVAILABLE` | 503 | 外部系统暂时不可用 |

错误响应包含 `request_id`、稳定错误码、可本地化消息和必要的字段级详情；不得返回堆栈、对象键、SQL 或敏感身份信息。

## 6. 审计与可观测性

登录、资格同步、文件下载、匿名确认、状态变化、专家指派、接受/拒绝、结果提交/更正、发布、异议结论、提现和权限变更必须记录审计事件。请求日志以 `request_id` 关联，但不得记录论文全文、完整评语、令牌、密码、签名地址或支付敏感数据。

## 7. API 编码准入条件

- 相关 FR、ROLE、FLOW、TABLE、TC 和 AC 已建立追踪关系；
- 请求/响应投影通过盲审泄露检查；
- 状态命令具有权限、幂等、并发和审计规则；
- 文件接口具有用途、租户、扫描和短时授权约束；
- 正常、异常、重复和越权场景均有验收项；
- OpenAPI 在实现时由真实接口模型生成并纳入一致性检查。
