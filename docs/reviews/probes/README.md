# 2026-09-21 审查诊断

这些脚本用于重现审查时的缺陷，**断言或打印的是有问题的现状**，不是正式回归测试，不加入常规测试套件。修复时需改写为断言正确业务行为的测试。

基线 `12ab023`，使用现有 backend 测试 fixture、独立测试库与迁移隔离 schema。仅在开发测试环境运行，从 `backend/` 目录执行：

```sh
STORAGE_ROOT=$(mktemp -d /tmp/paper-review-audit.XXXXXX) .venv/bin/pytest \
  ../docs/reviews/probes/test_download_audit.py \
  ../docs/reviews/probes/test_integrity_audit.py \
  -c pyproject.toml -q -s
```

原始运行时脚本位于 `/tmp`，归档只调整文件名；输出见 `2026-09-21-observed-results.txt`。8 个诊断用例观察到下载 token 复用/审计缺失、复用文件读取异常、草稿删除外键异常、冻结元信息被修改、正式评分被覆盖、幂等请求体遗漏、发布内容漂移及异议顺序问题。
