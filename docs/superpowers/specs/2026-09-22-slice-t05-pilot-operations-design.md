# T05：首批试点最小运营设计

状态：用户已批准；T05-A/B/C 已实现并有本地验证，2026-09-23 复审发现 8 项待修问题，详见 ../../reviews/2026-09-23-t05-followup-review.md

日期：2026-09-22

依据：[T04 首批试点范围决策](2026-09-22-pilot-scope-decisions.md)

## 1. 目标

让非开发人员通过真实页面完成下一批试点的基础配置，不再修改 `backend/app/seed.py`：

1. 系统管理员建立学校租户、根组织和首个学校管理员账号。
2. 系统管理员维护学校状态与学校管理员账号。
3. 学校管理员维护本校批次、学生账号、导师账号和学生送审资格。
4. 账号、租户或资格停用后立即影响后续访问或新业务，同时保留历史论文、任务、结果和审计。

本切片采用已确认的方案 A：系统管理员负责学校与学校管理员，学校管理员负责本校批次、学生、导师和送审资格。

## 2. 首批边界

- 验收规模：1 所学校、20 篇论文以内、10 名专家、2 名学校管理员。该数字用于验收，不写成数据库硬上限。
- 一个账号当前只允许一个角色和一个租户；不提供登录后的角色/租户切换。
- 学校管理员只能建立 `student` 和 `supervisor` 账号，不能授予 `school_reviewer`、`platform_reviewer`、`expert` 或 `system_admin`。
- 系统管理员只能在本切片中建立和维护 `school_reviewer`；平台运营和专家账号继续使用现有账号，专家维护属于 T07。
- 组织只使用创建租户时生成的一个根组织；学院/专业树维护不在本切片。
- 学科继续读取现有受控目录，不在本切片维护目录。
- 不实现 SSO、批量导入、学校代传、费用、通知、专家库维护、评分规则编辑和部署。
- 不读取或显示论文正文；系统管理员页面只处理租户和账号元数据。
- 不提供物理删除接口。

## 3. 现状与必须修复的缺口

现有 `Tenant`、`Organization`、`ReviewBatch`、`User`、`TenantUserMembership`、`UserRoleAssignment` 和 `StudentEligibility` 足以承载首批数据，不建立平行模型。

当前真实缺口：

- `tenant/router.py`、`tenant/service.py`、`user/router.py` 和 `user/service.py` 仍为空壳；真实运营接口不存在。
- 系统租户页是静态数组，批次页强制演示菜单，真实模式没有成员维护页。
- `seed_database` 同时建立租户、批次、账号、角色、成员关系和资格；非开发人员无法建立下一批业务。
- 认证服务按创建时间选择第一条角色分配，没有拒绝多角色歧义，也没有检查 `effective_until`。
- 已登录请求只重新检查 `users.status`，没有重新检查角色分配、租户状态或租户成员状态。
- `review_batches` 没有用于两个学校管理员并发编辑的行版本。

## 4. 模块与接口

所有成功响应继续使用现有 `ok(data)` 信封，时间使用带时区 ISO 8601 字符串。列表首批不做分页；按 `created_at`、`id` 稳定排序，20 篇试点规模之外再单独设计分页。

权限矩阵：

| 操作 | system_admin | school_reviewer | 其他角色 |
|---|---:|---:|---:|
| 租户与学校管理员 | 允许 | 禁止 | 禁止 |
| 本校批次 | 只读也不开放 | 允许 | 禁止 |
| 本校学生/导师账号 | 禁止 | 允许 | 禁止 |
| 本校学生送审资格 | 禁止 | 允许 | 禁止 |
| 论文正文 | 禁止 | 沿用既有学校业务权限 | 沿用既有权限 |

### 4.1 模块划分

复用现有模块，不新建通用 CRUD 框架：

- `app.modules.tenant` 是学校与批次运营模块。它封装租户创建/停用、根组织、批次状态和送审资格的一致性。
- `app.modules.user` 是账号生命周期模块。它封装账号、唯一角色、唯一租户成员关系、密码重置、停用和会话撤销。
- `app.modules.auth` 继续负责登录、刷新和每次请求的身份有效性检查。
- `app.modules.audit` 记录运营动作并提供现有幂等键能力；审计内容不得包含密码或密码摘要。

