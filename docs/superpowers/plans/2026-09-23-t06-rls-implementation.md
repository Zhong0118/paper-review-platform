# T06 RLS Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans one assigned task at a time. T06-1 至 T06-5 已在本地完成；当前工作树含未提交的 T01–T05/R01–R09/T06-1 至 T06-5 改动，须保留。未经明确指令不提交、推送、合并或部署。

**审查门槛：** 2026-09-24 [独立设计审查](../../reviews/2026-09-24-t06-rls-design-review.md)的五项发现及新增的任务/link 写策略回环、邀请列暴露、同校文件错挂，已纳入[修订记录](../../reviews/2026-09-24-t06-rls-design-revision.md)。[独立复核](../../reviews/2026-09-24-t06-rls-design-rereview.md)已在设计层放行；T06-1 的本地结果见[验收记录](../../reviews/2026-09-24-t06-1-validation.md)，后续每项仍按本计划验证。

**Goal:** 使普通业务数据库账号在漏写 ORM 租户条件时也无法跨校读取/修改现有 28 张表的受保护行，同时保持登录、刷新、文件读取及单专家主链。

**Architecture:** 独立迁移 owner、受限认证账号与非 owner 的业务账号；业务 token 验签后在同一事务设置本地身份上下文，数据库逐表 RLS 默认拒绝。认证前入口使用单独连接，关联表由无环父表/任务链授权；原有服务层权限、锁、审计继续保留。

**Tech Stack:** PostgreSQL 16、Alembic、SQLAlchemy 2 async、FastAPI、pytest/httpx。

**Spec:** [T06 RLS 设计](../specs/2026-09-23-t06-rls-design.md)；前置 [R08 记录](../../reviews/2026-09-23-r08-validation.md)。

## Global Constraints

- 先核对实际分支、HEAD、未提交与未跟踪文件；不得 reset/clean，不改 `docs/99_原始材料/`。本计划不改变权限语义、token 语义和 R02/R03 已审锁顺序。
- 测试只用 `127.0.0.1:5433/paper_review_test` 的独立 schema；角色是 PostgreSQL 集群级对象，按唯一名字创建并在 finally 精确撤销。不得连接开发业务库、5432 或真实数据。
- 任一受保护表在最终 migration head 必须有 `ENABLE`、`FORCE`、显式策略、最小 `GRANT`；普通运行账号必须非 superuser、无 `BYPASSRLS`、非表 owner。一个高权限 fixture 的绿色结果不能充当验收。
- 系统管理员只能跨校管理学校/账号元数据；平台审核只在运营链路跨校，原文不可读；专家只读本人当前任务匿名文件。`tenant_id=NULL` 不是授权通配符。
- 策略子查询的内外同名列必须双边限定；对照规格中的 28 表 SELECT 引用图及写策略引用闭包逐表执行普通账号查询和写入，禁止循环。数据库匿名 purpose 为小写 `'anonymous'`，普通业务账号不能 SELECT `users.password_hash`。
- 先写直接 SQL 与 HTTP 失败测试，再加最小权限/策略使其通过。没有授权不提交、推送、部署；跨表关系循环或业务路径冲突先按规格和现有锁顺序定位，不用 `USING (true)`、superuser 或 owner 绕过。
- 首次运行前需要在隔离测试实例确认可创建普通测试角色；若无法建立**真实登录的非 owner 账号**，记录具体阻断，不把 `SET ROLE` 当最终替代品。

## Review Focus

1. 用户的旧 access 或旧文件 token 在重置/暂停/改派后，是否被新上下文或父表策略意外放行。
2. 认证账号是否因宽泛 GRANT 能直接读论文、文件路径或结果；系统管理员是否意外继承正文读取。
3. A 学校的 `tenant_id` 与 B 学校父 ID 混搭写入，是否因外键检查绕过 RLS 而成功。
4. 异常回滚、commit、savepoint 与池连接复用后，`SET LOCAL` 上下文是否串到下一请求。
5. 学生/导师发布前结果、学校专家身份和专家原文是否因联表策略或内部字段暴露。

## 文件与依赖

