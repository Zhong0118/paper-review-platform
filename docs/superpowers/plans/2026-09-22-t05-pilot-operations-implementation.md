# T05 Pilot Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让系统管理员和学校管理员通过真实接口及页面建立首批学校、批次、账号与学生送审资格，并让所有停用状态即时进入认证门禁。

**Architecture:** 复用 `tenant`、`user`、`auth` 和 `audit` 模块；tenant 模块封装租户/批次/资格，user 模块封装账号生命周期，auth 模块统一解析有效身份。前端通过三个真实页面调用明确命令接口，不建立通用 CRUD 框架，也不把业务写入演示服务。

**Tech Stack:** FastAPI、SQLAlchemy 2 async、Alembic、PostgreSQL 16、Pydantic、Vue 3、TypeScript、Pinia、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-22-slice-t05-pilot-operations-design.md`

> 2026-09-23 复审补充：以下勾选保留原实施步骤记录，不表示复审无缺陷。新增 8 项发现由 [R01–R08](2026-09-23-t05-review-fixes.md) 修复，关闭后才进入 T06。

## Global Constraints

- 测试数据库固定为宿主机 `127.0.0.1:5433/paper_review_test`，每次使用独立 `test_*` schema。
- 客户端不得提交 `tenant_id`；学校租户来自 token。
- 一个账号只允许一个角色和一个租户；迁移发现重复角色时失败，不自动删数据。
- 不修改 `docs/99_原始材料/`，不向 `frontend/src/demo/scenarioService.ts` 添加业务。
- 不实现 SSO、批量导入、学校代传、费用、通知、专家库、评分规则快照或部署。
- 系统管理员不得读取论文正文；敏感跨租户对象返回 `RESOURCE_NOT_FOUND`。
- 所有密码只进入 Pydantic 输入和 hash 函数，不进入响应、审计、日志、Pinia 或持久化浏览器存储。
- 不执行开发数据库迁移、清表或 seed；只迁移隔离测试 schema。
- 未经用户另行授权，不执行 git commit、push、PR、merge 或部署；每个任务结束以 diff 和测试结果作为检查点。

---

## T05-A：身份有效性门禁

### Task 1: 固化一个账号一个角色

**Files:**
- Create: `backend/alembic/versions/0008_identity_invariants.py`
- Modify: `backend/app/modules/user/models.py`
- Create: `backend/tests/test_identity_migration.py`

**Interfaces:**
- Produces: 数据库约束 `uq_user_role_assignments_user_id`。
- Produces: ORM `UserRoleAssignment.__table_args__` 与迁移一致。

- [x] **Step 1: 写重复角色预检失败测试**

在 0007 schema 中 seed 后，为同一用户插入第二条角色分配，再执行 0008：

```python
def upgrade(schema: str, revision: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "DATABASE_URL": _test_url(), "PGOPTIONS": f"-c search_path={schema}"},
        capture_output=True,
        text=True,
    )

def test_0008_rejects_duplicate_user_role_assignments():
    with migrated_test_schema("0007_file_upload_version") as schema:
        # seed_database, copy one user's assignment with a different id
        result = upgrade(schema, "0008_identity_invariants")
        assert result.returncode != 0
        assert "duplicate user role assignments" in (result.stdout + result.stderr)
```

- [x] **Step 2: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_identity_migration.py -c backend/pyproject.toml -q --tb=short`

Expected: FAIL，因为 0008 尚不存在。

- [x] **Step 3: 编写 0008 与 ORM 约束**

迁移 `revision="0008_identity_invariants"`、`down_revision="0007_file_upload_version"`，必须先查询重复数量，再建约束：

```python
duplicates = op.get_bind().execute(sa.text("""
    SELECT count(*) FROM (
      SELECT user_id FROM user_role_assignments GROUP BY user_id HAVING count(*) > 1
    ) duplicate_users
""")).scalar_one()
if duplicates:
    raise RuntimeError(f"duplicate user role assignments: {duplicates}")
op.create_unique_constraint(
    "uq_user_role_assignments_user_id", "user_role_assignments", ["user_id"]
)
```

