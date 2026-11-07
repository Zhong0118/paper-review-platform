# T07 试点专家维护实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Existing session has chosen inline execution; do not create another task or commit automatically.

**Goal:** 平台运营人员在真实模式维护单专家试点的专家账号、资格、服务状态与回避，直接派单和改派始终重新校验。

**Architecture:** 沿用 `users`/`user_role_assignments` 的全局专家身份、`experts`/`expert_conflicts`、现有派单服务。新迁移以窄 RLS 写策略开放平台维护，派单在论文/旧任务锁之后锁专家以串行化配置变更；前端在真实模式调用 API，演示模式保持旧服务。

**Tech Stack:** FastAPI、SQLAlchemy async、Alembic、PostgreSQL FORCE RLS、Vue/Vitest、独立 5433 `paper_review_test`。

**Spec:** [T07 设计](../specs/2026-09-28-t07-expert-operations-design.md)。

## 全局约束

- 只服务一篇论文、一位专家、平台账密的试点主链；费用、通知、SSO、批量导入延期。
- 学校和系统管理员不维护平台共享专家库；不泄露密码哈希、原文、作者或他校任务记录。
- `theses.stage` 仍只由 `workflow.transition` 修改；R02/R03 的论文→任务锁顺序不可倒置。
- 全部数据库验证用本机 `127.0.0.1:5433/paper_review_test` 独立 schema/普通角色；不迁移开发业务库，不改 `docs/99_原始材料/`。
- 保留已有未提交工作，不自动提交、推送、合并或部署。

---

执行口径：四个交付项保持不变，测试步骤不另算任务。每片只跑定向回归；全量检查放在 T07-4，遇到新失败再扩大。T07-2 的完整字段、幂等、RLS 和身份检查已在设计末两节固定，执行者不得另选契约。

### T07-1：专家字段与最窄 RLS/只读接口

**Files:** 创建 `backend/alembic/versions/0016_expert_operations.py`、`backend/app/modules/expert/router.py`、`backend/app/modules/expert/schema.py`、`backend/tests/test_expert_operations.py`；修改 `backend/app/modules/expert/models.py`、`backend/app/api.py`。

**Interfaces:** `GET /api/v1/platform-review/experts` 返回设计中的无敏感字段投影；迁移提供 `experts.qualification_status/unit/title/version`，回填旧专家为 `APPROVED`、回避唯一约束及只读列权限；写权限不在本项开放。后续 T07-2 复用这些列。

- [x] 写失败测试：平台能读两位 seed 专家及状态/学科，学生、学校、系统与另一位专家不能读管理 API；普通业务账号直接 SQL 仍不能读 `users.password_hash`，专家本人只能读本人档案。运行 `backend/.venv/bin/pytest backend/tests/test_expert_operations.py -c backend/pyproject.toml -q --tb=short -x` 确认红灯。
- [x] 写 `0016` 迁移：先审计旧 `service_status`、学科 JSONB 及重复 conflict；加列/检查/唯一约束，仅按只读需要调整列级 GRANT，测试平台仍不能直接 SQL 创建或修改专家。升级/降级在同一事务；仅 experts/expert_conflicts 均为空时允许降级，有数据明确拒绝，不删用户或任务。同步 ORM。
- [x] 实现只读 schema/router，注册路由；查询 `Expert` + `User` 时不选密码哈希，API 响应字段与设计逐项对照。定向复验、`git diff --check`；记录本项覆盖与未测。

预期接口检查示例：

```python
response = await client.get('/api/v1/platform-review/experts', headers=auth(platform))
assert response.status_code == 200
assert 'password_hash' not in response.text
assert {row['service_status'] for row in response.json()['data']} == {'AVAILABLE'}
```

### T07-2：创建、变更、回避与并发派单门禁

2026-09-28 已本地验证，见[实际命令与边界](../../reviews/2026-09-28-t07-2-validation.md)。

**Files:** 创建 `backend/app/modules/expert/service.py`、`backend/alembic/versions/0017_expert_management.py`；修改 `backend/app/modules/expert/router.py`、`schema.py`、`backend/app/modules/dispatch/service.py`、`backend/tests/test_expert_operations.py`、`backend/tests/test_dispatch_result_integrity.py`。

**Interfaces:** 设计中的 `POST /experts`、`PATCH /experts/{id}`、`POST :review-qualification`、`POST :set-service-status`、`PUT /conflicts`；候选列表和 `assign()`/`reassign()` 共享资格、状态、学科、回避校验。

