# T06 RLS 设计审查修订记录

日期：2026-09-24。状态：**修订稿经[独立复核](2026-09-24-t06-rls-design-rereview.md)在设计层放行，T06 实施 0/8**。本轮只修改设计、计划和交接文档；没有改业务代码、运行 RLS 迁移或连接开发数据库。原[独立审查](2026-09-24-t06-rls-design-review.md)的发现保留作追溯。

| 原审查发现 | 修订落点 | 待复核证据 |
|---|---|---|
| P1 父行示例同名列误绑定 | `round_school_insert` 的内外表列均显式限定；T06-5 增加已知 A/B UUID 混搭 INSERT/UPDATE 红灯 | 真实非 owner SQL 策略与跨校写入测试 |
| P1 认证账号读不到租户 | T06-4 明确认证账号读取 `tenants.id/code/status` 的列 GRANT、RLS SELECT 分支和 ACTIVE/SUSPENDED 回归 | 登录、刷新、暂停学校撤销与认证账号越权测试 |
| P1 匿名 purpose 大小写 | 统一为数据库实际的 `'anonymous'`；T06-7 覆盖匿名可读、原文不可读、旧任务 token 不可读 | 真实非 owner 专家与文件 HTTP 测试 |
| P1 SELECT 策略可能递归 | 列出 28 表 SELECT 直接引用图；文件 link SELECT 不查文件、summary SELECT 不查 publication；T06-5 用任务论文键解除论文/轮次/任务读环 | 实际策略 DDL 拓扑、普通账号逐表 SELECT/INSERT/UPDATE 无 `42P17` |
| P2 业务账号可读密码哈希 | 选择列级 GRANT 拒绝业务账号 SELECT `users.password_hash`；ORM 默认延迟加载，认证登录显式加载 | 直接 SQL 列权限及登录、重置回归 |

修订时又发现两条原计划未排除的**写策略回环**：任务写策略若查轮次，会经轮次→论文→任务的 SELECT 链回到任务；文件 link 写策略若查文件，会经文件→link 的 SELECT 链回到 link。设计现要求任务/轮次/论文关系由 `expert_tasks.thesis_id` 和复合外键约束，任务写策略不查轮次；T06-7 给 link 增加 `tenant_id` 与 `thesis_id`，以两个复合外键约束版本与文件属于同一论文、租户和 purpose，link 写策略不查文件。旧 link 从版本回填，旧任务从轮次回填，旧数据不一致时迁移拒绝。草稿复制 link 到新版时文件的 `upload_version_id` 可能仍指旧版，因此约束不把两者强制相等。静态图不能代替真实数据库探针。

独立复核过程中又指出邀请阶段的列暴露：若专家可 SELECT `thesis_versions` 行以读取标题，数据库直查还会得到同一行的摘要和关键词。修订稿现让专家的版本行 SELECT 拒绝；`review_rounds.anonymous_title` 在确认送出时快照版本标题，并从旧轮次关联版本回填。专家列表/邀请改读轮次快照，匿名文件 link 的专家分支用轮次、任务和论文判断，不要求版本行可见。此变更保持原 API 标题，同时把直接 SQL 负向断言加入 T06-5；仍需审查实际 DDL 和迁移。

同一轮独立复核还发现同校跨论文文件错挂：仅按租户/purpose 约束 link 时，另一篇同校论文的匿名文件可被挂到当前版本。现追加 `file_objects.thesis_id`，从上传版本或已有 link 唯一回填；无法归属的旧孤儿保持 NULL、禁止新 link 引用。新上传写明论文 ID，删稿解除 link 后将保留文件的 `upload_version_id` 和 `thesis_id` 同时置 NULL。文件上传版本、文件所属论文与 link 版本/论文由复合外键校验；同校跨论文 file ID 成为直接 SQL 负向断言。二次复核还要求明确删稿 UPDATE 的无版本新行分支，该分支及回归已写入设计和计划；最终复核在设计层放行。

源码定位确认 `ExpertTask(...)` 只有派单服务和 `test_dispatch_result_integrity.py` 的旧任务构造器两个调用，`ThesisVersionFile(...)` 有文件完成、论文草稿复制及 `test_file_migration.py` 三个调用。实施计划已把这些构造器和 ORM 复合约束声明纳入相应切片，避免新增非空列破坏旧测试或迁移元数据漂移。

本轮静态检查按文档解析出 **28 表、26 条 SELECT 直接引用边，无环**；手工列出的 20 条写策略父表引用边按 SELECT 闭包检查，没有返回写入表的路径。此检查仅验证修订图，尚未验证实际策略 DDL。文档链接与空白检查通过；没有执行后端/前端测试、浏览器验收或 RLS SQL。**下一项可单独执行 T06-1。** Hosted CI、生产 RLS、部署和真实数据均未覆盖。
