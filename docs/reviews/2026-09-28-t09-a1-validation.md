# T09-A1 本地访问日志去敏验收

分支 codex/slice-7a1-file-integrity，HEAD 39a8962；保留原工作树，未提交/推送/部署。

修改 logging.py 增加标准 Uvicorn 五元组 query 删除和未知访问记录固定占位；main.create_app 安装去重。HTTP请求与令牌语义、RLS、锁序不变。

实际运行：
- `backend/.venv/bin/pytest backend/tests/test_access_logging.py -c backend/pyproject.toml -q --tb=short -x`：首次退出1，缺少 RedactAccessQueryFilter。
- 实现后同文件不带-x：退出0，9 passed / 1 warning，6.45秒。
- `backend/.venv/bin/pytest backend/tests/test_access_logging.py backend/tests/test_file_access.py backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short`：退出0，33 passed / 2 warnings，36.95秒。

两个真实 Uvicorn 子进程（CLI 与 acceptance accepted）均执行GET；隔离专家匿名PDF下载200，正式提交后旧链接404，无效query拒绝；内存检查全部日志不含合成query或有效下载凭据，方法/路径/状态保留。子进程SIGINT退出，测试schema前后集合一致、临时storage不存在；未使用开发库。测试未将token写入验收文档。

代理/CDN日志、浏览器、生产环境NOT RUN；本项无需前端改动。后续T09-A2生产配置门禁。
