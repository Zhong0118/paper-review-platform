---
title: 代码工程规范
status: DRAFT
version: 0.1.0
last_updated: 2026-08-04
sources:
  - docs/03_架构设计/总体架构与安全设计.md
  - docs/06_开发规范/开发规范.md
  - 用户提供的代码与前端规范示例
related_documents:
  - ../06_开发规范/开发规范.md
  - ../ui-design-system.md
  - ../05_API设计/API设计.md
  - ../04_数据库设计/数据库设计.md
---

# 代码工程规范

本文件是 `docs/06_开发规范/开发规范.md` 的**代码级细则**：它规定写每一行代码时的文件头、注释、命名、TODO、错误码、API 调用、事务、测试和迁移标准。编码时所有新增/修改代码必须遵守本文件与 `docs/06_开发规范/`、`docs/03_架构设计/`。

> 状态：本文件为 `DRAFT`，供用户评审；评审通过后，编码阶段作为强制约束。正式文档未批准前不视为已批准设计。

## 1. 整体技术栈

| 层 | 技术 | 版本/约束 |
|---|---|---|
| 后端语言 | Python | ≥ 3.11 |
| 后端框架 | FastAPI | 最新稳定 |
| ORM/迁移 | SQLAlchemy 2.x + Alembic | 2.x 语法；迁移独立版本 |
| 数据校验 | Pydantic v2 | 请求/响应模型 |
| 数据库 | PostgreSQL | RLS 多租户 |
| 缓存/队列 | Redis + Celery | 异步任务 |
| 对象存储 | MinIO/S3 兼容 | 私有桶 |
| 前端语言 | TypeScript | 全量 TS，禁用无类型 JS |
| 前端框架 | Vue 3 | Composition API + `<script setup lang="ts">` |
| 前端构建 | Vite | 最新稳定 |
| 样式方案 | Tailwind CSS v4（CSS-first） | 布局/间距/排版/业务组件样式；令牌经 `@theme` |
| UI 组件库 | Element Plus | 表单/表格/弹窗/日期/上传/消息等交互组件 |
| 状态管理 | Pinia | 模块化分 store |
| HTTP 客户端 | axios | 统一封装与拦截器 |
| 日期处理 | dayjs | 与 Element Plus 同源 |
| 图标 | @element-plus/icons-vue | 统一图标库 |
| 表单校验 | Element Plus 原生 + 统一 FormItem 封装 | 不引第三方表单库 |
| 接入层 | Nginx + HTTPS | Docker Compose |

原则：模块化单体，模块通过应用服务接口协作；只有出现第二个真实适配器/独立扩缩需求才拆服务。所有外部能力（学校同步、通知、存储、未来支付）经适配器接缝接入，可用测试适配器替换。

## 2. 后端代码规范

### 2.1 目录与分层

每个业务模块按 `docs/03_架构设计/总体架构与安全设计.md` 模块表组织：

```text
backend/app/modules/<module>/
  domain.py          # 实体、值对象、领域规则（不依赖 Web 框架）
  application/       # 用例、命令、查询、事务边界
  infrastructure/    # 仓储、外部适配器
  api.py             # 路由与请求/响应模型
  service.py         # 应用服务（薄层，组织用例与跨模块调用）
  repository.py      # 数据访问（限定租户）
  model.py           # SQLAlchemy ORM
  schema.py          # Pydantic 请求/响应
  permissions.py     # 本模块权限
  enums.py           # 状态枚举（引用 02 唯一枚举表）
  events.py          # 事件定义
  tasks.py           # 本模块异步任务（可选）
```

分层职责与禁止项见 `docs/06_开发规范/` 第 4 节：API 层不含业务判断；领域层不依赖 Web 框架；禁止跨模块直接写其他模块表或状态字段。

### 2.2 文件头注释

每个代码文件**顶部必须有文件头块注释**，说明：文件职责、主要功能清单、主要依赖、权限要点、注意事项。以业务后端模块为例：

