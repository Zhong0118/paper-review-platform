# E02 评语提交前规则检查设计规格

日期：2026-10-12。状态：**APPROVED / 2026-10-13已本地验证**。阶段：一期。

原需求：A3、A7；B8错字及明确结论检查部分。依赖：E01。

目标：在原评阅及更正提交前提供可定位、可解释的有限规则提示，并记录专家确认。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 范围
共享一个纯规则引擎，不用LLM，不修改专家输入。初版包括：总体评价少于50个非空白字符提示；主要问题少于20个提示；至少20字符的同一句在同份评语出现两次提示；明确受控短语与计分结论冲突提示；已审核词条中的疑似错词/不当用语提示。阈值是已认可的v1产品规则，不是学术标准。
现有必填和分值错误继续422；新规则均为待确认提示，不直接认定评阅不合格，不自动替换。结论自由文本仅对明确列入规则文件的短语进行匹配，否定表达/引用不确定时不判矛盾。
词表用本地版本化JSON：code、category、pattern、suggestion、例外与来源说明。初版仅纳入经项目确认的确定词条和测试用例，不伪造“官方敏感词库”；检测报告写清覆盖词表及规则版本。身份信息只检查明确身份证/手机号等格式候选和专家本人已知信息，不向专家检测服务传入隐藏作者/导师信息，也不提供猜作者姓名的查询接口。

## 契约
拟新增 `check_comment(payload: dict, rule_snapshot: dict, dictionary: dict) -> list[Finding]`。Finding含code、field、start/end（Python Unicode码点半开区间）、message、suggestion可空、severity='WARN'；前端Array.from转换，禁止把Python偏移直接当UTF-16下标。
POST `/api/v1/expert-tasks/{id}/review-checks` `{payload}`；更正路径 `/expert-corrections/{id}/review-checks`。结果 `{payload_hash,rule_version,findings,checked_at,status:'COMPLETE'}`；仅可编辑本人任务或已批准更正。限制每字段10000码点、总量30000，超限422。
规则code固定为SHORT_OVERALL、SHORT_ISSUES、REPEATED_SENTENCE、EXPLICIT_CONCLUSION_CONFLICT及词表自身稳定code。
检查失败返回错误，不生成COMPLETE。最终提交服务自行重算哈希及确定性检查；请求带 `{check_ack:{payload_hash,rule_version,codes:[...]}}`。请求的check_ack为传输层字段，从ReviewPayload业务字段及payload_hash计算中排除；不要把ack写进评语正文。hash仅包含按键排序的规范评阅字段与规则版本。保留旧客户端平铺评分字段，router单独提取可空ack，校验后再调用业务服务。
有WARN未确认409 CHECK_ACK_REQUIRED；文本/分数变化则旧ack失效；零命中无需ack。只有服务端计算结果决定是否完整确认。
不保存每次预览全文；正式提交在原结果或更正revision的附加check_summary JSON保存规则版本、载荷哈希、命中code/计数、确认人/时间，词句正文不写普通日志。保留既有幂等摘要并纳入ack。JSON列只许与结果一起INSERT，旧历史留null表示未检测，不能回填PASS。

## 权限与验收
专家只见本人提示；学校发布核对可见匿名摘要，平台只在既有授权流程看摘要，不扩展其论文读取权限。确认提示不是删除或改写原评语。
用短评、重复句、emoji偏移、普通负面学术评价、引语/否定表达、空词表、改分数后旧ack、网络失败和更正提交覆盖。正常批评不因含“问题”二字命中；输入相同规则相同则输出稳定。


## 文件落点

现有修改：backend/app/modules/review/service.py、rules.py、models.py；E01 correction_service.py；backend/app/modules/dispatch/router.py；frontend/src/modules/review/pages/ReviewWorkspacePage.vue。
拟新增：backend/app/modules/review/comment_checks.py；backend/data/review-checks-v1.json；frontend/src/components/app/ReviewCheckPanel.vue；frontend/src/api/reviewChecks.ts；backend/tests/test_comment_checks.py；frontend/src/modules/review/__tests__/reviewChecks.spec.ts；check_summary列迁移。

## 用户审阅重点

50/20字符阈值、全部新规则只提示、审核词表来源须确认；不宣称全面中文纠错。

实施计划：[E02 plan](../plans/2026-10-12-e02-review-comment-checks.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

实测与限制：[E02验收记录](../../reviews/2026-10-12-e02-validation.md)。当前审核词表0条，内置规则不代表全面纠错。
