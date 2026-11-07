# T05 Review Fixes Implementation Plan

> 状态更新（2026-09-23）：R01–R08 已通过本地修复集合验收，证据见 [R08 记录](../../reviews/2026-09-23-r08-validation.md)。R09 已产出 [T06 设计](../specs/2026-09-23-t06-rls-design.md)与[实施计划](2026-09-23-t06-rls-implementation.md)，待独立设计审查；T06/RLS 实施尚未开始。下列步骤保留原始施工清单口径。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement one assigned task at a time. Steps use checkbox (`- [ ]`) syntax for tracking. 不自动执行整张表。

**Goal:** 关闭复审 F01–F08，建立可以交给后续 RLS 设计的稳定身份和业务边界。

**Architecture:** 复用现有身份服务、AuthSession、运营 service 和 Vue 页面。通过 User 令牌版本、事务行锁、请求代次和论文所属批次投影修复问题，不添加通用框架。

**Tech Stack:** FastAPI / SQLAlchemy async / PostgreSQL 16 / Alembic / Vue 3 / Vitest。

**Spec:** `docs/superpowers/specs/2026-09-23-t05-review-fixes-design.md`

## Global Constraints

- 先读 AGENTS.md、AGENT_HANDOFF.md、复审报告和本设计，仅执行被指定的 R 编号。
- 核对实际 git 状态。当前基线 `39a8962`，分支 `codex/slice-7a1-file-integrity`；T01–T05 是未提交工作树，禁止回退、清理或漏掉未跟踪文件。
- 独立数据库固定 `127.0.0.1:5433/paper_review_test`；新建唯一 schema，测试结束清理。不迁移开发库、不操作真实材料、不自动提交或推送。
- 不修改 docs/99_原始材料，不扩展费用、通知、SSO、专家库、规则快照或 RLS 实现。
- 每项先写会失败的行为测试，再实现，再运行本项命令。失败两次仍无法定位或需要改权限/锁顺序设计时，记录具体证据交回复核，不删断言。
- 不把 194/422 历史数字当本次结果。小任务只跑定向检查；R08 统一跑全套，降低重复执行成本。
- 各任务结束记录改动、实际命令与退出码、未覆盖项；禁止自行提交。R01–R03 交付后需要独立安全/并发复核，R01 单独完成不等于全部认证问题修复。

## 执行顺序与分工

| 任务 | 对应发现 | 依赖 | 执行边界 |
|---|---|---|---|
| R01 | F01/F03 | 无 | 令牌版本、文件身份门禁及迁移 |
| R02 | F02 | R01 | 登录/刷新/撤销锁与并发测试 |
| R03 | F04 | 无；推荐在 R02 后 | 新建论文与批次/资格串行 |
| R04 | F05 | 无 | 输入格式稳定返回 422 |
| R05 | F06 | 无 | 学校切换的管理员请求竞态 |
| R06 | F07 | 无 | 批次编辑 409 恢复 |
| R07 | F08 | 无 | 历史论文身份投影与页面 |
| R08 | 全部 | R01–R07 通过且 P1 复核完成 | 全套、浏览器、交付记录 |
| R09 | T06 准备 | R08 | 只产出 RLS 设计与任务，不写策略/迁移 |

建议较便宜模型一次执行一项。R04–R06 最适合先验证其执行质量；主交接默认 R01 起顺序执行。R01–R03 可以交其实现，但必须保留独立审查门，不能用“模型已完成”代替安全验证。R09 需要较强的架构判断。

## R01：访问令牌撤销与文件身份门禁

**Files:**
- Create: `backend/alembic/versions/0010_auth_version.py`
- Modify: `backend/app/modules/user/models.py`, `backend/app/core/security.py`
- Modify: `backend/app/modules/auth/service.py`, `backend/app/modules/auth/deps.py`
- Modify: `backend/app/modules/files/router.py`, `backend/app/modules/files/service.py`
- Test: `backend/tests/test_auth.py`, `backend/tests/test_file_access.py`
- Create: `backend/tests/test_auth_version_migration.py`, `backend/tests/test_token_revocation.py`

**Interfaces:** Consumes `load_active_identity`、`revoke_user_sessions`、`AuthSession`。Produces User.auth_version；两个 create_*_token 函数增加必填 auth_version；load_active_identity 增加 token_auth_version，规则见设计 D1。

