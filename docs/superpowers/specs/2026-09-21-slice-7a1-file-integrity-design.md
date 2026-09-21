# 切片 7A-1：文件归属与不可变性

依据：用户批准按后续开发规划逐步执行。只修上传生命周期；PDF 解析、下载授权和前端阅文留给后续切片。

- FileObject 新增 nullable `upload_version_id` 外键，指向 prepare 时的 ThesisVersion。新上传必须写入；历史记录留 null，禁止 PUT/首次 complete，不猜测原始绑定。历史已完成记录可幂等 complete，不重新绑定；原有版本文件关系和读取保持。
- prepare 必须是当前租户论文作者，且论文 DRAFT、当前版本 editable。同校他人和跨校返回 RESOURCE_NOT_FOUND。
- put/首次 complete 校验上传人、学生角色、租户、版本所属论文作者、当前版本及可编辑阶段。按论文行→文件行顺序锁定并刷新 ORM 状态；与 submit/withdraw 共用论文锁。
- completed_at 非空后 PUT 409。重复 complete 只返回原记录，不触碰内容、时间、链接；完成前未写文件返回 FILE_NOT_READY。
- 新版本替换文件必须 prepare 新 file_id。迟到的旧版本 complete 返回409，不绑定到当前新版本。旧文件可由多个版本引用而不被覆盖。
- pending 文件写入使用同目录临时文件及原子替换；完成时核对实际大小与 SHA256，数据库事务回滚造成的不一致不得通过 complete。只允许合法草稿重新 PUT 恢复 pending 内容。
- 锁等待后刷新论文/文件状态；提交、撤回的论文锁读取同样刷新，避免已有 ORM 实例过期。
- 数据迁移只加 nullable 列及外键；发出历史写入关闭的数量提示，不修改旧链接、文件或哈希。回退只移除新列/外键。
- 验收：真实 Postgres 的跨用户、完成后覆盖、延迟 complete、重试不重绑、旧版本保持、写入故障与独立会话并发测试；空库及含历史文件的升级验证。
