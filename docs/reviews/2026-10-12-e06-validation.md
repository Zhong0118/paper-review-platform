# E06 列设置与一期封板验证

实际执行日期：2026-10-26。状态：**LOCAL_VERIFIED**。E06-01～03完成，一期E01–E06已本地封板。

## 范围和基线

分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962c489163018a49ef5058171925c4faaa9d`。起始98项已跟踪修改、157项已有删除、239个未跟踪文件，全部保留；不回退，不提交/推送/部署。测试只使用本机5433/paper_review_test独立schema；原始材料和开发数据库未修改。

新增：
- `frontend/src/composables/useColumnPreferences.ts`
- `frontend/src/components/app/ColumnPreferences.vue`
- `frontend/src/components/app/__tests__/columnPreferences.spec.ts`

接线修改：`SchoolThesisTable.vue`、`ExpertTaskTable.vue`、`CandidateExpertTable.vue`，以及真实父页`PreparationListPage.vue`、`ExpertTasksPage.vue`、`DispatchWorkbenchPage.vue`。学校父页补一行最小宽度修复。

文档：本验收、E06 spec/plan、两期路线图、CURRENT、AGENT_HANDOFF、完整工作树清单和截图/浏览器结果。既有未提交工作不是本次新增。使用既有Vue和Element Plus图标，原生拖动，不新增依赖。无后端业务/权限/迁移改动。

## 执行环境

Python3.12.7、pytest9.1.1、Node24.19.0、Vitest4.1.10、Vite8.1.3、PostgreSQL16.15。版本来自本次实际命令/数据库只读查询。

## 已执行验证

命令从仓库根执行，前端命令在frontend目录运行。

| 命令 | 实际结果 |
|---|---|
| `node_modules/.bin/vitest run src/components/app/__tests__/columnPreferences.spec.ts` 初始 | exit1：测试文件已创建，但待实现的useColumnPreferences导入失败；属于实现缺失，不作为某个业务断言红灯 |
| `pnpm --dir frontend exec vitest …` | exit1：Corepack尝试写用户缓存，被沙箱拒绝；改为直接使用项目已安装可执行文件，没有安装依赖 |
| `node_modules/.bin/vitest run src/components/app/__tests__/columnPreferences.spec.ts` 实现后 | exit0：12 passed；增加边界断言和动画后14 passed（2.04s） |
| `node_modules/.bin/vue-tsc --build` 首次 | exit0 |
| `git diff --check` | exit0 |
| `./scripts/check.sh` | exit0：后端487 passed /2 warnings（834.52s）；前端500 passed /70 files；vue-tsc和真实构建exit0 |
| 窄屏修复后列偏好定向、vue-tsc、真实构建 | 全部exit0：定向14 passed（1.36s），类型和真实构建通过 |

定向覆盖：未知/重复列归一化、actions末尾、必要列和至少一个业务列、元数据保存、用户/角色/学校/表隔离、注销、旧版本新增列、损坏存储、存储失败与恢复默认、三表头/行一致、拖动/键盘重排及焦点、伪造费用列不显示。

## 实现自查

- 三个真实父页面传入当前用户；身份改变时同步加载对应偏好。键为`columns:v1:{userId}:{role}:{tenantId-or-platform}:{tableId}`，仅存schemaVersion/order/visibleIds，无记录、密码或token。
- 合法列由组件定义；真实专家/候选表的演示费用及负载字段不在可选列集合。服务端查询、租户、RLS、文件令牌和锁序均未改。
- actions固定末尾。学校论文标识、专家匿名任务编号、平台专家标识必须显示；表头和数据行消费同一visibleColumns。
- 控件含原生拖动、上下按钮、上下键重排、Escape关闭并归还焦点、恢复本表默认；有限动画支持减少动态效果偏好。窄屏保留表格内部横向滚动。

## 浏览器失败定位与修复

1. 首轮学校页390px视口出现整页宽度1010px。DOM诊断确认grid子项`.workbench`的自动最小宽度撑到994px，令表格滚动容器一起变宽。在该真实父页增加`min-width:0`后，整页390px、容器358px、表格内容992px，转为容器内滚动；三表浏览器检查随后通过。
2. 原E05虚构指标夹具的三个正式评分轮次仍为ACTIVE；E03只读取RESULT_READY/COMPLETED，正确返回零条历史。修正本次浏览器启动夹具为RESULT_READY，保留期望3条的断言，不改变业务历史范围。首轮隔离schema/角色/存储/临时密码均已清理。
3. 重跑中Playwright单步dragTo一次未产生任何drag事件。诊断记录events为空；改为等待面板有限动画完成并分步移动真实鼠标后，明确捕获dragstart(updated)→drop(student)→dragend，实际列顺序相符。未使用脚本直接改列顺序，也未修改应用拖动实现来绕过检查。

## 本轮真实浏览器矩阵

本机Chrome headless + Playwright，真实前端`VITE_DEMO_MODE=false`，API代理8013，前端5177。使用临时随机密码登录虚构账号，全部下列业务操作经页面完成；没有以HTTP请求替代浏览器操作。最终脚本exit0，8组PASS，pageerror为空。见[机器可读记录](evidence/2026-10-26-e06/browser-results.json)。

| 场景 | 本轮结果与证据 |
|---|---|
| 学校论文列设置 | PASS：隐藏专业、鼠标拖动、上下键与焦点、刷新保存、恢复默认、390px内部滚动；[设置](evidence/2026-10-26-e06/school-settings.png)、[窄屏](evidence/2026-10-26-e06/school-mobile.png) |
| 专家任务列设置 | PASS：相同交互矩阵，真实模式不出现费用；[设置](evidence/2026-10-26-e06/expert-settings.png)、[窄屏](evidence/2026-10-26-e06/expert-mobile.png) |
| 平台候选专家列设置 | PASS：相同交互矩阵，冲突专家仍禁选；[设置](evidence/2026-10-26-e06/candidate-settings.png)、[窄屏](evidence/2026-10-26-e06/candidate-mobile.png) |
| E05平台看板与候选选择 | PASS：在评3、已提交4，无评分分布；选择合法专家仍启用派单按钮（本轮未再次提交派单） |
| E04/E05学校范围与钻取 | PASS：全部在评2→近一年1，钻取一行且刷新保持范围；[看板](evidence/2026-10-26-e06/school-scope.png) |
| E02/E03更正提交检查 | PASS：三条本人历史命中、分档矛盾提示、逐类确认、编辑后确认失效，重查后可提交；[检查](evidence/2026-10-26-e06/comment-checks.png) |
| E01更正完整链 | PASS：专家申请→平台批准→专家提交→学校对照确认；学生确认前80，确认后68。无重新开放PDF，无学校泄露专家私有申请理由；[学校对照](evidence/2026-10-26-e06/school-correction.png)、[学生结果](evidence/2026-10-26-e06/student-corrected.png) |
| E05更正后的分布 | PASS：有效发布仍1篇、已提交仍4项，分布[0,1,0]，不会重复计数；[看板](evidence/2026-10-26-e06/corrected-dashboard.png) |

隔离资源只使用本次自建虚构schema。两轮后端均正常SIGINT退出，自动清理schema/三角色/存储和密码。最终只读检查：owned_schema_remaining=0、owned_roles_remaining=0、owned_storage_exists=false、temporary_password_exists=false，8013/5177均未监听。前端主动SIGINT退出130为停止服务结果，不是构建失败；既有Postgres容器保留运行。

实际浏览器命令（忽略目录为可重复执行启动器，不纳入版本控制）：

```sh
backend/.venv/bin/python .superpowers/sdd/2026-10-12-e06-table-column-preferences/browser_server.py
(cd frontend && VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:8013 node_modules/.bin/vite --host 127.0.0.1 --port 5177)
node .superpowers/sdd/2026-10-12-e06-table-column-preferences/browser-e06.cjs
backend/.venv/bin/python .superpowers/sdd/2026-10-12-e06-table-column-preferences/check_cleanup.py
```

## 验证边界

全量脚本已通过，其中包括迁移往返、33张表FORCE RLS、直接SQL越权、恢复CLI、实际恢复后发布读取，以及更正版本备份恢复；无新增后端文件或迁移。后端两条弃用警告来自crypt和argon2；构建有既有依赖PURE注释和包体积提示，未调整依赖或抑制警告。

仅覆盖指定三个表格、当前浏览器偏好，无跨设备同步；不宣称全平台列表均已支持。真实部署、正式数据迁移、生产恢复与负载测试未执行。E07–E10尚未实施。

过程日志位于git-ignored `.superpowers/sdd/2026-10-12-e06-table-column-preferences/`，最终可交接结论以本记录、测试源码及浏览器证据为准。


## 交接出口

E06已本地验收，一期6/6，增强模块6/10。这是按模块计数，不是工时完成比例。下一项E07论文敏感信息逐页定位，已有批准的spec/plan；以本次证据和保留工作树为入口，不回退、不重做一期。二期E07–E10尚未实施，真实环境B阶段仍待条件与授权。

全量exit0后仅增加学校页一行CSS修复；随后14项定向、类型、真实构建和完整8组浏览器矩阵均再次通过。未为该CSS变更重复运行13分钟后端全量。更换用户/角色/租户偏好隔离与损坏存储通过组件测试，本轮浏览器三账号为不同表格，未做同表不同账号及跨设备同步验证。E01驳回/取消/并发、六角色完整矩阵本轮未逐项浏览器重跑，相关后端自动用例已包含在487项内。E02词表仍0条，不把规则提示当作完整错别字检测。

完整工作树路径与计数见[2026-10-26-e06-worktree-status.md](2026-10-26-e06-worktree-status.md)。保留所有已有修改和删除；无提交、推送或部署。