- [ ] Step 1：在 `test_token_revocation.py` 用以下隔离 fixture，测试 reset 后旧 access/refresh 为 401；disable→enable、suspend→resume 后旧 access 仍为 401，新登录正常。

```python
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from scripts.acceptance_server import acceptance_environment

@pytest_asyncio.fixture
async def operations_client():
    async with acceptance_environment("operations") as runtime:
        async with AsyncClient(transport=ASGITransport(app=runtime.app), base_url="http://test") as client:
            yield client, runtime
```

使用 `tests.helpers.login/auth`；member ID 取 runtime.operations_ids['student_member_id']，学校账号 pilot.school；重置调用 `/api/v1/school-admin/members/{id}:reset-password`。断言必须包含：

```python
assert (await client.get('/api/v1/me', headers=auth(old_tokens))).status_code == 401
assert (await client.post('/api/v1/auth/refresh', json={'refresh_token': old_tokens['refresh_token']})).status_code == 401
```

- [ ] Step 2：文件测试用 helper create_draft/attach_files 生成虚构 PDF，取 current_version.files 中 ID，调用 authorize-download。暂停租户、membership 失效、角色到期、密码重置各自独立测试旧 URL 拒绝；恢复后旧 URL 仍拒绝，新登录重新授权可读；确认 DENIED 审计。禁止在输出中打印带 token 的 URL。
- [ ] Step 3：运行失败测试：`backend/.venv/bin/pytest backend/tests/test_token_revocation.py backend/tests/test_file_access.py -c backend/pyproject.toml -q --tb=short`。新旧令牌回归应先失败。
- [ ] Step 4：按 D1 实现迁移与参数传播。迁移核心：

```python
op.add_column('users', sa.Column('auth_version', sa.Integer(), server_default='1', nullable=False))
# downgrade 只移除 auth_version 列，不删除用户或角色
```

revoke_user_sessions 在锁内执行 `user.auth_version += 1` 并撤销 session；auth 校验要求 `type(token_auth_version) is int` 且与数据库一致。文件专用 token 走相同有效身份校验后仍调用材料授权。更新所有测试直接签发 token 的调用处，不增加兼容旧 token 的默认参数。
- [ ] Step 5：迁移验证 0009→0010→0009 保留账号数量/密码摘要；新列初值 1；随后再升 head。运行：`backend/.venv/bin/pytest backend/tests/test_auth_version_migration.py backend/tests/test_token_revocation.py backend/tests/test_auth.py backend/tests/test_file_access.py backend/tests/test_system_operations.py backend/tests/test_school_member_operations.py -c backend/pyproject.toml -q --tb=short`。
- [ ] Step 6：记录旧 token 需重登的兼容性变化，交独立复核；本项不宣称解决 F02。

## R02：签发与撤销的并发保护

**Files:** Modify `backend/app/modules/auth/service.py`, `backend/app/modules/tenant/service.py`, `backend/app/modules/user/service.py`；Create `backend/tests/test_auth_concurrency.py`。

**Interfaces:** Consumes R01 版本机制；Produces 登录/refresh/全会话撤销的 User 行锁协议，保持原 HTTP 契约。

- [ ] Step 1：测试沿用 operations 环境和独立 session_factory，在签发前使用 asyncio.Event 屏障；写 reset 与 refresh 两种先后顺序、旧密码 login 与 reset 竞争、同 refresh 两次竞争。线程/连接不得复用一个 AsyncSession；每个等待用 `asyncio.wait_for(..., 10)` 并 finally 放行。

```python
# 同一个 refresh 被两个独立 HTTP 请求同时使用
responses = await asyncio.gather(
    client.post('/api/v1/auth/refresh', json={'refresh_token': original_refresh}),
    client.post('/api/v1/auth/refresh', json={'refresh_token': original_refresh}),
)
assert sorted(r.status_code for r in responses) == [200, 401]
```