```python
"""
@file 论文评审结果服务
@description
    负责评审结果的草稿保存、正式提交、评分汇总和仲裁判断。

主要功能：
    1. 保存评审草稿。
    2. 校验评审提交内容。
    3. 提交并锁定评审结果。
    4. 计算论文综合评分。
    5. 判断是否需要进入仲裁流程。

主要依赖：
    - ReviewRepository：读写评审结果。
    - PaperRepository：更新论文状态。
    - AuditLogService：记录重要操作。

权限说明：
    - 评审专家只能操作分配给自己的任务。
    - 管理员可以重新开放已提交的任务。

注意事项：
    - 已提交评审默认不可修改。
    - 评分差异达到业务阈值时触发仲裁。
"""
```

配置、迁移、测试文件可适当简化，但至少含：`@file`、`@description`（一句话）、`主要功能`（条列）。

### 2.3 方法注释规范

**2.3.1 公开业务方法**：每个公开业务方法必须用一行注释说明其业务作用。

```python
def get_editable_review_task(self, reviewer_id: str, assignment_id: str) -> ReviewTask:
    """验证当前专家是否拥有该评审任务，并返回可编辑的任务信息。"""
    ...
```

**2.3.2 复杂方法**：使用 docstring 说明参数、返回值、异常和副作用。

```python
def submit_review(self, reviewer_id: str, assignment_id: str, input_: SubmitReviewInput) -> SubmitReviewResult:
    """提交评审结果并根据多名专家评分判断论文是否需要仲裁。

    Args:
        reviewer_id: 当前评审专家 ID。
        assignment_id: 评审任务 ID。
        input_: 评审评分和意见。

    Returns:
        提交后的评审结果和论文最新状态。

    Raises:
        ForbiddenException: 当前专家不拥有该任务。
        ConflictException: 任务已经提交或已经关闭。

    Side effects:
        更新评审任务、论文状态并写入审计日志。
    """
    ...
```

**2.3.3 私有辅助方法**：名称清晰的可省略注释。需要注释的私有方法：状态转换、权限判断、复杂数据转换、特殊排序/计算、易被误改的兼容逻辑、存在性能权衡的方法。

**2.3.4 禁止的注释**：不得写仅重复代码字面意思的注释。

```python
# 不推荐：
# 设置 loading 为 True。
self.loading = True

# 推荐：
# 请求期间锁定提交入口，避免产生重复评审记录。
self.loading = True
```

注释解释**原因与不变量**，不重复表面行为（开发规范第 7 节）。

### 2.4 命名规范

| 类别 | 规范 | 示例 |
|---|---|---|
| 模块/包 | 小写下划线 | `modules/thesis/` |
| 类 | PascalCase | `ThesisVersionService` |
| 函数/方法 | snake_case | `submit_final_review()` |
| 私有 | 前置单下划线 | `_validate_conflict()` |
| 常量 | 全大写下划线 | `MAX_REVIEW_SCORE` |
| 数据库表/字段 | snake_case | `review_result_versions` |
| 布尔命名 | 用 is/has/can 开头 | `is_eligible`、`can_dispatch` |
| 枚举成员 | 全大写下划线 | `TaskStatus.SUBMITTED` |
| 异常 | 以 Error/Exception 结尾 | `ReviewConflictError` |

API 资源用复数名词，业务动作用 `:verb`（如 `/theses/{id}:submit`），与 `docs/05_API设计/` 一致。

### 2.5 类型与数据校验

- 明确类型注解；禁止公共接口用隐式 dict。
- Pydantic 请求模型与 SQLAlchemy 持久化模型**分离**，不把 DB 字段直接暴露为 API。
- 时间用 `datetime`（带时区）对象；金额用 `Decimal` 或整数最小单位，禁止浮点。
- 枚举集中定义，API/DB/状态机共同引用唯一枚举表（02 第 7 节）。

### 2.6 错误码规范

错误码以 `docs/05_API设计/API设计.md` 第 5 节为唯一基线。异常统一转换为稳定业务错误码：

