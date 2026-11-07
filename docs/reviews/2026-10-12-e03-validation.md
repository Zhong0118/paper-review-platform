# E03 本人历史评语相似性检查验收

实际执行日期：2026-10-13。状态：已本地验证。E03交付完成，非全平台查重或质量认证。

## 范围与实现

分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；保留全部已有工作树。按批准spec/plan inline执行，没有子agent、提交、推送、部署或原始材料修改。数据库仅5433/paper_review_test独立schema，开发库未迁移。

- 纯比较函数：NFKC（保留组合字符、连字扩展、Hangul及emoji的原文码点映射），比较时忽略空白/标点；去除版本化模板后不足20码点不比较。完全相同为EXACT；双方至少40码点，字符3-gram集合Jaccard≥0.85为SIMILAR，不对分数四舍五入后判定。返回当前稿公共片段；不返回历史候选身份、全文或跳转链接。最高相似度保留实际计算值，即使未达到提示阈值。
- 模板初版仅现有固定结论标签“建议通过/建议修改/不通过/修改后通过”，不把一般学术批评擅自当模板。`review-checks-v1.json`文件保留路径，内容版本升级`review-checks-v2`，相似规则`own-history-v1`。审核错词词表仍0条。
- 语料取当前用户关联专家本人、有效SUBMITTED任务，每任务仅当前有效结果（最新ACTIVATED更正优先），排除当前任务全部版本、取消/失效轮次及过期论文版本。以生效结果自身created_at取365天窗口，按日期/ID稳定排序，最多200条，多取一条判断truncated；原结果很旧但新更正刚提交时按更正日期判断。
- 生产查询始终使用受RLS约束的业务连接，已有权限足够，未新增表/迁移/RLS策略，迁移头仍0023，业务表仍33张。测试辅助函数只为本次拥有的虚构schema造数据；不参与生产查询。
- 两个review-similarity端点和原E02 review-checks端点共享完整检查。客户端只能传payload；不能指定候选、专家或租户。整次检查复用同一份配置快照，防止不同规则读到两个版本。
- 语料使用一条SQL的MVCC一致性快照；最终提交在既有论文→任务锁内重新查询和计算。排序后的有效result/revision ID及规则版本组成fingerprint，并绑定在rule_version与payload_hash内，复用check_ack协议；历史变化后的旧ack返回409。没有锁其他历史论文，没有增加锁顺序或宣称跨任务串行化。语料以该次最终检查的SQL快照为准，不承诺阻塞随后并发提交的其他任务。
- 相似性摘要独立写入`check_summary.similarity`，包含覆盖范围、指标、fingerprint及计数，不保存候选全文或当前命中片段到摘要/审计；学校仅沿用匿名提示code摘要。无历史明确NO_HISTORY，不能写成质量合格。

## 失败与修复

日志：忽略目录 `.superpowers/sdd/2026-10-12-e03-review-comment-similarity/`。

1. 算法缺失5失败→5通过；真实端点缺失404→接通本人语料后通过。
2. 首次虚构历史夹具违反一学生一批次约束；改为每条虚构历史使用独立批次，不改生产约束。随后纯算法与真实RLS共6项通过，201条语料最多检查200条，外专家、366天前和取消任务被排除。
3. 前端三个新用例首次失败→新增覆盖范围/指标/空历史文案后，与E02共9项通过。
4. 短文且无历史曾返回INSUFFICIENT_TEXT，新增反例失败→修为优先NO_HISTORY。纯比较读取文件的反例失败→比较函数改为无I/O，服务端注入配置。
5. 两次配置读取可能混用版本的反例失败→单次配置快照；未达到阈值的最高相似度曾显示0，反例失败→保留实际最高值。

## 实际验证

| 命令/范围 | 结果 |
| --- | --- |
| 后端初轮E03/E02/更正 | 44项通过，退出0 |
| 扩大回归：E03/E02/更正、review_integrity、expert_workspace、rule_snapshot_api、恢复test_restored_published_bundle_retains_rows_rules_and_files | 77项通过，退出0；之后补修配置快照和最高分，最终核心回归49项通过 |
| 最终E03/E02/更正核心回归 | 49项通过，退出0；日志final-core.log |
| 最后补充精确0.85及0.849舍入边界的纯函数验证 | 13项通过、3个DB用例不在本命令范围；退出0 |
| `cd frontend && node_modules/.bin/vitest run --maxWorkers=4` | 66文件、474项通过，退出0 |
| `cd frontend && node_modules/.bin/vue-tsc --build` | 退出0 |
| `cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build` | 退出0 |

实际命令（仓库根）：