| 切片 | 精确文件 | 交付 |
|---|---|---|
| T06-1 | `backend/app/core/config.py`、`backend/alembic/env.py`、`backend/app/db/session.py`（业务 URL 选择）、`backend/tests/conftest.py`、`backend/tests/test_rls_roles.py`、`backend/scripts/acceptance_server.py`、`scripts/check.sh`、`.github/workflows/check.yml` | 独立连接配置与真实非 owner 测试角色/清理夹具 |
| T06-2 | `backend/app/db/session.py`、新增 `backend/app/db/rls_context.py`、`backend/app/modules/auth/deps.py`、`backend/app/modules/auth/router.py`、`backend/app/modules/files/router.py`、`backend/app/modules/audit/service.py`、`backend/tests/test_rls_context.py`、`backend/tests/test_auth_concurrency.py`、`backend/tests/test_file_access.py` | 认证前通道、验签后事务上下文和匿名拒绝审计 |
| T06-3 | `backend/app/modules/user/models.py`、`backend/app/modules/auth/service.py`、新增 `backend/alembic/versions/0011_rls_identity.py`、`backend/tests/test_rls_identity.py`、受影响的密码哈希测试 | 5 张身份与会话表、业务账号哈希列隔离 |
| T06-4 | `backend/app/modules/tenant/models.py`、新增 `backend/alembic/versions/0012_rls_metadata.py`、`backend/tests/test_rls_metadata.py`，按需调整认证租户查询投影 | 8 张学校/目录/专家/审计表、认证账号最窄租户读取 |
| T06-5 | `backend/app/modules/thesis/models.py`、`backend/app/modules/thesis/service.py`、`backend/app/modules/dispatch/models.py`、`backend/app/modules/dispatch/service.py`、`backend/app/modules/files/models.py`、`backend/app/modules/files/service.py`、`backend/tests/test_dispatch_result_integrity.py`、`backend/tests/test_file_migration.py`、新增 `backend/alembic/versions/0013_rls_core.py`、`backend/tests/test_rls_core.py` | 任务/文件所属论文键、轮次邀请标题快照与复合父键、6 张论文/任务/文件核心表 |
| T06-6 | 新增 `backend/alembic/versions/0014_rls_workflow.py`、`backend/tests/test_rls_workflow.py` | 4 张结果、异议与流程记录表 |
| T06-7 | `backend/app/modules/result/service.py`、`backend/app/modules/thesis/models.py`、`backend/app/modules/thesis/service.py`、`backend/app/modules/files/service.py`、`backend/tests/test_file_migration.py`、新增 `backend/alembic/versions/0015_rls_children.py`、`backend/tests/test_rls_children.py`、结果/文件回归 | 关联表租户键、匿名/发布门禁；学生/导师结果不联查任务 |
| T06-8 | `backend/tests/test_rls_end_to_end.py`、`backend/tests/test_acceptance_server.py`、`docs/reviews/pilot-acceptance-matrix.md`、`docs/CURRENT.md`、`docs/AGENT_HANDOFF.md`、任务板 | 28 表覆盖、负向矩阵、升降级及主链回归的交付记录 |

五项迁移仅在**同一隔离测试部署的最终 head 全部通过**后才有可运行状态；不能把中间 revision 当作可部署版本。未来生产迁移顺序和维护窗口仍需另定，不能因为测试能升降级就直接执行生产降级。

### T06-1：普通角色测试基线

**Interfaces:** Produces `runtime_business_session`、`runtime_auth_session`、`migration_connection`、唯一测试角色名及统一 schema；后续所有 RLS 测试消费它们。现有 `migrated_test_schema` 继续只操作测试库。

