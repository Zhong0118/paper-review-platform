# E04 全部／近一年论文列表范围验收

实际执行：2026-10-13。状态：已本地验证。E04完成；生产部署未执行。

## 范围与口径

分支codex/slice-7a1-file-integrity，HEAD39a8962，保留全部既有工作树。inline执行，无子agent、提交、推送、部署或原始材料修改。数据库仅5433/paper_review_test自有隔离schema，开发库未迁移。

近一年按论文created_at：上海当前日期回溯一个公历年，从当日00:00起；闰日取上一年当月末，下界包含，上界为服务端请求as_of，未来数据排除。all保持旧行为。updated_at、改派、评阅及发布日期不改变所属范围。

学生论文及结果选择、学校准备/进度/结果、平台派单、专家任务、导师已发布论文共8个真实页面使用共享选择器。名录、系统用户、词典、异议待办不被该范围隐藏。列表形状未包装，响应附X-Time-Scope/X-Time-From/X-As-Of；统计仍用同一范围的列表行计算，E05看板未实现。深链接及详情继续按原权限处理。

前端URL优先，localStorage偏好按userId/role/tenant区分；换账号即使范围相同也重新加载，登出清空范围内存。过期响应的列表、数量及日期meta都有generation守卫。近一年显示未结旧论文可能隐藏的提示及服务端下界。

## 用户批准的权限补充

实际RLS测试发现拒绝任务仍可列出，但专家无法读其论文行：直接JOIN会漏项。保留all原查询后，past_year仍失败。用户明确批准“专家仅能判断本人任务所属论文创建日是否落在区间”的最窄boolean查询。

新增0024_expert_task_time_scope：固定SQL、固定schema/search_path、只读STABLE SECURITY DEFINER函数；业务角色仅EXECUTE，PUBLIC/认证角色无执行权。仅迁移owner拥有受本人专家关系限制的论文读取policy；业务角色原论文SELECT与文件权限不变。其他专家、学生、未知任务或反向区间返回false。没有新增表，仍33张FORCE RLS。规格中已记录批准内容。

## 实际失败与验证

日志位于忽略目录.superpowers/sdd/2026-10-12-e04-data-time-scope/。

- 日期函数5失败→5通过，含闰日、上海跨日、上下界与非法参数。
- 初次DB执行受沙盒本机TCP限制（Operation not permitted），改为受审查授权执行隔离pytest；不作为业务失败证据。
- 跨角色接口最初缺少响应头；接通后学校进度/导师参数漏传导致2失败/7通过，补齐后9通过。扩大原相关回归28通过。
- 前端偏好3失败→3通过；真实专家页面范围/竞态2失败→通过，追加同范围换账号1失败→修复。
- 首次前端全量470通过/10失败：旧测试误选新范围下拉框及缺少路由fixture；精确定位业务控件并补真实router后479通过/1失败。学校审核后刷新误清空选中项，修复为只在范围切换时清空，最终480通过（68文件）。类型检查和真实构建退出0。
- 拒绝任务真实API反例：all遗漏→恢复旧查询；past_year仍遗漏→用户批准后加入0024，日期测试首轮8通过。
- SQL负向、往返、RLS和恢复扩大检查47通过/1失败，仅旧迁移head断言过时。更新断言，并增加恢复后业务角色past_year调用。E02回执降级回滚的head断言也经真实失败后同步更新，未改变降级拒绝或RLS断言。

最终后端相关回归 **66项通过、退出0**（2条依赖弃用警告）；随后追加取消任务真实API专项 **1项通过、退出0**。两集合不重叠，共67项相关检查，未跑整个后端套件。最后命令：

```sh
backend/.venv/bin/pytest backend/tests/test_time_scope.py backend/tests/test_dispatch_objection_projection.py backend/tests/test_expert_workspace.py backend/tests/test_publish.py backend/tests/test_supervisor_results.py backend/tests/test_thesis_submit.py backend/tests/test_dispatch.py backend/tests/test_rls_end_to_end.py backend/tests/test_recovery_drill.py backend/tests/test_comment_checks.py -c backend/pyproject.toml -q --tb=short --show-capture=no
```

前端命令在frontend目录：vitest run --maxWorkers=4、vue-tsc --build、VITE_DEMO_MODE=false vite build。历史中间运行有重叠，不重复相加。最后`git diff --check`退出0。类型/真实构建退出0；构建依赖PURE注释位置警告不影响完成。

