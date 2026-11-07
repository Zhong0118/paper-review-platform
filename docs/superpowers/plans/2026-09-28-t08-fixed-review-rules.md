# T08 Fixed Review Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution; no automatic commit/push/deploy.

**Goal:** 固定单专家六维规则并让真实页面、提交和发布使用同一轮次快照。

**Architecture:** 新增轮次 JSONB，复用汇总快照，两个只读规则接口；不建规则后台。

**Tech Stack:** PostgreSQL/Alembic、SQLAlchemy/FastAPI、Vue/Vitest。

**Spec:** [完整设计](../specs/2026-09-28-t08-fixed-review-rules-design.md)。

## Global Constraints

- 用户已调整为困难项优先：T07-2通过后可先做T08-1/2；T07/T08页面和模块验收仍各自执行。只用5433/paper_review_test独立schema，保持权限、令牌和论文→任务锁序。
- 不支持第二种模板或多个专家；不重算已发布历史分数，不修改 workflow 阶段。
- 固定对象与接口字段以设计为准。遇真实导入或未知历史数据停止回填并记录 ID/原因。

### T08-1：规则值对象与迁移

2026-09-28 T08-1/2已本地验证，见[实际命令、修复和未覆盖](../../reviews/2026-09-28-t08-backend-validation.md)。

**Files:** 创建 `backend/app/modules/review/rules.py`、`backend/alembic/versions/0018_round_rule_snapshot.py`、`backend/tests/test_review_rules.py`、`backend/tests/test_rule_snapshot_migration.py`；修改 `backend/app/modules/dispatch/models.py`、`backend/app/modules/dispatch/service.py` 的 confirm_dispatch 创建字段（避免迁移后 NOT NULL 使运行入口失效）。

**Interfaces:** `pilot_rule_snapshot()`、`validate_rule_snapshot(snapshot)`、`outcome_for_total(snapshot,total)`，详见设计。ReviewRound.rule_snapshot 不可变；新轮次只写独立副本。

- [x] 写参数化失败测试，包含规则副本隔离、固定字段、非法分数/未知版本拒绝：

```python
@pytest.mark.parametrize('total,code', [(59,'FAIL'),(60,'REVISION_REQUIRED'),
    (79,'REVISION_REQUIRED'),(80,'PASS'),(100,'PASS')])
def test_fixed_bands(total, code):
    assert outcome_for_total(pilot_rule_snapshot(), total)['code'] == code
```

- [x] 写迁移测试：旧无结果轮次、在途、已发布三种 fixture；升级保留全部旧业务字段并补规则；异常 key/总分/双席位整事务拒绝；空库往返，有轮次时 downgrade 拒绝且 revision 不变。记录红灯命令 `backend/.venv/bin/pytest backend/tests/test_review_rules.py backend/tests/test_rule_snapshot_migration.py -c backend/pyproject.toml -q --tb=short -x`。
- [x] 实现设计中的自包含迁移和最小纯函数；confirm_dispatch 新建时 `rule_snapshot=pilot_rule_snapshot()`，既有轮次原样返回。只给新列沿用所需权限，恢复 FORCE 后由普通身份测试。禁止修改既有 migration 文件实现“回填”。
- [x] 同一命令复验，再跑 `backend/tests/test_dispatch.py`；测试普通 SQL 更新快照失败、状态变化仍可用。记录实际数量、退出码和清理；全量留到 T08-3。

### T08-2：提交、汇总与只读接口

**Files:** 修改 `backend/app/modules/review/service.py`、`backend/app/modules/dispatch/router.py`、`backend/app/modules/result/service.py`、`backend/app/modules/thesis/router.py`；创建 `backend/tests/test_rule_snapshot_api.py`；补 `backend/tests/test_review_integrity.py`、`backend/tests/test_publish.py`、`backend/tests/test_supervisor_results.py`。

**Interfaces:** 设计中的 expert task rules、school review-rule 和两类结果响应新增字段。submit/summary 内部传 snapshot，不再用当前模块全局常量决定旧轮次结果。

- [x] 红灯：他人任务 rules 404、学生学校规则接口 403、坏 snapshot 提交 409、严格整数 422、跨校结果 404；规则 factory 被测试替换后旧轮次仍按原快照处理。未知 v2 不实现运行支持。
- [x] 红灯：发布前学生/导师 404；发布后响应 outcome 与 summary.rule_snapshot 一致且无 expert_id/name；改派仍同轮次，撤回重提新轮次拥有独立规则。结果集合数量校验必须从可信固定快照读取，同时仍拒绝异常双专家结果。
- [x] 实现最小链路，核心形状：

```python
rule = validate_rule_snapshot(round_.rule_snapshot)
validate_for_submit(payload, rule)
total = total_score(payload, rule)
# 汇总复制该 rule；对学生/导师的发布投影从 summary.rule_snapshot 读取。
```

- [x] 跑 `backend/.venv/bin/pytest backend/tests/test_rule_snapshot_api.py backend/tests/test_review.py backend/tests/test_review_integrity.py backend/tests/test_publish.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_supervisor_results.py -c backend/pyproject.toml -q --tb=short`。不得放开 student/supervisor 对 expert_tasks 的 SELECT 以通过测试。

### T08-3：页面规则来源与总验收

2026-10-02 已本地验证，见[T08页面与模块验收](../../reviews/2026-09-28-t08-validation.md)。

**Files:** 修改 `frontend/src/api/review.ts`、`frontend/src/api/results.ts`、`frontend/src/api/schoolOperations.ts`、`frontend/src/modules/review/components/ReviewFormPane.vue`、`frontend/src/modules/review/pages/ReviewWorkspacePage.vue`、`frontend/src/modules/school/pages/BatchRulesPage.vue`、`frontend/src/modules/result/pages/ResultProcessingPage.vue`、`StudentResultPage.vue`、`SupervisorResultPage.vue`（后三者同目录）；创建 `frontend/src/modules/review/__tests__/realReviewRules.spec.ts`，补 `frontend/src/modules/result/__tests__/realResultPages.spec.ts`；创建 `docs/reviews/2026-09-28-t08-validation.md`。

**Interfaces:** api/review.ts 导出 ReviewRule 类型及 `getReviewRules(taskId)`；ReviewFormPane 的 dimensions prop 使用 `{key,label,max_score}`（适配现有字段，不让 demo 字段定义反向决定真实规则）。结果增加 outcome/rule_snapshot。批次只读展示，不加入配置表单。

- [x] 页面失败测试：尚未取得规则不允许提交；加载失败不回退假模板；规则显示六维/总分/版本；快速换任务迟到响应不串；学生、导师和学校显示相同档位且不修改流程状态。demo 模板显式映射传入，旧 demo 测试继续通过。
- [x] 最小接线；规则和分数加载遵守既有 loadGeneration；对外展示“评分档位”，不显示为“学校已完成修改验收”。
- [x] 真实隔离服务浏览器核对专家规则、学校只读规则、发布后档位；定向测试及未覆盖步骤见验收记录。
- [x] `./scripts/check.sh`、`bash scripts/tests/check_test.sh`、`git diff --check`；最后前端补丁后再运行前端全套、类型和构建；记录规则迁移与浏览器实测、未测项；更新 CURRENT/HANDOFF/任务板。