```sh
backend/.venv/bin/pytest backend/tests/test_comment_similarity.py backend/tests/test_comment_checks.py backend/tests/test_result_corrections.py backend/tests/test_review_integrity.py backend/tests/test_expert_workspace.py backend/tests/test_rule_snapshot_api.py backend/tests/test_recovery_drill.py::test_restored_published_bundle_retains_rows_rules_and_files -c backend/pyproject.toml -q --tb=short --show-capture=no
backend/.venv/bin/pytest backend/tests/test_comment_similarity.py backend/tests/test_comment_checks.py backend/tests/test_result_corrections.py -c backend/pyproject.toml -q --tb=short --show-capture=no
backend/.venv/bin/pytest backend/tests/test_comment_similarity.py -k 'not real_rls and not correction_excludes' -c backend/pyproject.toml -q --tb=short --show-capture=no
git diff --check
```

最后一条diff检查退出0。环境沿用Python3.12.7、Node24.19.0、PostgreSQL16.15、Vitest4.1.10、Vite8.1.3。

后端命令统一使用 `backend/.venv/bin/pytest ... -c backend/pyproject.toml -q --tb=short --show-capture=no`。两条依赖弃用警告为crypt/argon2；构建依赖PURE注释位置警告不影响构建。测试集合有重叠，不将多个运行数量相加冒充独立通过数。没有重跑整个后端套件。

## 浏览器与未覆盖项

真实浏览器为Chrome（Playwright headless），真实模式Vite5177代理隔离后端8013；开始时通过测试fixture在本次schema创建两条本人虚构历史，过程中再增加一条以验证旧确认失效，未读写真实历史。

| 浏览器操作 | 实际结果 |
| --- | --- |
| 填入两条虚构本人历史相同的完整评语 | PASS：显示365天/200条范围、本次2条、命中2条，Jaccard1.000；无候选跳转链接。[截图](evidence/2026-10-13-e03/own-history-two-hits.png) |
| 确认提示后改字 | PASS：确认清空，最终提交禁用 |
| 中断检查请求再恢复 | PASS：错误不变成0命中；重试可恢复 |
| 检查后新增一条本人历史，再最终提交 | PASS：后端真实409，弹窗提示重查。[截图](evidence/2026-10-13-e03/stale-corpus-rejected.png) |
| 取消提交，重新检查并确认 | PASS：命中3条、提交80分成功。[截图](evidence/2026-10-13-e03/fresh-history-three-hits.png) |
| 申请更正→平台批准→再次检查→确认后提交81分更正 | PASS：仍只检查3条历史，没有把本任务的原结果当作第4条。[截图](evidence/2026-10-13-e03/correction-excludes-self.png) |

[浏览器断言记录](evidence/2026-10-13-e03/browser-results.json)含6条场景结果；首张截图已实际打开检查。更正激活后语料替换、旧结果超过365天但新更正进入窗口、跨专家直接SQL隔离由真实RLS集成测试覆盖，本轮浏览器没有重复学校激活步骤。

启动后端使用忽略目录中的`browser_server.py`，调用现有`acceptance_environment/serve`并仅用测试函数造历史；随机密码只存于临时0600文件，未打印或保存至交付证据。前端命令为`VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:8013 node_modules/.bin/vite --host 127.0.0.1 --port 5177`。

服务用SIGINT正常关闭（后端包装器退出0，Vite退出130），Chrome关闭。只读核对schema `test_1b6d3ca89a9a4570bd0d4bf7380ea8b0` 已不存在，隔离rls角色数0，所属临时存储及密码文件不存在，8013/5177无监听。资源由原验收工具清理，无手工清理现存资源。

未覆盖：没有真实数据、生产部署、跨专家检索、全平台查重、LLM或抄袭认定。并发历史在最终检查语料快照之后发生变化不会追溯撤销已经完成的检查。范围上限和模板都会造成覆盖不足，界面必须明确说明。

下一项E04（全部/近一年时间范围）尚未实施，已具备按既有spec/plan推进的条件。

## 改动文件与自查

- 新增`backend/app/modules/review/comment_similarity.py`、`backend/tests/test_comment_similarity.py`、`frontend/src/modules/review/__tests__/reviewSimilarity.spec.ts`。
- 修改E02的`comment_checks.py`、`review-checks-v1.json`，原提交`review/service.py`、更正`correction_service.py/correction_router.py`；增加相似性路由并复用受限查询/确认流程。
- 前端`api/reviewChecks.ts`、`ReviewCheckPanel.vue`、`ReviewCheckSummary.vue`增加范围、状态、指标和匿名类别文案。无新增跨任务链接或历史明文索引。
- 更新E03 spec/plan、总路线图、CURRENT/HANDOFF和本记录；新增5份浏览器证据。
- 自查权限未扩展，当前任务所有版本排除，最新已激活结果只取一次；配置和语料指纹绑定确认，失败不能成为COMPLETE；新语料/激活使旧确认失效，既有幂等重放仍保留原成功回执。论文→任务锁序、文件令牌和业务评分语义未变。没有新增数据库迁移。

最终工作树：92个已跟踪修改、215个未跟踪文件；HEAD仍`39a8962`。本轮开始的298个状态路径均保留，未删除或还原旧工作。完整清单在忽略目录`.superpowers/sdd/2026-10-12-e03-review-comment-similarity/final-status.txt`，同目录换模型须保留整个工作树。
