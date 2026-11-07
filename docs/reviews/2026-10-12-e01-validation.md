# E01 正式评审结果更正 — 实施与验证记录

实际执行日期：2026-10-13。状态：**LOCAL_VERIFIED，E01已本地验收**。

用户已认可两期spec/plan，并授权按路线图开始执行。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`。开始时87个已跟踪修改、176个未跟踪文件，全部保留；本次无提交/推送/部署。数据库仅本机5433/paper_review_test的本次独立schema。

## 执行环境

Python 3.12.7、PostgreSQL 16.15、pytest 9.1.1、Node v24.19.0、Vue 3.5.39、Vite 8.1.3、Vitest 4.1.10。Postgres来自既有`paper-review-postgres`容器，先启动Docker后启动该容器；没有迁移或清理开发库。

## 本次改动范围

下列是E01涉及的文件；其中部分早有未提交内容，本次只叠加更正相关修改，不能将整份git diff算作E01。

- 后端新增：`backend/alembic/versions/0021_publication_snapshots.py`、`0022_review_corrections.py`；`backend/app/modules/review/correction_service.py`、`correction_router.py`；`backend/tests/test_result_corrections.py`。
- 后端接线：`backend/app/api.py`、`backend/app/db/models.py`；review/result的models.py与service.py；`backend/app/modules/audit/service.py`。
- 权限与恢复：`backend/scripts/recovery_drill.py`、`backend/tests/test_recovery_drill.py`、`test_rls_end_to_end.py`、`test_rls_roles.py`。
- 前端新增：`frontend/src/api/corrections.ts`、`frontend/src/modules/result/components/RealCorrectionPanel.vue`、`frontend/src/modules/result/__tests__/realCorrections.spec.ts`。
- 前端接线：`frontend/src/api/results.ts`、`frontend/src/router/menus.ts`及`frontend/src/router/__tests__/routes.spec.ts`；ReviewWorkspacePage、ReviewFormPane、CorrectionApprovalPage、ResultProcessingPage、StudentResultPage、SupervisorResultPage。
- 文档：CURRENT、AGENT_HANDOFF、两期总路线图和20份模块spec/plan的用户认可状态；本验收记录及5张浏览器截图。其他模块只有批准状态更新，没有业务实现。

## 当前实现

- 0021：发布快照、发布序号和前驱约束；旧发布确定性回填，歧义回滚，有发布数据拒绝破坏性降级。
- 0022：申请、私有理由、不可变更正版本，FORCE RLS；原专家申请/取消/保存/提交，平台审批，本校激活或驳回。
- 激活前维持旧发布，激活时追加新发布；原任务仍SUBMITTED，文件权限不恢复。
- 私有理由按note_kind隔离；学校首次发布门禁只获得存在未结束申请的布尔状态，学生/导师也仅在已有结果阅读归属内得到“更正处理中”，不读取申请/草稿。
- 专家/平台/学校真实页面，原意见与更正对照、二次确认、409刷新与幂等重试。
- 恢复清单纳入33张业务表，对发布及更正数据记录内容摘要。

## 实际验证记录

所有pytest命令从仓库根执行，统一参数 `-c backend/pyproject.toml -q --tb=short --show-capture=no`。

| 命令/范围 | 实际结果 | 说明 |
|---|---|---|
| `backend/.venv/bin/pytest backend/tests/test_result_corrections.py` 初始2例 | exit1：2 errors | Docker/Postgres未启动，环境错误，不计业务红灯 |
| 同上，启动既有paper-review-postgres后 | exit1：2 failed | 当前汇总改变使发布读取409；无snapshot列 |
| 同上，快照实现后 | exit0：2 passed | 初步快照保护 |
| 更正真实角色链 `-k real_rls` | exit1：404 | 新入口未实现；实现后与迁移用例5 passed |
| 首次发布 `-k unfinished_private` | exit1：实际200、预期409 | RLS隐藏申请导致漏判；限定布尔查询修补后6 passed |
| 前端realCorrections初始 | exit1：2 failed | 实际菜单和申请入口缺失；实现后2 passed |
| 后端首次扩大回归（更正、review_integrity、dispatch_result_integrity、rls_children、rls_end_to_end、recovery_drill） | exit1：46 passed /9 failed | 旧30表检查及跨校task映射防护，已逐项修补，恢复待全量复验 |
| 更正＋两项RLS回归 | exit0：9 passed | 包含跨校伪造仍409；33表保持FORCE RLS |
| 前端realCorrections、realResultPages、realWorkspace | exit0：40 passed | 真实入口、匿名对照、确认、409不重放 |
| 直接SQL伪造发布 `-k forge` | exit1：2 failed | 数据库缺少内容/链校验；新增触发器后专项9 passed |
| 处理中状态及恢复摘要 `-k 'school_activation or recovery_manifest'` | exit1：2 failed | 缺少状态与内容摘要；修补后专项10 passed |
| `cd frontend && node_modules/.bin/vue-tsc --build` | exit0 | 当前新增类型通过 |
| 首轮 `./scripts/check.sh` | exit1：431 passed /1 failed /2 warnings，756.79s | 唯一失败为test_rls_roles残留30表断言，改为33并保留所有权/最小权限检查；更正数据真实恢复用例已通过。前端步骤因后端失败未运行 |
| `-k 'school_activation or deadlock or shadowed'` | 红灯exit1：3 failed；修复后exit0：3 passed | 半激活事务、幂等锁环、临时表遮蔽 |
| 前端realCorrections（出口按钮） | 红灯exit1：1 failed/4 passed；修复后exit0：5 passed | 更正编辑隐藏未接线的暂存退出按钮 |
| `-k 'school_activation or terminal_paths'` | 3 passed /1测试夹具错误 | 并发激活、载荷冲突、平台/学校驳回通过；夹具错误为不存在submitted场景 |
| `-k activate_before_publish` | exit0：1 passed | 改用accepted场景经真实提交，学校激活后仍须原发布操作 |
| 第二轮 `./scripts/check.sh` | exit1：后端437 passed /2 warnings（728.74s）；前端464 passed /1 failed | 前端唯一失败为旧菜单预期未包含真实更正审批入口；类型/构建在此脚本内未运行 |
| 版本标识字段 `-k school_activation` | exit1：1 failed | KeyError base_result_id；学校和已发布结果接口补齐base_result_id/effective_revision_id |
| 最终后端相关回归（见下方完整命令） | exit0：52 passed /2 warnings，160.69s | 覆盖最终字段补齐、更正/RLS/恢复、结果一致性和导师归属 |
| `cd frontend && node_modules/.bin/vitest run --maxWorkers=4` | exit0：465 passed /64 files | 菜单预期保留精确列表并加入已接通更正入口 |
| `cd frontend && node_modules/.bin/vue-tsc --build` | exit0 | 字段类型同步后通过 |
| `cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build` | exit0 | 853ms；依赖库PURE注释位置警告，不影响构建 |
| `git diff --check` | exit0 | 无空白错误 |

## 浏览器验收（2026-10-13）

PASS：本地真实模式，Playwright控制独立Chrome浏览器，全部业务操作经页面完成；不是用HTTP用例替代浏览器。后端使用`scripts.acceptance_server --scenario published --port 8013`（忽略目录启动器生成一次性种子密码，不进入日志），前端使用`VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:8013 node_modules/.bin/vite --host 127.0.0.1 --port 5177`。

隔离资源ID：`test_0b426dc2f8434bc4bb3240568f674f74`，只用5433/paper_review_test。服务已通过Ctrl-C退出，清理由acceptance_environment负责，未手工删除现存schema。密码文件由启动器finally删除。退出后只读查询确认该schema已不存在、该临时存储目录已移除。

1. 专家在已提交任务申请，平台在真实更正审批页面批准。
2. 专家编辑六维分数为90，保存草稿、最终提交并二次确认；没有PDF iframe。
3. [学生确认前](evidence/2026-10-13-e01/student-pending.png)：仍80分，有“更正处理中”。
4. [学校对照](evidence/2026-10-13-e01/school-comparison.png)：80/90分和评语并排显示，无专家姓名及申请理由；填写本校理由，二次确认。
5. [学生确认后](evidence/2026-10-13-e01/student-activated.png)、[导师确认后](evidence/2026-10-13-e01/mentor-activated.png)：90分及更正评语，处理中提示消失。
6. [专家确认后](evidence/2026-10-13-e01/expert-activated.png)：更正已生效、PDF iframe仍0，学校私有理由不可见。

浏览器脚本首个学生更新断言使用固定500ms等待，早于异步加载完成；改为等待90.0文本后通过，未改业务代码绕过。浏览器工具的沙箱不支持require/import读取本地临时凭证，转由Node REPL运行本机Playwright完成，不打印密码。

## 并发、RLS与恢复自查

- 所有更正命令保持论文→任务→申请→summary顺序。旧submit-final先拿幂等锁，更正命令先拿父项；新增`audit.replay(wait=False)`仅供更正使用，拿不到幂等锁时返回409，避免反向等待形成死锁。旧调用默认行为不变。双会话用例先制造数据库锁等待再验证结果。
- 学校首次发布门禁及学生/导师“处理中”通过固定布尔SECURITY DEFINER查询实现；FORCE RLS不关闭，表owner仅在有现行阅读归属时查询开放申请是否存在。业务角色仍不能读取私有申请/草稿。函数固定search_path，pg_temp显式放末尾；临时同名表不能遮蔽数据。
- 新表33表清单、私有理由、直接SQL伪造快照/版本链、事务提交时半激活防护均有回归。并发两次激活200/409，只新增一个publication；相同键相同载荷回放，相同键不同载荷409。
- `test_confirmed_correction_survives_owned_restore`实际创建80→90已确认更正，备份、恢复，再由学生读取90并查验旧/新发布[80,90]和revision对应；不是只检查备份文件存在。恢复清单新增四类内容摘要，不记录明文评语。
- 0021历史结构夹具验证确定性快照回填、损坏映射回滚、带数据降级拒绝。没有对真实历史数据迁移，无法据虚构夹具保证所有真实旧库都能回填；有歧义须保留并报阻断。

## 未覆盖与边界

- 真实部署、正式数据迁移、真实环境恢复仍未执行；开发库未迁移。本模块通过不等于具备试点上线条件。
- 浏览器覆盖一轮更正五个角色页面；驳回、取消、并发和跨校负例通过自动测试验证，未逐个做浏览器操作；未做多轮连续更正的浏览器回放、移动端完整矩阵、压力测试或独立外部安全审查。
- 既有真实结果页部分时间栏为空，本次未扩展时间字段展示；功能状态与分数/评语更新已验证。
- E02–E10仍未实施。更正不开放PDF，不提供独立立即撤下已发布结果，不接入LLM。

过程日志在git-ignored执行目录；可交接证据以本记录、测试源码和截图为准。后端全量与最终定向、前端全量/类型/真实构建均有实测记录，E01标为已本地验收。

完整工作树路径清单：[2026-10-13-e01-worktree-status.md](2026-10-13-e01-worktree-status.md)。起始路径检查无缺失；未对既有工作执行reset/clean。

最终补验命令（仓库根）：

```sh
backend/.venv/bin/pytest backend/tests/test_result_corrections.py backend/tests/test_review_integrity.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_rls_children.py backend/tests/test_supervisor_results.py -c backend/pyproject.toml -q --tb=short --show-capture=no
```

验证口径：完整后端437通过后，新增版本标识读取断言并补齐响应字段，再跑以上相关后端回归；前端菜单修正后重新跑全部465项、类型和真实构建。不将第二轮统一脚本的exit1改写为exit0，也不把补验数量累计成新增测试总数。后端两项警告来自crypt和argon2版本接口弃用，未修改依赖来消除警告。

## 交接出口

E01四个子项完成，迁移头`0022_review_corrections`，33张业务表FORCE RLS。E02具备开工条件：读取已批准的`2026-10-12-e02-review-comment-checks-design.md`与对应plan，按原计划将规则检查接入原提交及更正提交；不要重复实现E01。两期10个模块中当前已本地验收1个，E02–E10仍待执行，不能按任务数推断实际工时比例。

未提交、未推送、未部署，未改原始材料。最终工作树89项已跟踪修改、191项未跟踪；包含历史工作。服务已停止；既有Postgres容器保留运行。
