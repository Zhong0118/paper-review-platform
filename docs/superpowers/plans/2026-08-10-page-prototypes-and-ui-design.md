# 页面原型与 UI 设计文档修订实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复页面原型中的状态、权限、导航和引用问题，补齐五个已确认业务能力页面，并将 UI 设计规范调整为按业务场景自适应宽度。

**Architecture:** 页面文档继续采用“总览 + 单页字段级原型”结构，新增页面复用既有角色、流程、API 和数据投影。学校后台、百杰运营后台、学生/导师门户、专家门户采用不同页面骨架；布局宽度由页面任务决定，不设置全局最大宽度。

**Tech Stack:** Markdown、YAML front matter、ASCII 线框、Mermaid、现有 PAGE/FR/FLOW/API/TABLE 追踪编号。

## Global Constraints

- 只修改正式文档，不编写业务代码、数据库迁移或前后端接口实现。
- 所有文档保持 `DRAFT`，未经用户确认不得设为 `APPROVED`。
- 不修改 `docs/99_原始材料/`。
- 不新增未经确认的专家人数、评分阈值、期限、费用金额或异议期限。
- 学校侧不得看到专家身份；专家侧不得看到学生、导师或其他专家身份。
- 页面按钮由服务端允许动作驱动；页面文档不得以显示/隐藏代替服务端授权。

---

### Task 1: 修复八项页面原型一致性问题

**Files:**
- Modify: `docs/02_产品设计/页面原型/页面原型_总览与布局.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-003_论文编辑与上传.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-004_学校送审准备列表.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-005_学校送审与进度.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-008_专家任务列表.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-010_在线评阅工作台.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-011_结果处理工作台.md`
- Modify: all existing page prototype source paths.

**Interfaces:**
- Consumes: 论文状态、轮次状态、任务状态和 API 权限目录。
- Produces: 不混用状态、不越权、可顺序演示的 PAGE-001—018 原型集。

- [x] 修正 19 份原型文档的 `sources` 相对路径。
- [x] 将 PAGE-005 的论文阶段与轮次状态分列，移除 `READY` 假状态。
- [x] 将 PAGE-008/010 的逾期改为 `IN_REVIEW + overdue` 属性展示。
- [x] 移除学校直接催审能力，改为查看进度和联系百杰运营。
- [x] 将学校直接补审改成补审申请/待百杰处理投影，实际创建任务由百杰执行。
- [x] 将学生提交后的去向改为学生工作台，不跨角色跳转。
- [x] 统一匿名检测 `FAIL`、`REVIEW_REQUIRED`、`PASS` 的处理路径。
- [x] 将总览拆成学校后台、百杰后台、学生/导师门户、专家门户四套骨架。

### Task 2: 补齐五个缺失页面并增强系统管理页面

**Files:**
- Create: `docs/02_产品设计/页面原型/页面原型_PAGE-019_学校异议处理工作台.md`
- Create: `docs/02_产品设计/页面原型/页面原型_PAGE-020_评阅更正审批.md`
- Create: `docs/02_产品设计/页面原型/页面原型_PAGE-021_专家资料与资格.md`
- Create: `docs/02_产品设计/页面原型/页面原型_PAGE-022_结算处理工作台.md`
- Create: `docs/02_产品设计/页面原型/页面原型_PAGE-023_批次与评审规则.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_PAGE-017_租户与权限.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_总览与布局.md`

**Interfaces:**
- Consumes: API-005、012、023、027、028、032 以及批次规则版本化需求。
- Produces: 学校异议闭环、百杰更正闭环、专家本人资料维护、百杰结算闭环、批次规则配置入口。

- [x] 为每个新页面补齐 front matter、角色、入口、线框、字段、交互、异常状态与数据投影。
- [x] PAGE-019 只允许学校处理本租户异议，不包含完整在线复核实现。
- [x] PAGE-020 由百杰审核更正申请，保留原评阅版本且不得直接改分。
- [x] PAGE-021 仅允许专家维护本人资料并查看资格状态。
- [x] PAGE-022 只实现人工审核与线下付款回填，不描述自动支付。
- [x] PAGE-023 使用版本化配置，不提供未确认默认值；生效版本只读留痕。
- [x] PAGE-017 增加组织树、批次同步结果、逐条失败记录和映射版本详情。

### Task 3: 同步正式页面清单、API 和追踪矩阵

**Files:**
- Modify: `docs/02_产品设计/产品与流程设计.md`
- Modify: `docs/05_API设计/API设计.md`
- Modify: `docs/10_审查与决策/需求追踪矩阵.md`

**Interfaces:**
- Consumes: PAGE-019—023 页面职责。
- Produces: 页面、API 与 FR 的可追踪关系。

- [x] 将 PAGE-019—023 加入正式页面清单。
- [x] 将现有 API-023、027、028、032 对应到新增角色页面。
- [x] 新增 API-035 批次与评审规则资源目录，仅定义版本化配置边界。
- [x] 更新 FR-002、013、020、022、024、025、028—030 的 PAGE/API 追踪。
- [x] 检查页面角色与 API 主要角色一致。

### Task 4: 重构 UI 设计规范

**Files:**
- Modify: `docs/ui-design-system.md`
- Modify: `docs/02_产品设计/页面原型/页面原型_总览与布局.md`

**Interfaces:**
- Consumes: 四套页面骨架及数据密度要求。
- Produces: 可用于甲方展示稿和后续开发的响应式、场景化设计规范。

- [x] 移除全局 1200px 最大宽度和 `--content-max` 约束。
- [x] 定义列表、详情、表单、评阅、登录五类布局策略。
- [x] 规定后台利用可用视口、窄内容控制阅读行长、评阅工作台全屏双栏。
- [x] 增加品牌识别、导航层级、页面标题、关键任务聚焦和演示数据规范。
- [x] 增加表格密度、抽屉/弹窗宽度、移动端折叠和大屏适配规则。
- [x] 保持既有颜色、可访问性和双盲信息隔离要求。

### Task 5: 文档验证

**Files:**
- Verify: all modified and created Markdown files.

**Interfaces:**
- Consumes: Tasks 1—4 的全部文档。
- Produces: 可复核的路径、编号、状态、权限和差异检查结果。

- [x] 使用 `rg` 检查错误来源路径、假状态 `READY` 和状态型 `OVERDUE` 已消失。
- [x] 检查 PAGE-001—023 编号唯一且总览索引完整。
- [x] 检查 PAGE、API、FR 追踪关系覆盖新增页面。
- [x] 检查学校催审、学校直接创建补审、专家跨本人资料等越权描述已移除。
- [x] 检查 UI 文档不再包含统一最大宽度约束。
- [x] 运行 `git diff --check` 并审阅 `git diff --stat`、`git status --short`。
