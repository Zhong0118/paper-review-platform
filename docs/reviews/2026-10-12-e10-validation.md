# E10 可解释专家候选推荐验收

执行日期：2026-10-28至2026-10-29。状态：**已本地验收；两期增强10/10（一期6/6、二期4/4）**。

分支 `codex/slice-7a1-file-integrity`，HEAD `80ce25c92485a5e1d2ffc59d2cbe57bb712ecf0a`。保留原有E08/E09工作树，无提交、推送或部署。数据库仅本机5433/paper_review_test自有隔离schema，未迁移开发库。E10无新迁移，沿用0027/36表FORCE RLS。

## 实现范围

- 平台候选使用已有标题、摘要、关键词与专家明确标签评分。NFKC、去首尾空格、小写及去重后，方向完整文字命中每项3分（最多15），关键词精确交集每项2分（最多10）。解释只返回实际计分的标签，分值可手算；无全文读取、外部模型或额外权限。
- 可执行当前操作的候选优先，再按分数降序、UUID升序。旧空标签档案0分仍可派；命中回避、资格/接单状态不符或轮次不可操作时保留原因，默认折叠且禁选。账号无效者沿用旧逻辑排除。
- 候选返回规则版本、专家档案版本、论文版本和计分标签。派单/改派带可选专家版本，原有锁后重新检查版本和硬门禁；旧客户端省略版本仍执行最新门禁。幂等载荷包含实际提供的版本，省略时保持旧载荷。
- 页面展示规则分及解释，明确其不是概率；409后刷新并清空选择，要求人工重新确认。当前已有邀请/在评任务时仍可改派；新增`allowed_actions`区分ASSIGN_EXPERT和REASSIGN_EXPERT，不允许在已占席位上新增派单。

锁顺序、RLS与token语义不变。候选仅平台审核员可读；学校、专家、学生、导师与管理员均无候选读取权限。

## 文件

后端新增`app/modules/dispatch/candidate_ranking.py`及`tests/test_candidate_ranking.py`，修改dispatch service/router。前端修改dispatch API、CandidateExpertTable、DispatchWorkbenchPage，新增candidateRanking.spec.ts。另将旧`test_dispatch_result_integrity.py`的HTTP夹具切换到已有非owner角色环境，数据库故障注入仍用独立管理连接，保留原断言。收口补修涉及thesis service/detector、ReviewCheckPanel与DispatchDetailPanel说明，以及test_dispatch、test_comment_checks、test_rls_children、test_thesis_integrity、dispatchWorkbench/realDispatchObjections测试契约。

## 失败与定向验证

1. 新后端4项先失败于缺少评分/版本字段及空评分占位；前端3项先失败于缺少解释和版本提交。实现后后端4通过，前端新旧派单3文件7通过，类型检查通过。
2. 扩大后端首轮32通过/9失败，9项均发生于旧测试超级用户HTTP环境的派单响应生成。临时诊断确认`assign`成功而`serialize_thesis`抛RESOURCE_NOT_FOUND：超级用户绕过RLS读取到了平台不应读取的匿名核验记录。复用已有真实角色夹具后，完整性模块10项全部通过（99.72秒），没有放宽权限或删除断言。
3. 补充资格变更后旧版本409、无版本请求仍拒绝，以及改派幂等重放/版本载荷变化的验证。

4. 首次统一脚本运行至142通过/7失败时主动SIGINT停止（退出2，517.03秒），未作为全量通过。修复标题核对提示缺少兼容`location`字段；在论文序列化中显式限定仅学生/学校读取检测详情（与现有RLS边界一致），避免平台响应触发检测权限拒绝或返回身份发现。旧迁移测试改为验证当前0025报告保护先阻断、事务回滚保留0027；另新增独立0023用例，保留原“不能丢弃评语检查记录”断言。五个相关文件34项通过（57.86秒），覆盖这7项失败与E10核心。
5. 前端首轮全量520通过/3失败：旧函数调用断言缺少可选版本参数，学校页面测试详情缺少实际接口始终存在的anonymization/files字段。修正测试契约后相关17项通过，未修改终止/派单断言。
6. 浏览器截图复现评阅检查版本长标识撑宽页面：1440px窗口实际宽1671px。检查面板增加最小宽度及长文本换行，重测页面宽1440px，完成正式提交及更正。原浏览器脚本漏填必填“修改建议”时按钮正确禁用，补齐虚构意见后才提交，没有放松校验。

7. 第二轮统一检查实际完整运行后端：519通过/5失败，1657.74秒，退出1。5项分别为旧RLS矩阵仍预期平台读取匿名报告，以及4项旧并发测试直接调用服务却未绑定已验证身份。将平台读取数收紧到0，为直接调用会话绑定真实登录token的身份；不改权限或锁断言。补验整个论文完整性模块及该RLS场景13项全部通过（47.39秒）。本次未把第二轮脚本记作退出0，后续前端、类型和构建独立执行。
8. 前端补跑522通过/1失败：新增行过渡后，默认TransitionGroup测试替身不生成真实tbody，旧演示测试的tbody单选断言查不到元素。该测试改用真实TransitionGroup，保留原单选与派单断言；浏览器始终使用真实tbody。

## 浏览器与资源清理

