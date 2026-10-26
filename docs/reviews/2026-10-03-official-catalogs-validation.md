# 官方基础目录四项交付验证

日期：2026-10-03。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`。保留原有未提交/未跟踪工作；本轮没有提交、推送、部署或迁移开发库。

收尾核对`git status --porcelain -uall`：87个已跟踪文件有未暂存修改、155个未跟踪文件；无暂存项。该总数包含此前任务的全部工作，不代表本轮新增242个文件。分支/HEAD未变。

## 来源与交付

| 项 | 实现 | 验证边界 |
|---|---|---|
| D01 | 官方研究生目录184项、来源版本与原件校验；真实学生/专家读取后端目录 | 2022版一级学科和专业学位类别，不是学校全部培养专业 |
| D02 | 全国高校名录3196项、受控转换、管理员预览/导入、院校检索与租户关联 | 普通2952所、成人244所；导入不自动创建账号/租户 |
| D03 | 本校开放范围、版本冲突、最窄RLS、新建/改选/提交校验、历史稿原值保留 | 未配置沿用全局启用范围；明确保存空集则不开放新选项 |
| D04 | 学生搜索单选后建稿、专家搜索多选、院校选择、本校配置页与全选/清空 | 真实模式接口失败不回退演示目录 |

原始PDF/XLS、规范CSV与SHA256清单：`backend/data/official/manifest.json`。官方链接：

- [国务院学位委员会、教育部2022研究生目录（中国政府网PDF）](https://www.gov.cn/zhengce/zhengceku/2022-09/14/5709785/files/bb23485679bf489aba5d3299c36e0606.pdf)
- [教育部全国普通高校名单XLS](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618416094865984.xls)
- [教育部全国成人高校名单XLS](https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/202606/W020260618307096079727.xls)
- [教育部中国大学生在线发布页](https://dxs.moe.gov.cn/zx/a/sy_xzsd/260618/2045120.shtml)

学科代码/名称与原有前端184项逐项比对一致；运行时从后端统一读，原前端静态数据仅保留演示兼容。院校标识码为10位字符串，普通/成人跨文件去重。来源原件随仓库保存，运行无需访问外网。

## 实际验证记录

环境 Python 3.12.7 / Node v24.19.0；Postgres仅本机5433/paper_review_test，每个数据库测试使用独立schema。

| 命令/验证 | 退出码/结果 |
|---|---|
| 新数据测试首次执行（实现前） | 1，缺少catalog_data模块 |
| 新目录API测试首次执行（实现前） | 1，预览接口404 |
| 外部空选项选择器测试首次执行 | 1，错误回退184项，期望0 |
| 学校全选/清空测试首次执行 | 1，清空按钮尚未实现 |
| `PYTHONPATH=backend backend/.venv/bin/python -m scripts.verify_catalog_source backend/data/official/institutions-regular-2026.xls --kind REGULAR` | 0，官方快照一致2952项 |
| 同一转换命令对`institutions-adult-2026.csv --kind ADULT` | 0，官方快照一致244项 |
| `backend/.venv/bin/pytest backend/tests/test_official_catalog_data.py backend/tests/test_official_catalog_api.py backend/tests/test_official_catalog_migration.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0，7 passed / 2 warnings，9.23s |
| `frontend/node_modules/.bin/vitest run --maxWorkers=4`（frontend目录执行，去掉路径前缀） | 0，459 passed / 63 files；全选清空用例随后补入 |
| 学校目录前端定向复验 | 0，3 passed，含全选/清空和409刷新不重放 |
| `vue-tsc --build` 与 `VITE_DEMO_MODE=false vite build` | 0；构建存在第三方pure注解提示 |
| `./scripts/check.sh` | 1：418 passed / 3 failed / 2 warnings，710.01s；三项为旧迁移夹具和旧表数断言，见下文补验 |
| `backend/.venv/bin/pytest backend/tests/test_file_migration.py backend/tests/test_rls_roles.py backend/tests/test_official_catalog_data.py backend/tests/test_official_catalog_api.py backend/tests/test_official_catalog_migration.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0：14 passed / 2 warnings，16.12s，包含首轮全部3项失败 |
| 最终独立前端全量、类型检查、真实构建（同上命令） | 0：460 passed / 63 files；类型/build通过，另有大chunk提示 |
| `git diff --check` | 0 |
| 真实浏览器 | PASS，见下表；实际登录与页面交互，未用HTTP代替 |

测试保持真实语义：RLS过滤UPDATE返回0行时断言0行及无伪造值，不将其误写成必须抛异常；列级禁止改tenant_id仍断言数据库错误。原有UI测试更新为实际勾选/院校检索操作，保留权限、重复提交及密码不回显断言。新增两表后，RLS/恢复清单从28增至30；权限与所有权断言保留。

首轮失败具体原因：`test_file_migration.py`在0015旧schema调用当前建稿服务，读取尚未存在的`discipline_catalog.source_version`（随后也会依赖新配置表）；改为固定历史SQL夹具，保留升级、旧文件不可覆盖、已完成/未完成分支的全部断言。`test_rls_roles.py`原28表预期改为30，保持所有权、无TRUNCATE/REFERENCES和角色隔离断言。修正只涉及测试，未通过绕过生产校验让测试变绿。后端421项中首轮418通过，其余3项在14项定向补验中通过；**没有把首轮非零的统一命令写成一次全绿**，本轮未重复整套后端。首轮已通过实际恢复CLI与30表RLS检查。

## 浏览器实际验收

后端 `.venv/bin/python -m scripts.acceptance_server --scenario empty --port 8011`（backend目录，临时虚构密码）；前端 `VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:8011 node_modules/.bin/vite --host 127.0.0.1 --port 5186 --strictPort`。2026-10-03 14:52–14:56，本机Playwright，隔离schema `test_8448263ef7714b4aa83e59395de87b97`。

| 页面/操作 | 实际结果 |
|---|---|
| 管理员预览、确认导入、再次预览 | 初始院校新增3196；第二次新增0/更新0/未变3196；学科未变184 |
| 新增学校对话框查询学校标识码并选中 | 显示4111010001、北京大学、北京市、本科；取消表单，没有在浏览器建立学校账号（创建由API测试覆盖） |
| 学校配置清空→搜索0101→勾选→保存→刷新 | 初始184项选中，刷新后仅0101选中，菜单入口可见 |
| 学生新建 | 未选择时建稿按钮禁用；只有0101哲学可选；选中后允许创建，创建成功并刷新保持哲学 |
| 专家编辑资料搜索0101→勾选→保存→刷新 | 原0835保留，新0101保留，已选2项 |
| 学校保存空集；学生打开旧稿与新建 | 旧稿仍显示0101哲学并提示历史项；新建空态、建稿按钮禁用 |
| 浏览器拦截目录请求使其失败，解除拦截后重试 | 错误页不出现演示选择器；重试恢复真实空态 |

学生首轮浏览器脚本误等待`?id=`导致超时，实际页面已导航`?thesisId=`且创建200；按实际路由复核刷新与选择状态通过，未改业务路由掩盖脚本错误。控制台仅记录人为拦截产生的`net::ERR_FAILED`，正常流程没有控制台错误。本次未覆盖移动设备、其他浏览器和全部六角色旧流程。

验收结束后发送Ctrl+C关闭两服务；后端按工具约定退出130，前端退出1。只读核对本次schema剩余0、本次临时存储目录不存在；未清理其他schema或文件。

## 重点覆盖

- 官方文件SHA256、PDF到CSV一致性、XLS/XLSX/CSV转换、代码唯一、重复输入拒绝。
- 系统导入预览、过期409、重复导入不重复建项、不自动建租户；非系统管理员写入拒绝。
- 院校代码和名称后端匹配、租户关联；本校配置版本冲突、学生写入拒绝、外校隔离、禁止改tenant_id。
- 旧稿学科被关闭后允许原值保存，禁止改选未开放项和再次提交；新学生先选学科再建稿。
- 0020空数据升级→降级→升级；新表FORCE RLS；最终恢复与全库RLS回归见统一检查。

## 文件与未覆盖项

后端：目录模块`catalog_data.py`/`catalog_service.py`/`catalog_router.py`、租户模型与创建契约、迁移0020、seed、论文校验、受控转换脚本及对应测试。前端：目录API、共享选择器/导入组件、学校学科配置页、真实学生/专家/学校管理接线与路由测试。数据：官方3份原件、3份规范CSV、manifest。文档：[设计](../superpowers/specs/2026-10-03-official-catalogs-design.md)、[计划](../superpowers/plans/2026-10-03-official-catalogs.md)、[操作说明](../operations/official-catalogs.md)。

- 开发库/生产库未迁移、未初始化官方目录，旧服务不会自动获得新表。本次可运行证据来自隔离虚构环境。
- 不把全国名录当作本校学科授权名单。学院、校内培养专业与研究方向映射需要学校材料；本科专业目录不在本次范围。
- 旧租户不自动匹配官方学校；旧创建API保留人工字段兼容，新学校页面要求从名录选择。
- Web导入固定已核验快照，不接受任意文件/任意URL；离线转换支持CSV/XLS/XLSX，必须匹配官方快照。新官方版本须差异审核后更新文件与manifest，不承诺自动同步。
- 本轮不重做全部六角色论文流程、不验证真实部署；T09-B/T10-B/T11-B条件不变。
