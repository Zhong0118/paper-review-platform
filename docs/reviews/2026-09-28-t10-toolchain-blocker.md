# T10 本地备份工具链阻断

2026-09-28；HEAD 39a8962，工作树保留。T10-A1/A2尚未实现或验收；没有执行pg_dump、pg_restore、资源删除或恢复。不是实际部署B阶段的条件缺失。

## 实测

- 本机5433/paper_review_test只读 `SHOW server_version`：16.15。
- `/opt/homebrew/bin/pg_dump --version`、`pg_restore --version`：15.19。不能用旧主版本dump较新服务端。
- 定位已安装的本机工具仅找到postgresql@15；未发现可直接用于本地脚本的16+客户端。
- `HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install libpq`：失败，openssl@3 bottle manifest/checksum不匹配。
- 已核对本机openssl@3 3.6.3和readline 8.3.3；尝试仅安装客户端且不升级依赖：`HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --ignore-dependencies libpq`，再次失败，libpq自身bottle manifest/checksum不匹配。安装未成功，未升级数据库服务。
- 只读补充诊断：`docker ps`确认paper-review-postgres将本机127.0.0.1:5433映射到容器5432；`docker exec paper-review-postgres pg_dump --version`返回16.15。这是可供后续复核的另一条工具运输路径，尚未用于备份/恢复。

两次遇到同一Homebrew清单错误后，依据统一执行包规则5停止此处环境修复，不无限重试安装。源码检查未发现需要变更数据库业务权限的理由。

## 继续条件与实现注意

选择一种已验证的运输方式再实施T10：

1. 修复/提供原生16+ `pg_dump`和`pg_restore`可执行路径，先验证版本与普通archive往返；可继续现有设计的原生subprocess参数数组。
2. 若复用已存在的容器16工具，先在设计中固定容器标识、端口映射校验、stdin/stdout二进制归档、容器内0600 PGPASSFILE及精确临时文件清理。密码不能出现在docker exec命令参数、环境打印或日志中；不能依赖容器里可能存在的开发库默认连接。pg_restore仍需同名schema、事务恢复、保留ACL/owner/RLS，不得将--schema误作重命名。

无论采用哪种方式，所有权核对不能只发生在restore函数里：`isolated_runtime_roles`、`migrated_test_schema`与TemporaryDirectory的默认finally会清理资源。T10复用这些context时必须让schema和storage的最终清理也校验本次登记的OID/inode/角色身份；不能在函数中拒绝“非自有资源”后，又让外层finally删除它。建议给内部测试生命周期增加仅T10使用的精确清理回调，默认测试行为保持不变，或者提取拥有等价保护的最小生命周期；先写替换目标/OID变化负例，确认所有外层清理路径都拒绝越权。

后续脚本、失败门禁、真实恢复和运行手册仍按[T10计划](../superpowers/plans/2026-09-28-t10-local-recovery.md)执行。此记录是阻断与设计复核输入，不是恢复成功证据。