`downgrade()` 只删除该约束。

- [x] **Step 4: 增加成功升级/降级测试**

断言 0007→0008 后 `pg_constraint` 存在唯一约束，downgrade 0007 后约束消失，seed 用户和角色分配数量不变。

- [x] **Step 5: 运行迁移定向测试**

Run: `backend/.venv/bin/pytest backend/tests/test_identity_migration.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS；测试 schema 自动清理。

- [x] **Step 6: 检查点**

Run: `git diff --check && git status --short`

Expected: 只有计划内文件变化；不提交。

### Task 2: 统一解析有效身份并撤销会话

**Files:**
- Modify: `backend/app/modules/auth/service.py`
- Modify: `backend/app/modules/auth/deps.py`
- Modify: `backend/app/modules/auth/models.py` only if an index declaration is needed
- Modify: `backend/tests/test_auth.py`

**Interfaces:**
- Produces: `load_active_identity(session, user_id, *, token_role=None, token_tenant_id=None) -> ActiveIdentity`。
- Produces: `revoke_user_sessions(session, user_id, *, at=None) -> int`。
- Consumes: Task 1 的唯一角色约束。

- [x] **Step 1: 写访问令牌失效测试**

增加四个用例：登录后分别把 User 设为 DISABLED、角色分配设为过期、membership 设为 inactive、tenant 设为 SUSPENDED；原 access token 请求 `/api/v1/me` 均返回 401 `AUTH_REQUIRED`。

```python
res = await client.get("/api/v1/me", headers=auth(tokens))
assert res.status_code == 401
assert res.json()["code"] == "AUTH_REQUIRED"
```

- [x] **Step 2: 写 refresh 拒绝测试**

登录保存 refresh token，停用 User 后调用 `/api/v1/auth/refresh`，断言 401，且没有新增未撤销 AuthSession。

- [x] **Step 3: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_auth.py -c backend/pyproject.toml -q --tb=short`

Expected: 新用例 FAIL，证明现有 token 只检查 User 或 refresh 仍会签发 token。

- [x] **Step 4: 实现 ActiveIdentity 深模块**

在 `auth/service.py` 定义：

```python
@dataclass(frozen=True)
class ActiveIdentity:
    user: User
    role: Role
    assignment: UserRoleAssignment
    tenant: Tenant | None
    membership: TenantUserMembership | None

async def load_active_identity(
    session: AsyncSession,
    user_id: UUID,
    *,
    token_role: str | None = None,
    token_tenant_id: UUID | None = None,
) -> ActiveIdentity: ...

async def revoke_user_sessions(
    session: AsyncSession, user_id: UUID, *, at: datetime | None = None
) -> int: ...
```

查询必须使用 `.one_or_none()`，验证 User ACTIVE、分配生效期、token role/tenant、一致的 ACTIVE tenant 和 active membership；租户角色集合固定为 student/supervisor/school_reviewer。

- [x] **Step 5: 登录、刷新和依赖统一调用该接口**

`login()` 验证密码后调用 `load_active_identity`；`issue_tokens()` 接受 ActiveIdentity，不再自行挑第一条角色；`refresh_tokens()` 在轮换 refresh 前加载有效身份；`get_current_user()` 用 token 的 role/tenant 再验证数据库状态。

- [x] **Step 6: 运行认证测试**

Run: `backend/.venv/bin/pytest backend/tests/test_auth.py -c backend/pyproject.toml -q --tb=short`

Expected: 原有登录/登出和新增失效用例全部 PASS。

- [x] **Step 7: 运行 T05-A 后端回归**

