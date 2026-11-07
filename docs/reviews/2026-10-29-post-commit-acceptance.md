# 提交后本地验收

日期：2026-10-29。结论：**已批准E01–E10范围本地验收通过；本轮发现并补修2处问题，未部署。**

## 提交与边界

用户授权“先提交当前完成的代码和文档，再验收”。分支`codex/slice-7a1-file-integrity`；先将原46个已跟踪修改、81个未跟踪文件（共127个）提交为`d71b4121dec7fe264f23d3e1fe7cc3023f07bf88`，父提交`80ce25c`，没有回退。随后验收及本记录中的补修作为后续提交保存。

数据库全程仅`127.0.0.1:5433/paper_review_test`的自有隔离schema；迁移头仍0027，36张业务表FORCE RLS。没有迁移开发库、导入正式资料、推送或部署。原始材料未修改，`.env`、密钥、临时密码和备份未纳入提交。原有日志提交时仅规范行末空白。

## 发现与补修

1. **PDF清理异常覆盖业务错误。** Docker不存在，或转换/create失败后inspect再超时，原本503/422被FileNotFoundError/TimeoutExpired覆盖；转换成功但rm失败也会抛未处理异常。新增4个回归先全部失败，其中Docker不存在使用真实子进程及空PATH复现。`transform_runtime.py`只在清理边界捕获系统/子进程异常：保留正在传播的原错误；成功转换但清理失败返回明确503；日志仅记临时容器标识和异常类型。仍须核对本次owner标签才删除容器，原60秒/512MiB/禁网/非root限制、锁序、RLS不变。修复后4项通过，与全部现有PDF转换测试合跑19项通过，含真实Docker转换、超时清理、权限/并发及恢复。
2. **真实派单详情渲染空演示字段。** 截图出现空白的学校/论文类型/关键词等栏目、“第 轮”及重复代码“0812 · 0812”。真实队列接口并未提供这些演示字段。新增页面测试先失败，面板改为仅渲染实际提供的字段，代码与名称相同时只显示一次。保持现有接口、权限和演示完整资料的展示；无新增元数据读取。定向6项、随后全前端524项及浏览器通过。[修复前截图](evidence/2026-10-29-post-commit/ranking-before-detail-fix.png) / [修复后截图](evidence/2026-10-29-post-commit/ranking.png)。

本轮应用改动仅`backend/app/modules/files/transform_runtime.py`、`frontend/src/modules/dispatch/components/DispatchDetailPanel.vue`；对应`backend/tests/test_pdf_runtime_errors.py`和`frontend/src/modules/dispatch/__tests__/candidateRanking.spec.ts`增加回归。其余为状态文档、报告与证据。

## 实际命令与结果

工作目录为仓库根；标注前端的命令在`frontend`执行。完整输出仅去除终端颜色和行末空白，未改写结果。

| 命令 | 退出码 | 结果与版本范围 |
|---|---:|---|
| `./scripts/check.sh` | 0 | **d71b412**后端524通过/3条弃用警告，1683.33秒；前端74文件523通过；类型与真实构建通过；脚本总1710.19秒。[日志](evidence/2026-10-29-post-commit/full-check.txt)、[提交/时间记录](evidence/2026-10-29-post-commit/full-check-result.json) |
| `backend/.venv/bin/pytest .superpowers/sdd/2026-10-29-post-commit-acceptance/test_pdf_runtime_errors.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 1 | 修复前4项按预期失败。[红灯](evidence/2026-10-29-post-commit/runtime-red.txt) |
| 同上改为`backend/tests/test_pdf_runtime_errors.py` | 0 | 修复后4项通过。[绿灯](evidence/2026-10-29-post-commit/runtime-green.txt) |
| `backend/.venv/bin/pytest backend/tests/test_pdf_runtime_errors.py backend/tests/test_pdf_transforms.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 补修后19项通过，21.82秒。[PDF回归](evidence/2026-10-29-post-commit/pdf-regression.txt) |
| 前端：`node_modules/.bin/vitest run src/modules/dispatch/__tests__/candidateRanking.spec.ts --maxWorkers=4` | 1 | 详情显示新用例失败，原3项通过。[红灯](evidence/2026-10-29-post-commit/dispatch-detail-red.txt) |
| 前端：`node_modules/.bin/vitest run src/modules/dispatch/__tests__/candidateRanking.spec.ts src/modules/dispatch/__tests__/dispatchWorkbench.spec.ts --maxWorkers=4` | 0 | 详情修复后新旧6项通过。[定向回归](evidence/2026-10-29-post-commit/dispatch-detail-green.txt) |
| 前端：`node_modules/.bin/vitest run --maxWorkers=4` | 0 | **最终74文件524项全部通过**，20.57秒。[日志](evidence/2026-10-29-post-commit/frontend-final.txt) |
| 前端：`node_modules/.bin/vue-tsc --build` | 0 | 补修后类型检查通过。[命令结果](evidence/2026-10-29-post-commit/frontend-final-results.json) |
| 前端：`VITE_DEMO_MODE=false node_modules/.bin/vite build` | 0 | 补修后真实构建通过；依赖PURE注解提示非阻断。[构建日志](evidence/2026-10-29-post-commit/build-final.txt) |
| `node .superpowers/sdd/2026-10-29-post-commit-acceptance/browser-materials.cjs` | 0 | 真实Chrome材料链5组通过 |
| `node .superpowers/sdd/2026-10-29-post-commit-acceptance/browser-columns.cjs` | 0 | 三处真实表格3组通过；详情补修后重跑通过 |
| `node .superpowers/sdd/2026-10-29-post-commit-acceptance/browser-e10.cjs` | 0 | 业务链9组通过；详情补修后新数据重跑通过，增加真实详情断言 |
| `backend/.venv/bin/python .superpowers/sdd/2026-10-29-post-commit-acceptance/check_cleanup.py` | 0 | 两轮自有资源清理核对；最终全部服务关闭 |
| 文档链接检查 / `git diff --check` | 0 | 初次提交16份Markdown的189个本地链接有效；最终暂存内容另检查 |

