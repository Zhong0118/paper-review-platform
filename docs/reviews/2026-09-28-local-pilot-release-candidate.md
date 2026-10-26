# 本地试点候选版本交接记录

日期：2026-10-02。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；T05以后大量实现和本文仍在未提交/未跟踪工作树，未提交、推送、合并或部署。源码迁移 head 为 `0019_school_task_cancellation`，仅在本机 `127.0.0.1:5433/paper_review_test` 的独立 schema 执行；开发业务库和生产库没有迁移。本地版本：Python 3.12.7、Node 24.19.0、npm 11.17.0、PostgreSQL 服务端 16.15。宿主机 `pg_config` 为 15.19；T10 恢复演练使用已核对的 PostgreSQL 16.15 容器工具。

## 交付状态与证据

统一包的 **13/13 本地交付项已验证**：T09-A1/A2 [访问日志去敏](2026-09-28-t09-a1-validation.md)、[生产配置与seed门禁](2026-09-28-t09-a2-validation.md)；T07-1～4 [专家维护](2026-09-28-t07-validation.md)；T08-1～3 [固定规则快照](2026-09-28-t08-validation.md)；T10-A1/A2 [配套备份与恢复演练](2026-09-28-t10-a-validation.md)；T11-A1 [六角色浏览器矩阵](2026-10-02-t11-a-browser-validation.md)和本项 T11-A2。T01–T06 的历史本地验收见[任务板](../superpowers/plans/2026-09-22-pilot-task-board.md)；T02 的 Hosted CI **NOT RUN**，不能用本机脚本成功代替远端 CI。

T11-A1 的 14 行矩阵通过两轮隔离 `operations` 场景逐行完成实际浏览器观察，最终 **14/14 PASS**。六角色主链覆盖虚构 PDF 上传、匿名正文在 Chrome 内嵌阅读器实际可读、学校送出、平台派单、专家六维 80 分评阅、学校发布、学生/导师结果和异议；异常路径覆盖拒绝再派、接单后改派、学生撤回重提、学校终止，旧任务读/写/提交与旧匿名下载令牌被拒；冲突/空态覆盖双页面旧版本 409、一次网络失败后显式重试以及外校零论文页面。浏览器观察与独立 API/SQL 核对分列在[矩阵记录](2026-10-02-t11-a-browser-validation.md)，[匿名 PDF 截图](evidence/2026-10-02-t11-expert-anonymous-pdf.png)只含虚构内容。两次验收精确 schema/临时角色/存储均已清理，8011/5186 无监听；第二轮虚构 PDF 按文件名、所有权、模式和摘要逐个核对后删除。本次全量测试结束后 `test_%` schema 与 `rls_%` 临时角色均为 0。

首轮浏览器发现学校终止后留下 `INVITED` 任务。失败用例先得到 `INVITED != CANCELLED`；经用户明确批准最窄权限后，`0019_school_task_cancellation` 只允许学校审核员在本校已终止论文上把 `INVITED`/`IN_REVIEW` 任务改为 `CANCELLED`，触发器限制其他字段与版本变化，保留论文→任务锁顺序。定向邀请/在评、直接 SQL 负例和迁移升降往返 **4 passed / 2 warnings**；第二轮浏览器/数据库确认论文 `TERMINATED`、任务 `CANCELLED`、旧令牌 404。原始失败和修复复验均保留在[T11记录](2026-10-02-t11-a-browser-validation.md)及[T06设计补记](../superpowers/specs/2026-09-23-t06-rls-design.md#2026-10-02-已批准的学校终止例外)。

T10 本地演练实际对同一份虚构已发布论文做数据库 custom archive 与两份私有文件配套备份、同名 schema/路径恢复、权限/RLS/文件哈希核对，备份 1.191 秒、恢复 1.235 秒，`local_recovery=PASS`、`cleanup=PASS`。这些耗时只描述本机小样本，不能当作目标环境 RPO/RTO。详见[恢复记录](2026-09-28-t10-a-validation.md)和[运行手册](../operations/pilot-recovery-runbook.md)。

## 最终验证

| 实际命令 | 退出码和结果 |
|---|---|
| `./scripts/check.sh` 首次 | **1**：后端 405 passed、1 failed、2 warnings；唯一失败为 T10 恢复测试仍期望旧迁移 `0018`，实际归档正确记录新 head `0019`。这次脚本在后端阶段停止，未运行前端。 |
| `backend/.venv/bin/pytest backend/tests/test_recovery_drill.py::test_published_backup_is_readable_and_tampering_is_rejected_before_delete -c backend/pyproject.toml -q --tb=short --show-capture=no` | **0**：将断言更新为本次迁移 head 后 1 passed、2 warnings，归档校验及篡改拒绝断言保留。 |
| `./scripts/check.sh` 最终重跑 | **0**：后端 **406 passed / 2 warnings**（697.41s）；前端 **454 passed / 61 files**；`vue-tsc --build` 退出 0；`VITE_DEMO_MODE=false vite build` 退出 0。 |
| `bash scripts/tests/check_test.sh` | **0**：脚本成功、失败传播、错误数据库目标和缺依赖拒绝路径通过。 |
| `git diff --check` | **0**。 |

两条后端警告来自依赖的 Python `crypt` 和 argon2 包版本元数据弃用；Vite 构建有第三方 PURE 注解和超过 500 kB 的 chunk 警告，未阻断构建。本次没有把警告写成错误，也没有因警告做无关升级。T11-A1 页面修复分别有先失败再通过的定向测试和浏览器重验；最终统一脚本在全部实现改动后运行。

## 未运行及下一阶段输入

**本地候选版本不等于正式上线。** T09-B1、T10-B1、T11-B1 仍为 `ENVIRONMENT_BLOCKED`，没有实际主机/容器及负责人、域名/TLS、分离的数据库账号管理方式、私有持久存储、加密备份位置与保留期、RPO/RTO、管理员安全发放渠道、试点窗口、正式数据来源/授权/删除规则和部署/恢复操作授权。新增 `0019` 的最窄 RLS 例外已自查并实测，但尚未经过独立的生产迁移安全复核。T09-B1 还须实现并验证生产运行进程不持有迁移 owner 凭据的配置拆分和离线管理员维护命令；T10-B1 须在授权目标演练恢复/回退；T11-B1 须有目标环境主链、Hosted CI 或认可的替代证据和最终放行决定。输入与步骤见[环境门禁设计](../superpowers/specs/2026-09-28-pilot-deployment-gates-design.md)及[执行计划](../superpowers/plans/2026-09-28-pilot-deployment-gates.md)。Chrome/Firefox/Safari 交叉浏览器、大文件与并发容量、真实数据迁移和生产恢复均 **NOT RUN**。

同目录换模型可直接接续本工作树；跨机器移交须包含所有未跟踪实现、迁移、测试和文档，排除 `.env`、密钥、私有论文、备份及临时验收文件。HEAD `39a8962` 本身不含本地13项实现。
