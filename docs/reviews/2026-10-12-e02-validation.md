# E02 评语提交前规则检查验收

实际执行日期：2026-10-13。状态：已本地验证。后端两组共163项通过、前端471项通过，真实浏览器原评阅与更正流程通过。

## 范围与环境

按已批准E02 spec/plan inline执行，无子agent、提交、推送、部署。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；开始时89个已跟踪修改、191个未跟踪文件，均保留。独立Postgres仅 `127.0.0.1:5433/paper_review_test` 的本次临时schema；开发数据库未迁移，原始材料未改动。

环境：Python3.12.7、Node24.19.0、PostgreSQL16.15、Vitest4.1.10、Vite8.1.3。

实现范围：确定性规则、原评阅和已批准更正的预览/确认、提交时重新检查、不可事后改写的确认摘要、学校匿名摘要、共享前端检查面板。新迁移 `0023_review_check_summaries` 在两个已有结果表追加nullable JSONB；仍33张业务表，未扩大RLS权限或改变论文→任务锁序。

经认可的规则为短评50/20非空白字符、重复长句、明确结论与评分档位冲突，以及手机号/身份证格式候选。审核词表目前为空，页面明确显示0条；仅测试fixture包含测试词条。没有外部“官方敏感词库”、全面中文纠错、LLM、跨专家查重或自动改写能力。

## 失败与修复证据

原始日志保存在忽略目录 `.superpowers/sdd/2026-10-12-e02-review-comment-checks/`，没有密码或token；其中浏览器临时密码文件仅服务运行期间存在且权限0600，不应复制。

- 纯规则首次12项失败→12项通过，覆盖正常批评、否定/引语、Unicode偏移、空词表、哈希与长度限制。
- 实际RLS集成：最初预览404/检查故障仍提交200→原评阅及更正共15项通过；警告未确认/旧hash返回409，失败不能产生正式结果，同幂等键只生成一次。
- 追加反例：多行引语被误判、清除全部警告后旧ack仍被接受，两项失败→修复后14项纯规则通过。
- 前端首次组件缺失3项失败→3项通过；学校摘要缺失1项失败→补齐。新增分项评价/优点的恢复定位2项失败→6项检查组件测试通过。定位使用码点转UTF-16，不自动修改文本。
- 扩大后端回归曾26失败/18通过，原因是共享旧夹具使用短评而没有确认；将常规成功夹具改为具体长评，保留短评专用测试。第二轮3失败/65通过：两处故意冲突/短评的历史测试改为真实预览并确认，另一处迁移版本断言按实际head更新，没有放宽生产门禁。
- 原结果的恢复内容摘要缺失：新增断言失败KeyError→把原结果表纳入既有内容SHA256核对，继续复验真实备份恢复。

## 验证命令

从仓库根执行，前端命令在frontend目录运行。所有通过数量均取自当次输出。