| 错误码 | HTTP | 场景 | 抛出位置示例 |
|---|---|---|---|
| `AUTH_REQUIRED` | 401 | 未认证/会话失效 | auth 模块 |
| `ACCESS_DENIED` | 403 | 已认证但无权 | 权限中间件/服务 |
| `RESOURCE_NOT_FOUND` | 404 | 不存在或敏感不可见 | 仓储/服务 |
| `VALIDATION_FAILED` | 422 | 字段/模板校验失败 | schema 校验 |
| `STATE_TRANSITION_DENIED` | 409 | 状态不允许动作 | workflow/domain |
| `VERSION_CONFLICT` | 409 | 乐观锁冲突 | 应用层捕获 |
| `IDEMPOTENCY_CONFLICT` | 409 | 同一幂等键用于不同请求 | 幂等中间件 |
| `ANONYMIZATION_FAILED` | 422 | 匿名检查未通过 | thesis |
| `FILE_NOT_READY` | 409 | 文件未完成/扫描失败 | files |
| `CONFLICT_RULE_TRIGGERED` | 409 | 结果冲突需补审 | result |
| `RATE_LIMITED` | 429 | 频率超限 | 限流中间件 |
| `INTEGRATION_UNAVAILABLE` | 503 | 外部系统不可用 | integration |

规则：

- 业务代码**不直接抛 HTTP 异常**，抛领域异常，由 `exception_handlers.py` 统一映射为错误码 + `request_id`；
- 响应体不含堆栈、SQL、对象键、签名 URL、令牌、完整论文/评语；
- 敏感资源 404/403 采用一致外部响应，防枚举；
- 日志脱敏：不记录令牌、密码、银行卡、完整联系方式。

### 2.7 事务、幂等与并发

- 状态变化、事件记录、任务投递意图在同一事务边界（`db/transaction.py`）；
- 命令接口（提交、指派、接拒、最终提交、发布、异议、提现）读取并校验 `Idempotency-Key`，重复请求返回原结果；
- 聚合根用 `version` 乐观锁，冲突抛 `VERSION_CONFLICT`，禁止静默覆盖；
- 跨模块状态修改必须经对应领域服务（workflow.transition / dispatch.assign 等）；
- Celery 任务至少一次执行，处理器幂等；重试有限退避并区分可重试/不可重试错误；
- 外部适配器带超时、熔断/降级、签名验证、重放保护。

### 2.8 数据访问

- 每次租户业务查询带可信租户上下文，禁止以客户端参数代替；仓储默认限定租户；
- 查询避免 N+1；新增高频列表合并前检查查询计划；
- 结构变化全部走 Alembic 迁移；迁移注明前向/回滚/兼容策略。

### 2.9 测试规范

- 分层：领域/状态机单测、仓储+RLS+事务集成、API 契约、关键闭环 E2E；
- 每个权限变更必须有允许+拒绝两类测试，尤其跨租户与盲审泄露；
- 时间/超时/异步用可控时钟与测试适配器，不依赖真实等待；
- 修复缺陷先加复现测试再修复；
- 测试数据一律虚构；测试环境与生产同构。

## 3. TODO 与占位实现规范

允许占位方法/TODO，但必须满足：明确标记占位、说明未实现原因、说明完成条件、关联需求/任务编号、不得伪装成完整实现、不得在安全/权限/数据一致性关键路径使用空实现。

### 3.1 TODO 格式

```python
# TODO(REVIEW-021, P1): 接入评审超时通知。
# 完成条件：任务截止前 24 小时向未提交专家发送站内信和邮件。
```

### 3.2 FIXME 格式

```python
# FIXME(PAPER-014, P0): 当前文件权限校验仅检查角色，尚未校验资源归属。
# 风险：可能产生水平越权，生产部署前必须修复。
```

### 3.3 占位方法格式

```python
def generate_anonymous_paper(self, source_file_key: str) -> str:
    """生成匿名论文文件。

    当前状态：
        暂时返回原始文件引用，仅用于本地流程联调。

    TODO(PAPER-032, P0):
        实现 PDF 元数据清理、作者信息检测和匿名文件重新生成。

    禁止用于生产环境。
    """
    raise NotImplementedError("匿名论文生成尚未实现，禁止在生产环境调用")
```

### 3.4 TODO 优先级

| 级别 | 含义 |
|---|---|
| P0 | 发布阻断、安全或数据错误 |
| P1 | 当前阶段必须完成 |
| P2 | 重要但可延后 |
| P3 | 优化建议 |

### 3.5 禁止行为

- 禁止 `return True` 临时绕过权限检查；
- 禁止 `except: return None` 静默吞异常；
- 禁止无注释、无任务编号地保留空方法；
- 禁止 `pass` 作为占位（除抽象基类）。

