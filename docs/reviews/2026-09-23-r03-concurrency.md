# R03 新建论文与批次/资格并发验证

范围：仅 R03，独立测试库 `127.0.0.1:5433/paper_review_test` 的临时 schema。未迁移开发库、未提交或部署。

修复前运行 `PYTHONPATH=backend backend/.venv/bin/python docs/reviews/probes/t05_batch_race.py`（`DATABASE_URL` 指向独立测试库）：退出码 0，但 close、archive、create 均返回 200，数据库出现 `ARCHIVED / DRAFT`。该探针是缺陷证据，不作为修复后的验收命令；它的同步等待方式在正确加锁后会使双方互等。

新增 `test_batch_creation_concurrency.py` 覆盖创建先于关闭、关闭先于创建、同批次双重创建，以及创建与资格停用交错。修复前首轮 3 failed / 1 passed；资格停用用例改为创建先持门禁并独立探测资格锁后，单跑先失败。失败分别表现为未持有 batch/eligibility 锁、关闭先提交后仍创建成功、双重创建出现请求异常。

现在 `create_draft` 先无锁定位候选资格，再按 batch → student membership → eligibility 加锁并用刷新后的对象复核租户、关系、ACTIVE/ELIGIBLE/OPEN；锁覆盖查重和插入，直到路由提交。关闭或归档仍通过原有 batch 锁串行，资格停用通过原有 eligibility 锁串行。既有草稿在 `SUBMISSION_CLOSED` 的编辑和提交语义未改。

修复后命令（均设置独立测试库 `DATABASE_URL`）：

- `pytest backend/tests/test_batch_creation_concurrency.py -c backend/pyproject.toml -q --tb=short --show-capture=no`：4 passed、2 warnings，退出码 0。
- `pytest backend/tests/test_batch_creation_concurrency.py backend/tests/test_batch_operations.py backend/tests/test_eligibility_operations.py backend/tests/test_thesis_integrity.py backend/tests/test_thesis_submit.py -c backend/pyproject.toml -q --tb=short --show-capture=no`：30 passed、2 warnings，退出码 0。
- 独立复核补出的 R02 成员创建锁修复后，R01–R03 相关的 12 个定向测试文件合并运行：95 passed、2 warnings，退出码 0。

R01–R03 集合独立安全/并发复核未发现 R03 可证实的高优先级缺陷。资格暂停先提交的独立并发用例仍未覆盖；当前源码在锁后复核资格状态，但这一路径尚无专门交错测试。未运行后端全套、前端与浏览器验收；统一验收属于 R08。