- [x] 写 `test_rls_roles.py::test_runtime_role_is_not_owner_or_bypass`：以真实业务登录连接查询 `current_user`、`pg_roles.rolsuper`/`rolbypassrls`、owner/认证角色成员关系、schema `CREATE` 与表 `TRUNCATE`/`REFERENCES` 权限，对 28 表查询 `pg_class.relowner`；先观察当前单账号/owner 不满足。
- [x] 在本地测试实例核对 `rolcreaterole`。仅对唯一测试角色和 schema 建立 owner、业务、认证账号；提供各自连接 URL 给测试 fixture，finally 先终止这些测试连接再精确 `DROP ROLE`/`DROP SCHEMA`。不得在文档或日志输出密码。连接目标安全门同时检查三个 URL 都是 5433/`paper_review_test`。
- [x] 将 Alembic 指向迁移连接，将 HTTP 业务连接指向普通账号；`acceptance_server.py` 的两个运行引擎共享同一个隔离 schema。测试 seed 在 `0010` 后、RLS 启用前准备虚构行，再升至最终 head；`operations` 后续准备改走受限业务 API，不能依赖 owner 在 `FORCE RLS` 后写业务行。`scripts/check.sh` 与 CI 仅注入测试所需 URL，不让运行服务回退到 owner；生产配置缺必要 URL 必须启动失败。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_roles.py backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short`，核对退出码、角色和 schema 精确清理。若测试实例无建角色权限，停在此项并报告，不能让后续任务假绿。证据见 [T06-1 验收记录](../../reviews/2026-09-24-t06-1-validation.md)。

### T06-2：事务身份上下文与认证引导

**Interfaces:** Consumes T06-1 三连接；Produces `get_auth_session`、`bind_candidate_identity(session, verified_claims)`、`get_current_user` 成功后可用的同事务 `app.user_id`/`app.role`/`app.tenant_id`。`bind_candidate_identity` 只接受服务端验签后的声明对象，不接受客户端租户参数。

- [x] 写 `test_rls_context.py`：未验签 token 不触发任何 `set_config`；已验签但 `auth_version` 过期不能进入业务 service；A commit/rollback/savepoint 后同池 B 或空上下文的 `current_setting(..., true)` 不含 A 身份；同请求 commit 后新事务不继承 A，需显式再绑定。失败现状与结果见 [T06-2 验收记录](../../reviews/2026-09-24-t06-2-validation.md)。
- [x] `/auth/login`、`/auth/refresh`、`/auth/logout` 改用 `get_auth_session`；在业务 `get_current_user` 中先 decode/检查声明，再在任何身份 SELECT 前同事务 `set_config(name, value, true)`，随后执行现有 `load_active_identity`；失败回滚。文件专用 token 同样先验签、绑定、复核，不降低现有 token 版本和文件授权检查。
- [x] 未认证或已验签但身份失效的文件读取/授权先回滚可能已绑定候选 GUC 的业务事务，再由受限认证 session 在独立事务写空 actor DENIED 审计；已认证事件继续走业务 session。保持成功/拒绝审计现有结果及 R02 User→AuthSession 锁顺序。`seed.py` 只在显式测试/迁移通道执行，不由服务启动自动使用 owner。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_context.py backend/tests/test_auth.py backend/tests/test_auth_concurrency.py backend/tests/test_token_revocation.py backend/tests/test_file_access.py -c backend/pyproject.toml -q --tb=short`；如有同一请求 commit 后继续读库，修为显式重新绑定，而不是 session 级 `SET`。

### T06-3：身份与认证会话策略（5 表）

本项实际结果见 [T06-3 验收记录](../../reviews/2026-09-24-t06-3-validation.md)。

**Interfaces:** Consumes T06-2 上下文；Produces `0011_rls_identity`，`down_revision=0010_auth_version`；只覆盖 `users`、`roles`、`user_role_assignments`、`tenant_user_memberships`、`auth_sessions`。