- [x] 先写失败测试：新建专家 `PENDING` 不可派；审批后可派；暂停、驳回、学校 ID 回避、导师姓名回避均在直接 assign/reassign API 返回 409/404；无效学校与学科 422；旧版本 409；非平台 403/404；重复用户名 409 且账号/档案/角色均不残留。
- [x] 写并发测试：派单事务按论文（改派再旧任务）→专家锁顺序暂停；配置变更只锁专家。让暂停与派单、添加回避与派单并发，证明结果按专家锁先后线性化，配置先取得锁并完成时派单拒绝；派单先完成时配置也可成功、旧任务保留、下一次派单拒绝；两种时序均不倒序等待。旧在途任务仍可提交，已发布结果总分和化名不漂移。
- [x] 写权限随本片迁移开放，直接 SQL 负例必须同时通过：全局账号创建限定 `provisioned_by=app_actor_id()` 且 `provisioned_tenant_id IS NULL`，角色只能是 expert，Expert 用户父键与 conflict 专家父键不可后改；降级沿用设计的空专家库限定。先复现非 ACTIVE 账号/失效全局角色仍可成为派单目标的场景，再覆盖候选和直接派单拒绝；目标身份使用已有 load_active_identity 检查，不新增用户锁；如源码出现本计划未覆盖的全局在线身份写入，再报告具体锁图。
- [x] 按设计末两节的字段/状态/错误码/创建幂等和 expert-options 响应写契约测试；学校 ID 是回避对象，绝不能成为请求身份的 tenant_id 覆盖。补全 assignment 最窄 SELECT 和 RLS 无递归负例；不加全局在线停账号接口。
- [x] 实现最少代码：平台账号创建按 User→Expert→全局 RoleAssignment 顺序在一次事务完成，密码只存哈希；资料/状态/资格/回避变更锁 Expert 并校验 `version`，每次变更加一并写审计；冲突集合先验证 UUID/学校及重复再原子替换。`assign()` 在当前论文/旧任务锁后 `FOR UPDATE` 目标 Expert，再校验资格与两类回避；候选列表使用同一资格/状态/回避判断但不得取代 assign 锁内复核；无效账号候选不返回。
- [x] 运行 `backend/.venv/bin/pytest backend/tests/test_expert_operations.py backend/tests/test_dispatch.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_termination_reassignment.py -c backend/pyproject.toml -q --tb=short`；保留 R02/R03 原并发测试通过。

直接 API 负例骨架：

```python
await client.post(f'/api/v1/platform-review/experts/{expert_id}:set-service-status',
                  headers=auth(platform), json={'version': version, 'status': 'UNAVAILABLE', 'reason': '试点暂停'})
blocked = await client.post(f'/api/v1/platform-review/theses/{thesis_id}:assign',
                            headers=auth(platform), json={'expert_id': expert_id})
assert blocked.status_code in (404, 409)
```

### T07-3：真实专家库页面

2026-10-02 已本地验证，见[T07页面与模块验收](../../reviews/2026-09-28-t07-validation.md)。

**Files:** 创建 `frontend/src/api/expertOperations.ts`、`frontend/src/modules/expert-management/__tests__/realExpertLibrary.spec.ts`；修改 `frontend/src/modules/expert-management/pages/ExpertLibraryPage.vue`、必要的同目录组件、`frontend/src/router/menus.ts`、`frontend/src/router/routes.ts` 与 `frontend/src/router/__tests__/routes.spec.ts`。演示模式继续使用 `scenarioService`。

**Interfaces:** 页面只展示真实 API 的单位、职称、学科、资格、状态、回避；提供创建、编辑、审批/驳回、暂停/恢复及回避编辑；不展示费用、接单率或资质文件等未接线字段。

- [x] 先写失败的真实模式单元测试：加载、空态/错误、旧版本 409 刷新、暂停后候选不可派提示、回避学校 ID 显示名称、保存成功；确认演示模式现有测试不变。
- [x] 测试真实模式平台菜单能进入 `/platform/experts`，其他角色不可访问；仅调整真实路由白名单/菜单，保留 demo 入口规则。
- [x] 最小接线：给真实模式独立 API 投影和操作分支，保留现有演示分支；只显示后端已持久化的字段，动作后重新读取服务器状态，不本地伪造成功。真实模式不显示费率、统计或资格材料入口。
- [x] 运行真实页面及演示定向测试、`node_modules/.bin/vue-tsc --build`、`VITE_DEMO_MODE=false node_modules/.bin/vite build`；实际数量见验收记录。

### T07-4：隔离验收与交付

2026-10-02 已本地验证，手工 `operations` 服务的直接派单/改派步骤未执行，自动化覆盖见[T07验收记录](../../reviews/2026-09-28-t07-validation.md)。

**Files:** 创建 `docs/reviews/2026-09-28-t07-validation.md`；更新 `docs/CURRENT.md`、`docs/AGENT_HANDOFF.md`、任务板与验收矩阵。

- [x] 在 `operations` 独立服务中用真实平台页面/API 创建专家、审批、暂停/恢复、编辑学校/导师回避；直接派单/改派由自动化 API 证明，手工服务步骤明确 NOT RUN；在途/已发布历史由回归测试核对。浏览器、API、直接 SQL 结果分别记录。
- [x] 运行 `./scripts/check.sh`、`bash scripts/tests/check_test.sh`、`git diff --check`；确认 28 表仍 FORCE RLS。验证 `0015→0017→0015→0017`、有数据降级拒绝及服务/资源精确清理。
- [x] 按设计矩阵复核全局专家账号 RLS/GRANT、直接派单并发、R02/R03 锁序、跨校回避与日志敏感字段；记录了未测生产/Hosted CI/完整浏览器矩阵。