重置提交后，之前旧凭据流程签发出的 access 和 refresh 均必须不可用；若签发先获锁，重置应等待签发事务结束后撤销新会话。
- [ ] Step 2：运行 `backend/.venv/bin/pytest backend/tests/test_auth_concurrency.py -c backend/pyproject.toml -q --tb=short`，先记录红灯。
- [ ] Step 3：按 D2 锁 User 后验证密码；refresh 的锁前查询只用于定位 user_id，User 锁后重新取得 AuthSession 锁并重新验证。成员创建和已有成员命令先取 Tenant KEY SHARE 并复核 ACTIVE；已有成员再锁 membership → User → assignment。租户暂停保持 Tenant FOR UPDATE，用户 ID 稳定排序。所有锁查询用 `.execution_options(populate_existing=True)`，不得依赖 identity map 的旧对象。用独立会话覆盖成员重置与暂停的两种提交顺序、暂停先于成员创建，以及缓存对象刷新。
- [ ] Step 4：运行上述并发测试及 `test_token_revocation.py test_auth.py test_system_operations.py test_user_operations.py`；检查提交/回滚后没有仍有效的旧凭据会话。把精确锁顺序写进交付记录，交独立复核。

## R03：批次归档与新建论文保持一致

**Files:** Modify `backend/app/modules/thesis/service.py`；仅必要时 modify `backend/app/modules/tenant/service.py`；Create `backend/tests/test_batch_creation_concurrency.py`。

**Interfaces:** Consumes `_eligibility_for_student/current_student_eligibility/create_draft/change_batch_status`；Produces D3 事务锁，无新公开接口或迁移。

- [ ] Step 1：先运行 `PYTHONPATH=backend backend/.venv/bin/python docs/reviews/probes/t05_batch_race.py` 记录现状。把探针时序转成测试：创建已取得门禁锁时 close/archive 必须等待；状态命令先提交时新建必须失败。不要把探针“200”作为通过标准。
- [ ] Step 2：增加两个 create 并发和 suspend eligibility 与 create 并发；观察数据库最终不变量：

```python
assert not any(batch_status == 'ARCHIVED' and stage not in {'COMPLETED', 'TERMINATED'}
               for batch_status, stage in persisted_states)
assert active_thesis_count <= 1
```

`persisted_states` 由探针中的 SELECT 得到；active_thesis_count 按相同 tenant/member/batch 且 stage != TERMINATED 查询。先验证新测试失败。
- [ ] Step 3：候选资格定位后锁 batch→membership→eligibility，并重新验证关系/状态。锁必须覆盖 existing 查询和插入至 commit；等待后状态不符返回现有业务错误。不要使用会让测试双方互等的屏障：持锁后，先确认另一任务尚未完成，再放行持锁事务。
- [ ] Step 4：运行 `backend/.venv/bin/pytest backend/tests/test_batch_creation_concurrency.py backend/tests/test_batch_operations.py backend/tests/test_eligibility_operations.py backend/tests/test_thesis_integrity.py backend/tests/test_thesis_submit.py -c backend/pyproject.toml -q --tb=short`。确认 SUBMISSION_CLOSED 中既有草稿仍能提交。交独立并发复核。

## R04：输入类型错误稳定返回 422

**Files:** Modify `backend/app/modules/user/schema.py`, `backend/app/modules/tenant/schema.py`；Test `backend/tests/test_school_member_operations.py`, `backend/tests/test_system_operations.py`。

**Interfaces:** 公开载荷不变，非法 username/code 不再 500。

- [ ] Step 1：为 username/code 的 `123, None, [], {}` 参数化 HTTP 失败用例，其他字段提供合法数据；断言 422/VALIDATION_FAILED，学校/组织/成员数量不变。保留合法大写/空格归一化测试。先跑这两个测试文件记录失败。
- [ ] Step 2：两个 before validator 使用以下最小修改：

```python
return value.strip().lower() if isinstance(value, str) else value
```

- [ ] Step 3：`backend/.venv/bin/pytest backend/tests/test_school_member_operations.py backend/tests/test_system_operations.py backend/tests/test_user_operations.py -c backend/pyproject.toml -q --tb=short` 全通过，记录结果后停。

## R05：管理员列表请求不串学校

**Files:** Modify `frontend/src/modules/system/pages/TenantPermissionsPage.vue`；Test `frontend/src/modules/system/__tests__/realTenantPermissions.spec.ts`。

**Interfaces:** listReviewers API 不变，只约束当前选择的响应生效。