- [材料链矩阵](evidence/2026-10-29-e10/materials/browser-results.json)：Chrome5组通过。实际合并/提取/删页、生成预览与确认应用分离、换文件旧报告失效及新报告绑定新文件；取消预览保留旧材料；窄屏PDF预览可用。
- [业务链矩阵](evidence/2026-10-29-e10/browser-results.json)：Chrome9组通过。10/5/0排序、19分回避者折叠禁选、双页面改档案导致409并刷新、0分人工派单、在途改派、CSV预览版本竞争、专家原评阅提交、80→68更正、发布分布与日期范围、学校不能读取专家身份。
- 脚本在自有虚构批次内创建材料与排名论文，避免同一学生同一批次重复有效论文；没有绕过该约束。两份脚本累计14组，业务链曾因漏填字段和显示溢出暂停；最后用全新自有数据从头完整跑通9组，最终截图和JSON均来自该完整运行，保留早期失败日志。桌面1440/窄屏390的页面宽度均等于视口宽度。
- [清理结果](evidence/2026-10-29-e10/cleanup.json)：自建schema和角色剩余0，存储及临时密码已移除，8013/5177服务均已停止。仅由原夹具清理其拥有的资源。

## 最终命令与结果

除前端命令外从仓库根执行；前端在frontend目录执行。日志见同一证据目录，运行脚本暂存`.superpowers/sdd/2026-10-12-e10-expert-candidate-ranking/`。

| 实际命令 | 退出码 | 实测结果 |
|---|---:|---|
| `backend/.venv/bin/pytest backend/tests/test_candidate_ranking.py backend/tests/test_expert_operations.py backend/tests/test_dispatch_result_integrity.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 1 | 首轮32通过/9旧夹具失败 |
| `backend/.venv/bin/pytest backend/tests/test_dispatch_result_integrity.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 真实角色夹具下10通过 |
| `backend/.venv/bin/pytest backend/tests/test_anonymization.py backend/tests/test_comment_checks.py backend/tests/test_dispatch.py backend/tests/test_dispatch_objection_projection.py backend/tests/test_candidate_ranking.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 34通过，57.86秒 |
| `./scripts/check.sh` | 1 | 第二轮完整后端519通过/5旧测试契约失败，1657.74秒；因此脚本没有继续前端，不声称统一脚本全绿 |
| `backend/.venv/bin/pytest backend/tests/test_thesis_integrity.py backend/tests/test_rls_children.py::test_published_children_follow_role_and_school_scope_without_task_read -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 补验13通过，47.39秒，覆盖全部5项失败及相邻并发场景 |
| 前端：`node_modules/.bin/vitest run --maxWorkers=4` | 0 | 最终74文件523通过，17.94秒 |
| 前端：`node_modules/.bin/vue-tsc --build` | 0 | 类型检查通过 |
| 前端：`VITE_DEMO_MODE=false node_modules/.bin/vite build` | 0 | 真实模式构建通过；依赖PURE注解提示非阻断 |
| `node .superpowers/sdd/2026-10-12-e10-expert-candidate-ranking/browser-materials.cjs` | 0 | Chrome材料链5组通过 |
| `node .superpowers/sdd/2026-10-12-e10-expert-candidate-ranking/browser-e10.cjs` | 0 | 最终新数据完整9组通过，页面异常0 |
| `backend/.venv/bin/python .superpowers/sdd/2026-10-12-e10-expert-candidate-ranking/check_cleanup.py` | 0 | 自有schema/角色剩余0，临时存储/密码和服务已清理 |
| `git diff --check` | 0 | 无空白错误 |

后端共524个用例已实际执行；完整运行后仅修正测试夹具/过时断言，再定向覆盖全部失败，未再重复27分钟全仓。13项补验与519项通过存在8项重叠，不能相加为532项，也不能写成一次524全绿。末尾没有修改后端应用实现。三条后端弃用警告涉及crypt、argon2版本接口及测试构造主动内容PDF的add_js，未屏蔽。

全量已实际覆盖36表RLS、备份/恢复和自有资源删除保护；E08派生材料、E09专家档案/导入记录均在恢复清单中。E10无新持久化表。环境见[环境版本](evidence/2026-10-29-e10/environment.txt)：Python3.12.7、Node24.19.0、Postgres16.15、Docker28.1.1、pypdf6.19.0、Chrome156.0.8078.49。

## 自查与未覆盖

- 评分仅使用已有元信息和专家标签；解释只含计分标签，没有PDF全文或摘要片段；没有对外请求/缓存/自动派单。返回规则版本用于页面显示，删除旧页面“历史质量匹配”的不实说明。
- 版本校验在现有专家锁后进行；单席位与改派回滚仍成立；幂等重放与载荷变化均实测。学校/专家等五个非平台角色不能读取候选，平台不能读取检测身份发现。
- 本次只验证虚构数据和本机环境，没有大规模专家库性能压测、正式数据导入、OCR、语义匹配/LLM或自动派单；评语词表仍为空。E06列拖动浏览器证据沿用原验收，前端相关测试已纳入本轮全量。
- 所有已发现失败均已解释并补验，无待确认的权限/令牌/锁序偏离。完整工作树见[文件清单](evidence/2026-10-29-e10/working-tree.txt)，最终为46个已跟踪修改、81个未跟踪文件，包含既有E08/E09，不把它们都算作本轮新改动。
- [两期交接](2026-10-29-enhancement-release-candidate.md)已补齐。下一步可用虚构数据进行人工体验验收；真实上线仍需T09-B/T10-B/T11-B环境输入及授权，不自动执行L01–L07或部署。
