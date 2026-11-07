# T10-A 本地数据库与文件配套恢复演练

执行日期：2026-10-02。分支 `codex/slice-7a1-file-integrity`、HEAD `39a8962`；保留全部已有未提交和未跟踪工作，未提交、推送、部署。仅使用本机 5433 `paper_review_test` 中由本次运行亲自创建的隔离 schema、三角色和临时文件。未迁移或清理开发业务库。

## 工具链与实现边界

本机15.19客户端低于PostgreSQL服务端16.15，因此没有继续Homebrew安装。只读核对现有 `paper-review-postgres` 为 `postgres:16-alpine`，容器内 `pg_dump`/`pg_restore` 均16.15，映射为 `127.0.0.1:5433 → 5432/tcp`。脚本固定容器ID并逐次复核，凭据只经stdin写入容器内本次随机0600 `PGPASSFILE`；数据库custom archive通过无TTY二进制流落入宿主机0700临时目录，归档、清单和文件以0600创建。容器内不留归档。

`backend/scripts/recovery_drill.py` 生成虚构已发布论文、原文/匿名PDF，记录内存所有权（schema OID、三角色OID、storage inode）；备份所有自有物理文件和数据库schema，清单包含文件hash、29张表行数及有效权限、28张业务表FORCE RLS、轮次规则、论文/任务/发布ID与时间。恢复同名schema和同一storage路径，`pg_restore --single-transaction --exit-on-error` 保留owner/权限/RLS；新OID/inode重新登记，退出路径在schema/角色/存储各阶段校验所有权。修改仅为T10提供严格清理回调，原隔离测试默认清理行为保留。

## 实际运行证据

| 命令/边界 | 结果 |
|---|---|
| `backend/.venv/bin/pytest backend/tests/test_recovery_drill.py backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short -x --show-capture=no` | 退出0，**26 passed / 2 warnings**，49.21s（补充bundle位置/路径越界回归后重跑） |
| `PYTHONPATH=backend backend/.venv/bin/python -m scripts.recovery_drill` | 退出0，`local_recovery=PASS`、`cleanup=PASS`；最终一次实际演练备份 **1.191s**、恢复 **1.235s**；资源 `test_3ce0e5a8545a4ed29d3aca7956cfca7c`，28业务表、2文件、规则 `pilot-single-v1` |
| `backend/.venv/bin/pytest backend/tests -c backend/pyproject.toml -q --tb=short --show-capture=no` | 退出0，**401 passed / 2 warnings**，657.58s；其后只新增一项路径拒绝测试，定向26项与CLI均通过 |

定向测试先复现缺失清理回调、OID/inode失配、容器工具版本、归档0600、清单落盘校验、恢复后文件权限等失败，再逐项最小实现。失败门禁实际覆盖错误库/端口、角色指向其他库或获得BYPASSRLS、源completed文件缺失、dump非零、清单/归档哈希损坏、storage被替换时源schema不得先删除、pg_restore失败后不重启应用。`accepted/published`原隔离入口回归保持通过。

实际命令行演练在备份后先提交一次虚构用户名显示值变更，恢复后确认回到备份值；另在DDL事务中主动异常并确认新表没有留下。恢复后以普通角色登录：学生和导师已发布结果均200、外校学生结果404；学生本人原文文件200且字节SHA256与备份一致，专家原文404。数据库恢复后检查表行数、owner、有效GRANT、RLS、规则版本、总分、发布ID/时间和文件哈希；认证角色按现行登录职责可读密码哈希，业务角色无该列读取权。

## 清理与未覆盖

脚本报告精确schema、三角色、storage与归档均清理；容器临时凭据按inode删除。全量及最终CLI之后只读核对：上述精确schema 0、`rls_%`隔离角色 0、精确storage 0、恢复归档目录 0、容器内 `paper-review-recovery-*`临时文件 0。恢复后的旧令牌只代表备份时间点：备份后撤销可能回滚；真实环境需T10-B停服轮换密钥和撤销refresh会话。本地演练不证明旧应用构建兼容性、异地备份、真实数据回填、生产恢复、RPO/RTO或T11六角色浏览器矩阵。