路由只做 schema 解析、依赖注入和响应包装；跨表事务、锁、权限和审计都位于上述模块的 service 中。

### 4.2 账号不变量

1. `users.username` 去除首尾空格并转小写，只接受 3–64 位 `[a-z0-9._-]`。
2. 新密码为 12–128 个字符；接口和审计永不返回密码或 `password_hash`。
3. 每个 `user_id` 只有一条 `UserRoleAssignment`。启用账号时复用原分配，不追加第二条。
4. 租户角色 `student`、`supervisor`、`school_reviewer` 必须有且只有一条与角色分配相同租户的有效 `TenantUserMembership`。
5. `system_admin`、`platform_reviewer` 和 `expert` 的角色分配不绑定租户。
6. 本切片创建的学生、导师和学校管理员均只属于一个租户；服务层拒绝复用已属于其他租户的账号。

### 4.3 身份有效性

登录、刷新以及每个 Bearer 请求都必须验证：

- `User.status == ACTIVE`；
- 角色分配唯一，且 `effective_from <= now`，`effective_until` 为空或大于 `now`；
- token 中的角色和租户与当前有效分配一致；
- 租户角色对应的 `Tenant.status == ACTIVE`；
- 租户角色对应的成员关系 `is_active == true`。

任一条件失败均返回 `AUTH_REQUIRED` 401。停用账号、重置密码或暂停租户时撤销受影响用户所有未撤销的 `AuthSession`。已有短期访问令牌也会因每次请求重新检查而立即失效。

### 4.4 系统管理员接口

前缀：`/api/v1/system`。仅 `system_admin` 可访问。

#### `GET /tenants`

返回租户的 `id`、`code`、`name`、`status`、根组织、学校管理员数量、创建时间和 `allowed_actions`。不得返回学生、导师、论文数量或论文内容。

#### `POST /tenants`

原子建立租户、根组织和首个学校管理员：

```json
{
  "code": "pilot-univ",
  "name": "试点大学",
  "organization": {"external_id": "root", "name": "试点大学"},
  "reviewer": {
    "username": "school.operator",
    "display_name": "学校管理员",
    "external_id": "staff-001",
    "password": "operator-secret"
  }
}
```

`code` 创建后不可修改。事务任一步失败时，租户、组织和账号均不得残留。创建操作写 `create_tenant` 审计，detail 只保存租户 code 和新账号 ID。

#### `GET /tenants/{tenant_id}/reviewers`

只返回该租户的学校管理员账号元数据和状态。

#### `POST /tenants/{tenant_id}/reviewers`

为已有 ACTIVE 租户建立额外学校管理员，使用与首个管理员相同的 reviewer 载荷。用户名和 external_id 冲突返回 409。

#### 状态命令

- `POST /tenants/{tenant_id}:suspend`
- `POST /tenants/{tenant_id}:resume`
- `POST /tenants/{tenant_id}/reviewers/{user_id}:disable`
- `POST /tenants/{tenant_id}/reviewers/{user_id}:enable`
- `POST /tenants/{tenant_id}/reviewers/{user_id}:reset-password`

暂停租户不改论文、批次、成员或历史结果，只阻断该租户角色的认证。不得停用一个 ACTIVE 租户的最后一名可用学校管理员。密码重置载荷为 `{"password":"..."}`。

### 4.5 学校批次接口

前缀：`/api/v1/school-admin`。仅当前租户的 `school_reviewer` 可访问；tenant_id 只取 token。

#### 查询与建立

- `GET /batches`
- `POST /batches`
- `PATCH /batches/{batch_id}`

建立载荷：

```json
{
  "code": "2027-spring",
  "name": "2027 年春季硕士论文盲审",
  "start_at": "2027-03-01T00:00:00+08:00",
  "end_at": "2027-05-31T23:59:59+08:00"
}
```

批次响应包含 `id`、code、name、status、start_at、end_at、rule_version、version 和 `allowed_actions`。新批次固定为 `DRAFT`、`rule_version=1`、`version=1`。code 在租户内唯一且创建后不可修改。`PATCH` 只允许 DRAFT 批次修改 name/start_at/end_at，并要求 `expected_version`；成功后 version 加一。两个时间同时存在时必须 `start_at < end_at`。