- [ ] Step 1：延迟 Promise 测试先选 A 后选 B，先 resolve B 再 resolve A；页面只显示 B 管理员。再测 A reject、B resolve 和快速关闭/重新打开，旧请求不能改 error/loading。

```typescript
const pending = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
```

沿用现有页面测试的 api mock、mount、学校 fixture，把两个 promise 分别作为 listReviewers 返回值；真实点击两个学校“管理”按钮，不直接修改内部 ref。先红灯。
- [ ] Step 2：在页面局部增加递增 generation；请求捕获 tenant ID，成功/catch/finally 都比较 generation 与当前 tenant ID。刷新学校列表或清空选择也使旧请求失效；不引入通用请求框架。
- [ ] Step 3：`cd frontend && node_modules/.bin/vitest run src/modules/system/__tests__/realTenantPermissions.spec.ts && node_modules/.bin/vue-tsc --build`。

## R06：批次编辑冲突后丢弃旧表单

**Files:** Modify `frontend/src/modules/school/pages/BatchRulesPage.vue`；Test `frontend/src/modules/school/__tests__/realBatchRules.spec.ts`。

**Interfaces:** updateBatch 输入不变；409 后需要从最新行重新进入。

- [ ] Step 1：mock updateBatch 拒绝409；listBatches 下一次返回 version+1、状态 OPEN 且不含 EDIT。点击编辑保存后，断言旧 dialog 消失、冲突提示可见、无编辑按钮。另一用例新状态仍 DRAFT，可重新打开并发出最新 version。

```typescript
api.updateBatch.mockRejectedValueOnce({ response: { status: 409 } })
// 完成页面已有编辑输入和保存交互后
expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
expect(wrapper.text()).toContain('数据已变更')
```

- [ ] Step 2：先红灯；再于 PATCH 409 分支清空 editing/formMode 后刷新，不自动更新旧表单 version 再提交。具体 ref 名按当前源码；不要改新增表单语义。
- [ ] Step 3：`cd frontend && node_modules/.bin/vitest run src/modules/school/__tests__/realBatchRules.spec.ts && node_modules/.bin/vue-tsc --build`。

## R07：历史论文按自身批次展示

**Files:** Modify `backend/app/modules/thesis/service.py`, `frontend/src/api/theses.ts`, `frontend/src/modules/thesis/pages/ThesisEditPage.vue`；Test `backend/tests/test_eligibility_operations.py`；Create `frontend/src/modules/thesis/__tests__/realThesisIdentity.spec.ts`。

**Interfaces:** thesis detail 新增可选 `student.degree_type: string|null` 和 `review_batch: {id:string,name:string,end_at:string|null}`；保留 batch_name。student 不可见角色不增加身份字段。

- [ ] Step 1：后端建立旧批次 DRAFT 后关闭旧批次，再建立新批次/新资格并 OPEN；旧详情必须保留旧批次与旧资格导师、学位快照。测试学生、学校正常读取，系统管理员和专家仍不能通过该接口读学生身份。
- [ ] Step 2：前端 mock getThesis 返回旧批次详情，fetchEligibility 若被调用则返回新批次/新导师；挂载真实编辑页，断言旧数据保留、fetchEligibility 未调用。补缺失资料用例，不能显示演示日期、教授后缀或当前资格。
- [ ] Step 3：先跑新前后端用例确认失败；按 D6 从论文绑定 review_batch_id 与对应 eligibility 产生投影。前端保留原始 detail 的身份字段，不以 adapter 的演示 fallback 值补缺失；移除真实编辑读取当前资格的分支。

```typescript
// 从真实详情构造 identity；以下字段不以当前 eligibility 回退
supervisor: detail.student?.supervisor_name || '未提供',
degreeType: detail.student?.degree_type || '未提供',
trainingLevel: '未提供',
batch: detail.review_batch?.name || detail.batch_name || '未提供',
deadline: detail.review_batch?.end_at || '未设置',
```

- [ ] Step 4：运行 `backend/.venv/bin/pytest backend/tests/test_eligibility_operations.py backend/tests/test_projections.py -c backend/pyproject.toml -q --tb=short`；再 `cd frontend && node_modules/.bin/vitest run src/modules/thesis/__tests__/realThesisIdentity.spec.ts src/modules/thesis/__tests__/realSubmit.wiring.spec.ts src/modules/thesis/__tests__/studentSubmission.spec.ts && node_modules/.bin/vue-tsc --build`。不要把未存在培养层次数据伪装成已实现字段。