后端补修后只重跑受影响的PDF模块；19项包含原524项中的15项和新增4项，**不能相加为543项，也不是修复后528项一次全量通过**。后端其余业务代码未改。前端发生后续显示补修，所以全量、类型和构建重新执行。没有删断言、放宽权限或回退提交。

执行中有两次工具编排偏差，均保留记录：首次浏览器早于虚构数据环境就绪，context文件尚不存在，业务场景未运行；等待8013与context就绪后完整通过。另一次前端补测错误地给整个Vitest设置`VITE_DEMO_MODE=false`，导致81个依赖演示模式的测试失败（443通过）；恢复仓库标准测试环境后524通过，真实模式开关仅用于构建和浏览器服务。没有以改业务/测试断言修正该编排问题。[浏览器启动记录](evidence/2026-10-29-post-commit/browser-start-before-ready.txt)、[环境偏差摘要](evidence/2026-10-29-post-commit/frontend-wrong-test-env-summary.txt)。

## 浏览器与恢复证据

实际Chrome headless，真实API、非owner业务角色、临时随机登录密码、全虚构数据。没有用HTTP调用冒充页面操作。共17组不同场景，3组列表和9组业务链在详情补修后重跑；材料模块此后没有改动。

- [材料5组](evidence/2026-10-29-post-commit/materials/browser-results.json)：合并/提取/删页、确认前保留旧绑定、确认后新绑定和旧报告失效、重检绑定新文件、取消预览保留当前材料、窄屏预览。
- [列表3组](evidence/2026-10-29-post-commit/columns/browser-results.json)：学校论文、专家任务、平台候选表格的显隐、真实拖动、键盘排序/焦点、刷新保存、重置、390px表格内部横向滚动；无整页横溢。
- [业务9组](evidence/2026-10-29-post-commit/browser-results.json)：10/5/0解释排序、19分回避者禁选、旧候选409刷新清空、0分人工派单、在途改派、CSV并发版本冲突及重新确认、专家评阅提交、80→68更正与学校确认、分布/时间范围、学校不能查看专家身份。详情补修后另断言只显示提供的字段。
- 页面异常均0；查看了真实PDF预览、窄屏材料、候选排序及评语面板截图。[评阅宽度](evidence/2026-10-29-post-commit/review-layout.json)：桌面1440/窄屏390，均无整页横溢。
- 全量后端包含36表RLS、实际备份恢复和资源所有权保护；PDF专项再次覆盖派生材料恢复。本轮未对目标部署环境执行恢复。
- [最终清理](evidence/2026-10-29-post-commit/cleanup.json)：自有schema/角色各0，临时存储/密码不存在，8013/5177均关闭，PDF转换容器0。第一轮已在重新创建虚构环境前清理，见[中间核对](evidence/2026-10-29-post-commit/cleanup-before-restart.json)；该时刻保留前端服务供下一轮使用。

[环境版本](evidence/2026-10-29-post-commit/tool-environment.json)、[浏览器命令记录](evidence/2026-10-29-post-commit/browser-runs.jsonl)。重放脚本随证据保存；使用本机既有Playwright/Chrome位置，需先启动脚本中的自有验收环境，再启动5177真实前端代理8013。不能针对现存业务库运行这些虚构数据脚本。

## 未覆盖与后续

本次可作为本地虚构数据试用的依据，未发现仍待处理的阻断项；不表示不存在未知bug。没有执行正式数据导入、目标主机部署/恢复、大规模压测、Safari/Firefox或真实移动设备兼容测试。导师/管理员页面本轮未重新做浏览器矩阵，其权限仍由全量后端/前端回归覆盖。E03正向相似命中本轮沿用模块浏览器证据与自动化测试，本轮更正链验证检查/编辑失效/重查提交流程。

两期仍是E01–E10的10/10模块，不表示原始22条需求全部实现。评语审核词表仍为空；规则推荐、字面检查、人工导入均不宣称AI或实名认证。真实上线仍需T09-B/T10-B/T11-B的主机/域名TLS、凭据、存储备份、RPO/RTO、账号角色名单及放行授权；本次没有自动推进B阶段或L01–L07。
