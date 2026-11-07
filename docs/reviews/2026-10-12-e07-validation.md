# E07 论文敏感信息逐页定位验收

实际执行：2026-10-26。**已本地验证，E07-01/02/03 完成。** 文件日期沿用已批准模块编号日期。

分支 `codex/slice-7a1-file-integrity`；HEAD `39a8962c489163018a49ef5058171925c4faaa9d`，没有提交、推送或部署。开始时保留99个已修改、157个已删除和256个未跟踪文件；删除均为既有工作。本次没有更改 `docs/99_原始材料`，未迁移开发业务库。完整状态另见[工作树快照](2026-10-26-e07-worktree-status.md)。

## 已交付范围

- `extract_pdf_pages` 保留物理页序号、逐页文字和提取不确定性；旧 `inspect_pdf` 三元契约保持。身份姓名、学号和导师检查保留，跨页断开的身份词仍会阻断，页码指向命中起始物理页。文件名和文件元数据不虚构页码，上下文最多120码点。
- 学校维护最多200条字面词，默认WARN，支持BLOCK和说明；2–64码点、空白、重复、版本冲突均校验。没有内置官方敏感词库，不执行正则。
- 学生可对本人草稿匿名版检测，学校可检测本校草稿/准备中材料。`file_id` 必须是当前匿名材料绑定；原版、别校、随机ID或非授权角色不允许检测。版本冲突409。
- 报告绑定论文版本、文件ID/SHA256、检测器版本及词表版本。额外记录检测输入摘要，覆盖标题/摘要/关键词或核验身份变化但论文版本ID不变的情况。旧报告缺少来源时显示失效，不假装回填。
- 学校确认PASS前重查来源和文件完整性；词表WARN需人工理由，BLOCK和身份命中仍FAIL。仅标题文字未找到为提示，不增加匿名阻断。既有已经完成的人工确认/派单不因词表更新被自动撤销。
- 学生“保存并检测匿名版”实际保存文字、上传所选匿名PDF、调用真实接口。学校核验区域展示报告与重检按钮。按页分组，可读取受控文件并在浏览器PDF阅读器中跳页；切换记录、换文件、编辑或退出时清除旧预览。没有公开文件链接或持久化正文到浏览器设置。
- 标题仅做前两页NFKC/去空白后的文字核对；不宣称论文语义一致。扫描、空白、图片或不可靠提取仍需要人工核验。

## 实施细化与权限自查

1. 学校入口落在现有 `PreparationListPage` 的匿名核验区域；规划中的 `ReviewProgressPage` 并非实际审核按钮所在处，未重复建设页面。
2. 迁移头为 `0025_sensitive_locations`，新增 `tenant_sensitive_terms`，共34张业务表均FORCE RLS。学校只读写本校词表；学生及其他角色不能直接SELECT完整词表。
3. `match_sensitive_terms` 为受限SECURITY DEFINER函数：验证当前真实身份、本人/本校论文、当前匿名文件关联，只返回输入文本命中的词条和版本，不返回未命中词表；PUBLIC和认证库角色无EXECUTE。固定search_path，显式schema引用，所有者仍受RLS约束。此为已批准学生本人材料检测的数据库实现。
4. `anonymization_checks` 详细发现仅学生本人和本校审核可读；平台、专家、导师、系统管理员不能取得身份命中内容。学校增加本校报告插入权限以支持重检。
5. 报告创建/确认先持论文锁，再持本校词表事务锁；配置更新只持词表锁，不反向锁论文。没有改变论文→任务锁顺序或文件token语义。
6. 审计只增加计数、检测版本、词表版本，不新增命中姓名或整页正文。恢复清单包含词表、来源元数据及内容摘要；有配置/绑定报告的破坏性降级被拒绝，事务回滚后FORCE RLS仍有效。
7. 自查补修：用户在前端移除匿名材料后，不能继续检测服务器上的旧文件；移除待上传文件同时清除相应待上传对象。真实模式上传说明不再沿用“仅保存元数据”的演示文案。