## 4. 前端代码规范

### 4.1 目录结构

```text
frontend/src/
  api/            # 请求封装与各域 API（request.ts 统一拦截器）
  modules/<域>/   # 页面 pages/、组件 components/、api.ts、types.ts、routes.ts
  components/     # 通用组件（业务组件按模块）
  layouts/        # 后台/学生/专家布局
  stores/         # Pinia 状态
  permissions/    # 权限指令与守卫
  types/          # 类型定义（与 OpenAPI 同步）
  styles/         # 设计令牌与全局样式
  utils/          # 工具
  hooks/          # 组合式函数
```

### 4.2 编码风格

- Vue 3 + TypeScript + Composition API（`<script setup lang="ts">`），全量 TS，禁止无类型 JS；
- API 类型从确认的 OpenAPI 契约生成或严格同步，禁止手写漂移副本；
- 路由守卫只改善体验，不能替代服务端授权；
- 组件/状态/API 命名：`PascalCase` 组件名、`camelCase` 变量/函数、常量 `UPPER_SNAKE`；props/emits 用 `camelCase` 定义、模板中 `kebab-case` 绑定；
- 状态管理用 Pinia，模块化分 store；组件内私有状态不放入全局 store；
- 所有异步请求经 `src/api/request.ts` 统一拦截器（携带 token、处理错误码、统一 loading 策略）；
- 布局/间距/排版用 Tailwind 语义类，交互组件用 Element Plus，视觉令牌见 `docs/ui-design-system.md`；禁止硬编码色值/字号/间距；
- 组件职责：页面组件（`pages/`）编排路由与数据，业务组件（`components/`）承载可复用业务块，通用组件（`components/common/`）无业务依赖；业务组件不内联页面路由逻辑。

### 4.3 API 调用规范

- 前端统一调用封装函数，不经由组件直接 `fetch`；
- 命令接口携带 `Idempotency-Key`（提交、发布、提现等），防重复；
- 列表接口用服务端返回的 `paging.next_cursor` 翻页，不自行推断页码；
- 错误处理：统一解析错误码 → 展示本地化消息 + 字段级错误；`401` 跳转登录；`403` 提示无权限；`409` 提示并发冲突并刷新；
- 禁止在浏览器持久化签名地址或敏感论文内容；下载用短时签名 URL。

### 4.4 表单与交互

- 表单显示字段级错误、状态冲突与可恢复操作；
- 最终提交、撤回、发布、改派、付款回填等需二次确认；
- 上传显示进度、类型/大小校验、失败重试与匿名检查结果；
- 状态按钮由服务端允许动作驱动，前端不推断。

### 4.5 可访问性

键盘可操作、可见焦点、语义标签、错误提示关联、足够颜色对比（对比度 ≥ 4.5:1 正文）。

### 4.6 UI 库与表单封装

- **Element Plus**：表单、表格、弹窗、日期、上传、分页、消息提示等交互组件，全量按需引入（`unplugin-vue-components` + `unplugin-auto-import` 或等价按需方案）；
- **Tailwind CSS v4**：布局、间距、排版、业务自定义组件样式；令牌在 `@theme` 定义（见 `docs/ui-design-system.md` 第 2 节），并同步覆盖 Element Plus CSS 变量；
- **表单封装**：基于 Element Plus 原生校验统一封装 `AppFormItem` / `AppForm`（统一标签宽度、必填标记、错误定位、提交防重复），业务页面不直接散落 form 逻辑；不引第三方表单库；
- **图标**：统一 `@element-plus/icons-vue`，不混用多风格图标库；
- **日期**：统一 dayjs（Element Plus 同源），格式化函数集中封装，不散落 `new Date()` 拼字符串。

## 5. 后端代码示例（作为风格基准）

文件头 + 一行注释 + 命名 + 错误 + 幂等：

```python
"""
@file 论文提交服务
@description
    负责学生论文草稿维护、正式提交与派单前撤回。

主要功能：
    1. 保存与更新论文草稿。
    2. 校验提交资格与材料完整性。
    3. 提交论文并触发状态流转。
    4. 处理派单前撤回。

主要依赖：
    - ThesisRepository：读写论文与版本。
    - WorkflowService：状态流转。
    - FileService：文件授权校验。
"""

class ThesisSubmissionService:
    def submit(self, thesis_id: str, actor: UserContext) -> ThesisStatus:
        """校验资格并提交当前版本，返回最新论文状态。"""
        thesis = self._get_editable(thesis_id, actor)
        self._assert_eligible(thesis)
        version = self._lock_and_advance(thesis, ThesisStatus.SUBMITTED)
        self._events.emit("thesis.submitted", version.id)
        return version.status
```

