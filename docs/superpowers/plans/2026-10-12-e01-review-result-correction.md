# E01 正式评审结果更正 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 按任务 inline 执行；用户既定约束禁止自动子agent、提交或推送。用户已审阅认可，并于2026-10-13授权按顺序执行。

**Goal:** 允许原专家申请更正、平台审核、原专家提交新意见、本校确认生效；原结果和已发布内容不被静默覆盖。

**Architecture:** 一期模块；依赖现有0020基线。复用现有FastAPI/SQLAlchemy/Postgres RLS及Vue真实模式接口。以规格中的状态、字段、权限与响应契约为准，候选新文件不代表现有功能。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy、Alembic、Postgres、pytest；Vue 3、TypeScript、Vitest；PDF处理复用pypdf，无LLM或外部支付/通话依赖。

**Spec:** [同名设计](../specs/2026-10-12-e01-review-result-correction-design.md)

**Status:** LOCAL_VERIFIED / 2026-10-13本地验收完成，见[验收记录](../../reviews/2026-10-12-e01-validation.md)；规划依据head 39a8962及保留的工作树，不允许执行者回退到该head。

## Global Constraints

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 文件与接口

现有修改：backend/app/modules/review/models.py；backend/app/modules/result/models.py、service.py；backend/app/modules/dispatch/router.py；backend/app/api.py；frontend/src/modules/review/pages/ReviewWorkspacePage.vue；frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue；frontend/src/modules/result/pages/ResultProcessingPage.vue；frontend/src/router/menus.ts。
拟新增：backend/app/modules/review/correction_service.py、correction_router.py；frontend/src/api/corrections.ts；新增迁移；backend/tests/test_result_corrections.py；frontend/src/modules/result/__tests__/realCorrections.spec.ts。

接口的具体字段与状态表见规格“契约”相关段落。每项开始先用CodeGraph理解列出的实际调用者；语义检索用zvec并传绝对root，精确文件/符号用rg。不要重读全仓历史，不自行重建索引。实施前核对新文件是否已由后续工作创建，已有则验证关系后精准修改。

## 第一条失败用例种子

以下是拟新增测试的可执行断言示例，不是本次已经运行的测试。集成fixture写在所列新测试文件中，复用`tests.conftest.isolated_runtime_roles`或`acceptance_environment`及`tests.helpers.login/auth`；角色、数据状态按注释创建，不用mock替代RLS/数据库。纯函数接口由本规格新增。

```python
# 拟新增的集成测试；fixture correction_case 在本测试文件中建立独立角色schema，
# 用现有acceptance_environment和真实HTTP命令生成70分已发布论文。
# fixture返回client、school_headers、student_headers、thesis_id、request_id、request_version，
# request_id已经历申请/批准/专家提交90分revision，处于AWAITING_SCHOOL。
async def test_new_revision_does_not_replace_publication_before_activation(correction_case):
    c = correction_case
    url = f"/api/v1/my/theses/{c['thesis_id']}/published-result"
    old = await c['client'].get(url, headers=c['student_headers'])
    assert old.status_code == 200
    assert old.json()['data']['total'] == 70
    activated = await c['client'].post(
        f"/api/v1/school-review/corrections/{c['request_id']}:activate",
        headers={**c['school_headers'], 'Idempotency-Key': 'activate-once'},
        json={'version': c['request_version'], 'reason': '核对完成'})
    assert activated.status_code == 200
    new = await c['client'].get(url, headers=c['student_headers'])
    assert new.json()['data']['total'] == 90
```

集成async用例使用pytest.mark.asyncio；示例省略装饰仅为突出断言，正式测试必须添加。字段来源由真实响应/数据库fixture读取，不填猜测ID。新fixture只创建本次拥有的虚构资源。

### E01-01 固定发布快照与历史兼容

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“固定发布快照与历史兼容”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：snapshot["total"] == 70；修改当前summary后 published_result仍返回70；迁移异常事务回滚。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：先用历史schema构造原结果及发布，再升级。断言当前结果变化不改变已存发布；损坏映射迁移失败。实现publication快照、唯一版本及统一读取，不启动申请入口。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e01-validation.md`，不自动git commit。

### E01-02 更正状态、RLS和命令

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“更正状态、RLS和命令”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：使用上述真实HTTP用例，依次申请、批准、提交90分更正；确认前发布值为70，学校激活后为90；直接SQL验证双方均不能读取对方私有理由。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：新增申请/版本表及最窄策略。实现申请、审核、草稿、提交、取消与学校激活/拒绝；每个命令先锁父项、重读版本、幂等检查，最后写审计同事务提交。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e01-validation.md`，不自动git commit。

### E01-03 真实角色页面接线

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“真实角色页面接线”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：专家改稿→平台/学校相应操作→学生刷新；每一步检查当前可见版本及原专家PDF仍不可读。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：分别接原专家申请/更正编辑、平台审批、本校匿名差异确认；保留demo分支，不向scenarioService添加业务。409刷新不重放，重复点击禁用；页面明确旧发布仍有效。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e01-validation.md`，不自动git commit。

### E01-04 并发、恢复与一期基础验收

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“并发、恢复与一期基础验收”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：旧结果内容不变；一次激活一个publication；恢复后发布快照和当前revision对应。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：测试真实双会话竞争、跨租户直接SQL、恢复后版本链和历史发布；运行全量脚本并用隔离浏览器完成一次原发布→新发布。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e01-validation.md`，不自动git commit。

## 实际验证命令与验收出口

以下命令从仓库根运行；新文件不存在时须先按上文创建失败测试，不能把找不到测试文件当作业务失败证据。

```sh
backend/.venv/bin/pytest backend/tests/test_result_corrections.py backend/tests/test_review_integrity.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_rls_children.py -c backend/pyproject.toml -q --tb=short --show-capture=no
(cd frontend && node_modules/.bin/vitest run src/modules/result/__tests__/realCorrections.spec.ts --maxWorkers=4)
(cd frontend && node_modules/.bin/vue-tsc --build)
(cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build)
git diff --check
```

命令从仓库根启动，前端命令在子shell中执行，不改变后续命令工作目录。期待测试、类型检查和构建退出0，输出数量必须记录实测。 E01、E06、E10出口运行`./scripts/check.sh`，包含全量后端、前端、类型和真实构建；新增数据表时同时复验`backend/tests/test_rls_end_to_end.py`和`backend/tests/test_recovery_drill.py`。其余模块以定向验证为主，发现关联失败才扩大。

浏览器用`scripts.acceptance_server`的独立schema及真实模式前端，按spec验收场景操作；页面不可用记NOT RUN。停止服务后仅由原工具清理本次自建资源，不手工清理现存schema。审阅记录包括变更文件、具体命令/退出码、失败→修复过程、迁移/RLS/恢复与浏览器证据、未覆盖项及下项条件。

完成本模块后仅在用户已批准整期执行时继续顺序下一项；否则停在本项边界。本模块不扩展：发布后更正仍保留旧公开版本；不重新开放PDF；本期不做独立撤下发布。这三点已获用户认可。