## R08：修复集合验收与交接

**Files:** Modify 复审报告、`docs/reviews/pilot-baseline.md`、`docs/reviews/pilot-acceptance-matrix.md`、`docs/CURRENT.md`、`docs/AGENT_HANDOFF.md` 和任务板。

**Interfaces:** Consumes R01–R07 的提交外 diff、定向测试结果和 P1 独立审查；Produces 完成/阻断清单，不自动进入 T06。

- [x] Step 1：逐项核对 F01–F08 测试证据；P1 有未解决发现则阻断本任务。禁止先把报告改为全部完成。
- [x] Step 2：运行 `./scripts/check.sh` 和 `git diff --check`；记录真实数量/退出码/警告，失败继续定位，不删测试。
- [x] Step 3：operations 隔离浏览器验证学校快速切换、批次409、历史论文身份；令牌/锁问题以真实独立会话自动测试为主。没有执行的浏览器路径保留 NOT RUN。
- [x] Step 4：正常停止验收服务，确认本次 schema/存储消失、相关端口无监听；仅查询测试库。更新报告与入口，明确 Hosted CI 仍未运行，T06 只具备设计前置。

## R09：T06 RLS 设计输入与详细任务

**Files:** Create `docs/superpowers/specs/2026-09-23-t06-rls-design.md`, `docs/superpowers/plans/2026-09-23-t06-rls-implementation.md`。若实际执行日期已变，采用实际日期并同步链接。

**Interfaces:** Consumes R08 已验证的身份/版本/文件访问、`backend/app/db/session.py` 与现有模型/迁移；Produces 可审查 RLS 规格，不产生业务代码或数据库策略。

- [x] Step 1：CodeGraph/语义检索绘制角色→表→读写动作矩阵，列所有有/无 tenant_id 表及关联表。系统管理员跨校管理元数据不等于能读论文；平台、专家的 tenant_id=null 不等于绕过策略。
- [x] Step 2：设计登录/refresh 身份尚未建立时的引导访问，普通运行账号与迁移owner分离，FORCE RLS、连接池 SET LOCAL/事务清理、文件专用token、后台任务上下文。audit 的 system actor tenant_id=null、幂等按 user_id+key 必须有单独规则。
- [x] Step 3：先在文档中给出两租户、平台派单、专家任务、系统元数据、异常回滚后连接复用的 SQL/HTTP 负向断言；普通运行账号必须验证非 superuser、无 BYPASSRLS、非表owner。不得用超级用户测试通过代替 RLS 证据。
- [x] Step 4：把设计拆为“普通角色测试夹具→身份上下文→分组策略→主链回归/回滚”可单独验收任务，给出精确文件、策略表达式与锁/事务边界。没有部署条件时不决定生产主机或密钥。
- [x] Step 5：交独立设计审查后停止；本项没有授权直接执行迁移、CREATE ROLE 或部署。T07 专家维护、T08 规则快照仍保持原任务板，避免为降低模型成本提前编造接口。

## 可复制的执行提示词

```text
接手 /Users/zhongxu/Desktop/0-Inbox/paper-review-platform。
先核对分支、HEAD、未提交和未跟踪文件，保留全部已有工作。
依次读取 AGENTS.md、docs/AGENT_HANDOFF.md、
docs/reviews/2026-09-23-t05-followup-review.md、
docs/superpowers/specs/2026-09-23-t05-review-fixes-design.md、
docs/superpowers/plans/2026-09-23-t05-review-fixes.md。
本次只执行 R01。按失败测试→最小实现→定向验证交付。
数据库仅用 5433/paper_review_test 的独立 schema，不迁移开发库。
不修改原始材料，不扩展功能，不提交/推送/部署。
若需要改变设计中的权限、令牌语义或锁顺序，报告具体阻断。
完成后报告文件、实际命令/结果、未覆盖项和待复核内容，停在本项边界。
```

后续每次把“R01”替换为已满足依赖的下一编号；不要一次要求“完成后面的所有事情”。
