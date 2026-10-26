# T11-A1 六角色浏览器验收记录（本地通过）

日期：2026-10-02。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`，全部实现保留在未提交工作树。两次 `operations` 场景均使用 `VITE_DEMO_MODE=false`、本机 `5433/paper_review_test` 的独立 schema（首轮 `test_6aa092331de24cb98208f8991da9acb8`；补验 `test_c27b4553911d4aba9af0049d26c6bb65`）和独立文件目录；所有数据与 PDF 均为虚构。首轮浏览器八个独立上下文包含六种角色及新建账号。下面的 PASS 仅指本次实际观察，不替代生产验收。

| 设计矩阵行 | 浏览器结果 | 独立核对/限制 |
|---|---|---|
| 系统初始化 | PASS：`admin.system` 页面创建 `pilot-browser-audit` 学校和首位审核员，刷新仍在；新账号登录进入本校页面 | 租户、组织、STAFF/角色经登录及页面读回；未核对正式环境 |
| 学校准备 | PASS：`pilot.school` 创建学生、DRAFT 批次和 OPEN 批次资格，刷新后仍在 | 学生/资格/批次/导师关系在隔离库按 ID 核对；新学校看不到原学校论文 |
| 学生材料 | PASS：`pilot.student` 创建论文，选取原文与匿名 PDF 并提交 | 论文 `5042bf36-9d2e-4a02-a28b-9864c809e2e8` 当前版本冻结；两份文件完成上传，库中 SHA-256 与本机虚构文件一致。保存草稿后本地待上传文件需重选，见限制 |
| 学校审核 | PASS：学校页面匿名核验、确认送出 | 轮次 `7a42a652-1520-4c81-8526-ac5569263d2f` 对应当前版本，固定规则 `pilot-single-v1` |
| 平台专家运营 | PASS：创建非种子专家、资格通过、暂停/恢复、两类回避、刷新；非种子专家可登录 | 直接 API 对待审核专家返回 404、回避候选派单返回 409；页面没有虚构费用/统计 |
| 平台派单 | PASS：回避/方向不符候选禁选，选 E-001 派单 | 单席位任务 `11d5281c-b48d-426d-ac95-2e78fe7ad0cb`；直接 API 拒绝不合格/回避专家 |
| 专家邀请 | PASS：E-001 接受并进入精确任务；另一位专家看不到该任务 | 真实邀请页曾因 `fee.toFixed` 崩溃，已按红灯测试修复并在浏览器重验拒绝按钮 |
| 专家评审 | PASS：匿名 PDF 正文在 Chrome 内嵌阅读器实际可读；六维 100 分，80 分草稿刷新恢复，最终提交后只读且文件权限结束 | [虚构 PDF 截图](evidence/2026-10-02-t11-expert-anonymous-pdf.png)；正式结果六维 `12/12/16/20/8/12`，旧草稿写入 409 |
| 学校发布 | PASS：发布前页面见化名/档位，发布后更新 | 发布前学生/导师 API 404，发布后 200，汇总 80 分/PASS、E-001 |
| 学生/导师结果 | PASS：两个独立浏览器页面显示本人/指导论文的 80 分和 E-001，不显示专家姓名 | 学生、导师读回同一发布结果；外校学校读取该结果 404 |
| 异议闭环 | PASS：学生提交，学校受理、办结，学生刷新见结论 | 异议 `950ad1c9-ff89-4aec-bfe2-d1421388304d` 为 RESOLVED；重复/并发负例仍沿用既有自动化，本次未新做浏览器竞态 |
| 异常流程 | PASS：首轮专家拒绝后再派、接单后改派成功，旧任务读/写/提交均 404；补验学生撤回后修改摘要并重提，学校终止后专家任务显示“已撤销” | 第二轮论文 `09d63e0e-1e20-4052-8196-3f1d65540c6b` 的两个冻结版本与 PDF hash 匹配；终止后数据库 `TERMINATED/CANCELLED`，任务 version 2，旧文件令牌从 200 变为 404 |
| 冲突与空态 | PASS：学校同一账号两个独立页面旧 version 保存返回 409，页面刷新显示服务器最新名称；注入一次网络错误后显示错误，重试成功；另一学校零论文显示空态 | 未自动重放旧 version；曾发现成功刷新后保留旧 409 提示，失败测试→修复→浏览器重验，定向 7 项通过 |
| 权限负例 | PASS：学校/专家/系统直接打开越权路由分别回到允许页面；另一学校独立浏览器不见本校论文 | 专家/系统读取原文 404，外校学校读原文/结果 404，学生本人原文 200；旧匿名文件令牌 404 `RESOURCE_NOT_FOUND`；本次服务日志未发现授权头、密码字段或令牌查询参数 |

## 已修复缺陷：终止未取消邀请任务

步骤：在上述隔离服务中让学校论文进入 `UNDER_REVIEW`、平台创建 `INVITED` 任务，学校页面填写原因后点击“终止送审”。预期：论文 `TERMINATED`、轮次及未完成任务均 `CANCELLED`，专家无法接受。实际：论文与轮次已取消，但任务 `9f09bae8-0ffa-41fd-8fb0-30098314b9ff` 仍为 `INVITED`，专家页面仍显示“接受”。隔离库只读查询得到同一轮次的旧 REJECTED、旧 CANCELLED 和当前 INVITED 状态。

最小失败用例：`backend/tests/test_expert_operations.py::test_terminate_cancels_invited_task_under_rls`。修复前执行

```text
backend/.venv/bin/pytest backend/tests/test_expert_operations.py::test_terminate_cancels_invited_task_under_rls -c backend/pyproject.toml -q --tb=short -x --show-capture=no
```

退出码 **1**，实际 `INVITED != CANCELLED`。历史 `test_termination_reassignment.py` 在 owner/非 RLS 夹具中通过，无法覆盖此环境。`thesis.service.terminate` 在学校身份下用 `SELECT ... FOR UPDATE` 找未完成任务；现行 `0013_rls_core` 的 `expert_tasks` UPDATE 策略仅允许平台或本人专家，T06 设计矩阵也只给学校任务进度读取权，因此学校事务拿不到待更新任务，却继续取消轮次并返回 200。

用户明确批准“学校审核员仅能将本校 INVITED/IN_REVIEW 任务改为 CANCELLED”这一最窄例外。迁移 `0019_school_task_cancellation` 添加限租户/状态的 UPDATE 策略和数据库触发器：只允许终止后的论文任务、status/version/updated_at 变化，其他任务字段必须不变。服务层的论文→任务锁顺序没有修改。最初尝试在策略中直接查询论文触发 `42P17` RLS 策略回环；改为在触发器中核对已终止父论文后，邀请/在评双参数测试、直接 SQL 防越权和迁移升降往返 **4 passed / 2 warnings**，退出码 0。第二轮真实浏览器重验终止成功，库中论文 `TERMINATED`、任务 `CANCELLED`；专家页面显示已撤销，终止前有效的匿名 PDF 令牌变为 404。首轮失败事实保留在本节，最终矩阵以补验结果为准。

## 本轮页面修复和运行证据

- 真实派单/专家列表不再展示虚构费用、天数和演示批次；真实结果/异议/进度页显示实际租户；真实邀请页不再读取不存在的费用字段。邀请页失败测试先出现 `TypeError: Cannot read properties of undefined (reading 'toFixed')`，修复后 `realWorkspace.spec.ts`、`expertTaskFlow.spec.ts`、`expertReview.spec.ts` 合计 **35 passed**，退出码 0；浏览器刷新后显示匿名标题并能拒绝。
- `node_modules/.bin/vue-tsc --noEmit`（frontend）退出码 0。其他受影响页面定向测试分别为 13、17、32、3 passed，见本次执行记录；首轮结束时 T11-A2 的全量检查尚未运行。T10 的后端全量 **401 passed / 2 warnings** 是添加上述故意失败用例之前的结果，不能代表现在全绿。
- 独立 API 对改派前任务 `730c3e03-d5da-4fff-90c2-a562abb7e8ea` 的材料 GET、草稿 PUT、最终 POST 均返回 404 `RESOURCE_NOT_FOUND`。路由负例通过真实浏览器观察；上述权限 API 返回码单独列示，没有用 HTTP 代替页面验收。
- 首轮虚构 PDF 文件/版本 hash 已核对，但未记十六进制摘要；第二轮重新生成的原文 SHA-256 为 `1582ec55d69480646b90fc47d07c89a67890c4b657cf5f0b0b0340b986d3503f`，匿名版为 `cfbb4dc6b7ec435903356528d5d31cee1eef03938f6ea51089b2219b2d1d61d7`。第二轮撤回重提后的版本 #1/#2 文件链接均与这些摘要一致。截图只含虚构正文和界面，不含密码或令牌。
- 两轮均正常停止 8011/5186 服务后核对两端口无监听；各轮精确 schema、同 ID 临时角色和存储目录均为 0/不存在。第二轮两份虚构 PDF 经文件名、所有权、模式和 SHA-256 核对后逐一删除。未清理任何既存开发数据。

## 本地验收边界

14 行均有本次浏览器记录且无 FAIL/NOT RUN；API/SQL 负例与浏览器观察分列。T11-A1 本地通过，后续 T11-A2 的最终全量结果见[候选版本交接](2026-09-28-local-pilot-release-candidate.md)。旧任务延迟写入、双页面旧版本、迁移往返分别由上述 API/SQL/自动化补证，不宣称浏览器实际制造数据库竞态。Chrome/Firefox/Safari 交叉浏览器、容量、正式部署与恢复、实际试点放行仍未运行。