| 命令 | 退出码/结果 |
| --- | --- |
| `backend/.venv/bin/pytest backend/tests/test_comment_checks.py backend/tests/test_review.py backend/tests/test_review_integrity.py backend/tests/test_result_corrections.py backend/tests/test_expert_workspace.py backend/tests/test_supervisor_results.py backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0；73项通过、2条依赖弃用警告 |
| `node_modules/.bin/vitest run --maxWorkers=4` | 0；65文件、471项通过 |
| `node_modules/.bin/vue-tsc --build` | 0 |
| `VITE_DEMO_MODE=false node_modules/.bin/vite build` | 0；依赖库PURE注释位置警告，不影响构建 |
| `git diff --check` | 0 |

补查评分档位测试最初3失败/12通过：59/60/79分仍选择“建议通过”，新规则正确返回409。测试改为真实预览并确认，保留原评分/结论断言，关联回归最终90项通过、退出0。命令：

```sh
backend/.venv/bin/pytest backend/tests/test_rule_snapshot_api.py backend/tests/test_publish.py backend/tests/test_rls_workflow.py backend/tests/test_rls_children.py backend/tests/test_rls_end_to_end.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_termination_reassignment.py backend/tests/test_file_access.py backend/tests/test_thesis_integrity.py backend/tests/test_access_logging.py -c backend/pyproject.toml -q --tb=short --show-capture=no
```

两组73+90为不重叠定向/关联测试，不是后端全量；本模块按计划未重跑整个后端套件。两条警告来自crypt/argon2依赖弃用。

## 浏览器、迁移与恢复

迁移历史null保持、已有回执拒绝降级、实际恢复已包含在上表73项通过中。恢复核对包含原结果和更正结果的JSON内容摘要，33张表的RLS/权限清单未增加表。没有操作真实历史数据。

浏览器为本机Chrome（Playwright，headless），真实模式Vite5177→隔离后端8013，场景accepted。后台通过临时0600文件设置随机种子密码，未打印秘密。启动命令：`backend/.venv/bin/python .superpowers/sdd/2026-10-12-e02-review-comment-checks/browser_server.py`；前端在frontend执行 `VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:8013 node_modules/.bin/vite --host 127.0.0.1 --port 5177`。

| 浏览器操作 | 结果/证据 |
| --- | --- |
| 短评与手机号格式提示、按类确认；emoji后选中正确原文字段 | PASS；[原评阅检查](evidence/2026-10-13-e02/original-checks.png) |
| 修改分数后旧提示/确认清空，最终提交重新禁用 | PASS；[机器断言记录](evidence/2026-10-13-e02/browser-results.json) |
| 浏览器中断检查请求，出现错误且不允许提交；恢复网络重试后提交81分 | PASS；[失败重试](evidence/2026-10-13-e02/network-retry.png) |
| 学校看到匿名检查摘要，无专家姓名/确认人ID | PASS；[学校摘要](evidence/2026-10-13-e02/school-anonymous-receipt.png)，API测试另验证无confirmed_by |
| 专家申请→平台批准→回填分项评语→检查确认→提交83分更正 | PASS；[更正检查](evidence/2026-10-13-e02/correction-checks.png) |
| 学校核对新版只含手机号提示，确认生效后摘要同步切换新版 | PASS；[学校更正对比](evidence/2026-10-13-e02/school-correction-receipt.png)及机器断言记录 |

验收截图中的号码是虚构测试文本；规则只提示，专家确认后保留原文，未进行自动替换。截图已实际打开检查。

结束时Chrome已关闭，两服务由SIGINT停止（进程退出130，正常shutdown日志），由acceptance环境自身清理本次资源。只读核对：schema `test_269c39a34aa14ff0aea9fb7da2451f72` 已不存在，测试rls临时角色数量0，独占存储和临时密码文件不存在，8013/5177无监听。未手工清理其他资源。

## 改动文件与自查

- 后端：新增`review/comment_checks.py`、`data/review-checks-v1.json`、迁移0023；修改review models/service、correction_router/service、dispatch/router、result/service，以及recovery_drill的原结果内容摘要清单。
- 前端：新增`api/reviewChecks.ts`、`ReviewCheckPanel.vue`、`ReviewCheckSummary.vue`；接入ReviewFormPane/ScoreDimensionInput/ReviewWorkspacePage、RealCorrectionPanel、ResultProcessingPage，扩充review/results/corrections API类型。
- 测试：新增`test_comment_checks.py`、`reviewChecks.spec.ts`；更新test_review、test_expert_workspace、test_supervisor_results、test_rule_snapshot_api、test_recovery_drill和realWorkspace.spec.ts的真实确认契约。
- 文档：本记录、E02 spec/plan、两期路线图、CURRENT与AGENT_HANDOFF；浏览器证据6份。

自查：原提交保持平铺字段，更正保持嵌套payload；ack只在传输层，纳入有ack请求的幂等摘要但不进入业务评语；无ack旧请求摘要不变。服务端重算，预览不落库，确认摘要随结果INSERT；更新触发器拒绝更改。旧结果null明确未检测；学校摘要剔除确认人及载荷哈希，不向专家注入隐藏作者信息。请求预览/正式提交沿用本人任务RLS和既有锁顺序，未改权限策略。

## 未覆盖项与下一步

未运行后端全量、生产迁移/部署、真实敏感词库、中文全面纠错、真实用户数据或全浏览器兼容测试。规则不是质量认证；人工确认可能保留风险文本。E03尚未实施，已具备按既有spec/plan执行本人历史评语相似提示的条件，保持本人范围。

最终工作树：92个已跟踪修改、206个未跟踪文件；HEAD仍39a8962。初始280个状态路径全部仍在，未删除/还原此前工作。完整状态清单见忽略目录 `.superpowers/sdd/2026-10-12-e02-review-comment-checks/final-status.txt`，同目录接手须保留全部工作树。
