# R06 批次编辑冲突后丢弃旧表单

范围：仅 `BatchRulesPage.vue` 的编辑 PATCH 409 处理与页面回归测试。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；保留既有未提交工作，未提交、推送或部署。本项不使用数据库。

先增加两项测试：刷新后批次已 OPEN、无 EDIT 动作时，旧编辑表单必须消失；刷新后仍为 DRAFT 时，必须重新打开并用服务端最新版本提交。修复前定向测试 3 通过、2 失败，均因旧表单在 409 后仍存在。修复只在 `submitBatch` 的 409 分支中清空编辑模式和编辑对象，再刷新批次列表；新增批次表单语义及 `updateBatch` 输入未变。

验证命令：

- `cd frontend && node_modules/.bin/vitest run src/modules/school/__tests__/realBatchRules.spec.ts`：5 passed，退出码 0。
- `cd frontend && node_modules/.bin/vue-tsc --build`：退出码 0。
- `git diff --check`：退出码 0。

未运行前后端全套或浏览器强制 409 场景；统一验收归 R08。R06 交付边界已到，下一项为 R07。
