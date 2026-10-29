# E09 专家档案增强与受控导入验收

执行日期：2026-10-28。状态：**已本地验收**。两期增强模块累计 **9/10**（一期6/6、二期3/4），下一项E10可解释专家候选推荐，本次未执行E10。

分支 `codex/slice-7a1-file-integrity`；开始及结束HEAD为 `80ce25c92485a5e1d2ffc59d2cbe57bb712ecf0a`。保留E08全部未提交/未跟踪工作，本次不提交、推送或部署，不修改原始材料。数据库仅本机5433 / paper_review_test的自有独立schema，开发数据库未迁移；新迁移0027、36张业务表FORCE RLS。

## 实际交付

- 专家档案增加省份、博导/硕导三态、研究方向、关键词、来源链接/说明及服务端维护时间。历史导师资格保持NULL，不推断为否。省份由已核验官方院校CSV去重，实际31个省级名称；职称仍为人工文本，学科仍为启用的官方一级学科/专业学位类别。
- 平台专家页支持字段编辑及学科、省份、职称、导师资格、方向/关键词精确标签筛选。“人工维护 / 未核验”持续可见；不声明实名认证、智能采集或自动匹配。
- 真实CSV模板下载、上传预览、逐字段差异、错误行与确认更新闭环。只按精确用户名更新已有专家；UTF-8/BOM、1 MiB、500行、固定列、分号列表、严格true/false/空值。空白可空字段明确清空；重复用户名、未知账号/学科、危险公式前缀、非法值或格式均拒绝，无部分成功。
- 预览绑定操作者、10分钟有效期、文件SHA、专家版本及资格/账号/接单状态。确认锁预览，再按专家UUID升序加锁，先复验整批再更新。来源链接仅存储，不自动请求；临时上传通过UploadFile关闭并释放自身暂存。
- 使用现有幂等设施；重复确认不重复更新，同一资料再次导入无差异时不提升版本或改维护时间。导入不修改审核资格、账号、服务状态或回避。审计只记字段名称、版本、预览ID，不记个人字段原文。
- 新预览表FORCE RLS仅平台操作者本人可读写，来源差异不可修改，READY只能进入APPLIED，INVALID/APPLIED不可再篡改；没有删除授权。过期确认409不返回差异；页面隐藏过期差异，没有新增过期预览读取接口。
- 新表与experts完整内容摘要加入恢复校验，真实备份→自有资源重建→恢复后档案内容及幂等结果保持一致。空迁移往返通过；已有新增档案数据或导入记录时拒绝破坏性降级。

`source_checked_at`表示本次人工维护/导入确认时间，不表示网站抓取时间或真实性认证。来源URL仅接受无用户名密码的HTTP/HTTPS，最长2048字符；说明最长1000字符。旧客户端未提供的新字段保留原值；CSV模板中的空字段则按规格清空。

## 文件范围

- 后端：`app/modules/expert/{models,schema,service,router,import_service,import_models}.py`；`alembic/versions/0027_expert_profiles.py`；ORM注册与恢复清单。
- 前端：`api/expertOperations.ts`、`components/app/ExpertImportDialog.vue`、`modules/expert-management/pages/RealExpertLibraryPage.vue`及组件类型声明。
- 测试：新增`backend/tests/test_expert_profile_import.py`、`frontend/src/modules/expert-management/__tests__/expertImport.spec.ts`；调整现有RLS表数与恢复迁移头断言，未放宽原权限断言。
- 必要补修：`app/core/exception_handlers.py`仅保留校验错误的type/loc/msg，避免ValueError对象无法JSON序列化，并不回显原始输入。
- 文档：E09 spec/plan、本验收记录、CURRENT、HANDOFF及路线图。完整工作树含原有E08变更，见[文件清单](evidence/2026-10-28-e09/working-tree.txt)。`import_service.py`原来是已跟踪的占位文件，本次填入实际实现。

## 失败用例与修复

1. 新档案字段测试先失败于缺少doctoral_supervisor；导入测试先失败于未注册接口（405）；前端5项先失败于缺少导入入口与新档案展示。均有实际失败输出，随后实现。
2. 扩大后端首轮27通过/1失败：非法短标签触发Pydantic ValueError，旧异常处理器直接JSON序列化ctx失败。保留业务拒绝断言，修复异常响应后返回422。
3. 前端首次实现10通过/1失败：脱离document的测试表单点击未派发原生submit；改用真实submit事件触发测试，保留筛选参数断言，浏览器另外实际点击筛选按钮验证。
4. 浏览器首轮在409后立即检查离场按钮数量，早于Vue离场完成；等待节点移除后原断言通过。截图另复现原生dialog被全局margin重置到左上角，补充margin:auto并复验水平居中。
5. 收尾补充空字符边界：档案文本与CSV用户名里的NUL可能进入Postgres触发异常。先保存失败用例，增加字段校验、查询前排除非法用户名及筛选拒绝；补修后的6项核心用例重新通过。