- [x] 在 `test_rls_identity.py` 写直接 SQL 红灯：空上下文不能读用户/角色分配；本人、学校校内成员、系统管理员账号路径分别受限；普通业务账号 `SELECT users.password_hash` 被权限拒绝，认证账号可验证密码而对论文表无 SELECT；学校停用成员后仍能在同事务撤销其会话。已有 owner fixture 的哈希断言须显式加载该列。
- [x] 在 `0011_rls_identity.py` 建固定 search_path、无表读取的 `app_actor_id()`/`app_tenant_id()`/`app_role()`；五表逐命令 `ENABLE/FORCE`、GRANT 与策略。`users`=本人/同校成员用户/平台专家用户/系统账号管理；`roles`=认证与已验签业务上下文只读；`user_role_assignments`=本人或管理者目标用户/租户/角色；`tenant_user_memberships`=本人、本校、平台运营或系统学校审核员管理；`auth_sessions`=认证账号轮换/退出、业务账号仅系统或本校目标撤销。停用目标后不要求目标 membership 仍 active。
- [x] 将 `User.password_hash` 映射为默认 deferred；只在认证登录查询显式加载，其他 `select(User)`、`session.get(User)` 不读此列，重置时只写新哈希。`users` 的业务账号 SELECT GRANT 逐列排除 `password_hash`，密码创建/重置仅给所需 INSERT/UPDATE 列权限并仍受学校/系统行策略限制；认证账号对登录所需列含哈希单独授权。检查现有登录、刷新、文件身份、学校/系统重置与测试 fixture 的实际 SQL，不以 API 未返回哈希代替数据库权限验证。
- [x] `auth_sessions` 的认证账号 GRANT 限于登录读取和会话行轮换/退出；业务撤销只可更新目标 `users.auth_version` 和会话 revoked 字段。检查策略依赖无环和业务账号不是表 owner。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_identity.py backend/tests/test_auth.py backend/tests/test_auth_concurrency.py backend/tests/test_token_revocation.py backend/tests/test_school_member_operations.py backend/tests/test_user_operations.py backend/tests/test_file_lifecycle.py -c backend/pyproject.toml -q --tb=short`；核对 5 表的 `pg_policies`、`relrowsecurity`、`relforcerowsecurity`，记录退出码。

### T06-4：学校、目录、专家与审计策略（8 表）

本项实际结果见 [T06-4 验收记录](../../reviews/2026-09-28-t06-4-validation.md)。

**Interfaces:** Consumes T06-3 身份策略；Produces `0012_rls_metadata`，`down_revision=0011_rls_identity`；覆盖 `tenants`、`organizations`、`review_batches`、`discipline_catalog`、`experts`、`expert_conflicts`、`idempotency_keys`、`audit_events`。

- [x] 在 `test_rls_metadata.py` 写 A/B 学校、系统元数据、平台专家库、本人幂等键和审计负向 SQL：系统管理员不能由学校元数据权限读论文；A 学校不能更新 B 的批次或把 B 的组织设为 A 的父组织；认证账号能读取 ACTIVE/SUSPENDED 租户的 `id/code/status` 完成登录门禁，但不能读取组织或论文；无 actor 只能插入允许的文件 DENIED 审计，不能读审计表。
- [x] 在 `0012_rls_metadata.py` 逐表 `ENABLE/FORCE`、GRANT 与 `USING/WITH CHECK`：`tenants`=系统管理所有元数据、其他租户角色仅本校、平台仅运营读，**认证数据库账号单独 SELECT 任意状态租户的 `id/code/status`，不使用业务 GUC，认证查询仅投影这三列**；`organizations`=系统元数据写或本校读、平台运营读，其 `(parent_id,tenant_id)` 用 UNIQUE/复合外键保证同校且避免自引用 RLS 子查询；`review_batches`=学校本校写、学生本校/平台运营读；`discipline_catalog`=全局行或本校行读，平台跨校读另写显式分支，业务角色不写；`experts`=本人/平台专家库读；`expert_conflicts`=平台专家库读；`idempotency_keys`=`user_id=app_actor_id()` SELECT/INSERT；`audit_events`=actor 本人 INSERT，认证账号仅 `actor_id IS NULL AND tenant_id IS NULL AND result='DENIED'` 且文件动作 INSERT，业务账号无 SELECT。
- [x] 暂停学校后仍须看见 SUSPENDED 的目标租户及校内账号并完成撤销；父表写入时验证引用租户一致，不能仅依赖外键。认证账号对论文/文件/结果表直接 SELECT 应为权限拒绝。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_metadata.py backend/tests/test_auth.py backend/tests/test_system_operations.py backend/tests/test_batch_operations.py backend/tests/test_idempotency_service.py backend/tests/test_file_access.py -c backend/pyproject.toml -q --tb=short`；核对累计 13 表策略、认证租户列 GRANT 和 ACTIVE/SUSPENDED 登录结果。

