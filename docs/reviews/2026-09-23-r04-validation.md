# R04 输入类型校验

范围：仅 username 与学校 code 的 before validator；使用 `127.0.0.1:5433/paper_review_test` 的临时 schema，未改开发库、未提交。

学校新增成员的 username 和系统新增学校的 code 各测试 `123`、`null`、`[]`、`{}`。修复前 8 项都因对非字符串调用 `.strip()` 抛出 `AttributeError`，合法大写/空格归一化用例通过。修复只让字符串执行 strip/lower，其他类型交给字段验证；失败请求均返回 HTTP 422 / `VALIDATION_FAILED`，学校、组织、账号及成员数量不变。

验证命令（设置 `DATABASE_URL` 指向独立测试库）：`pytest backend/tests/test_school_member_operations.py backend/tests/test_system_operations.py backend/tests/test_user_operations.py -c backend/pyproject.toml -q --tb=short --show-capture=no`。结果：25 passed、2 warnings，退出码 0。

未运行后端全套、前端或浏览器验收；统一验收属于 R08。