#### 状态命令

- `POST /batches/{batch_id}:open`
- `POST /batches/{batch_id}:close-submissions`
- `POST /batches/{batch_id}:archive`

状态只允许：

```text
DRAFT → OPEN → SUBMISSION_CLOSED → ARCHIVED
```

命令载荷含 `expected_version`，服务在行锁内检查并将 version 加一。OPEN 后名称和时间不可编辑。打开批次前，服务按 membership ID 排序锁定该批次全部学生成员，再检查每名学生都没有属于另一 OPEN 批次的资格；并发打开两个包含同一学生的批次必须串行，冲突时整批保持 DRAFT。ARCHIVED 仅允许该批次所有论文均为 `COMPLETED` 或 `TERMINATED` 时执行；空批次可以归档。状态不允许回退，T05 不提供重开批次。

只有 OPEN 批次允许学生新建论文。批次进入 `SUBMISSION_CLOSED` 后不再产生新的论文，但关闭前已经建立的 DRAFT 仍可编辑、提交或在匿名退回后重提，避免管理员关批次时把在途学生卡死；已提交论文继续审核、派单、评阅、发布和异议。`ARCHIVED` 后不再允许 DRAFT 写入，归档门禁保证此时不存在非终态论文。

T08 才写入评分模板和评审人数快照；T05 页面只显示“单专家、六维 100 分规则将在 T08 固化”，不得把静态演示费用或规则当成真实配置。

### 4.6 学校成员接口

#### `GET /members`

支持 `membership_type=STUDENT|SUPERVISOR` 过滤，返回本租户成员 ID、账号 ID、username、display_name、external_id、membership_type、账号状态和成员状态。列表不返回密码、密码摘要、其他租户关系或论文内容。

#### `POST /members`

```json
{
  "membership_type": "STUDENT",
  "username": "student.20270001",
  "display_name": "试点学生",
  "external_id": "20270001",
  "password": "student-secret"
}
```

`membership_type` 只接受 STUDENT 或 SUPERVISOR，服务端分别派生 `student` 或 `supervisor` 角色；客户端不能传 role 或 tenant_id。成员自动绑定租户根组织，`external_source` 固定为 `manual`。

#### `PATCH /members/{membership_id}`

只允许修改 `display_name`、`contact_phone`、`contact_email`，并要求客户端回传列表中的 `expected_updated_at`。username、external_id、membership_type、role 和 tenant_id 均不可修改；时间戳不一致返回 `VERSION_CONFLICT`。display_name 同时更新 User 和 TenantUserMembership，资格中的姓名快照及已有论文不随之修改。

#### 状态与密码命令

- `POST /members/{membership_id}:disable`
- `POST /members/{membership_id}:enable`
- `POST /members/{membership_id}:reset-password`

命令只能作用于 token 租户内的 STUDENT/SUPERVISOR 成员。停用只允许 ACTIVE 账号，且同时设置 `membership.is_active=false`、`user.status=DISABLED`、角色分配 `effective_until=now` 并撤销会话；启用只允许 DISABLED 账号，并原子恢复三者。`LOCKED` 不由本切片解锁。停用不删除论文、异议、结果或导师关联。

### 4.7 学生送审资格接口

- `GET /batches/{batch_id}/eligibilities`
- `POST /batches/{batch_id}/eligibilities`
- `POST /eligibilities/{eligibility_id}:suspend`
- `POST /eligibilities/{eligibility_id}:resume`

建立载荷：

```json
{
  "student_membership_id": "uuid",
  "supervisor_membership_id": "uuid-or-null",
  "degree_type": "工学硕士"
}
```

建立资格时必须满足：

- 批次属于 token 租户且处于 DRAFT 或 OPEN；
- 学生和导师成员均属于 token 租户、账号 ACTIVE、成员有效，类型分别正确；
- 同一学生在同一批次只有一条资格；
- `student_name`、`student_no`、`supervisor_name` 从成员关系复制形成业务快照；客户端不能直接提交这些快照字段；
- `source_version` 使用服务生成的 `manual:<audit request id>`，`source_updated_at` 使用服务端时间。

