# T10-A：本地数据库与文件配套恢复演练

状态：设计完成，未实施。依赖 T07/T08 的迁移完成。只演练本次新生成的虚构数据，不提供接收任意 schema/目录的恢复工具，不操作开发数据库或他人验收资源。

## 方案选择

采用 PostgreSQL 原生 custom archive + 文件副本 + manifest，避免自研数据库导入格式。`pg_restore --schema` 是筛选而非重命名，不能用字符串替换 dump SQL 实现跨 schema 恢复。当前 file_objects.storage_key 保存绝对路径，简单复制到另一路径同样不足。

### 2026-10-02 本机客户端运输补充

本机 PostgreSQL 客户端为15.19，数据库服务端及现有 `paper-review-postgres` 容器内客户端均为16.15。本地演练改为通过**当前运行且ID已核对的同一容器**执行16版工具：运行前核对该容器的唯一ID、镜像、`127.0.0.1:5433 → 5432/tcp` 映射、容器内工具主版本和目标数据库；每次数据库工具操作使用该ID，容器内连接固定 `127.0.0.1:5432/paper_review_test`，不接受CLI自定义容器、库或schema。归档在宿主机受限临时目录，用 `docker exec` 无TTY的二进制stdin/stdout流传输；不在容器内留下归档。密码只经stdin写入容器内本次随机生成的0600 PGPASSFILE，`docker exec -e`仅传文件路径，不传密码；结束时核对精确文件inode再清理。任何容器ID/端口/版本/凭据检查失败，备份或删除均不得开始。不重试此前失败的Homebrew安装。

恢复演练可为现有隔离测试context提供**仅本次内部使用**的清理校验回调：schema、三角色、storage在每个finally删除前均对照本次内存登记的OID/inode及目标数据库；恢复后更新新OID/inode，删除后标记为预期不存在。默认测试context行为不变；校验失败时保留可疑资源并报告精确标识，不通过外层finally绕过拒绝。演练运行前确保不存在其他使用这三角色的活跃连接，不终止他人会话。

因此本地灾难演练在一个脚本所拥有的唯一 test_<UUID> schema 内：生成虚构数据 → 停止本进程所有业务请求/提交并 dispose 连接 → 配套备份并验证可读 → 仅移除自己创建的 schema 和临时 storage → 按同名 schema/同一绝对 storage_root 恢复 → 重新启动普通角色应用验收。恢复的是全新重建的 schema 对象，名字和路径保持不变。此前路线中的“恢复到另一个名字的 schema/目录”由本设计替代；不碰运行中的已有来源。

复用 tests.conftest.isolated_runtime_roles 与 acceptance_environment 的最小虚构数据准备逻辑，不改变其默认自动清理；如复用 context 会过早清理，提取最小 preparation helper，不新增持久化服务模式。创建资源后持有 in-memory Ownership 记录：schema、schema OID、三角色名称、storage_root、storage inode、resource_id。任何删除前都核对精确所有权和本机 5433/paper_review_test；不能仅凭 test_ 前缀授权清理，不使用通配符，拒绝符号链接/非自有目录。启动时不接受任意现存资源的破坏参数。

## 备份契约

新增 `backend/scripts/recovery_drill.py`，CLI `python -m scripts.recovery_drill` 自动创建并清理自身资源。备份在源 storage 以外的 TemporaryDirectory，0700；文件0600。无需网络发布、不落库密码，不把备份提交 git。

manifest（格式版本1）记录：resource_id、数据库 host/port/name（无凭据）、原 schema/OID、预期 Alembic revision、三角色名、源 storage_root、备份时间、各表行数、数据库 archive SHA256、文件相对路径/长度/SHA256、对应 file ID 与 completed 标记、FORCE RLS/owner/GRANT 检查结果。还记录参考论文/任务/发布结果 ID 和业务总分用于恢复核对。manifest 不存密码、access/refresh/download token。