Run: `backend/.venv/bin/pytest backend/tests/test_identity_migration.py backend/tests/test_auth.py backend/tests/test_projections.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

- [x] **Step 8: T05-A 检查点**

记录测试数量、警告、迁移升级/降级结果和未覆盖项；运行 `git diff --check`，不提交，等待 T05-A 代码复核后才进入 T05-B。

---

## T05-B：真实运营后端

### Task 3: 把幂等能力移到 audit 模块

**Files:**
- Modify: `backend/app/modules/audit/service.py`
- Modify: `backend/app/modules/thesis/service.py`
- Create: `backend/tests/test_idempotency_service.py`

**Interfaces:**
- Produces: `audit_service.replay(session, user, key, route, payload) -> dict | None`。
- Produces: `audit_service.remember(session, user, key, route, payload, response_body, code=200) -> None`。
- Preserves: `thesis_service.remember_idempotent`、`store_idempotent` 作为薄转发，旧路由无需同时重写。

- [x] **Step 1: 写稳定请求摘要测试**

同一嵌套 JSON 的不同 key 顺序必须重放；相同 key 不同 route 或 payload 必须抛 `IDEMPOTENCY_CONFLICT`。

```python
assert request_digest({"a": {"x": 1, "y": 2}}) == request_digest({"a": {"y": 2, "x": 1}})
```

- [x] **Step 2: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_idempotency_service.py -c backend/pyproject.toml -q --tb=short`

Expected: FAIL，因为 audit 接口尚不存在。

- [x] **Step 3: 实现规范化摘要和重放**

```python
def request_digest(route: str, payload: dict) -> str:
    raw = json.dumps({"route": route, "payload": payload}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(raw.encode()).hexdigest()
```

`replay` 同时比较 route 和 digest；`remember` 复用 `IdempotencyKey`，不存请求正文。

- [x] **Step 4: 保留旧接口并跑并发/幂等回归**

Run: `backend/.venv/bin/pytest backend/tests/test_idempotency_service.py backend/tests/test_review_integrity.py backend/tests/test_termination_reassignment.py backend/tests/test_thesis_submit.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

### Task 4: 建立账号生命周期模块

**Files:**
- Modify: `backend/app/modules/user/schema.py`
- Modify: `backend/app/modules/user/service.py`
- Modify: `backend/app/modules/user/models.py`
- Create: `backend/tests/test_user_operations.py`

**Interfaces:**
- Produces: `CreateTenantUserInput`、`UpdateMemberInput`、`ResetPasswordInput`。
- Produces: `create_tenant_user`、`update_member`、`disable_tenant_user`、`enable_tenant_user`、`reset_tenant_user_password`。
- Consumes: Task 2 的 `revoke_user_sessions`。

- [x] **Step 1: 写用户名、密码、角色派生失败测试**

覆盖大写用户名归一化、非法字符、短密码、重复 username、重复 tenant external_id、客户端无法传 role/tenant_id，以及 STUDENT→student、SUPERVISOR→supervisor、STAFF→school_reviewer 的唯一映射。

- [x] **Step 2: 写启停、重置和历史保留测试**

直接调用 service：停用后 User DISABLED、membership inactive、assignment 到期、sessions revoked；启用复用原 assignment；重置后旧 hash 不通过、新密码通过，审计 detail 不含输入密码。

- [x] **Step 3: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_user_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: FAIL，因为 schema/service 尚为空。

- [x] **Step 4: 实现输入 schema**

```python
class CreateTenantUserInput(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    display_name: str = Field(min_length=1, max_length=128)
    external_id: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=12, max_length=128)

class UpdateMemberInput(BaseModel):
    display_name: str = Field(min_length=1, max_length=128)
    contact_phone: str | None = Field(default=None, max_length=32)
    contact_email: str | None = Field(default=None, max_length=128)
    expected_updated_at: datetime
```

- [x] **Step 5: 实现事务内账号操作**

所有状态函数锁 User、assignment、membership；启用只接受 DISABLED，停用只接受 ACTIVE，LOCKED 返回状态冲突。`create_tenant_user` 只接受由调用方传入的受控 role_code/membership_type 组合，hash 后立即丢弃明文。

- [x] **Step 6: 运行账号模块测试**

Run: `backend/.venv/bin/pytest backend/tests/test_user_operations.py backend/tests/test_auth.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

