# Slice 7A-1 File Integrity Implementation Plan

> Execute inline with executing-plans and test-driven-development. No subagents required.

**Goal:** 上传只属于作者的可编辑版本，已完成文件不可覆盖。
**Architecture:** 新增 prepare 时的版本外键，复用论文行锁，文件原子写入与完成时哈希核对。
**Tech Stack:** 现有 FastAPI/SQLAlchemy/Postgres、本地文件存储。
**Spec:** ../specs/2026-09-21-slice-7a1-file-integrity-design.md

## Tasks

- [x] 在 tests/test_file_lifecycle.py 添加真实 API 回归；先观察同校他人上传、完成后 PUT、旧版本 complete、重试链接错误等预期失败。
- [x] 修改 files/models.py、新增 0007 迁移；新文件绑定 upload_version_id，旧记录只读；验证迁移。
- [x] 修改 files/service.py，所有权检查及论文→文件行锁，complete 幂等且不重新绑定；submit/withdraw 锁刷新 ORM。
- [x] 修改 files/storage.py，临时文件原子替换；完成时核对大小/哈希；故障回归测试。
- [x] 独立数据库会话验证锁竞争：提交/撤回先完成时，迟到 PUT/complete 被拒；complete 先持锁时提交等待后读取完成结果。
- [x] 全后端回归、迁移测试、自查，更新 CURRENT 与本计划的验证记录。

Commands: backend/.venv/bin/pytest（在 backend 中执行 .venv/bin/pytest）；测试库只用 5433/paper_review_test，文件使用临时 STORAGE_ROOT。

## 验证记录

- 首轮 6 项 API 回归全部按预期失败，分别覆盖同校他人上传、草稿/提交后已完成文件覆盖、旧版本 complete、重复 complete 恢复旧绑定、哈希不一致。
- 存储故障测试先失败，加入原子替换后通过。
- 全后端回归：49 passed；含 5 项独立会话锁竞争、2 项旧数据迁移测试。保留原有 3 条依赖/测试事务警告。
- 测试基建在 paper_review_test 创建隔离 schema，实际执行 Alembic；结束清理该 schema，不删除已有测试数据。
- 本片不修改前端与 PDF 检测，不把已有测试通过当成后续切片验收。

- 补充真实 PUT 回滚→complete 拒绝→重新 PUT 恢复用例；49 项最终回归通过。临时移除论文锁后并发测试失败，恢复后通过。独立审查未发现可操作问题。
