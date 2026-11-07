# 01、02、06、13 学校试用补充验收
2026-11-03。本地分支 codex/slice-7a1-file-integrity，基线 c299ed9，工作树未提交。数据库均使用 127.0.0.1:5433/paper_review_test 单次独立 schema；未新增迁移、未改 RLS，未连接开发库。所有图及下载样本均为虚构数据。

| 项目 | 真实模式交付 | 验收证据 |
|---|---|---|
| 01 送审前清单 | 本人原批次资格、服务端开放目录、编辑中的必填字段和两份材料合并提示；按缺项聚焦。资格暂停仅限制建新稿；附件不计作匿名稿；本地选件尚待服务端验证。 | [同时显示缺原稿、匿名稿](evidence/2026-11-03-school-pilot/01-checklist.png)。回归包含关闭专业、暂停资格及旧草稿仍能提交。 |
| 02 命中导航 | 复用绑定匿名版的受控预览。每条有页码的命中都可打开，支持同页和跨页“上/下一处”；任一输入失效就撤销旧预览。 | [Chrome 实际显示第 2/2 页](evidence/2026-11-03-school-pilot/02-hit-navigation.png)。同页两处前后切换、非页码命中和换文件失效由组件测试覆盖。无页内坐标高亮或 OCR。 |
| 06 匿名评阅书 | 学校下载本校有效发布快照的 PDF，含发布时间的上海日期、发布版本、匿名论文编号、六维评分、总分、结论及三项已发布意见。PDF 的结构化字段不取专家身份或更正私有备注，不对正式自由文本做自动脱敏或改写。 | [Chrome 下载的实际评阅书](evidence/2026-11-03-school-pilot/06-anonymous-review.pdf)。受限角色的更正测试读出确认前 80 分/v1、确认后 90 分/v2；禁止学生调用学校导出接口，跨校/未发布不可导出。渲染检查中文及布局，用长样本验证 9 页末段与字面尖括号无丢失。 |
| 13 批次收尾核对 | 按本校指定批次、全时段只读查询，分组展示未发布且未终止的论文、未结异议、待学校确认更正；计数从同一份明细产生。逐项进入论文、异议或具体更正记录；不改变归档条件。 | [Chrome 收尾清单](evidence/2026-11-03-school-pilot/13-closeout.png)：点击后打开对应异议。API 验证跨校拒绝、终止排除、办结/确认后移出清单。 |

## 实际结果
后端上述五个测试文件 **31 passed**（347.81 秒，2 条依赖弃用警告），终止排除/跨校和暂停资格投影另复验 **2 passed**，与 31 有重叠。前端全量 **74 文件、528 passed**；类型检查、真实构建、Chrome 四场景、PDF 渲染均退出 0。验收服务已停止。未把测试数量与旧报告合并。

## 如何复验
后端使用仓库虚拟环境、独立临时 STORAGE_ROOT，预先确认 DATABASE_URL 目标为本机 5433/paper_review_test；测试夹具自行创建与回收 schema。前端 Vitest 按仓库默认配置，真实模式开关仅用于构建及浏览器服务。
- 后端定向：`backend/.venv/bin/python -m pytest -c backend/pyproject.toml -q --tb=short backend/tests/test_batch_closeout.py backend/tests/test_objections.py backend/tests/test_result_corrections.py backend/tests/test_eligibility_operations.py backend/tests/test_thesis_submit.py`。
- 前端：在 frontend 运行 `./node_modules/.bin/vitest run --maxWorkers=4`、`./node_modules/.bin/vue-tsc --build`、`VITE_DEMO_MODE=false ./node_modules/.bin/vite build`。
- 浏览器：在独立的 published 验收场景创建另一虚构学生草稿和原校开放异议。另一学生在真实编辑页核对缺项、上传带两页身份命中的匿名稿、点击检测后前后导航；学校登录后在结果页下载 PDF，再在批次中点击未结异议。四场景通过，无未捕获的页面错误。学校与学生使用独立浏览器会话。
- 回归前先观察过的失败：清单和逐条跳页元素不存在、导出/收尾接口 404、附件被认作匿名稿、历史更正可能被默认选中。一次前端全量发现演示错误提示变化，已保留原提示并重验。

不含：后端全库回归、非 Chrome 浏览器、实际学校资料、正式部署和目标主机印刷字体兼容。本次验收时 20 仅有设计，随后的独立实现见[20 本地验收](2026-11-03-school-programs-validation.md)；后续候选见[执行计划](../superpowers/plans/2026-11-03-school-pilot-additions.md)。
