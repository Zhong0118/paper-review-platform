# 7C-1 实施计划

规格：[review-integrity](../specs/2026-09-21-slice-7c1-review-integrity-design.md)。在既有开发分支 inline 实施，保留上一轮未提交的审查材料。

1. 新增 tests/test_review_integrity.py，复用独立会话 fixture；覆盖旧对象、实际锁等待、回滚、HTTP 并发幂等及请求体变化。运行并记录 RED。
2. get_task_for_expert 增加可选锁定刷新；save_draft/submit_final 使用；路由在缓存前锁定并使用规范化完整评分内容。运行定向 GREEN。
3. 跑后端全套、审查改动，记录边界与测试结果；更新 CURRENT 和路线下一步为 7C-2。不推送、不合并、不处理其他审查缺陷。

## 执行记录

- RED：新测试首批 7 failed / 2 passed；额外真实锁等待测试 3 failed / 1 passed。失败分别对应旧对象绕过状态、改内容幂等不冲突、同任务并发、草稿未等待锁。
- GREEN：`pytest tests/test_review_integrity.py tests/test_review.py -q` → 17 passed。
- 全套：`STORAGE_ROOT=<临时目录> .venv/bin/pytest -q` → 62 passed，3 个既有警告（依赖弃用与异议测试事务警告）；测试数据库为 5433/paper_review_test 的隔离 schema。
- 修改范围：dispatch/service.py、dispatch/router.py、review/service.py；新增 tests/test_review_integrity.py。未改前端和数据库结构。
- 独立代码复核：未发现本片范围内的阻塞问题。待补强的小项：HTTP 并发测试尚未精确控制路由缓存查询前的交错；服务层已有确定性 pg_blocking_pids 锁等待测试。未为此引入测试钩子或修改生产接口。
- 兼容性：旧提交缓存复用 key 会冲突；历史分数不自动修复；其他审查问题由后续切片处理。
- 保留工作分支，不推送或合并；下一片 7C-2。
