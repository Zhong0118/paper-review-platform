# 7A-2 实施步骤

1. 生成真实 PDF 测试材料，先运行校验/匿名检测失败回归。
2. 实现有限范围的 PDF 检查与抽取、上传实际字节上限、完成与提交校验；替换旧伪 PDF 测试材料，保留故障测试。
3. 定向/全套/独立复核，更新 CURRENT 与依赖安装说明。无迁移、推送或合并。

## 执行记录（2026-09-21）

- RED：最初真实 PDF 回归 12 failed / 2 passed，复现压缩中文身份漏检、伪造/损坏 PDF 放行、上传上限缺失与历史伪 PDF 可提交。修正大小测试的设置方式后再次确认同样失败。
- GREEN：初始 14 项全部通过；替换既有伪 PDF fixture 后全套 111 passed。
- 独立复核发现内联图片与异常控制字符可能 PASS。内联图片新增真实样本先复现失败再修复；控制字符使用复核提供的真实内容流复现材料补回归。两项最终均进入 REVIEW_REQUIRED。
- 最终：独立 Postgres 5433 / paper_review_test 隔离 schema，`pytest backend/tests -c backend/pyproject.toml -q` **119 passed，3 warnings，84.17s**；22 项为本批新增。复核修复后定向 2 项通过；compileall 与 git diff --check 通过。
- 三项警告仍为 crypt 弃用、argon2 版本读取弃用、原有异议测试事务 warning；不将警告说成零。
- 新依赖 pypdf 6.19.0（运行）及 ReportLab 4.5.1（测试）已安装并写入 pyproject。README、配置示例与 CURRENT 已更新。无需新增迁移，未改开发业务库。
- 默认 50 MiB 是暂用开发假设，可通过 MAX_UPLOAD_BYTES 调整；用户尚未指定其他值。PDF 页数/解压内容/字符检查并非严格进程级内存和 CPU 隔离；所有自动 PASS 仍有学校人工门禁。
- 下一批：7B-1 专家真实材料阅读与准确 task_id，先写规格/失败测试。