## 实际命令与结果

除标注frontend者外，从仓库根执行。测试数量来自本次实际输出；33与29两组共有6项重叠，合计56个不同相关用例，**不是全仓全量**。末尾NUL补修后重跑6项核心（含恢复/迁移），前端最终13项、类型和构建也重跑通过。

| 命令 | 退出码 | 结果 |
|---|---:|---|
| `backend/.venv/bin/pytest backend/tests/test_expert_profile_import.py backend/tests/test_expert_operations.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 33通过，256.05秒 |
| `backend/.venv/bin/pytest backend/tests/test_expert_profile_import.py backend/tests/test_rls_end_to_end.py backend/tests/test_rls_roles.py backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 29通过，107.28秒；36表RLS、真实恢复与清理保护 |
| `backend/.venv/bin/pytest backend/tests/test_expert_profile_import.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 最后补修后6通过，17.72秒 |
| frontend：`node_modules/.bin/vitest run src/modules/expert-management/__tests__/expertImport.spec.ts src/modules/expert-management/__tests__/realExpertLibrary.spec.ts --maxWorkers=4` | 0 | 2文件13通过 |
| frontend：`node_modules/.bin/vue-tsc --build` | 0 | 类型检查通过 |
| frontend：`VITE_DEMO_MODE=false node_modules/.bin/vite build` | 0 | 真实模式构建通过；既有依赖PURE注解提示非阻断 |
| `node .superpowers/sdd/2026-10-12-e09-expert-profile-import/browser_check.mjs` | 0 | Chrome真实浏览器8组通过，含截图检查 |
| `backend/.venv/bin/python .superpowers/sdd/2026-10-12-e09-expert-profile-import/check_cleanup.py` | 0 | 自建schema/角色剩余0，存储/临时密码不存在，8013/5177已停止 |
| `git diff --check` | 0 | 无空白错误 |

环境：Python3.12.7、Node24.19.0、Vitest4.1.10、PostgreSQL16.15、Docker28.1.1、Chrome156.0.8078.49。后端两条既有依赖弃用告警（crypt/argon2版本接口）不影响断言。

核心场景包含：三态与历史NULL、31个官方省份、来源URL限制、字段长度/标签上限、无权限六角色边界；批次A预览后B改档案导致整批409；两个相反行序批次同时确认仅一个成功；相同幂等键、不同请求键冲突、相同资料无更新；明确清空、重复/未知/非法行、过期、禁止额外权限列；直接SQL验证预览归属、差异只读、终态不可回退及删除无权限；档案/预览恢复后一致。

## 浏览器与证据

[浏览器矩阵](evidence/2026-10-28-e09/browser-results.json)记录8组PASS：模板下载到确认更新、刷新与三态筛选、重复用户名错误、重复导入无变化、明确清空、双页面并发409、学校访问隔离、390px无横向溢出/无外部来源请求/无页面异常。

截图：[导入预览](evidence/2026-10-28-e09/import-preview.png)、[真实专家列表](evidence/2026-10-28-e09/profiles.png)、[版本冲突](evidence/2026-10-28-e09/version-conflict.png)、[窄屏](evidence/2026-10-28-e09/mobile.png)。[清理结果](evidence/2026-10-28-e09/cleanup.json)。所有资料为本次虚构数据，凭据仅临时文件并已删除，未进入证据目录。

命令日志与失败摘要存放同一证据目录；浏览器脚本及临时执行材料在忽略目录`.superpowers/sdd/2026-10-12-e09-expert-profile-import/`。仅由自有夹具/工具清理其创建的资源，无reset、clean或开发库操作。

## 未覆盖及下一项

- 本次没有运行全仓统一检查；E10收口仍应按计划运行`./scripts/check.sh`及二期完整浏览器矩阵。
- 未用正式专家资料，未做500名不同专家同时写入的性能压测，未验证目标部署环境；CSV行数与字节边界已有拒绝测试。没有网络采集、实名认证、二级学科映射、学校侧共享专家检索或自动派单。
- E10所需province_name、导师三态、research_directions、keywords字段与编辑/导入能力已具备，**可开工E10**；沿用已有spec/plan，不另建专家表或扩展权限。真实上线仍须另行补齐部署、恢复目标与最终授权。
