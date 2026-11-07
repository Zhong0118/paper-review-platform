# T08：固定试点评审规则与轮次快照

状态：设计完成、未实施。依据 [试点决定](2026-09-22-pilot-scope-decisions.md)。保留单专家、六维 100 分，不做多专家、规则编辑器、改分、更正审批或新的 workflow 状态。

## 决策与接口

增加 `review_rounds.rule_snapshot JSONB NOT NULL`；不新增规则表，不向客户端接受模板/人数/阈值写参数。在 `dispatch.service.confirm_dispatch()` 创建轮次的既有论文锁事务中写一份深拷贝；重复确认同轮次不重写。`result_summaries.rule_snapshot` 继续保留，汇总时从所属轮次复制；已发布结果读取 summary 内规则，不要求学生/导师额外查询专家任务或轮次。

固定对象：

```json
{
  "version": "pilot-single-v1",
  "required_experts": 1,
  "mode": "sum_dimensions",
  "dimensions": [
    {"key":"topicValue","label":"选题价值","max_score":15},
    {"key":"literatureTheory","label":"文献与理论基础","max_score":15},
    {"key":"methodology","label":"研究方法","max_score":20},
    {"key":"innovation","label":"创新性","max_score":25},
    {"key":"writingStandards","label":"写作与学术规范","max_score":10},
    {"key":"resultsWorkload","label":"研究成果与工作量","max_score":15}
  ],
  "bands":[
    {"min":0,"max":59,"code":"FAIL","label":"不通过"},
    {"min":60,"max":79,"code":"REVISION_REQUIRED","label":"修改后通过"},
    {"min":80,"max":100,"code":"PASS","label":"通过"}
  ]
}
```

这些 code 是新结果响应字段 `outcome` 的取值，不是 AnonymizationConclusion（其中 PASS/FAIL 用于匿名检测），也不是 ThesisStage。发布仍完成现有学校发布流程；FAIL/REVISION_REQUIRED 不自动终止、回退或发起新轮次。“修改后通过”表示评分档位，不表示平台已验过修改稿；真实页面注明结果档位不替代学校后续处置。专家 recommendation 仍为独立评语，不覆盖计算档位。

新增 `review/rules.py`：`pilot_rule_snapshot() -> dict` 返回深拷贝；`validate_rule_snapshot(snapshot) -> dict` 校验固定 v1 全内容并返回副本，未知版本/损坏规则 409，不能降级回常量；`outcome_for_total(snapshot,total) -> dict` 返回 `{code,label}`，不在 0..100 的整数为 409。ReviewPayload 的六个最终分数用严格整数，拒绝 bool/小数/数字字符串；draft 仍沿用既有可暂存的完整六维字段契约，正式提交检查每维范围及必填评语。

`validate_for_submit(payload, rule_snapshot)` 与 `total_score(payload, rule_snapshot)` 使用轮次规则；`submit_final` 在原论文→任务锁内加载规则。`maybe_close_round`、`_summary_results`、`publish` 使用所属轮次或 summary 快照的人数和校验；`published_result` 仅读 summary+正式结果现有可见表。禁止为方便前端扩大结果表 RLS。

### 只读响应

- 新增 `GET /api/v1/expert/tasks/{task_id}/rules`，复用 `get_task_for_expert` 当前任务权限，返回固定对象。非本人、不可见旧任务仍 404。
- 新增 `GET /api/v1/school-review/review-rule`，学校角色可读当前固定试点规则，供批次页只读展示；不提供 PUT/PATCH。
- school results 返回增加 `rule_snapshot: object|null`、`outcome: {code,label}|null`；无 summary 则两者 null。my published-result 增加非空两个字段；supervisor 沿用同一已发布投影。其他返回字段不删不改。
- 真实 ReviewFormPane 接受规则 dimensions prop；真实模式在规则加载成功前禁止编辑/提交，失败显示重试且不 fallback demo。demo 模式显式传既有模板，scenarioService 不加业务。快速切任务的规则响应遵守现有 loadGeneration，不能串任务。

## 迁移与既有数据

新增 `0018_round_rule_snapshot`（依赖 T07 的 0017；若实际 migration head 不同，先报告关系，不改旧 revision）。先只读审计再同事务更新；必要时仅迁移 owner 临时 NO FORCE，结束恢复 FORCE，不对业务连接放开。

自动回填范围仅限本仓库 0017 及之前、没有任何真实试点导入的已知固定六维数据。迁移前检查：每轮活跃占位（INVITED/IN_REVIEW/SUBMITTED）最多一项；正式 results 的 scores 键恰为六维、值为整数且在上限内、sum 等于 total；现有 summary.rule_snapshot 恰为旧 `{required_experts:1,mode:sum_dimensions}` 或完整 v1；summary 对应单一正式 task、round/tenant 一致且 total 相等。仅检查已存在的正式记录，不要求未完成轮次已有结果。异常行汇总 ID/原因后整体拒绝，不能修改分数来迁就迁移。

满足上述条件的轮次回填 v1；summary 的旧二字段对象补全为同轮次 v1，总分、评语、发布时间不变。此规则来源依据是当前仓库已固定六维实现和 T04 确认，不是单凭分数恰巧相符就推断外部历史。若执行者发现真实导入、不同旧版本或无来源数据，停止迁移并报告，不能自动套用。迁移中将完整 v1 字面量自包含，不 import 以后可变的运行时代码。

对 review_rounds.rule_snapshot 加不可变触发器：INSERT 仅接受完整 v1（与既有 RLS 一起生效），UPDATE 即使普通角色有状态更新权限也不能改快照；无修改时正常通过。summary 在写入时校验完整 v1，汇总服务不更新已发布结果。空轮次/summary 库允许 downgrade；存在任何轮次或 summary 即拒绝，保留新规则信息，采用前向修复或 T10 配套恢复。

## 必须验证

59/60/79/80/100 档位；六维越界、bool/小数；未知/损坏快照拒绝；普通 SQL 改轮次快照拒绝；重复确认不重写；旧轮次在默认 factory 被测试替换后保持原快照（不实现 v2）；改派复用同轮次，撤回再送新建快照；外校/他人 rules 请求拒绝；学生/导师发布前 404、发布后仅读 summary 也能得到正确档位。旧发布结果升级后总分/评语/化名/发布时间不变。全量检查集中 T08-3。

## 2026-09-28 实施核对

学校只读规则端点复用现有 `thesis/router.py` 的 school_router（实际 `/school-review` 命名空间在此），不另建重复router。轮次和汇总数据库校验比较JSONB规范化文本，而不仅是JSONB `=`：后者会把1与1.0视作相等，可能让严格规则读取失效；已增加普通SQL及汇总约束负例。迁移仍不修改分数、评语、发布记录或原RLS。

按用户“困难项优先”的最新授权，T08-1/2可以在T07-2后端验收后先执行；T07-3/4与T08-3仍单独等待页面及模块验收，不据此提前放行整模块。