### Task 5: 系统管理员租户与管理员接口

**Files:**
- Modify: `backend/app/modules/tenant/schema.py`
- Modify: `backend/app/modules/tenant/service.py`
- Modify: `backend/app/modules/tenant/router.py`
- Modify: `backend/app/modules/user/router.py`
- Modify: `backend/app/api.py`
- Create: `backend/tests/test_system_operations.py`

**Interfaces:**
- Produces: `system_router`，prefix `/api/v1/system`。
- Produces: `POST/GET /tenants`、reviewer list/create/disable/enable/reset-password、tenant suspend/resume。
- Consumes: Task 4 的账号 service 与 Task 3 的幂等接口。

- [x] **Step 1: 写原子创建学校的 HTTP 失败测试**

以 `admin.system` 登录，POST `/api/v1/system/tenants`，断言租户、root Organization、school_reviewer User/membership/assignment 同时存在且新账号可登录；人为制造 reviewer username 冲突后断言租户与 organization 均未残留。

- [x] **Step 2: 写权限与敏感投影测试**

school_reviewer 调 system 接口返回 403；租户列表只含设计字段，不含 student、thesis、password_hash；system_admin 访问原文文件继续返回 404。

- [x] **Step 3: 写租户暂停和最后管理员测试**

暂停后该租户旧 access/refresh 均 401；恢复后账号可重新登录；停用最后一名 ACTIVE reviewer 返回 409，新增第二名后可停用其中一名。

- [x] **Step 4: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_system_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: 路由 404 或空模块错误。

- [x] **Step 5: 实现 tenant schema/service**

定义 `CreateTenantInput` 内嵌 organization/reviewer；`create_tenant` 单事务建立 ACTIVE Tenant、COLLEGE root Organization 和首个 reviewer，并记录 `create_tenant`。跨角色调用返回 403，目标租户不存在返回 404。

- [x] **Step 6: 实现 system routers 与统一响应**

所有命令读取 `Idempotency-Key`，先 `audit_service.replay`，成功后 `remember`；使用 `ok(data, request_id=...)`。在 `app/api.py` 注册 system tenant/user routers。

- [x] **Step 7: 运行 system API 测试**

Run: `backend/.venv/bin/pytest backend/tests/test_system_operations.py backend/tests/test_file_access.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS，系统管理员正文读取负向测试仍通过。

### Task 6: 批次迁移与状态机

**Files:**
- Create: `backend/alembic/versions/0009_pilot_operations.py`
- Modify: `backend/app/modules/tenant/models.py`
- Modify: `backend/app/modules/tenant/schema.py`
- Modify: `backend/app/modules/tenant/service.py`
- Modify: `backend/app/modules/tenant/router.py`
- Create: `backend/tests/test_batch_operations.py`
- Modify: `backend/tests/test_identity_migration.py` or create `backend/tests/test_operations_migration.py`

**Interfaces:**
- Produces: ReviewBatch `version: int`。
- Produces: `/api/v1/school-admin/batches` list/create/patch/open/close-submissions/archive。
- Produces: `allowed_actions` derived only from current status and archive readiness。

- [x] **Step 1: 写 0009 升降级测试**

从 0008 升级 0009，断言 version 默认 1 以及 `ix_membership_tenant_type_active`、`ix_batch_tenant_status_created`；降级后只移除新增列/索引。

- [x] **Step 2: 写批次 HTTP 状态机测试**

覆盖 DRAFT 建立/编辑、旧 expected_version、DRAFT→OPEN→SUBMISSION_CLOSED→ARCHIVED、非法回退、OPEN 后不可编辑、非终态论文不可归档和跨租户 404。

- [x] **Step 3: 写并发打开冲突测试**

两个 DRAFT 批次包含同一学生，使用独立 session 并发 open；断言只有一个 OPEN，另一个返回 409，两个事务均无部分状态。

- [x] **Step 4: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_operations_migration.py backend/tests/test_batch_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: FAIL，因为 0009 和接口尚不存在。

- [x] **Step 5: 实现 0009、ORM version 和索引**

迁移 `revision="0009_pilot_operations"`、`down_revision="0008_identity_invariants"`，与模型使用相同名称；version server_default 为 1。迁移不更新业务行的其他字段。

- [x] **Step 6: 实现批次命令**

`open_batch` 先锁 ReviewBatch，再按 UUID 排序锁 Student membership；状态/expected_version 校验后更新。`archive_batch` 用 EXISTS 查询非终态 Thesis。每次成功变更 version 加一并写审计。

- [x] **Step 7: 实现 school-admin batch router**

客户端 schema 不含 tenant_id；所有查询从 CurrentUser.tenant_id 过滤；GET 返回稳定排序和 allowed_actions。

- [x] **Step 8: 运行批次测试**

Run: `backend/.venv/bin/pytest backend/tests/test_operations_migration.py backend/tests/test_batch_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