同一学生可以在不同历史批次保留多条资格，但同时最多只能有一个 OPEN 批次。向已 OPEN 批次建立资格时，服务先锁定学生成员，再拒绝该学生已存在的另一 OPEN 批次；这条检查不能只放在批次 open 命令中。`/me/eligibility` 优先返回 OPEN 批次的资格；没有 OPEN 批次时返回最近创建批次的资格，并将 `eligible` 返回为 false。论文新建服务只接受 OPEN 批次且状态为 ELIGIBLE 的唯一资格，不能再对全部历史资格执行 `scalar_one_or_none()`。

暂停只把 ELIGIBLE 改为 SUSPENDED；恢复只允许 SUSPENDED 回到 ELIGIBLE。资格状态影响新建论文和未开始的业务，不删除或改写已有论文。已有论文仍按创建时的 `review_batch_id`、student_membership_id 和历史快照展示。

## 5. 错误、并发与幂等

- 无认证或身份已经失效：`AUTH_REQUIRED` 401。
- 已认证但角色不允许：`ACCESS_DENIED` 403。
- 跨租户对象、错误类型成员或敏感对象：`RESOURCE_NOT_FOUND` 404。
- username、tenant code、batch code、external_id 或资格唯一键冲突：`RESOURCE_CONFLICT` 409。
- 非法状态流转、停用最后一名管理员：`STATE_TRANSITION_DENIED` 409。
- `expected_version` 过期：`VERSION_CONFLICT` 409。
- 字段格式、时间顺序或密码长度不合法：`VALIDATION_FAILED` 422。

所有 POST 状态命令和创建命令要求 `Idempotency-Key`。相同用户、路由、key 和相同载荷返回第一次响应；同 key 不同载荷返回 409。实现时把现有幂等读写从 thesis 模块下沉到 audit 模块，并为旧调用保留薄转发，避免运营模块依赖论文模块。

唯一冲突必须捕获数据库 `IntegrityError` 并转为稳定业务错误；不能把 PostgreSQL 约束文本返回客户端。创建、启停、重置和批次流转均在单事务中执行，目标行使用 `FOR UPDATE`。

## 6. 审计

以下成功动作均写 `AuditEvent`：

- `create_tenant`、`suspend_tenant`、`resume_tenant`
- `create_school_reviewer`、`disable_user`、`enable_user`、`reset_password`
- `create_batch`、`update_batch`、`open_batch`、`close_batch_submissions`、`archive_batch`
- `create_member`、`create_student_eligibility`、`suspend_student_eligibility`、`resume_student_eligibility`

detail 可包含旧/新状态、batch code、membership type 和相关对象 ID；不得包含密码、密码摘要、refresh token、论文题目、摘要或文件信息。失败由统一异常与访问日志记录，本切片不为校验失败另建业务审计行。

## 7. 数据库迁移

新增两次顺序迁移，使 T05-A 和 T05-B 可以独立验收：

1. `0008_identity_invariants`：给 `user_role_assignments.user_id` 增加唯一约束，固化一个账号一个角色。
2. `0009_pilot_operations`：给 `review_batches` 增加非空整数 `version`（默认 1），并增加成员列表 `(tenant_id, membership_type, is_active)` 和批次列表 `(tenant_id, status, created_at)` 索引。

0008 在建立唯一约束前统计重复 `user_id`；存在重复时明确失败并报告数量，不自动删除或挑选角色。downgrade 只删除对应新增索引、唯一约束和 version 列，不删除运营数据。

## 8. 前端真实模式

### 系统管理员 `/system/tenants`

- 移除静态租户数组，真实模式读取 system 接口。
- 提供“新增学校”表单，原子提交租户、根组织和首个管理员。
- 租户行可展开学校管理员列表，并执行新增、停用、启用和重置密码。
- 页面不展示用户总数、论文数、SSO 模式等尚无真实来源的数字。

### 学校管理员 `/school/batch-rules`

- 真实模式展示批次列表、状态、时间和 version。
- 支持建立 DRAFT、编辑 DRAFT，以及按允许动作开放、关闭提交、归档。
- 显示 T08 尚未固化规则的明确提示，不显示演示费用。

### 学校管理员 `/school/members`

