# 20 校内专业代码映射：本地验收（2026-11-03）

分支 `codex/slice-7a1-file-integrity`，工作树基线 `c299ed9`。[执行计划](../superpowers/plans/2026-11-03-school-program-code-mapping.md)先于实现编写，[校方操作说明](../operations/official-catalogs.md)。学校导入、批次固定与学生选择三条主路径均已在真实浏览器走通。人工退回的既有 RLS 故障经批准修复，真实操作、负例和迁移检查通过，**20 已完成本地验收**。

| 用户动作 / 风险 | 实际结果 |
|---|---|
| 校方表内有重复校码，或官方代码无效 | Chrome 看到重复校码且无发布按钮。API 另验未知代码、无出处、空字符、超出 UTF-8 字节限制：不能取得有效预览指纹。遗漏的旧条目不自动停用。 |
| 两校使用相同校码 `0007` | 两个学校账号各自发布并固定本校版本。两个学生以 `0812` 或 `0007` 搜索、建稿、保存、刷新，看到各自学校的名称。各校在准备列表看到本校论文的双口径。 |
| 越权、过期、历史 | 真实受限数据库角色：跨校绑定、伪造官方代码、重复绑定被拒；并发提交同一预览一成一败（200/409）。仅传版本和校码即可由后端推导官方学科；关闭的学科不允许送审。旧稿可不补校码继续送审，也可撤回后主动改选。学生撤回复制已有校码成功。 |
| 匿名链路 | 用已选校码的论文派单、专家接单、提交及学校发布；核对专家任务 API 和生成的评阅书 PDF 正文、元数据，无本次样例的校内名称或目录 ID。用专家身份直接查询三张校码表可见行均为 0。这里验证的是系统生成的数据；没有声称能移除学生原始材料中手工填写的专业。 |
| 迁移与恢复 | 0027→0029→0028→0027→0029 空库成功；有历史版本的回退被拒且 FORCE RLS 仍有效。对本次自建隔离资源做真实备份恢复，三张新表各有一行，恢复后的学校接口读回同一论文版本的原校码和目录版本。未迁移开发库。 |

## 执行和证据

- 首轮后端 20 专项为 4 通过、1 失败（退出 1），失败为下述人工退回。较早的相关回归为 18 通过、1 未选（退出 0）。补修后的结果见下方，次数有重叠，不累计。本轮没有运行全量后端。
- 补修期间后端：独立测试库中，`python -m pytest -c backend/pyproject.toml -q --tb=short backend/tests/{test_school_programs,test_thesis_submit,test_anonymization,test_thesis_integrity,test_rls_roles,test_rls_end_to_end,test_recovery_drill,test_comment_checks}.py`，**66 项通过，退出 0**，含真实备份恢复。最终补上同事务重放及缺迁移的断言后，在同一测试库执行 `python -m pytest -c backend/pyproject.toml -q --tb=short backend/tests/test_school_programs.py backend/tests/test_rls_workflow.py`，**12 项通过，退出 0**（其中 6 项为 20 专项）。两个批次不加总。
- 前端（20 主功能验收时，在 `frontend/`；本次权限补修未修改前端业务代码）：`node_modules/.bin/vitest run`，**74 个文件、529 项通过**；`node_modules/.bin/vue-tsc --build`、`VITE_DEMO_MODE=false node_modules/.bin/vite build`，均退出 0。
- 浏览器：实际运行本机 Uvicorn + Vite + Chrome，没有拦截请求或注入登录状态。两校各走 4 组目录操作，并在第二校实际上传两份 PDF、提交、人工退回、学生打开草稿并修改保存。共 10 组操作，均通过；浏览器无未捕获异常，脚本退出 0。[逐组输出](evidence/2026-11-03-school-programs/browser-results.txt)；[预览](evidence/2026-11-03-school-programs/01-preview.png)、[绑定](evidence/2026-11-03-school-programs/02-pinned.png)、[学生回读](evidence/2026-11-03-school-programs/03-student.png)、[退回后打开并修改](evidence/2026-11-03-school-programs/04-returned-draft.png)。
- 重跑浏览器：在 `frontend/` 执行 `VITE_DEMO_MODE=false VITE_API_PROXY_TARGET=http://127.0.0.1:18237 node_modules/.bin/vite --host 127.0.0.1 --port 15237 --strictPort`。另在仓库根运行 `backend/.venv/bin/python docs/reviews/evidence/2026-11-03-school-programs/browser.py`。需本机 Chrome、Node 可解析的 Playwright（如通过已安装版本的 `NODE_PATH`）；脚本启动独立测试 API，结束时释放该次测试资源。随后停止自己启动的 Vite。

## 人工退回：故障复现与补修

- **修复前：** 使用独立测试库里的非所有者业务账号，学生提交带校码的论文，学校执行 `POST /api/v1/school-review/theses/{id}:confirm-anonymization`（REJECT、原因和当前版本号）。PostgreSQL 在向 `thesis_versions` 插入新版本时拒绝，SQLSTATE 42501。原表仅允许学生创建版本，尚未到复制校码。在负例中还复现过：单靠“同事务事件”不能阻止人为指回老版本重复复制，以及缺迁移时请求可能错误返回成功。
- **0029 修复边界：** 保持原先先锁论文、检查版本、写事件和提交的次序。学校退回事件先写入数据库，随后由论文从 PREPARING 变成 DRAFT 的操作触发复制。核对学校、审核员、当前事务、退回原因、源版本及版本号。只从最新冻结版读取，新版沿用正文、关键词、官方学科、原文件 ID / 用途及校码；仅新版本可编辑。业务账号没有获得通用版本或文件写权限，不能执行触发器函数，未关闭 RLS。无新任务锁。
- **权限及失败路径：** 他校调用 404，陈旧版本 409；同一请求重放返回同一版本。没有同事务事件、拿历史事件重放、直接插入版本/文件、或同事务指回旧版试图再复制均被数据库拒绝。学生合法修改、再次提交后仍可再次退回。事务中止时旧版本、文件数及论文状态不变；模拟服务已更新但数据库仍在 0028，接口返回 503，保持 PREPARING。
- **浏览器与接口的区别：** Chrome 用两个独立登录会话真实提交并点击退回，核对返回的新版本、原两份文件 ID 和校码，再由学生打开、看到两份原文件名、改题目、保存并刷新。直接尝试篡改、回滚、幂等及迁移保护是数据库/API 测试，不计入浏览器场景。

未验证真实学校的正式目录，未导入正式数据、未部署。上线前仍需首校正式来源及样表核对；11、15、18、16 未开工。