### T06-5：论文、任务与文件核心策略（6 表）

本项实际结果见 [T06-5 验收记录](../../reviews/2026-09-28-t06-5-validation.md)。

**Interfaces:** Consumes T06-4 元数据策略；Produces `0013_rls_core`，`down_revision=0012_rls_metadata`；覆盖 `student_eligibilities`、`theses`、`thesis_versions`、`file_objects`、`review_rounds`、`expert_tasks`。

- [x] 在 `test_rls_core.py` 写 A/B 已知 UUID 的 SELECT/UPDATE/INSERT/改父 ID 红灯，并写学生本人草稿、撤回本人 `CREATED` 轮次、学校本校确认、平台两校派单、专家本人邀请/任务和导师已发论文的目标路径。专家邀请的 API 标题须与旧版一致，但其直接 SELECT `thesis_versions` 得 0 行；学生删稿后旧文件成为不可重新挂接的孤儿，两个归属键同置 NULL，若仍有 link 则不能解除归属。先在隔离旧数据上验证 `expert_tasks.thesis_id`、`review_rounds.anonymous_title` 可从轮次/版本唯一回填，`file_objects.thesis_id` 可从 upload version 或旧 link 唯一回填；两个来源冲突时迁移必须拒绝，无法归属的旧孤儿行保持 NULL，不从 storage key 猜测。用真实普通账号而非迁移 owner。**旧 link 的最终不可重挂接约束仍待 T06-7 复合 FK；本项仅限制文件行不能重绑。**
- [x] 在 `0013_rls_core.py` 为 `expert_tasks` 增加非空 `thesis_id`，按 `round_id→review_rounds.thesis_id` 回填；为 `review_rounds` 增加非空 `anonymous_title`，按关联 `thesis_versions.title` 回填；为 `file_objects` 增加可空 `thesis_id`，按已验证的 upload version/旧 link 归属回填。确认送出时将当前版本标题写入轮次；专家列表/邀请改读轮次快照，不再加载版本整行。新派单与改派直接填已锁定论文 ID；新文件 prepare 写论文 ID，删稿在删除论文前、解除 link 后同时将文件 `upload_version_id` 和 `thesis_id` 置 NULL。R02/R03 锁序不变。同步调整 `test_dispatch_result_integrity.py` 的旧任务构造器，写入原轮次的论文 ID。先审计旧父键，再建立规格列出的 UNIQUE/复合外键：论文当前版本、版本论文/租户、轮次论文/版本/租户、任务轮次/论文/租户及同轮次替代任务、文件所属论文/租户/上传版本；`file_objects` 加 `upload_version_id IS NULL OR thesis_id IS NOT NULL` 检查，防非空上传版本绕过复合 FK。ORM 模型声明同一批约束，避免后续迁移元数据漂移。可空 ID 按 MATCH SIMPLE；降级仅移除新增约束/列并保留原数据。
- [x] 逐表 `ENABLE/FORCE`、GRANT、分命令策略：资格=本校/本人/指导关系/平台运营；论文=学生本人 membership、学校本校、平台运营、**直接经 `expert_tasks.thesis_id` 授权本人专家**或导师已发；版本=父论文且同租户，**专家无直接 SELECT**；文件=学生本人上传、学校本校、平台匿名、专家当前任务匿名，另为本人删稿开放仅将 `upload_version_id` 与 `thesis_id` 同置 NULL 的 UPDATE 分支，不要求更新后仍有可见版本，已有 link 由复合外键拒绝；轮次=同租户论文与版本，学校/平台写，专家派且可读邀请标题快照，学生可 SELECT 本人全部轮次、仅 UPDATE 本人旧状态 CREATED 为 CANCELLED（取消后 SELECT 仍可见），导师已发读；任务=学校本校进度、平台写、专家本人写，**学生/导师无 SELECT**。任务写策略只查 `experts`，任务与轮次/论文/租户关系由复合外键约束，避免任务→轮次→论文→任务回环。所有跨校父 ID 校验均显式限定内外列。专家匿名文件的最终验收留到 T06-7。**旧 link 未有复合 FK，本项尚不能验证“已有 link 拒绝脱钩”。**
- [x] 对照规格的 28 表 SELECT 图检查本项链路为 `expert_tasks→experts`、`theses→expert_tasks`、`review_rounds→theses/expert_tasks`、`thesis_versions→theses`；不得让 `expert_tasks` 的 SELECT 反查轮次，也不得让 `theses` 的 SELECT 反查轮次。真实普通账号同时跑学生撤回、专家邀请/评阅，以及跨校父 ID 混搭；`42P17` 或意外 0 行即本项失败。文件 service 最终复核不删除。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_core.py backend/tests/test_batch_creation_concurrency.py backend/tests/test_eligibility_operations.py backend/tests/test_dispatch.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_file_migration.py backend/tests/test_thesis_integrity.py -c backend/pyproject.toml -q --tb=short`；不以尚未可运行的完整主链作本项通过条件，记录策略拒绝与累计 19 表覆盖。最终 `-x` 执行 51 passed / 2 warnings。

### T06-6：结果与流程记录策略（4 表）

**Interfaces:** Consumes论文/任务策略；Produces `0014_rls_workflow`，`down_revision=0013_rls_core`；覆盖 `result_summaries`、`objections`、`workflow_events`、`termination_records`。

- [x] 在 `test_rls_workflow.py` 写两校结果/异议/事件直接 SQL 红灯：学生仅本人异议、学校仅本校处理，导师发布前看不到汇总，平台跨校仅现有流程事件，系统管理员没有论文流程数据。
- [x] 在 `0014_rls_workflow.py` 加分命令策略与父租户一致检查：`result_summaries`=学校本校写、学生/导师仅经本人 `theses.stage='COMPLETED'` 读，SELECT **不引用 `result_publications`**，COMPLETED 后不能 UPDATE summary；`objections`=学生本人创建/读取、学校本校处理；`workflow_events`=学生本人读、学校/平台按论文归属写；`termination_records`=学校本校写。学生/专家现行主链所需的写入与专家本人 `RETURNING` 限读见[实施校正](../specs/2026-09-23-t06-rls-design.md)和[验收记录](../../reviews/2026-09-28-t06-6-validation.md)，封轮次后专家不可再改汇总。`result_task_ids` 是 JSONB，不能以外键代替现有发布集合验证。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_workflow.py backend/tests/test_objections.py backend/tests/test_termination_reassignment.py -c backend/pyproject.toml -q --tb=short`；退出码 0、21 passed / 2 warnings，累计 23 表覆盖。完整发布 API 在子表策略就位后的 T06-8 复验。