## 6. 合并质量门禁

每个实现任务合并前必须满足（`docs/06_开发规范/` 第 9 节）：

1. 需求与验收编号明确；
2. ruff/静态/类型检查通过；
3. 相关单元/集成/契约/E2E 测试通过；
4. 迁移前向与兼容验证；
5. 权限、租户、盲审、幂等、并发、审计检查通过；
6. API、数据库、运维、用户文档同步；
7. 无密钥、真实数据、空实现、未追踪业务规则；
8. 回滚/安全关闭方式清晰。

## 7. Definition of Done

功能在实现、测试、可观测、可运维、文档与验收证据齐全后才算完成（`docs/06_开发规范/` 第 10 节）。页面可点击、接口返回成功或单测通过均不能单独代表业务功能完成。

## 8. 前端技术选型决策

用户已确认以下选型（2026-08-04），作为 `docs/03_架构设计/` ADR-0001 技术栈的细化，编码时不得擅自更换：

| 决策项 | 选择 | 理由 |
|---|---|---|
| 样式方案 | Tailwind CSS v4（CSS-first） | 骨架已启用 `@tailwindcss/vite`；utility-first 高效完成布局/间距/排版；`@theme` 原生支持设计令牌 |
| UI 组件库 | Element Plus | 后台场景最成熟、生态/文档/社区最好、上手成本低；与 Tailwind 分工：组件管交互、Tailwind 管视觉 |
| 语言 | TypeScript | 类型即契约；盲审平台投影/权限敏感，防字段漂移与身份泄露 |
| 状态管理 | Pinia | 骨架已装；Vue 3 官方推荐；模块化分 store |
| HTTP | axios | 拦截器生态成熟，统一封装 token/错误码/幂等键 |
| 日期 | dayjs | Element Plus 同源依赖，体积小，免新增重量日期库 |
| 图标 | @element-plus/icons-vue | 与 Element Plus 风格统一 |
| 表单 | Element Plus 原生 + 统一 AppForm 封装 | 不引第三方表单库，避免额外学习/维护成本 |

被否决方案：Ant Design Vue（Vue3 Pro 版收费、开源维护疑停滞、学习曲线陡）、Naive UI（生态较新、维护频率有下降迹象）、SCSS 手写令牌（与 Tailwind 双写重复）。此决策与 `docs/ui-design-system.md` 第 1.1 节分工边界一致。

### 8.1 版本与后端对接补充

- **TypeScript 使用 5.x（当前 5.9.x），不使用 7.x**：`vue-tsc` 依赖 TypeScript 的 `lib/tsc` 导出，TS 7 原生编译器不导出该子路径，导致 `vue-tsc --build` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。升级 TS 大版本前必须验证 `vue-tsc` 兼容性。
- **axios BASE_URL**：指向后端 FastAPI，基线路径 `/api/v1`（`docs/05_API设计/API设计.md` 第 1 节）。前端通过 `.env` 的 `VITE_API_BASE_URL` 配置；开发环境由 Vite dev server 代理 `/api` 到 `http://localhost:8000`（`vite.config.ts` 的 `server.proxy`，可用 `VITE_API_PROXY_TARGET` 覆盖）。
- **环境变量**：`.env` 不入仓库，提交 `.env.example`；Vite 仅暴露 `VITE_` 前缀变量，密钥不得写入前端环境变量。

## 9. 与本文件相关的其他文档

- `docs/06_开发规范/开发规范.md`：工程总纲（分层、安全、测试、门禁）；
- `docs/ui-design-system.md`：前端视觉与组件设计系统（Tailwind + Element Plus 双轨令牌）；
- `docs/05_API设计/API设计.md` 与 `docs/04_数据库设计/`：契约与数据依据；
- `docs/10_审查与决策/`：问题决策、ADR、追踪矩阵、编码准入。
