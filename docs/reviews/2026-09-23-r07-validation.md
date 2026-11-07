# R07 历史论文身份与批次展示

范围：论文详情投影、真实编辑页身份来源及对应前后端测试。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`；保留所有既有未提交工作，未提交、推送或部署。后端测试仅用 `127.0.0.1:5433/paper_review_test` 的独立临时 schema。

先新增后端用例：旧批次论文建立后关闭旧批次，再建立含不同导师和学位类型的新批次资格并开放；旧论文详情仍须返回旧资格的导师/学位和旧批次 ID、名称、截止时间，学生与学校可读，系统管理员与专家对该接口仍为 404。修复前失败于缺少 `student.degree_type`。后端现在从论文绑定的资格及批次返回这两个新增字段，保留 `batch_name`。

再新增真实编辑页用例：当前资格即使指向新批次，也不能覆盖旧论文身份；缺失信息显示“未提供”或“未设置”，不能回落到演示学校、日期、教授头衔。修复前两项均失败，页面确实显示了当前资格。编辑页现直接映射原始 thesis detail，不再为已有论文调用 `/me/eligibility`；未增加培养层次字段，缺值明确显示。

验证：

- `DATABASE_URL=...5433/paper_review_test backend/.venv/bin/pytest backend/tests/test_eligibility_operations.py backend/tests/test_projections.py -c backend/pyproject.toml -q --tb=short --show-capture=no`：11 passed、2 个依赖库弃用警告，退出码 0。
- `cd frontend && node_modules/.bin/vitest run src/modules/thesis/__tests__/realThesisIdentity.spec.ts src/modules/thesis/__tests__/realSubmit.wiring.spec.ts src/modules/thesis/__tests__/studentSubmission.spec.ts`：20 passed，退出码 0。
- `cd frontend && node_modules/.bin/vue-tsc --build`：退出码 0。
- `git diff --check`：退出码 0。测试库残留 `test_%`/`acceptance_%` schema 数量为 0。

未运行前后端全套、浏览器历史论文路径或 Hosted CI；统一验收归 R08。R07 交付边界已到，下一项为 R08。