### T06-7：关联子表与匿名/发布门禁（5 表）

**Interfaces:** Consumes核心与流程父表策略；Produces `0015_rls_children`，`down_revision=0014_rls_workflow`；覆盖 `thesis_version_files`、`anonymization_checks`、`review_drafts`、`review_result_versions`、`result_publications`，累计 28/28 表。

- [x] 在 `test_rls_children.py` 写跨校/跨任务直接 SQL 红灯：B 的 link/check/draft/result/publication ID 对 A 不可见，同校另一论文的 file ID 也不能挂到当前版本；专家真实 `purpose='anonymous'` 的当前 link 与文件可读，`purpose='original'` 不可读，取消/改派后的旧下载 token 拒绝；学生/导师发布前无结果、发布后仅本人且直接 SELECT `expert_tasks` 为 0；系统管理员不能读评阅子表。学生/导师发布后的 HTTP 分数、建议、化名须与旧 API 一致。
- [x] 在 `0015_rls_children.py` 先给 `thesis_version_files` 增加非空 `tenant_id` 和 `thesis_id`，从版本回填并审计其与文件的现有论文/租户/purpose，再为 `(thesis_version_id,thesis_id,tenant_id)` 与 `(file_id,thesis_id,tenant_id,purpose)` 建复合外键及父表 UNIQUE；更新文件完成、论文草稿复制 link、旧文件迁移测试构造器。草稿复制时文件 `upload_version_id` 可指旧版，但所属论文须与新 link 一致。随后分别按父链 `ENABLE/FORCE`：link 的非专家 SELECT→版本，专家 SELECT→轮次/任务/论文且只准当前匿名，专家不依赖 `thesis_versions` 行权限；**不反查 `file_objects`**。其 INSERT/UPDATE `WITH CHECK` 只查可见版本与本行，**不查 `file_objects`**，两个复合外键阻止跨校/跨论文/跨 purpose 父 ID；`anonymization_checks`→版本→论文，仅学生本人/学校/平台；`review_drafts`→任务，仅本人 IN_REVIEW 写；`review_result_versions` 的专家/学校 SELECT→任务，学生/导师 SELECT→可见的已发布 `result_summaries.result_task_ids`，无需任务 SELECT；`result_publications` SELECT→汇总→论文，汇总 SELECT 不反查 publication。升降级验证新列移除但数据保留。
- [x] 将 `published_result()` 的结果读取从复用 `school_results()` 中拆出：学生/导师先经现有论文、membership/指导关系与 COMPLETED 检查，再按本人可见 summary 的 `result_task_ids` 读取当前 `ReviewResultVersion`，核对单专家结果数量、当前标记及总分与 summary 一致；学校发布前仍用原 `_summary_results()` 对任务归属、轮次、分数进行完整校验。保持已有 404、匿名别名、评分与建议格式，不给学生/导师开放任务行。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_rls_children.py backend/tests/test_file_access.py backend/tests/test_file_concurrency.py backend/tests/test_file_migration.py backend/tests/test_review_integrity.py backend/tests/test_supervisor_results.py -c backend/pyproject.toml -q --tb=short`。若策略循环或缺父表 SELECT，修依赖/最窄 GRANT，不用 `SECURITY DEFINER` 绕过。

### T06-8：完整回归、回滚与交付

**Interfaces:** Consumes 0011–0015 最终 head；Produces可复核证据，不执行部署。R08 的未覆盖项不自动宣告完成。

- [x] `test_rls_end_to_end.py` 对 28 张 `__tablename__` 与 `pg_class/pg_policies` 做集合对账；以不同数据库凭据证明业务角色非 owner/非 `BYPASSRLS`，逐表 SELECT 与关键 INSERT/UPDATE 均无 `42P17`，直接 SQL 负向矩阵含 A/B 父 ID 混搭、平台、专家、系统、业务账号密码哈希列拒绝、认证账号租户读取、审计、幂等及池连接复用。测试 `0010→0015→0010→0015` 的隔离升降级、原始数据与任务论文映射不丢；中间 revision 不作为运行版本。
- [x] 重跑 `./scripts/check.sh`（显式测试库）、`bash scripts/tests/check_test.sh`、`git diff --check`；隔离 `operations` 浏览器/API 复验学生草稿、学校批次、平台派单、专家匿名下载、学校发布/学生导师结果及跨校负向。分别记录命令退出码、数量、警告和 NOT RUN。
- [x] 正常停止服务，按本次唯一 schema/角色/存储 ID 核查清理；更新 [验收矩阵](../../reviews/pilot-acceptance-matrix.md)、[CURRENT](../../CURRENT.md)、[AGENT_HANDOFF](../../AGENT_HANDOFF.md) 和任务板。向独立审查者交 28 表授权矩阵、策略 DDL、GRANT 清单、R02/R03 锁关系及所有负向测试；未解决高优先级发现阻断 T06 完成。

## R09 交接判据

本计划只是实施输入。[独立复核](../../reviews/2026-09-24-t06-rls-design-rereview.md)已在设计层放行；T06-1 普通角色夹具已按[验收记录](../../reviews/2026-09-24-t06-1-validation.md)验证。认证账号最小权限、平台/专家范围、实际 DDL 无循环与跨校父 ID 检查、`SET LOCAL` 在真实 SQLAlchemy 事务下的复用、文件与审计拒绝路径仍须在后续切片用真实连接验证。T07–T11 仍按原任务板，不因 R09/T06-1 完成而自动开始。