## 浏览器与限制

Chrome的MCP启动在当前沙盒中SIGABRT/EPERM；改为受自动审查授权的本机Node/Playwright脚本，真实Chrome验收最终通过。首轮等待导师下拉框中隐藏option超时，改为核对实际可见select控件后在新的自有场景完整复跑，没有修改业务代码。

命令：`node .superpowers/sdd/2026-10-12-e04-data-time-scope/browser-e04.cjs`，退出0；结果`{"browser":"PASS","scenarios":7}`。真实Vite5177代理自有隔离后端8013。测试将一篇虚构论文created_at设为2024-01-01，updated_at/任务/评阅/发布均为当前时间，验证采用论文创建日。浏览器实际点击控件，同时核对收到的API响应及页面显示，不以HTTP替代页面操作。

| 浏览器场景 | 实际结果/证据 |
| --- | --- |
| 学生从全部切近一年，老论文隐藏；提示与服务端下界显示，刷新保持 | PASS；[学生范围](evidence/2026-10-13-e04/student-past-year.png) |
| 换学校账号默认全部，准备/进度共用学校偏好；进度1行/1在评切成0行/0在评 | PASS；[学校全部进度](evidence/2026-10-13-e04/school-all-progress.png) |
| 平台派单队列全部包含该旧未结论文，近一年为空 | PASS |
| 专家任务列表近一年隐藏旧任务，直接评阅深链接仍可进入并正式提交80分 | PASS |
| 学校结果选择近一年为空，切全部可核对并发布旧论文 | PASS；[学校发布](evidence/2026-10-13-e04/school-published-all.png) |
| 导师刚发布的旧论文仅在全部中出现，未因发布日期重新进入近一年 | PASS；[导师范围](evidence/2026-10-13-e04/supervisor-past-year.png) |
| 学生个人偏好仍为近一年，切全部可读结果；带旧thesisId的显式详情链接可在近一年范围外显示80分 | PASS |

[机器断言记录](evidence/2026-10-13-e04/browser-results.json)包含7条结果。截图已实际打开检查。拒绝/取消任务、越权SQL及迁移恢复由真实隔离API/SQL测试覆盖，本轮浏览器未单独造拒绝任务。

Chrome已自动关闭，后端包装器退出0、Vite SIGINT退出130，均正常shutdown。只读核对schema `test_a9bc1e4a7ef94ecdae0397d60b4b9b49` 不存在，rls临时角色数0，所创建存储和0600临时密码文件不存在，8013/5177无监听。此前失败浏览器场景同样由原acceptance工具清理，未手工清理现存资源。

未覆盖生产迁移、部署、真实数据及全浏览器兼容性。E05尚未实施，已具备按现有E05规格与计划开工的条件。

## 改动与自查

新增：backend/app/shared/time_scope.py、0024迁移、backend/tests/test_time_scope.py；frontend/src/api/timeScope.ts、useTimeScope.ts、TimeScopeSelect.vue和两份timeScope测试。本记录及5份浏览器证据。

修改：thesis/dispatch/result的列表服务及router；前端request响应头读取、theses/schoolReview/dispatch/expertTasks/results的列表参数，8个真实页面。旧前端测试改为明确选业务下拉框并提供router，保持原断言；恢复/确认摘要测试按实际0024 head核对，并验证恢复后的日期查询。E04 spec/plan、路线图、CURRENT/HANDOFF更新状态。

自查：日期过滤与权限过滤组合；无客户端租户/任意日期参数，原响应形状保持；未归档、删除或改变实际业务数据。all保留原专家任务读取路径，拒绝/取消任务的past_year使用获批boolean谓词；普通业务连接不能读这些论文行或材料。owner函数固定SQL/search_path、最窄ACL与本人关系检查，直接SQL负向、PUBLIC/认证角色ACL、迁移往返和实际恢复均通过。未结旧任务隐藏提示、账号隔离、过期响应守卫、默认兼容和详情深链接均有证据。

最终工作树：95个已跟踪修改、229个未跟踪文件；HEAD仍`39a8962`。本轮开始307个状态路径全部仍保留；完整状态清单在忽略目录`.superpowers/sdd/2026-10-12-e04-data-time-scope/final-status.txt`，没有回退或删除旧工作。
