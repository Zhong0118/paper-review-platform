# E04 全部与近一年统一时间范围 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 按任务 inline 执行；用户既定约束禁止自动子agent、提交或推送。用户已审阅认可，并于2026-10-13授权按顺序执行。

**Goal:** 让论文业务列表和统计使用一致的时间范围，不归档、不删除数据、不改变详情权限。

**Architecture:** 一期模块；依赖E01；执行顺序在E03之后。复用现有FastAPI/SQLAlchemy/Postgres RLS及Vue真实模式接口。以规格中的状态、字段、权限与响应契约为准，候选新文件不代表现有功能。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy、Alembic、Postgres、pytest；Vue 3、TypeScript、Vitest；PDF处理复用pypdf，无LLM或外部支付/通话依赖。

**Spec:** [同名设计](../specs/2026-10-12-e04-data-time-scope-design.md)

**Status:** LOCAL_VERIFIED / 2026-10-13已本地实现与验收；规划依据head 39a8962及保留的工作树，不允许执行者回退到该head。

## Global Constraints

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 文件与接口

拟新增：backend/app/shared/time_scope.py；frontend/src/components/app/TimeScopeSelect.vue；frontend/src/composables/useTimeScope.ts；backend/tests/test_time_scope.py；frontend/src/components/app/__tests__/timeScope.spec.ts。
现有修改：backend/app/modules/thesis/router.py、service.py；backend/app/modules/dispatch/router.py、service.py；backend/app/modules/result/service.py；frontend/src/api/theses.ts、dispatch.ts、schoolReview.ts、results.ts；相应真实列表页面。

接口的具体字段与状态表见规格“契约”相关段落。每项开始先用CodeGraph理解列出的实际调用者；语义检索用zvec并传绝对root，精确文件/符号用rg。不要重读全仓历史，不自行重建索引。实施前核对新文件是否已由后续工作创建，已有则验证关系后精准修改。

## 第一条失败用例种子

以下是拟新增测试的可执行断言示例，不是本次已经运行的测试。集成fixture写在所列新测试文件中，复用`tests.conftest.isolated_runtime_roles`或`acceptance_environment`及`tests.helpers.login/auth`；角色、数据状态按注释创建，不用mock替代RLS/数据库。纯函数接口由本规格新增。

```python
from datetime import datetime, timezone
from app.shared.time_scope import resolve_time_scope

def test_leap_day_uses_calendar_year_and_shanghai_midnight():
    now = datetime(2024,2,29,4,tzinfo=timezone.utc)
    lower, upper = resolve_time_scope('past_year', now)
    assert lower == datetime(2023,2,27,16,tzinfo=timezone.utc)
    assert upper == now
```

集成async用例使用pytest.mark.asyncio；示例省略装饰仅为突出断言，正式测试必须添加。字段来源由真实响应/数据库fixture读取，不填猜测ID。新fixture只创建本次拥有的虚构资源。

### E04-01 边界函数与日期口径

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“边界函数与日期口径”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：resolve_time_scope("past_year", now)[0] == expected_shanghai_midnight_utc。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：先固定时钟测试2024-02-29回溯到2023-02-28、上海午夜与UTC；实现标准库日期函数，参数all/past_year白名单。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e04-validation.md`，不自动git commit。

### E04-02 列表API一致过滤

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“列表API一致过滤”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：old.updated_at=now不能使old进入past_year；all可查看old；直接详情仍按权限可读。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：依次接论文、任务、导师结果API，保持响应结构；通过论文created_at过滤，响应附范围头；一组跨角色共享fixture核对相同论文。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e04-validation.md`，不自动git commit。

### E04-03 选择器与竞态回归

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“选择器与竞态回归”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：选择past_year后刷新仍相同，换用户回到该用户偏好；未结项隐藏提示可见。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：接入范围组件、按身份持久化和URL同步；响应竞争时只展示最后选择；在隔离浏览器确认列表/范围提示/刷新。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e04-validation.md`，不自动git commit。

## 实际验证命令与验收出口

以下命令从仓库根运行；新文件不存在时须先按上文创建失败测试，不能把找不到测试文件当作业务失败证据。

```sh
backend/.venv/bin/pytest backend/tests/test_time_scope.py backend/tests/test_dispatch_objection_projection.py -c backend/pyproject.toml -q --tb=short --show-capture=no
(cd frontend && node_modules/.bin/vitest run src/components/app/__tests__/timeScope.spec.ts --maxWorkers=4)
(cd frontend && node_modules/.bin/vue-tsc --build)
(cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build)
git diff --check
```

命令从仓库根启动，前端命令在子shell中执行，不改变后续命令工作目录。期待测试、类型检查和构建退出0，输出数量必须记录实测。 E01、E06、E10出口运行`./scripts/check.sh`，包含全量后端、前端、类型和真实构建；新增数据表时同时复验`backend/tests/test_rls_end_to_end.py`和`backend/tests/test_recovery_drill.py`。其余模块以定向验证为主，发现关联失败才扩大。

浏览器用`scripts.acceptance_server`的独立schema及真实模式前端，按spec验收场景操作；页面不可用记NOT RUN。停止服务后仅由原工具清理本次自建资源，不手工清理现存schema。审阅记录包括变更文件、具体命令/退出码、失败→修复过程、迁移/RLS/恢复与浏览器证据、未覆盖项及下项条件。

完成本模块后仅在用户已批准整期执行时继续顺序下一项；否则停在本项边界。本模块不扩展：近一年按论文创建日、公历年；默认全部；范围不包含专家名录与异议待办。

## 本次交付

[验收记录](../../reviews/2026-10-12-e04-validation.md)：后端66项相关回归及新增取消专项1项通过，前端480项、类型/真实构建通过；Chrome7场景通过。已按用户批准补0024最窄日期boolean查询，未扩大正文/文件读取。下一项E05未执行。
