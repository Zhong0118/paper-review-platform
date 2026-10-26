# R02 并发保护：锁顺序阻断及复核结果

状态：锁顺序变更已获用户确认并完成定向验证；不自动进入 R03。本次仅使用 `127.0.0.1:5433/paper_review_test` 的测试临时 schema；未改开发库，未提交。

已实现登录和刷新在签发前锁 User，刷新先无锁定位 user_id，再按 User → AuthSession 加锁并重新验证；撤销同样锁 User。租户暂停按稳定排序逐个锁 User。加锁的 Tenant 读取现在使用 `populate_existing`。并发测试覆盖重置先于刷新、签发先于重置、同 refresh 竞争，以及同一会话缓存 Tenant 后的锁读取。

独立复核发现规格 D2 未覆盖的锁环，测试 `test_member_reset_and_tenant_suspend_do_not_deadlock` 已在独立数据库复现 PostgreSQL `40P01`：成员重置持有 User 锁后，审计记录的 tenant_id 外键需要 Tenant 的 KEY SHARE；租户暂停先持有 Tenant FOR UPDATE，再等待该 User。两请求形成 User → Tenant 与 Tenant → User 的循环。单独把暂停改为 Tenant FOR NO KEY UPDATE 虽可消除此锁环，却会让暂停扫描成员后新成员插入并在提交前签发会话，可能漏撤销，因此没有采用。

用户已确认调整 D2：成员创建和已有成员命令都先锁 Tenant KEY SHARE 并确认仍为 ACTIVE；已有成员再按 membership → User → assignment 加锁，创建则继续插入新用户。租户暂停继续 Tenant FOR UPDATE → 按 user_id 排序的 User。认证签发按 User → AuthSession。成员、User、assignment 的锁查询也刷新 ORM 已缓存对象。学校及系统管理员的成员重置共用该成员加锁入口。

验证记录：

- `pytest backend/tests/test_auth_concurrency.py -c backend/pyproject.toml -q --tb=short --show-capture=no -k 'locked_tenant_read_refreshes_cached_status or member_reset_and_tenant_suspend_do_not_deadlock'`：修复前 2 failed，退出码 1。
- `pytest backend/tests/test_auth_concurrency.py -c backend/pyproject.toml -q --tb=short --show-capture=no -k 'not member_reset_and_tenant_suspend_do_not_deadlock'`：5 passed、1 deselected，退出码 0。
- `pytest backend/tests/test_auth_concurrency.py -c backend/pyproject.toml -q --tb=short --show-capture=no -k member_reset_and_tenant_suspend_do_not_deadlock`：1 failed，异常 SQLSTATE `40P01`，退出码 1。
- 同样排除死锁用例，另加 `test_token_revocation.py test_auth.py test_system_operations.py test_user_operations.py test_school_member_operations.py test_file_access.py`：61 passed、1 deselected、2 warnings，退出码 0。
- 修复后新增测试先红：缓存成员锁读取旧值、重置未持有 Tenant 屏障、暂停先提交时 `40P01`，3 failed，退出码 1；最小修复后 3 passed，退出码 0。
- 修复后 R02 并发测试加上上述六个回归文件：64 passed、2 warnings，退出码 0。
- 独立复核又指出学校创建成员未走 Tenant 前置锁。暂停先提交、在途创建后继续的新增测试先返回 200（预期 409），退出码 1；复用 `_lock_active_tenant` 后，认证并发、学校/系统成员及用户服务共 25 passed、2 warnings，退出码 0。复核者复看该修复后未报告第二个可证实的高优先级缺陷。
- 上述修复与 R03 合并定向回归：12 个测试文件、95 passed、2 warnings，退出码 0。

上述 pytest 均设置 `DATABASE_URL` 指向独立测试库。未运行全后端、前端或浏览器验收；它们属于 R08。R01–R03 集合已做独立安全/并发复核，资格暂停先提交的独立并发测试尚未覆盖。
