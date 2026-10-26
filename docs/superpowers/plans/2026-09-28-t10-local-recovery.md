# T10-A Local Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution; no automatic commit/push/deploy.

**Goal:** 用原生数据库备份和匹配文件包完成一次可重复、仅自有测试资源的灾难恢复。

**Architecture:** 单个演练脚本封装资源所有权、停写、导出、校验、同名重建、恢复后普通角色验证；不提供任意目标恢复参数。

**Tech Stack:** Python subprocess/pathlib/hashlib/json、PostgreSQL pg_dump/pg_restore、现有 isolated_runtime_roles/验收 helper。

**Spec:** [恢复设计](../specs/2026-09-28-t10-local-recovery-design.md)。

2026-09-28预检的[工具链阻断及清理边界复核](../../reviews/2026-09-28-t10-toolchain-blocker.md)已由容器内16版客户端和严格所有权清理解除；2026-10-02本地完成，实际证据见[T10-A验收](../../reviews/2026-09-28-t10-a-validation.md)。

## Global Constraints

- 只接收本机 5433/paper_review_test，source 必须由当前运行创建；开发库、旧工作树、他人资源只读且不清理。
- 不读取并打印秘密；密码只在0600临时 PGPASSFILE；归档不提交、不上传。
- source storage 与 archive 目录隔离；保留角色/owner/ACL/RLS；不替换 dump SQL、不用 row-security 部分备份。

### T10-A1：自有备份与拒绝门禁

**Files:** 创建 `backend/scripts/recovery_drill.py`、`backend/tests/test_recovery_drill.py`；必要时从 `backend/scripts/acceptance_server.py` 提取虚构准备 helper，保留原默认清理契约；不修改业务模块。

**Interfaces:** 脚本内部 `backup_owned_resources(owned, archive_dir) -> manifest`、`validate_bundle(manifest, archive_dir) -> None`；owned 由运行过程生成，不从用户 JSON 反序列化授予删除权限。CLI 本片允许内部 dry-run 到备份验证为止，默认不做破坏；A2 接好后默认运行完整演练。

- [x] 先写失败测试：错误库/端口、他人 schema、schema OID 改变、目录 inode 不符、storage 越界/符号链接、completed 文件丢失、archive 目录位于 source 内时，subprocess/drop 从未执行。示例结构：

```python
with pytest.raises(ValueError):
    validate_bundle(tampered_manifest, archive_dir)
assert destructive_calls == []
```

测试里的 tampered_manifest 使用合法基准包逐项改坏，不凭 mock 返回 PASS。

- [x] `backend/.venv/bin/pytest backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short -x` 记录红灯。实现最少所有权/manifest/校验逻辑；subprocess 参数数组按设计，schema 用受控 UUID 名并通过 SQL identifier 引用。
- [x] 在真实测试 schema 生成有原文、匿名 PDF、草稿/正式结果的数据，停写后 dump，核对 TOC、全部表计数、文件 hash。模拟 dump 退出非0，断言源未删除。记录 pg_dump/服务端版本与实际命令的去敏形式。
- [x] 同一测试命令复验及 `backend/tests/test_acceptance_server.py`；退出时只清理自身资源。交付本片不声称恢复已通过。

### T10-A2：同名重建、失败演练与验收

**Files:** 扩展 `backend/scripts/recovery_drill.py`、`backend/tests/test_recovery_drill.py`；创建 `docs/reviews/2026-09-28-t10-a-validation.md`、`docs/operations/pilot-recovery-runbook.md`（只描述已实现本地演练，生产引用 B 阶段门禁）。

**Interfaces:** `restore_owned_resources(owned, manifest, archive_dir)` 只在 A1 全部验证且 source 已停写后可执行；恢复 source 精确名字/路径；CLI 运行完整自有生命周期。

- [x] 红灯：损坏 dump/文件先拒绝且源仍在；目标被替换成非自有目录拒绝；pg_restore 非0时不启动应用；恢复成功后原 ID/行数/hash/规则/结果一致。
- [x] 按设计在单事务原生恢复；失败不能用 --clean 或降级擦除数据“重试”。三个自有角色留到验证结束；HTTP 使用普通账号，不用管理员连接冒充 RLS 验收。
- [x] 验恢复后的本人材料/结果 200，专家原文/外校结果 404；检查全部28表 FORCE RLS、业务非 owner/BYPASSRLS、hash不可读。验证提交/发布主链，测试旧token撤销场景按备份时间点解释，不伪称可跨恢复撤销。
- [x] 演练事务失败回滚及备份后虚构写入的恢复撤销；不更动当前 checkout。旧应用构建兼容回退明确归T10-B，本地不声称已验证。
- [x] `PYTHONPATH=backend backend/.venv/bin/python -m scripts.recovery_drill`、上述 pytest、`git diff --check`；记录实际退出码、备份/恢复耗时、成功和失败清理结果。不为纯脚本片重复前端全量，T11-A2 统一收口。
