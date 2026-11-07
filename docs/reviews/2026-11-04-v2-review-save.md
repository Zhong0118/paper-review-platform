# BUG-01/02 · 普通专家评阅草稿与暂存退出

切片规格：打开任务时取得完整草稿和 revision；无草稿为 0。PUT 要求 expected_revision，在该专家本人任务及现有事务锁内比较并保存，成功后递增；同一前版和相同的完整内容可安全重试。旧版不同内容返回结构化 409。正式提交继续使用原有 ACK 与命令幂等，并在同一锁下核对所见草稿版本。

浏览器编辑按本人和任务隔离，800ms 内合并，最多一个 PUT 正在执行。暂存退出、同页切换和离开路由先等待最后一份完整输入获确认；失败保留输入并允许重试；刷新/关闭时对未确认输入使用浏览器原生提示，不承诺异步请求一定完成。

## C-SAVE 接口契约

| 请求 | 成功 | 冲突、安全和兼容 |
| --- | --- | --- |
| `GET /api/v1/expert/tasks/{task_id}/draft` | 未保存：`data={"revision":0}`；已保存：现有完整表单字段及整数 `revision`。迁移前已有草稿从 1 开始。 | 专家只读自己的任务；未授权专家读同一 URL 返回 404。 |
| `PUT /api/v1/expert/tasks/{task_id}/draft` | 完整表单额外带 `expected_revision`；与服务器一致时，在原任务锁内保存并递增。回执含正文和新 `revision`。 | 旧客户端缺版本、非整数、负数均为 422。过期写入返回 409 和双方版本，不回显评语；仅当恰好是前一版且规范化完整正文等于当前正文时，重送视为同次确认，不递增。提交后返回状态冲突。 |
| `POST /api/v1/expert/tasks/{task_id}:submit-final` | 工作台先排空写队列，再发送完整表单、`expected_revision`、原有 `check_ack` 和独立的命令幂等键。相同命令遇响应丢失重试复用同键。 | 不含版本的旧直提命令按 0 处理，只能在没有草稿时首次生效。版本/表单/ACK 一起关联幂等内容；版本不进入评语检查摘要或正式意见。已成功的同命令重放优先于状态检查。 |

服务端沿用现有论文→任务行锁，使首次插入和既有草稿更新同样有序。网络结果不明时前端先重发原版本与原完整内容，再送最新输入；收到明确 422 则允许改正字段后重试。409 后不会自动采用服务器版本：表单保留本地各维度分值、逐项评价、总体意见等完整内容，用户可查看服务器的完整版本，明确选择采用服务器稿，或按所比较的版本提交当前输入；期间若又有人更新，仍会再次冲突。

同一页中身份或任务变化会隔离待发请求和过期回执；不在 URL、localStorage 或 sessionStorage 中存评语。临时关闭/强退不能保证异步网络完成，浏览器只有在允许原生离开提示时才会拦截。没有收到保存确认的输入只保留在当前页内存。

## 实测

- 修复前：受限 Postgres 上两条独立 HTTP 请求用同一初版写不同内容，结果为 `[200,200]`；立即退出的真实工作台组件没有发出 PUT；硬刷新事件未拦截。服务器回填曾错误触发编辑事件，这会污染普通评阅和更正面板的本地副本。
- 修复后：独立业务会话竞争得到 `[200,409]`。模拟首个成功响应丢失后原样重发，仍回 1；下一次有效编辑回 2；迟到的初版不覆写。过期正式提交 409，正式提交响应重放 200，正式提交后的草稿写入 409。
- 后端定向 **22 项通过**：`test_review_draft_cas.py`、`test_review.py`、`test_expert_workspace.py`、`test_review_integrity.py`、`test_rls_children.py::test_other_expert_cannot_read_draft_or_result_and_family_cannot_read_before_publish`。通过指定受保护启动器，只用 localhost:5433/paper_review_test 临时 schema。
- 前端定向 **64 项通过**：`realWorkspace.spec.ts`、`realReviewRules.spec.ts`、`reviewWorkspaceFlow.spec.ts`、`realCorrections.spec.ts`。覆盖离开、浏览器后退、同路由换任务、硬刷新提示、最后写入合并、网络中断、422 改正后重试、冲突比对、身份切换、提交 ACK 与同键重试、回填不触发编辑。类型检查和 Chrome 测试用独立输出目录的真实模式构建均通过。
- **真实 Chrome**，独立构建、受限运行角色、临时后端 18446 / Vite 15446：从最后一次真实 input 到点击暂存退出 **5.5ms**；拦住已成功的真实 PUT 回执时仍留在工作台，给回执后才跳转。重新进入时 GET=200、revision=1，六维分值、分项评价、结论和所有长文本逐一相等。第二个窗口以版本 1 写已到 2 的草稿收到 409，留住本地完整输入，能看到获胜窗口的版本。另一专家直接访问不显示表单，GET / PUT 均为 404，获胜版本未变。测试端口已关闭。
- [Chrome 脱敏结果](evidence/2026-11-04-v2-review-save/chrome-summary.json) · [重入工作台，完整恢复](evidence/2026-11-04-v2-review-save/restored-form.png) · [两窗口冲突，对照服务器版本](evidence/2026-11-04-v2-review-save/compare-conflict.png)。

Chrome 捕获的真实冲突回执（只移除了请求标识）：

```json
{"request_id":"[redacted]","code":"VERSION_CONFLICT","message":"草稿已在其他窗口更新","data":{"expected_revision":1,"current_revision":2}}
```

定向复跑（仓库根目录，数据库及存储使用统一入口同样的隔离配置）：

```sh
backend/.venv/bin/python -m pytest -q -c backend/pyproject.toml backend/tests/test_review_draft_cas.py backend/tests/test_review.py backend/tests/test_expert_workspace.py backend/tests/test_review_integrity.py backend/tests/test_rls_children.py::test_other_expert_cannot_read_draft_or_result_and_family_cannot_read_before_publish
cd frontend
node_modules/.bin/vitest run src/modules/review/__tests__/realWorkspace.spec.ts src/modules/review/__tests__/realReviewRules.spec.ts src/modules/review/__tests__/reviewWorkspaceFlow.spec.ts src/modules/result/__tests__/realCorrections.spec.ts
```

另补 799ms / 801ms 两侧退出的单飞与确认断言，均通过；它们已计入最终全量测试。