备份包含所有自有存储文件（含未完成上传实际存在的字节）；每个 completed FileObject 必须有文件、长度和 sha256 与数据库一致；pending 记录允许没有物理文件，但已有物理文件也加入清单。storage_key.resolve 必须在本次源 storage 内；拒绝 .. 越界、symlink、同一路径重复关联。外部引用、未知外部 schema 依赖、缺失已完成文件时备份失败，禁止进入破坏步骤。

数据库工具客户端主版本不小于服务端；若不匹配找已安装的匹配版本，不自动升级服务或修改数据库。dump 必须用能读全 schema 的本地测试管理连接，不能使用业务角色或 `--enable-row-security` 导出局部数据。不修改角色的 BYPASSRLS 权限。无足够测试权限即明确阻断。

用 Python subprocess 参数数组执行，凭据仅通过0600 PGPASSFILE，日志只记无密码 host/port/database：

```text
pg_dump --format=custom --schema=<owned_schema> --file=<archive> --host=127.0.0.1 --port=5433 --username=<test_admin> paper_review_test
pg_restore --list <archive>
pg_restore --single-transaction --exit-on-error --dbname=paper_review_test --host=127.0.0.1 --port=5433 --username=<test_admin> <archive>
```

保留 owner/ACL/RLS/函数/触发器，不用 --no-owner/--no-privileges/--clean/--create。三种角色在整个演练 context 内保留，不把集群角色定义打包。dump 前所有自有写连接已停止，无其他进程拥有这些随机角色；检查 pg_stat_activity 精确角色，仍有活动事务就失败，不杀他人连接。

## 恢复和迁移失败演练

删除任何源资源前，重新核对 archive hash/TOC、自有资源、文件副本 hash；这一步失败就保持源可用。schema 删前记录 reference 状态；DDL 只针对本次自有 schema。恢复时数据库 schema 必须不存在、文件目标为空或不存在，不能覆盖未知现存目录；恢复失败保持应用不启动，记录错误并清理仅自身资源。成功后核对新schema的owner和对象范围与备份匹配，由本进程登记新OID和新目录inode供后续精确清理；不能继续用旧OID，也不能收养其他进程先创建的目标。随后使用原三种登录重连，检查 schema owner、28 表 FORCE RLS、全部表计数、已完成文件 hash、原 ID/总分/发布时间、外校和原文拒绝。

迁移失败场景不修改既有 migration：在本次自有 schema 开一个事务，写演练标记后主动异常，断言回滚；另在备份后提交一次虚构数据变更，再按备份恢复，断言恢复到备份前行数/版本，证明配套包可以退回数据状态。此处只验证数据/文件恢复与DDL事务失败，不宣称旧应用构建兼容性；真实“旧构建+旧库”回退属于T10-B，并需已保存的对应构建。不能切换/回退用户工作树，也不能因T07 downgrade拒绝而强删新字段。

恢复的是备份时间点；旧会话可能随 DB 回到该点。本地必须记录这一事实，不能承诺撤销事件跨恢复保留。实际发布的 T10-B 恢复后先停服轮换 JWT_SECRET、撤销全部 refresh 会话，再重新登录验收，确保备份后被撤销的旧 token 不因回滚恢复授权；该行为不自动带到运行中的开发环境。

## 出口

有正常备份恢复、缺文件/哈希损坏拒绝、目标非自有拒绝、恢复命令失败不启动四类证据，及成功后主链/隔离检查与精确资源清理。记录耗时而不承诺生产 RPO/RTO。整个过程本地虚构数据，T10-A PASS 不等于真实备份/异地存储/生产恢复通过。


## 2026-10-03 删除边界补修

[F01/F02 补修契约](../../reviews/2026-10-03-followup-fix-contract.md)将外部 catalog 依赖检查用于备份和清理门禁，并在恢复 DROP 的事务内再次检查；schema OID 与 nspowner 同时匹配。限现行停止写入的本地隔离演练；不扩大可删除资源或真实环境授权。验证见[补修记录](../../reviews/2026-10-03-followup-fix-validation.md)。