### Task 7: 学生与导师成员接口

**Files:**
- Modify: `backend/app/modules/user/schema.py`
- Modify: `backend/app/modules/user/service.py`
- Modify: `backend/app/modules/user/router.py`
- Create: `backend/tests/test_school_member_operations.py`

**Interfaces:**
- Produces: `/api/v1/school-admin/members` list/create/patch/disable/enable/reset-password。
- Consumes: Task 4 的账号 service 与 Task 5 已注册的 user router。

- [x] **Step 1: 写角色提权和跨租户失败测试**

POST schema 携带 role 或 tenant_id 返回 422；school_reviewer 只能创建 STUDENT/SUPERVISOR；对另一租户 membership 的所有命令返回 404。

- [x] **Step 2: 写成员编辑并发和资格快照不漂移测试**

PATCH 正确 expected_updated_at 同步 User/membership display_name；旧时间戳返回 409；已有 StudentEligibility.student_name/supervisor_name 保持原值。

- [x] **Step 3: 写启停和密码重置 HTTP 测试**

旧 access/refresh、旧密码失效；enable 后新密码登录；响应与 AuditEvent 序列化不含输入密码或 hash。

- [x] **Step 4: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_school_member_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: 新路由 404。

- [x] **Step 5: 实现成员 router 和序列化**

membership_type query 只接受 STUDENT/SUPERVISOR；列表按 created_at/id；PATCH 只传三个可编辑字段和 expected_updated_at；命令使用幂等键。

- [x] **Step 6: 运行成员测试**

