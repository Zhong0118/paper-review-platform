# T06 RLS 独立设计审查

日期：2026-09-24。结论：**未通过实施前审查；先修订设计和计划，不启动 T06-1。** 本轮只审查 R09 文档及现有模型、认证、文件和测试入口；没有实施 RLS、修改业务代码或运行迁移。工作树原有 T01–T05/R01–R09 未提交内容均保留。

## 必须修订

1. **P1：跨校父行校验示例会误判为通过。** [设计中的 `round_school_insert`](../superpowers/specs/2026-09-23-t06-rls-design.md) 在子查询内写 `t.tenant_id = tenant_id`、`v.thesis_id = thesis_id`、`v.tenant_id = tenant_id`。未限定的同名列优先绑定内层表，因此这些比较会变成内层列与自身比较，不能证明父论文、版本与待插入轮次同校/同论文。测试库只读 SQL 探针以外层 `tenant_id=2`、内层 `tenant_id=1` 验证：原写法为 `true`，显式外层限定为 `false`。修订时所有策略子查询都要显式限定外层列，并为父 ID 混搭写入建立真实非 owner 的失败测试；不能照抄当前示例。
2. **P1：认证账号的租户读取在策略计划中缺失。** 现有 `load_active_identity()` 在登录和刷新时读取 `Tenant` 并检查 `status`，`issue_tokens()` 还用其 `code`。[T06-3](../superpowers/plans/2026-09-23-t06-rls-implementation.md) 为认证账号安排身份表权限，[T06-4](../superpowers/plans/2026-09-23-t06-rls-implementation.md) 启用 `tenants` RLS，却只列出业务角色的租户策略。若按此执行，最终 head 的认证账号看不到学校行，学校用户无法登录或刷新。明确认证账号对 `tenants` 的最窄 SELECT 列、RLS 策略和停用学校的读取行为，并在 T06-4 加登录/刷新回归；不要把认证账号变成可读论文的业务角色。
3. **P1：匿名文件 purpose 值写错。** 设计将 `file_objects.purpose` 与 `thesis_version_files.purpose` 写成 `'ANONYMOUS'`，实际 `FilePurpose.ANONYMOUS` 为小写字符串 `'anonymous'`，现有文件服务也按小写值查询。按设计字面实施会让专家合法匿名文件始终不可见。修订设计为实际存储值，并在 T06-7 以真实非 owner 专家账号同时验证“匿名文件可见、原文不可见、改派后旧文件不可见”。
4. **P1：策略依赖图尚不足以排除递归。** 设计要求无环，但目前只给出核心链路，没有逐表、逐命令的引用图。`file_objects` 专家 SELECT 需要查 `thesis_version_files`；T06-7 又要求 link 验证文件与版本同租户。若 link 的 SELECT 反查 `file_objects`，会形成循环。同样，若 `result_summaries` 的“已发布”靠 `result_publications`，而 publication SELECT 又依赖 summary，也会循环。测试库临时两表策略互相引用的探针在真实非 owner 连接上返回 PostgreSQL `42P17: infinite recursion detected in policy`。修订时给出所有 28 表的 **SELECT 引用图** 和写入 `WITH CHECK` 的父行引用图；明确文件 link 的 SELECT 不反查文件表，以及结果发布门禁如何避免 summary/publication 双向引用。每张子表均需对应 `USING`/`WITH CHECK` 负向断言，不能用 `SECURITY DEFINER` 或宽泛放行解环。
5. **P2：`users.password_hash` 的业务账号列权限需明确取舍。** 矩阵允许学校读取本校成员、系统管理员读取账号；现有 `select(User)` 会加载整行，包含 `password_hash`。如果业务账号获得整表 SELECT，它能用直接 SQL 取得可见成员的密码哈希，RLS 不会隐藏列。[PostgreSQL 16 行安全说明](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)明确行策略与 `GRANT` 是不同层。设计需明确这是接受的数据库层残余风险，还是改为列级 GRANT 并调整业务身份/管理查询的投影；不能在没有记录的情况下称“最小权限”。认证账号为核验密码确需读取哈希，但不应由此自动扩给业务账号。

## 已核实的前提和边界

- 当前 ORM 元数据为 **28 表：16 表有 `tenant_id`、12 表没有**，与 R09 盘点一致。六种 `RoleCode` 与设计矩阵一致。
- `127.0.0.1:5433/paper_review_test` 当前连接账号可建测试角色；在该测试库创建唯一临时普通账号、用其凭据真实登录，并确认 `rolsuper=false`、`rolbypassrls=false`，随后精确删除。用于递归探针的唯一临时 schema 和角色也已删除。这只证明**夹具可建立**，没有证明未来 28 表 RLS 正确。
- [PostgreSQL 16 SET 文档](https://www.postgresql.org/docs/16/sql-set.html)确认 `SET LOCAL` 在事务结束后失效，回滚到设值之前的 savepoint 也会撤销该值。设计要求首次身份查询前绑定、同请求 commit 后重新绑定、池复用负向测试是必要的；本轮尚未实施或运行 SQLAlchemy 的这些测试。
- 当前文件拒绝审计在捕获未认证/失效 token 时使用业务 session 提交空 actor 事件。T06-2 必须改为受限认证 session 的独立事务，并先回滚可能已绑定候选上下文的业务事务；保留现有 401/404 与审计结果。平台/专家 `tenant_id=NULL` 的范围不能被当作跨校通配。上述路径本轮只做静态核对，尚未有新 RLS 运行证据。
- 本轮未运行全量后端/前端测试或浏览器矩阵；R08 的历史通过数字不作为本次验证。没有连接开发业务库、5432 或真实数据。

## 放行门槛

先按以上发现修订 T06 设计和实施计划，再由独立审查复核父行校验、认证账号权限、准确的匿名 purpose、无环依赖图和密码哈希列权限决定。复核通过后才单独启动 T06-1；当前 T06 实施仍为 **0/8**。本记录不授权提交、推送、合并或部署。
