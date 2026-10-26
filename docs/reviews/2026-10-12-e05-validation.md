# E05 真实评审运营看板验收

实际执行：2026-10-26。状态：LOCAL_VERIFIED。增强模块完成5/10，一期完成5/6；不代表上线完成。

## 基线与边界

分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962c489163018a49ef5058171925c4faaa9d`。开始时95个已跟踪修改、157个已有删除、227个未跟踪文件，全部保留。删除项不是本轮清理；原统计router已删除，因此新入口采用 `dashboard_router.py`，没有恢复其它占位文件。

按已批准规格inline执行，没有子agent、提交、推送、部署或修改原始材料。数据库只用本机5433/paper_review_test自有schema；测试及浏览器建库串行。无新增迁移、数据表或RLS策略，迁移头仍0024_expert_task_time_scope，33张业务表。开发库未迁移。

实际环境：Python3.12.7、pytest9.1.1、Node24.19.0、PostgreSQL16.15；浏览器为本机Chrome，Playwright驱动，VITE_DEMO_MODE=false。

## 实现与自查

- 学校 `GET /api/v1/school-review/dashboard` 返回待派论文、邀请中/评阅中/已提交任务数，本校当前有效发布分数分布和分母；平台同名dashboard只返回运营cards及meta，不查询发布分值，不返回评分/评语/作者字段。系统管理员、学生、导师、专家不可调用。
- 共用 `dispatch/projection.py` 读取当前论文版本的最新非取消轮次；终止论文排除，取消/拒绝任务不算有效任务，旧轮次和旧论文版本不计。待派条件与原ASSIGN_EXPERT条件一致；列表与看板共用同一投影，消除两套计数口径。
- 每次看板只发出一条业务SELECT，任务与学校最新发布分值共享Postgres语句快照。SQL只读，没有新增锁；请求中的原认证与RLS绑定沿用现状。集成用例捕获SQL，核对只有一次业务查询。
- 评分取当前轮次最新publication_no的发布快照，不取尚未发布的summary或更正稿。同一论文80→70更正激活后，分段替换而分母和已提交任务数都保持1。59/60/79/80真实发布样本分段为1/2/1。
- 逾期卡片返回null和NOT_CONFIGURED；学校进度旧totals.overdue也改为null，并返回overdue_status。没有配置截止规则时不展示假0。
- 复用E04论文created_at、公历年/上海日期和响应头。学校进度及平台派单列表新增 `status_filter=ALL|WAITING|INVITED|IN_REVIEW|SUBMITTED`，非法值422。保持原列表封装形式；学校增加as_of/filtered_count/status_filter。平台默认ALL保持原派单队列范围，明确SUBMITTED钻取才列出结果处理/已完成论文的任务状态，评分权限不变。
- 学校进度页和平台派单台复用TaskProgressSummary。卡片点击把time_scope/status_filter写入URL，实际重查列表。显示卡片与列表各自更新时间、当前计数，计数变化提示“数据已更新”；重复点击同一状态也刷新。范围切换的旧响应不会覆盖新数据。
- 指标和列表分别处理失败，指标失败不显示全0；提供重试。零数据是成功查询后的空态。分数分布明确“已发布论文”和每篇一次。沿用现有组件、原生meter和CSS动画，无新增依赖。截图复核后补齐列表按钮间距，并将平台真实模式说明收窄到已实现的运营指标；重新类型/构建和真实浏览器验证通过。

按requesting-code-review检查项在当前线程自查（用户要求不创建子agent）：核对角色白名单、RLS查询、字段去敏、状态过滤、参数绑定、时间口径、单语句快照、异步旧响应和正常空态。不是独立第三方审查，也不是全仓无bug结论。

## 失败→修复证据

日志目录 `.superpowers/sdd/2026-10-12-e05-review-operations-dashboard/` 为本地忽略目录。

1. 首次数据库测试因沙箱TCP限制失败；授权通道发现本项目Postgres容器停止，精确启动paper-review-postgres后重跑。前两次环境失败不计业务失败证据，不启动其它项目的5433容器。
2. `backend-red-running-db.log`：4条接口用例因dashboard不存在返回404；更正用例在准备数据时因缺少E02 check_ack返回409。补上真实review-checks与确认，不绕过校验。
3. `backend-green1.log`：4通过/1失败。冻结as_of早于数据库刚创建的样本，近一年依法排除“未来”论文；将该日期边界fixture的论文日期固定到明确的2026-10-25，旧样本保持2020。没有放宽时间上界。
4. `frontend-red.log`：5失败，缺少真实指标卡片、错误重试及钻取；实现后5通过。
5. `backend-regression.log`：39通过/1失败。旧测试要求overdue=0，与已批准NOT_CONFIGURED规格冲突；更新为严格断言null和NOT_CONFIGURED，未删除其它断言。
6. `selected-card-red.log`：重复点击已选卡片后仍保留旧列表，1失败/5通过；补刷新入口后6通过。最终关联前端66项通过。

## 实际命令与退出码

以下均为本次实跑，没有借用E04历史结果。数据库命令从仓库根运行；前端在frontend目录运行。

| 命令 | 结果/退出码 | 日志 |
|---|---|---|
| `backend/.venv/bin/pytest backend/tests/test_dashboard_metrics.py backend/tests/test_time_scope.py backend/tests/test_result_corrections.py backend/tests/test_dispatch_objection_projection.py backend/tests/test_dispatch.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 首轮39 passed/1 failed，退出1，原因见上 | backend-regression.log |
| `backend/.venv/bin/pytest backend/tests/test_dashboard_metrics.py backend/tests/test_dispatch.py backend/tests/test_dispatch_result_integrity.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 最终23 passed/2 warnings，退出0，含新增真实改派/终止、修正后的全部失败项 | backend-final.log |
| `node_modules/.bin/vitest run src/modules/school/__tests__/dashboardMetrics.spec.ts src/modules/school/__tests__/realProgress.wiring.spec.ts src/modules/dispatch/__tests__ src/modules/result/__tests__/realDispatchObjections.spec.ts src/components/app/__tests__/timeScope.spec.ts --maxWorkers=4` | 66 passed/8 files，退出0 | frontend-final.log |
| `node_modules/.bin/vue-tsc --build` | 退出0 | typecheck-final.log |
| `VITE_DEMO_MODE=false node_modules/.bin/vite build` | 退出0 | build-final.log |
| `git diff --check` | 退出0 | 实际终端输出 |
| `node .superpowers/sdd/2026-10-12-e05-review-operations-dashboard/browser-e05.cjs` | Chrome6场景PASS，退出0 | browser-run.log |

后端两组覆盖51个不同相关用例：原40项加1个生命周期用例和10个派单完整性用例；所有已知失败均已复验通过。没有宣称运行本轮后端全量或前端全量；E06的一期出口再执行统一全量。警告为既有crypt/argon2弃用提示和前端依赖PURE注解位置提示。

## 真实浏览器证据

[结构化记录](evidence/2026-10-26-e05/browser-results.json)：

1. 学校卡片待派2、邀请1、在评2、提交4，只有1篇已发布；同状态钻取正确，响应仅匿名任务，没有他校论文。
2. 近一年将旧论文排除，状态及范围刷新保留。
3. 卡片读取后，使用真实专家接单接口改变任务；再点击旧“邀请中1”卡片得到0，页面提示“数据已更新”。
4. 浏览器拦截指标请求模拟503，列表独立可用，卡片不显示假0；解除拦截后点击重试恢复真实数据。
5. 平台抓包严格白名单，无分数/评语字段；已提交钻取得到4条，包括结果处理和已完成状态；不请求学校指标接口。
6. 待派钻取仍可选择论文加载候选；390px手机宽度下卡片正常显示，无页面横向溢出。

已查看截图：[学校看板](evidence/2026-10-26-e05/school-dashboard.png)、[变化后列表](evidence/2026-10-26-e05/school-updated-list.png)、[平台已提交](evidence/2026-10-26-e05/platform-submitted.png)、[手机卡片](evidence/2026-10-26-e05/mobile-dashboard.png)。分数边界与更正换桶由真实RLS/API集成验证，本轮未在浏览器重复完整更正流程。

## 文件与资源

业务新增：
- backend/app/modules/dispatch/projection.py
- backend/app/modules/statistics/dashboard_router.py
- frontend/src/api/dashboard.ts
- frontend/src/composables/useOperationsDashboard.ts

业务修改：backend/app/api.py、modules/statistics/dashboard_service.py、modules/dispatch/service.py及router.py、modules/thesis/router.py；frontend/src/api/dispatch.ts、学校ReviewProgressPage/TaskProgressSummary、平台DispatchWorkbenchPage。

测试：新增backend/tests/test_dashboard_metrics.py和frontend/src/modules/school/__tests__/dashboardMetrics.spec.ts；调整backend/tests/test_dispatch.py逾期契约。交付文档：本记录、四张截图/JSON、E05 spec/plan、路线图、CURRENT/HANDOFF。

验收服务经SIGINT正常退出，由原acceptance工具清理自有schema/角色/存储；只读复核结果：本次schema剩余0，临时rls角色剩余0，存储目录不存在，随机临时密码文件已删除，8013/5177均不监听。没有手工清理已有数据；本机paper-review-postgres容器保持运行，便于后续开发。

最终工作树为98个已跟踪修改、157个已有删除、239个未跟踪文件。完整初始/最终工作树清单位于本地执行目录的initial-status.txt/final-status.txt。核对初始脏路径全部仍存在于最终状态；不将既有157项删除计作本轮改动。

## 未覆盖与下一项

未进行大数据量性能压测、生产部署、多浏览器兼容、全仓独立审查；没有真实截止规则/自动催审、AI分析或跨校评分。保留现有单专家业务边界。

E06具备开工条件：复用现有列表实施列显示/顺序偏好，随后按E06计划做一期全量验收。E06尚未实现，二期E07–E10仍待执行。真实部署B阶段仍需用户提供环境条件和最终授权。