Run: `backend/.venv/bin/pytest backend/tests/test_school_member_operations.py backend/tests/test_auth.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

### Task 8: 多批次学生资格与论文入口

**Files:**
- Modify: `backend/app/modules/tenant/schema.py`
- Modify: `backend/app/modules/tenant/service.py`
- Modify: `backend/app/modules/tenant/router.py`
- Modify: `backend/app/modules/auth/service.py`
- Modify: `backend/app/modules/thesis/service.py`
- Create: `backend/tests/test_eligibility_operations.py`

**Interfaces:**
- Produces: eligibility list/create/suspend/resume endpoints。
- Produces: `current_student_eligibility(session, user_id, tenant_id) -> tuple[StudentEligibility, ReviewBatch]`。
- Replaces: 对 StudentEligibility 全历史集合直接 `scalar_one_or_none()` 的读取。

- [x] **Step 1: 写多历史批次资格读取测试**

同一 student membership 建立 CLOSED 历史批次和一个 OPEN 批次；`/me/eligibility` 返回 OPEN 批次。关闭 OPEN 后返回最近批次但 `eligible=false`，不得抛 MultipleResultsFound。

- [x] **Step 2: 写资格建立和跨租户测试**

覆盖学生/导师类型、ACTIVE user、active membership、batch tenant/status、唯一键、客户端快照字段/tenant_id 422，以及跨租户统一 404。

- [x] **Step 3: 写 OPEN 批次后追加学生的冲突测试**

学生已属于一个 OPEN 批次时，向另一个 OPEN 批次 POST eligibility 返回 409；并发请求最终仍只有一个 OPEN 批次关联。

- [x] **Step 4: 写资格暂停与历史不变测试**

暂停后不能新建论文；已有 DRAFT 仍可编辑/提交；已有发布结果、论文、workflow event 数量不变。SUBMISSION_CLOSED 阻止新建但允许关闭前 DRAFT 重提。

- [x] **Step 5: 运行测试确认失败**

Run: `backend/.venv/bin/pytest backend/tests/test_eligibility_operations.py -c backend/pyproject.toml -q --tb=short`

Expected: 新接口 404，历史多资格读取暴露现有多行问题。

- [x] **Step 6: 实现确定性资格解析**

查询 join ReviewBatch，先取 OPEN，再按 batch.created_at/id 倒序取最近；返回 eligibility + batch。`create_draft` 额外要求 batch OPEN 与 eligibility ELIGIBLE，已有论文 update/submit 不重新用资格门禁。

- [x] **Step 7: 实现资格命令和快照**

student_name/no、supervisor_name 从 locked membership 复制；source_version=`manual:<request_id>`；suspend/resume 只允许对应状态并写审计。

- [x] **Step 8: 运行 T05-B 定向测试**

Run: `backend/.venv/bin/pytest backend/tests/test_system_operations.py backend/tests/test_batch_operations.py backend/tests/test_school_member_operations.py backend/tests/test_eligibility_operations.py backend/tests/test_auth.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS。

- [x] **Step 9: 运行后端全套**

