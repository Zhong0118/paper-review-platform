# 专家任务页当前分组

验收口径：进入专家任务页时，双盲信息栏右侧显示当前选中的分组名称。手动切换时，即使分组没有任务，顶部名称也与选中标签一致。默认选组、任务筛选和接单流程保持原行为。

回归：新增用例在修改前失败（预期“评阅中”，实际“待接受”）。修改后，在 `frontend` 运行 `node_modules/.bin/vitest run src/modules/review/__tests__/realWorkspace.spec.ts src/modules/review/__tests__/expertTaskFlow.spec.ts`，34 项通过。`VITE_DEMO_MODE=false npm run build`（含类型检查）退出 0。

浏览器：Chrome 加载上述真实模式构建，连接 `5433/paper_review_test` 独立 schema 的 `accepted` 验收场景。虚构专家登录后默认显示[评阅中（1 条）](evidence/2026-11-03-expert-task-group-label/in-review.png)。依次点击待接受、已完成、已拒绝、已撤销、[需要更正（空分组）](evidence/2026-11-03-expert-task-group-label/correction-empty.png)，再切回评阅中。每次顶部名称都与选中标签一致：五个空分组显示暂无任务，切回后恢复同一条任务。无未捕获页面错误或失败的 API 响应；验收服务及临时资源已关闭清理。
