# E03 本人历史评语相似性检查设计规格

日期：2026-10-12。状态：**APPROVED / 2026-10-13已本地验证**。阶段：一期。

原需求：A9；A7与A11的重复线索。依赖：E02。

目标：只对专家本人既往正式评语提供可复现的重复与相似片段提示，不泄露其他专家或学校数据。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 首版语料范围
默认仅当前专家本人已提交且任务仍有效的正式评语，不开放跨专家查询；同一任务的原结果和更正全部排除，不把更正原文当查重命中。每任务只取当前有效版本，当前稿只在请求中处理，不建全局明文索引。
允许平台跨专家查重属于后期明确权限扩展，本期不暗中实现。专家历史检索不得新增论文原文/作者/学校信息读取权限。

## 可复现算法与边界
拟新增 `compare_comments(current: str, history: list[dict]) -> dict`。按NFKC、折叠空白和标点归一化；排除本地版本化通用模板句。去除模板后文本不足20码点不查重。完全相同标EXACT；至少40码点且字符3-gram集合Jaccard>=0.85标SIMILAR。返回指标名和阈值，不能叫抄袭率。通过标准库difflib提取原文公共片段，归一化到原文偏移映射必须覆盖Unicode扩展。
每次最多最近200条本人有效任务结果，过去365天，以结果最终提交created_at为时间依据；超过范围明确 `coverage:{window_days:365,limit:200,examined,truncated}`，不能写全库已查。零历史返回NO_HISTORY而非质量合格。规则阈值已获用户认可。

## 接口和安全
POST `/api/v1/expert-tasks/{id}/review-similarity` `{payload}`，更正同E02路径体系。服务端取历史，不接受客户端候选ID、专家ID或tenant_id。只返回hit_count、最高相似度、当前稿命中片段及规则版本，不返回候选全文、学校、作者或跨任务跳转。
本人历史资格来自当前认证用户和原任务expert关系；RLS如需新增SUBMITTED后本人评语查询，限该关系且不开放文件。学生学校不能调用此接口。不得用数据库管理员连接读取跨权限语料。
接E02提示和确认机制；最终提交重算或验证事务中固定的语料fingerprint（由排序后的有效result/revision ID及规则版本计算），变化则要求重新确认，不能接受旧结果继续提交。相似性摘要独立存入check_summary，不保存被比对原文到审计日志。

## 验收
完全复制命中；模板内容不命中；同任务更正不自撞；别的专家相同评语不进入首版语料；新增历史/更正激活使旧fingerprint失效；覆盖不足明确提示。UI必须写“本人历史评语范围内相似性提示”，不得写“全平台查重通过”。


## 文件落点

拟新增：backend/app/modules/review/comment_similarity.py；backend/tests/test_comment_similarity.py；frontend/src/modules/review/__tests__/reviewSimilarity.spec.ts。
修改E02 comment_checks.py、ReviewCheckPanel.vue、reviewChecks.ts；review/service.py及E01 correction_service.py；如需本人历史RLS新增迁移，不改0015；模板排除短语存backend/data/review-checks-v1.json的新版本。

## 用户审阅重点

首版只查本人历史，365天/200条/0.85为建议范围；不能标记A9全平台查重完整覆盖。

实施计划：[E03 plan](../plans/2026-10-12-e03-review-comment-similarity.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

实施与边界：[验收记录](../../reviews/2026-10-12-e03-validation.md)。本人语料沿用现有RLS，不新增权限；最终提交重算单条SQL快照的fingerprint，绑定原check_ack的rule_version，不新增客户端候选参数。