Run: `STORAGE_ROOT=$(mktemp -d /tmp/paper-review-t05b.XXXXXX) backend/.venv/bin/pytest backend/tests -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS；命令退出后删除该精确临时目录并确认 `paper_review_test` 无残留 `test_*` schema。

- [x] **Step 10: T05-B 检查点**

记录实际测试数量、警告、迁移结果、API 清单和未覆盖项；`git diff --check` 通过后才进入 T05-C。

---

## T05-C：真实运营页面

### Task 9: 建立运营 API 客户端

**Files:**
- Create: `frontend/src/api/systemOperations.ts`
- Create: `frontend/src/api/schoolOperations.ts`
- Modify: `frontend/src/api/request.ts`
- Create: `frontend/src/api/__tests__/operations.spec.ts`

**Interfaces:**
- Produces: TenantSummary、SchoolReviewer、ReviewBatch、SchoolMember、StudentEligibility 类型。
- Produces: 与规格逐一对应的 list/create/update/command 函数。

- [x] **Step 1: 写 URL、body 和幂等键测试**

Mock Axios，断言 create/command 使用正确 prefix、body 且 RequestOptions.idempotencyKey 被传递；类型中没有 password_hash 或 tenant_id 输入。

- [x] **Step 2: 扩充前端错误码类型**

把 `RESOURCE_CONFLICT` 加入 ApiErrorCode；409 继续显示统一刷新提示，不显示数据库约束文本。

- [x] **Step 3: 实现两个 API 文件**

命令函数统一由页面传 `crypto.randomUUID()`：

```typescript
export function openBatch(id: string, expectedVersion: number, options: RequestOptions) {
  return httpApi.post<ReviewBatch>(`/school-admin/batches/${id}:open`,
    { expected_version: expectedVersion }, options)
}
```

- [x] **Step 4: 运行 API 客户端测试和类型检查**

Run: `cd frontend && node_modules/.bin/vitest run src/api/__tests__/operations.spec.ts && node_modules/.bin/vue-tsc --build`

Expected: PASS。

### Task 10: 接通系统租户页

**Files:**
- Modify: `frontend/src/modules/system/pages/TenantPermissionsPage.vue`
- Create: `frontend/src/modules/system/__tests__/realTenantPermissions.spec.ts`

**Interfaces:**
- Consumes: Task 9 systemOperations。
- Produces: 真实加载、新增学校、管理员列表、启停/重置交互。

- [x] **Step 1: 写加载、空态和错误重试测试**

`VITE_DEMO_MODE=false`；mock listTenants 成功/空/失败。失败时隐藏旧列表，retry 重新请求。

- [x] **Step 2: 写创建和状态命令测试**

表单不得包含论文字段；提交中按钮 disabled；成功清空 password；失败保留非密码字段但 password 输入清空；命令成功刷新当前租户。

- [x] **Step 3: 运行测试确认失败**

Run: `cd frontend && node_modules/.bin/vitest run src/modules/system/__tests__/realTenantPermissions.spec.ts`

Expected: FAIL，因为页面仍使用静态数组。

- [x] **Step 4: 重写页面为真实状态**

使用 auth store 的 displayName；不显示虚构用户数/SSO；modal 关闭和成功后显式清空密码 ref；按钮由 allowed_actions 控制。

- [x] **Step 5: 运行页面测试**

Run: `cd frontend && node_modules/.bin/vitest run src/modules/system/__tests__/realTenantPermissions.spec.ts`

Expected: PASS。

### Task 11: 接通批次页

**Files:**
- Modify: `frontend/src/modules/school/pages/BatchRulesPage.vue`
- Create: `frontend/src/modules/school/__tests__/realBatchRules.spec.ts`

**Interfaces:**
- Consumes: Task 9 schoolOperations batch functions。
- Produces: DRAFT 创建/编辑和三条状态命令 UI。

- [x] **Step 1: 写真实加载与规则边界测试**

断言真实模式不显示 ¥300 或 DEMO version，显示 T08 待固化提示；错误时隐藏旧列表并可 retry。

- [x] **Step 2: 写 allowed_actions 和冲突刷新测试**

只有服务端 allowed_actions 对应按钮出现；command 传当前 version；409 后重新 list，不在前端猜测新状态。

- [x] **Step 3: 运行测试确认失败**

Run: `cd frontend && node_modules/.bin/vitest run src/modules/school/__tests__/realBatchRules.spec.ts`

Expected: FAIL，因为页面是固定演示内容。

- [x] **Step 4: 实现列表、表单和命令状态**

loading/error/rows/saving 分离；切换或失败时不保留旧成功提示；创建/编辑时间用 ISO 字符串提交。

- [x] **Step 5: 运行批次页测试**

Run: `cd frontend && node_modules/.bin/vitest run src/modules/school/__tests__/realBatchRules.spec.ts`

Expected: PASS。

### Task 12: 新增成员与资格页并开放真实菜单

**Files:**
- Create: `frontend/src/modules/school/pages/SchoolMembersPage.vue`
- Create: `frontend/src/modules/school/__tests__/realSchoolMembers.spec.ts`
- Modify: `frontend/src/router/routes.ts`
- Modify: `frontend/src/router/menus.ts`
- Modify: `frontend/src/router/__tests__/routes.spec.ts`

**Interfaces:**
- Consumes: Task 9 schoolOperations member/eligibility functions。
- Produces: `/school/members`，roleCodes 仅 school_reviewer。

- [x] **Step 1: 写路由和真实菜单失败测试**

真实 school 菜单追加 `/school/batch-rules`、`/school/members`；其他角色不出现；新页面固定使用 `PAGE-025`，并把 page-id 唯一性/总数断言同步为 25。

- [x] **Step 2: 写三个视图测试**

学生/导师列表分别传 membership_type；建立、编辑、启停、重置密码防重复；资格表单只展示有效学生/导师和 DRAFT/OPEN 批次。

- [x] **Step 3: 写密码清理测试**

建立或重置成功/失败后，password input 均为空；sessionStorage、wrapper state 文本和 API list 响应中均无密码。

- [x] **Step 4: 运行测试确认失败**

Run: `cd frontend && node_modules/.bin/vitest run src/modules/school/__tests__/realSchoolMembers.spec.ts src/router/__tests__/routes.spec.ts`

Expected: FAIL，因为页面/route 尚不存在且 live menu 未开放。

- [x] **Step 5: 实现页面与路由**

三个 tab 共用一次 refresh；命令成功后重新加载；失败隐藏旧成功消息；所有 idempotency key 在点击确认时生成一次并保留到请求完成。

- [x] **Step 6: 运行 T05-C 定向测试**

Run: `cd frontend && node_modules/.bin/vitest run src/api/__tests__/operations.spec.ts src/modules/system/__tests__/realTenantPermissions.spec.ts src/modules/school/__tests__/realBatchRules.spec.ts src/modules/school/__tests__/realSchoolMembers.spec.ts src/router/__tests__/routes.spec.ts`

Expected: 全部 PASS。

### Task 13: 隔离浏览器闭环与交付记录

**Files:**
- Modify: `backend/scripts/acceptance_server.py`
- Modify: `backend/tests/test_acceptance_server.py`
- Modify: `docs/reviews/pilot-acceptance-matrix.md`
- Modify: `docs/reviews/pilot-baseline.md`
- Modify: `README.md`
- Modify: `docs/CURRENT.md`
- Modify: `docs/AGENT_HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-22-pilot-task-board.md`

**Interfaces:**
- Produces: acceptance scenario `operations`，输出非敏感 tenant/batch/member IDs。
- Preserves: 现有 empty/accepted/published 场景与清理行为。

- [x] **Step 1: 写 operations 场景清理测试**

真实子进程启动 `--scenario operations`，断言服务 ready、输出无密码/token、SIGINT 后 schema/storage/port 清理；现有三场景测试继续通过。

- [x] **Step 2: 实现 operations 虚构场景**

通过真实 system/school-admin service 建立非 seed 租户、学校管理员、OPEN 批次、学生、导师和资格；不直接 INSERT 业务表。

- [x] **Step 3: 运行 acceptance 定向测试**

Run: `backend/.venv/bin/pytest backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short`

Expected: 全部 PASS，无 `CancelledError` 和残留资源。

- [x] **Step 4: 运行前端全套、类型和构建**

Run: `cd frontend && node_modules/.bin/vitest run && node_modules/.bin/vue-tsc --build && VITE_DEMO_MODE=false node_modules/.bin/vite build`

Expected: 全部退出 0。

- [x] **Step 5: 用浏览器复验非 seed 主链入口**

在 operations 场景中：系统管理员建立/查看学校；学校管理员建立成员或查看已建成员；非 seed 学生登录并创建论文 DRAFT；独立 API 会话读回相同 tenant、batch、membership 和 thesis 关系。不得使用真实论文文件。

- [x] **Step 6: 运行统一全套检查**

Run: `./scripts/check.sh`

Expected: 后端、前端、类型检查、真实模式构建全部退出 0。

- [x] **Step 7: 核对资源与数据库边界**

确认验收端口无监听、`paper_review_test` 的 `test_*` schema 为 0、临时 acceptance 目录为 0；不查询或修改开发业务库。

- [x] **Step 8: 更新交付记录**

记录实际测试数量、浏览器步骤、未覆盖项、Hosted CI 状态和 T06 开工判断；README 补充运营场景的虚构账号准备方式和真实页面入口。只把实际观察写为 PASS，未运行项保持 NOT RUN。

- [x] **Step 9: 最终检查点**

Run: `git diff --check && git status --short`

Expected: 无空白错误；保留 T01–T05 全部未提交改动，不提交、推送、合并或部署。

## Execution Order

严格按 Task 1→13 执行。Task 2 后停一次复核 T05-A；Task 8 后停一次复核 T05-B；Task 13 才能标记 T05 完成。T06 的详细规格只在 T05 完成并记录实际身份/租户接口后编写。