## 测试与实际命令

环境：Python3.12.7、pytest9.1.1、FastAPI0.141.1、SQLAlchemy2.0.52、Alembic1.19.1、pypdf6.19.0、Node24.19.0、PostgreSQL16.15、Chrome156.0.8078.48。没有新增第三方依赖。

后端命令在仓库根执行；仅连接 `127.0.0.1:5433/paper_review_test`，每个数据库fixture建立独立schema/运行角色。没有同时运行数据库迁移和浏览器验收实例创建。

```sh
backend/.venv/bin/pytest backend/tests/test_sensitive_locations.py backend/tests/test_pdf_validation.py backend/tests/test_file_lifecycle.py backend/tests/test_rls_end_to_end.py backend/tests/test_rls_roles.py backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short --show-capture=no
```

**退出0，65 passed，2 warnings，88.07秒。** 包含11项E07测试，以及PDF校验、文件生命周期、非所有者真实RLS、迁移ACL/往返/拒绝有数据降级、备份完整性与恢复回读。测试覆盖六角色、别校、原版/随机文件、参数限制、并发词表保存一成一冲突、报告失效、缺少理由拒绝与恢复后继续检测。两条警告来自既有passlib/argon2依赖弃用提示。

前端在 `frontend` 执行：

```sh
node_modules/.bin/vitest run src/modules/thesis/__tests__/sensitiveLocations.spec.ts src/modules/thesis/__tests__/realThesisIdentity.spec.ts src/modules/school/__tests__/realPreparationCounts.spec.ts src/modules/school/__tests__/schoolManagement.spec.ts src/router/__tests__/routes.spec.ts --maxWorkers=4
node_modules/.bin/vue-tsc --build
VITE_DEMO_MODE=false node_modules/.bin/vite build
```

**测试退出0，25 passed / 5 files；类型检查退出0；真实模式构建退出0。** 构建保留已有第三方纯注释提示，没有构建错误。覆盖逐页/元数据展示、标题提示、受控预览及过期请求丢弃、失效和空态、配置冲突保留编辑、菜单/路由角色限制、学生/学校真实入口接线、移除文件后拒绝检测旧绑定。

文件选择组件涉及真实/演示说明，另执行 `node_modules/.bin/vitest run src/modules/thesis/__tests__/ThesisFileField.spec.ts src/demo/__tests__/studentPortalService.spec.ts --maxWorkers=4`，**退出0，29 passed / 2 files**。两批不同文件共54项前端测试。

`git diff --check` 退出0。按E07计划执行定向回归，没有将E06历史全量487/500结果冒充本次全量测试；本次未重跑全仓后端/前端。

### 失败→修复证据

日志位于忽略目录 `.superpowers/sdd/2026-10-12-e07-thesis-sensitive-locations/`。

- 初始逐页提取/字段测试5项失败；实现后相关用例通过。追加跨页断开身份的兼容回归与词表接口，2项失败后修复。
- 扩展测试出现3项失败：可选词条说明未设默认、重复词校验的异常对象不能序列化、恢复仍期待33表。已精准修复；并补上正文登记信息摘要，防止同ID草稿编辑后沿用报告。
- 后端扩大回归64通过/1失败，失败为备份断言仍写旧迁移0024；新迁移断言改0025后最终65通过。
- 前端先新增目标测试，组件尚未实现时报缺失；组件实现后7通过。关联测试20通过/2失败为新增页面后的路由数及菜单旧期望，按新页面精确更新为27页，未放宽权限断言。
- 末尾“移除匿名文件后不应检测旧绑定”新增测试失败；阻止旧文件检测、清除已移除待上传对象后最终25通过。
- 浏览器前两轮分别遇到脚本按钮名/学校行选择器错误，修正定位后完整5组通过；末尾补修后重新用全新隔离样本运行6组，全部通过。没有用HTTP请求结果替代页面操作验收。

