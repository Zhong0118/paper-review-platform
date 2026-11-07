# F01–F03 最小补修契约

沿用 2026-10-02 复审，权限、token 和业务锁序不变，无新增迁移。

- F01：通过 PostgreSQL catalog dependency 闭包识别自有 schema、直属对象及其 internal/auto 子对象（如 rewrite、索引、约束和 TOAST）；拒绝闭包外的用户对象入向/出向依赖。系统 bootstrap 对象允许，非自有 schema 不默认允许。备份和 schema 清理门禁均检查；恢复执行删除的同一事务再次检查。适用现行停止写入的本地演练，不承诺抵御同时执行 DDL 的数据库超级用户。
- F02：schema 删除阶段核对 OID 与 nspowner（捕获的 owner role OID），后续阶段仍要求 schema 已不存在；保留角色及文件检查。
- F03：回避审计记录按 kind 分类的 before/after/added/removed 数量，集合去重后比较，能区分同数量替换且不记录导师姓名/学校 ID。资格与服务状态记录 before/after 状态；理由仅记录 reason_provided=true，不留存可能夹带个人信息的自由文本。资料修改仅记录 changed_fields 名称，不记录全文。所有成功记录与修改同事务，失败/409不新增成功记录。本项实现的是去敏变更摘要，不新增敏感历史档案。

执行顺序：失败探针→正式边界测试→最小实现→定向测试（含实际恢复 CLI）→统一检查。无提交或部署。
