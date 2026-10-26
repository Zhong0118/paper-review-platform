# T05-B 后端检查点

日期：2026-09-23。分支：`codex/slice-7a1-file-integrity`；HEAD：`39a8962`。本检查点改动仍在工作树，未提交、推送、合并或部署。

## 已交付

- `audit` 统一请求摘要、幂等重放和写入；相同用户/幂等键的并发请求在事务内串行读取，避免唯一约束错误。旧论文路由通过薄转发继续使用该能力。
- `user` 建立学生、导师、学校管理员账号，并提供成员编辑、启停、密码重置和会话撤销。
- 系统管理员 `/api/v1/system/tenants` 可列出、原子建立学校、暂停/恢复学校；`/tenants/{tenant_id}/reviewers` 可列出、新增、启停及重置管理员密码。
- 学校管理员 `/api/v1/school-admin/batches` 可列出、建立、编辑、开放、关闭提交及归档批次；`/members` 可维护本校学生/导师；`/batches/{batch_id}/eligibilities` 可列出/建立资格，`/eligibilities/{id}` 可暂停/恢复资格。
- `0008_identity_invariants` 固定一账号一角色；`0009_pilot_operations` 增加批次 `version` 与两个列表索引。迁移升降级和旧文件/身份迁移回归均已测试。
- `seed_database` 按学生与批次定位种子资格，已有其他历史批次时可再次运行。

## 本次验证

所有数据库测试使用宿主机 5433 的 `paper_review_test`，由 `migrated_test_schema` 创建独立 `test_*` schema；全套使用独立临时 `STORAGE_ROOT`，命令完成后自动删除。未迁移开发业务库。

| 命令 | 结果 |
|---|---|
| `backend/.venv/bin/pytest backend/tests/test_system_operations.py backend/tests/test_batch_operations.py backend/tests/test_school_member_operations.py backend/tests/test_eligibility_operations.py backend/tests/test_auth.py backend/tests/test_operations_migration.py -c backend/pyproject.toml -q --tb=short` | 36 passed，2 warnings；退出码 0 |
| `backend/.venv/bin/pytest backend/tests/test_idempotency_service.py backend/tests/test_review_integrity.py backend/tests/test_termination_reassignment.py backend/tests/test_thesis_submit.py -c backend/pyproject.toml -q --tb=short` | 35 passed，2 warnings；退出码 0 |
| 在临时 `STORAGE_ROOT` 中运行 `backend/.venv/bin/pytest backend/tests -c backend/pyproject.toml -q --tb=short` | 193 passed，3 warnings；退出码 0 |
| `git diff --check` | 退出码 0 |
| 查询 `paper_review_test` 中名称匹配 `test_*` 的 schema 数量 | 0 |

全套警告为 `passlib` 对 Python `crypt`、argon2 版本属性的弃用提示，以及既有 `test_open_objection_unique_per_thesis` 的 SQLAlchemy transaction 警告；均未造成测试失败。

## 边界与下一项

本检查点只验收后端。真实运营页面尚未接线，前端测试、类型检查、真实模式构建和浏览器闭环将在 T05-C 执行。生产 RLS、正式数据、部署与高负载并发不在本检查点；T06/T09 仍是上线门禁。下一项从实施计划 T05-C Task 9 的 API 客户端开始。
