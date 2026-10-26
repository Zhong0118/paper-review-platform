# E01 正式评审结果更正设计规格

日期：2026-10-12。状态：**APPROVED / 2026-10-13已本地验收**。阶段：一期。

原需求：A10。依赖：现有0020基线。

目标：允许原专家申请更正、平台审核、原专家提交新意见、本校确认生效；原结果和已发布内容不被静默覆盖。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 已有实现与设计选择
现有 `review/service.py` 最终提交锁定任务，`result/service.py::_summary_results`按task及is_current读取；`ResultPublication`只关联summary，没有完整发布快照。旧更正页面仅演示。直接重新开放SUBMITTED任务会恢复材料读取、改变状态统计，禁止采用。

采用附加更正记录与不可变发布快照，原任务始终SUBMITTED，不恢复PDF token权限，不回退论文阶段。原 `review_result_versions` 内容保持不可变。新更正版本独立保存，由统一有效结果读取函数选择；不能让各页面分别判断版本。

## 业务状态与用户操作（已认可）
1. 原专家针对当前有效结果申请更正，填写理由；当前论文须RESULT_PROCESSING或COMPLETED，轮次及论文版本仍一致。
2. REQUESTED→APPROVED或REJECTED，仅平台审核员可操作；申请人可在REQUESTED/APPROVED状态取消为CANCELLED。
3. APPROVED后原专家编辑单独的更正草稿，最终提交进入AWAITING_SCHOOL，生成不可变revision；校验沿用原轮次规则，后续E02/E03同样作用于此提交。
4. 学校只读匿名更正内容及变更字段，不读取可能含专家身份的申请理由；AWAITING_SCHOOL→ACTIVATED或SCHOOL_REJECTED，理由必填。同一原结果最多一条未终结申请，结束后可重新申请。
5. 未发布论文：申请开始后禁止首次发布，直到申请结束；学校激活后更新待发布汇总，仍需既有发布操作。已发布论文：原发布继续有效，显示“更正处理中”；学校“确认并发布更正结果”才以新快照替换有效发布。拒绝/取消不改原内容。
6. 本期不做“立即撤下所有公开结果且不提供替代”的独立撤回；A10覆盖更正闭环，完整撤回入口仍为明确延期。任务取消/论文终止后新命令409，无新写入。

## 数据与接口契约（拟新增）
- `review_correction_requests`：task_id/round_id/tenant_id/base_result_id/base_revision_id可空、status、version、draft_payload、请求人/决定人及时间。存量无需生成申请。
- `review_correction_notes`：request_id、author_id、note_kind、reason正文；申请与平台决定理由在此独立保存，FORCE RLS按note_kind及归属限制行：EXPERT_REQUEST/PLATFORM_DECISION仅原专家与平台审核员可读，SCHOOL_DECISION仅本校审核员与平台审核员可读。学校无权读取前两类理由，专家无权读取学校理由；API及直接SQL均验证。不要将school_note放在专家可读的申请行上，也不能只在响应中隐藏字段。专家收到学校决定状态，不返回可能含作者身份的学校自由文本。
- `review_result_revisions`：request_id唯一、base_result_id、task/round/tenant复合归属、revision_no、scores/comments/total/rule_snapshot。最终提交时INSERT，内容不可UPDATE/DELETE。
- `ResultSummary.effective_revision_id`可空：空表示原结果；激活时更新且summary.version递增。读取返回base_result_id、effective_revision_id和匿名数据。
- `ResultPublication`新增snapshot（含精确base_result_id/revision_id、匿名分数/评语、规则快照、论文版本）、publication_no、replaces_id可空；新行追加，旧行不可写。唯一(summary_id,publication_no)、replaces_id唯一并校验同summary。有效发布取同summary最大publication_no，不通过当前summary重新计算。
- 历史发布：仅在当前单专家结果、summary和论文版本一致时确定性回填快照；有歧义则整次迁移失败并列出内部ID，不输出正文。初次发布与更正发布均使用同一快照生成函数。
- POST `/api/v1/expert-tasks/{id}/corrections` `{base_result_id,base_revision_id,reason}`；GET同路径；POST `/corrections/{id}:cancel` `{version}`。
- GET `/api/v1/platform-review/corrections`；POST `/{id}:decide` `{version,decision:APPROVE|REJECT,reason}`。
- PUT `/api/v1/expert-corrections/{id}/draft` `{version,payload}`；POST `/{id}:submit` `{version,payload}`。
- GET `/api/v1/school-review/corrections`；POST `/{id}:activate`或`:reject` `{version,reason}`。只允许本校当前有效轮次。
- 所有命令有Idempotency-Key；摘要包含完整payload、版本、动作。相同键相同载荷返回原结果，不同载荷409；过期版本409，无权限/不可见对象404。

## 权限、锁与迁移重点
所有更正写入按论文→任务→申请→summary锁序；校验需在锁后刷新。提交与审批只能改规定字段，数据库触发器约束状态转移/角色/字段白名单，不能只靠前端。新表FORCE RLS：原专家仅本人，平台审核可处理，学校仅本校，申请/决定理由从独立notes表隔离；学生导师无权读申请或未激活revision。学校可读AWAITING_SCHOOL候选，激活后学生/导师读取仅通过已有发布归属。
发布快照仍需动态验证当前学校、学生、导师关联和论文版本；新增快照不等于任何登录用户可读。专家不能通过revision恢复论文下载。系统管理员仍不能读正文/评语。不得增加BYPASSRLS或信任客户端角色。
更新0020以后真实head上的迁移，以及新表的恢复导出/导入与角色清单。历史状态迁移测试需用固定旧结构夹具，不能调用依赖新表的业务服务。

## 可验收结果
- 70分原发布→更正草稿90分→提交→学校确认前仍70分；确认后90分，旧70分可追溯。
- 未发布期间有未结申请不能发布；拒绝/取消解锁发布且旧内容不变。
- 并发两次申请仅一条开放记录；并发激活/重复请求仅一个新发布版本；同一键换payload409。
- 别校、别的专家、学生、系统管理员API和直接SQL负例；旧文件token权限不增加。
- 激活前后导师/学生页面、异议页面和评分看板均读取正确的固定版本。


## 文件落点

现有修改：backend/app/modules/review/models.py；backend/app/modules/result/models.py、service.py；backend/app/modules/dispatch/router.py；backend/app/api.py；frontend/src/modules/review/pages/ReviewWorkspacePage.vue；frontend/src/modules/expert-management/pages/CorrectionApprovalPage.vue；frontend/src/modules/result/pages/ResultProcessingPage.vue；frontend/src/router/menus.ts。
拟新增：backend/app/modules/review/correction_service.py、correction_router.py；frontend/src/api/corrections.ts；新增迁移；backend/tests/test_result_corrections.py；frontend/src/modules/result/__tests__/realCorrections.spec.ts。

## 用户审阅重点

发布后更正仍保留旧公开版本；不重新开放PDF；本期不做独立撤下发布。这三点已获用户认可。

实施计划：[E01 plan](../plans/2026-10-12-e01-review-result-correction.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。