## 浏览器与恢复证据

真实模式Vite：127.0.0.1:5177；验收后端：127.0.0.1:8013。临时口令只保存在权限0600文件，从未打印；虚构身份/PDF来自现有fixture。浏览器脚本 `browser-e07.cjs` 使用Chrome，结果记录为[6组PASS与浏览器版本](evidence/2026-10-26-e07/browser-results.json)。

| 场景 | 结果与证据 |
|---|---|
| 学校词表保存、默认WARN、刷新回读 | PASS，[学校词表](evidence/2026-10-26-e07/01-school-vocabulary.png) |
| 两页各命中身份、印刷页99/一不影响物理页、元数据无页码、扫描第3页仍人工核验 | PASS，[来源分组](evidence/2026-10-26-e07/03-identity-metadata-uncertainty.png) |
| 真实受控PDF页1/2导航 | PASS，[Chrome阅读器第2页](evidence/2026-10-26-e07/02-student-page-two.png)；不声称框坐标定位，保留浏览器不支持自动跳转时的手动页码提示 |
| 上传替换、标题不匹配提示、编辑标题后报告失效再检测、390px无整页横向溢出 | PASS，[标题提示](evidence/2026-10-26-e07/04-replacement-title-warning.png)、[移动布局](evidence/2026-10-26-e07/05-mobile-report.png) |
| 移除所选匿名版不发起旧文件检测，重新上传后可检测 | PASS，[移除文件门禁](evidence/2026-10-26-e07/08-removed-file-gate.png) |
| 学校改词表→旧报告失效/隐藏通过→重检→无理由422→填写理由确认 | PASS，[旧报告失效](evidence/2026-10-26-e07/06-school-stale-report.png)、[确认后状态](evidence/2026-10-26-e07/07-school-confirmed.png) |
| 专家无词表菜单/报告，访问学校配置路由被导回专家任务页 | PASS，脚本断言；浏览器pageerror为空 |

恢复为真实自有资源备份与同名恢复，核对词表/报告行数、完整数据回读一致、函数授权和恢复后重新检测成功；原工具在逐项验证所有权后清理本次创建资源，不清理现存schema或文件。所有浏览器验收实例退出后，检查对应schema/运行角色为0，storage和临时口令不存在，8013/5177停止；清理结果见证据目录 `cleanup-final.json`。

## 变更文件

- 后端：`app/modules/files/pdf.py`；`app/modules/thesis/{detector,models,service,sensitive_terms}.py`；`app/db/models.py`；`app/api.py`；迁移 `0025_sensitive_locations.py`。
- 测试/恢复：`tests/test_sensitive_locations.py`、`test_rls_end_to_end.py`、`test_rls_roles.py`、`test_recovery_drill.py`、`scripts/recovery_drill.py`。
- 前端：`api/{theses,sensitiveChecks}.ts`；`components/app/SensitiveFindingPanel.vue`；`modules/school/pages/{PreparationListPage,SensitiveTermsPage}.vue`；`modules/thesis/pages/ThesisEditPage.vue`、`components/ThesisFileField.vue`；`router/{routes,menus}.ts`；新增 `sensitiveLocations.spec.ts` 和更新3个相关测试文件。
- 文档：本记录、工作树快照、CURRENT、HANDOFF、增强路线图及E07规格/计划状态、浏览器和清理证据。原始材料未改动。

## 未覆盖与下一项

- 没有OCR、PDF字框坐标、自动替换或标题语义判定；有限字面词表不是智能安全审查或官方词库。大规模文档/词表的负载测试、Safari/Firefox和真实学校语料未验收。
- 线上环境、正式数据、部署、外部通知和费用不在本次范围；本地验证不等于已可开放真实试点。
- E07已完成，增强模块7/10；一期6/6，二期1/4。下一项 **E08 PDF材料合并、拆分与删页**，已有配套spec/plan，可沿既定顺序开始；本次停止于E07验收边界。
