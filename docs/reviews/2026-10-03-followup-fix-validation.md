# F01–F03 补修验证

日期：2026-10-03。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`。保留全部既有未提交/未跟踪工作；无新迁移、无前端改动，未提交/推送/部署。数据库仅本机 5433/paper_review_test 独立 schema。

## 改动

- `backend/scripts/recovery_drill.py`：递归检查 schema 自有对象及 internal/auto 子对象的 catalog 依赖；拒绝闭包外入向/出向用户对象依赖。备份、清理门禁和恢复 DROP 同事务前检查；schema OID 和当前 nspowner 均须匹配。保留角色属性、文件 inode 和测试库门禁。
- `backend/app/modules/expert/service.py`：回避按类型记录 before/after/added/removed 数量；资格/服务状态保留前后状态，资料修改保留字段名，理由仅保留存在标记。无导师姓名/理由自由文本/密码全文。同事务审计，不改 RLS、token 或业务锁序。
- `backend/tests/test_candidate_followup.py`：8 项正式回归，覆盖入向/出向依赖、备份后依赖、所有者变化、精确审计摘要、去重/等量替换/无变化、409/422及事务失败整体回滚。
- 最小字段契约见 [补修契约](2026-10-03-followup-fix-contract.md)。历史探针与复审失败记录保留。

## 实际命令和结果

1. 原始探针：`PYTHONPATH=backend backend/.venv/bin/pytest docs/reviews/probes/test_2026_10_02_candidate_review.py -c backend/pyproject.toml -q --tb=short --show-capture=no`，修复前退出 1，3 failed / 2 warnings，6.76s。
2. 正式用例首轮：`backend/.venv/bin/pytest backend/tests/test_candidate_followup.py -c backend/pyproject.toml -q --tb=short --show-capture=no`，修复前退出 1，4 failed / 2 warnings，10.09s；不是环境错误，两个依赖方向、owner与审计均未达到预期。
3. 首轮最小修复：`backend/.venv/bin/pytest backend/tests/test_candidate_followup.py backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short --show-capture=no`，退出 0，19 passed / 2 warnings，42.18s。包括真实 PostgreSQL dump/restore 与恢复 CLI。
4. 扩展定向：`backend/.venv/bin/pytest backend/tests/test_candidate_followup.py backend/tests/test_recovery_drill.py backend/tests/test_expert_operations.py -c backend/pyproject.toml -q --tb=short --show-capture=no`，退出 0，49 passed / 2 warnings，121.41s。
5. 追加原子性用例：`backend/.venv/bin/pytest backend/tests/test_candidate_followup.py::test_audit_failure_rolls_back_conflicts_version_and_event -c backend/pyproject.toml -q --tb=short --show-capture=no`，退出 0，1 passed / 2 warnings，1.73s。
6. `./scripts/check.sh`：退出 **0**。后端 **414 passed / 2 warnings，623.45s**；前端 **454 passed / 61 files**；类型检查、真实模式构建均 exit 0。完整本机日志 `/tmp/paper-review-followup-20261003-check.log`（临时文件，不作为跨机器交接依赖）。两项后端警告为 crypt/argon2 弃用；构建有依赖 PURE 注释与大于 500 kB chunk 提示，未放宽构建检查。

7. 原始 3 项探针修复后按第 1 条命令重跑：退出 **0**，**3 passed / 2 warnings，5.20s**，断言未删减。
8. 最后只读查询 `review_probe_%` 和严格 `^test_[0-9a-f]{32}$` schema 数量均为 **0**；`git diff --check` 退出 **0**。

**结果：F01–F03 补修及本轮全量复验通过，恢复本地候选封板；B 阶段仍待条件与授权。**

## 边界

本轮不新增业务功能，无 UI 改动，不重新声明浏览器 PASS；此前浏览器矩阵继续作为历史证据。恢复门禁依据 PostgreSQL catalog 的依赖，适用现行停止写入的隔离演练；不声称能分析任意动态 SQL 文本或抵御同时修改 catalog 的超级用户。真实旧数据、目标主机、生产备份恢复及 B 阶段均未执行。

理由和回避不建立敏感全文历史档案，当前交付为去敏变化摘要；如需可回放的完整敏感档案，应另定访问权限与保存期限，不把全文直接塞进 audit detail。
