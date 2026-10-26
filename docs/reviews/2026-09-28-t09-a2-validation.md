# T09-A2 生产配置与演示 seed 门禁

分支 codex/slice-7a1-file-integrity，HEAD 39a8962；全部原工作保留，无提交/推送/部署。

config.py production 拒绝默认/空白/不足32字节JWT及默认/空白seed口令，Pydantic错误隐藏输入。seed.py在函数和CLI建立会话前拒绝production；README明确生产管理员引导尚未交付。

实际验证：
- `backend/.venv/bin/pytest backend/tests/test_production_safety.py -c backend/pyproject.toml -q --tb=short -x`：首次退出1，production默认JWT没有抛错。
- `backend/.venv/bin/pytest backend/tests/test_production_safety.py backend/tests/test_access_logging.py backend/tests/test_rls_roles.py backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short`：退出0，36 passed / 2 warnings（22.30秒）。
- `./scripts/check.sh`：退出0，后端313 passed / 2 warnings（457.05秒）；前端430 passed / 59 files；类型检查、真实模式构建通过。
- `bash scripts/tests/check_test.sh`：退出0，behavior tests passed；`git diff --check`退出0。

仅测试5433/paper_review_test，沿用唯一schema/角色与临时storage自动清理。未迁移开发库；配置负例使用虚构输入且不读取.env。浏览器、Hosted CI、反向代理/CDN、部署及正式管理员引导未验证。T09-A两项本地完成，T09整体未完成，下一项T07-1。