- 新增真实页面和菜单，分学生、导师、送审资格三个视图。
- 账号表单一次只建立一个成员，不提供粘贴表格或文件导入。
- 密码输入只存在于建立/重置对话框；成功后立即清空，不进入 store、URL、日志或列表状态。
- 资格表单从当前本校有效学生、导师和批次中选择，不允许输入 tenant_id。

真实模式菜单新增“批次管理”和“成员与资格”；演示模式既有页面不作为真实能力证据，也不向 `scenarioService.ts` 添加 T05 业务。

## 9. 验收测试

### 后端

1. 系统管理员原子建立租户、根组织和首个学校管理员，新管理员可以登录。
2. 租户 code、username、tenant external_id 并发重复时只产生一套数据，另一请求返回稳定 409。
3. 非系统管理员不能调用 system 接口；系统管理员不能通过论文接口读取正文。
4. 学校管理员只能看到和修改 token 租户的数据，客户端 tenant_id 字段被 schema 拒绝。
5. 学校管理员建立 DRAFT 批次并按单向状态机流转；非法回退和旧 version 被拒绝。
6. 同一学生出现在两个待开放批次时，第二个批次不能 OPEN；历史多批次资格读取不会产生多行异常。
7. SUBMISSION_CLOSED 阻止新建论文，但允许关闭前已有 DRAFT 编辑、提交和匿名退回后重提；已提交论文后续流程不受阻断。
8. 有非终态论文的批次不能归档。
9. 学校管理员建立学生/导师账号；客户端不能指定高权限角色。
10. 学校管理员可修正显示名和联系方式；并发旧时间戳被拒绝，资格快照不漂移。
11. 停用账号后，旧 access token 的下一次请求和旧 refresh token 均返回 401；启用后原角色和租户恢复。
12. 重置密码后旧密码和旧 refresh token 失效，新密码可登录。
13. 暂停租户后该租户所有角色的旧 token 失效；系统管理员仍可恢复租户。
14. 建立资格时校验同租户、成员类型、成员状态和唯一键；跨租户统一 404。
15. 暂停资格后学生不能新建论文；已有论文、已发布结果和审计记录数量及内容不变。
16. 所有成功命令存在审计，审计 JSON 序列化后不含明文密码和密码摘要。
17. 迁移升级/降级测试验证 version、唯一约束和索引；重复角色预检不得静默删数据。

### 前端

1. 系统租户页加载、空态、错误重试、建立学校及管理员状态操作。
2. 批次页按服务端状态和 allowed_actions 控制按钮，409 后刷新当前行。
3. 成员页建立、停用、启用、重置密码；提交期间防重复。
4. 资格页只列本校有效对象，操作成功后刷新；失败时不保留旧成功提示。
5. 真实模式菜单只暴露已接通页面；密码不写入持久化 store。

全套验收仍使用宿主机 5433 的 `paper_review_test`、独立 schema 和临时存储。完成后必须运行 `./scripts/check.sh`，并更新隔离验收场景以建立一个非 seed 学生账号完成登录和论文草稿创建。

## 10. 实施切片

T05 实现拆成三个顺序交付，任何一片失败都不得提前接下一片：

1. **T05-A 身份有效性门禁**：0008 唯一角色约束；登录、刷新、请求校验；会话撤销模块接口及负向测试。账号状态命令尚不对外开放。
2. **T05-B 租户、批次、成员与资格后端**：0009 迁移；system/school-admin 接口；账号启停和密码重置；事务、状态机、审计、幂等与跨租户测试。
3. **T05-C 真实运营页面**：系统租户页、学校批次页、成员与资格页、菜单和浏览器闭环。

T05-C 完成不代表可用真实论文。RLS 仍由 T06 实现；专家资料与回避由 T07 实现；评分规则快照由 T08 实现；部署与正式认证由 T09 决定。

## 11. 回滚与交付边界

- 接口上线前端前先完成迁移和后端测试；前端真实菜单仅在对应接口可用后开放。
- 本切片不修改现有论文阶段、评审任务或发布结果。
- 回滚代码时保留已经建立的租户、账号、批次和资格数据；不得通过清表回滚。
- 若需要数据库 downgrade，先停止 T05 写入口，再删除新增约束/索引/version；历史业务表保持不变。
- 本规格批准后再编写实现计划；本轮不自动实现、提交、推送、合并或部署。
