# E10 可解释专家候选推荐设计规格

日期：2026-10-12。状态：**已本地验收（2026-10-29），验证及补验明细见E10记录**。阶段：二期。

原需求：B7规则版；B10平台侧筛选部分。依赖：E09，E07；二期最后收口。

目标：在现有硬约束之上，按显式方向和关键词对候选排序并解释原因，派单仍由平台人员确认。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 保持硬门禁
复用现有list_candidates和assign：账号有效、资格APPROVED、服务AVAILABLE、论文四位学科在专家discipline_codes内、未命中回避、当前单专家席位可用。排序分数不能豁免任何硬门禁；最终assign锁后重算门禁，不信客户端评分/推荐ID。
拒绝同名导师等已有规则不变。B7“自动匹配”在本期解释为自动生成候选排序，自动派单、推送等待配置、正文语义embedding检索均不做，不声称完整覆盖B7。

## 输入与评分
不为推荐新增平台读取原始PDF正文的权限。只使用平台既有可读论文元信息：title、abstract、keywords，以及专家研究方向/关键词。元信息可能含姓名，不调用外部模型/服务，不把整段摘要写入日志。
对NFKC、去首尾空白、英文小写后的精确标签匹配。研究方向标签完整出现在标题或摘要：每项3分，最多15；论文keywords与专家keywords精确交集：每项2分，最多10。未配置方向/关键词时0分但仍可作为合规候选，不能因旧数据字段为空排除全部专家。0分表示缺少匹配线索，不代表不合格。
排序：可派候选优先→score降序→expert UUID升序；不可派候选保留明确原因，默认折叠。分数是规则排序分，不能展示为匹配准确率/概率。不从本文档推断学科近邻或跨学科自动放宽。

## 接口契约与变更失效
在原候选接口扩展 `{match_score,match_rule_version:'expert-rank-v1',match_reasons:[{kind,tag,points}],candidate_version,thesis_version}`，旧字段保留；平台页展示命中标签和不可派原因，不把此响应开放给学校。
拟新增纯函数 `rank_candidate(metadata: dict, expert: dict) -> dict`，只负责软评分；hard_allowed仍由原服务产生。专家档案变更后下一请求重新评分；缓存首版不加。派单请求可带expected_expert_version，版本变化409并刷新，旧客户端不带时仍按已有最新硬门禁校验。

## 验收及二期收口
关键词同义但不相同首版不命中；英文大小写/全角一致；研究方向文字命中与公式可手算复现；高分回避者仍不可派；更改资格后旧页面操作失败；0分老专家仍可正常派单。命中说明只向平台审核员提供已有档案标签，不附带论文正文片段；学校与专家不能调用平台候选接口。
浏览器验证候选排序、命中解释、409刷新及人工派单；二期封板包括E07/E08来源文件报告失效、E09导入版本竞争和一期更正/提交回归。全量测试、30表以上实际RLS清单/恢复、真实模式build和浏览器证据完成后再交接；本地完成不等于上线。


## 文件落点

新增：backend/app/modules/dispatch/candidate_ranking.py；backend/tests/test_candidate_ranking.py；frontend/src/modules/dispatch/__tests__/candidateRanking.spec.ts。
修改：backend/app/modules/dispatch/service.py、router.py；frontend/src/api/dispatch.ts；frontend/src/modules/dispatch/components/CandidateExpertTable.vue；frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue。

## 用户审阅重点

规则分仅推荐线索；不分析全文、不自动派单；硬门禁优先。

实施计划：[E10 plan](../plans/2026-10-12-e10-expert-candidate-ranking.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 实施口径

当前操作可执行性以`hard_allowed`与`allowed_actions`表达：空席位可ASSIGN_EXPERT，在途任务的替代专家可REASSIGN_EXPERT。既有改派保留，已占席位不可新增派单。`thesis_version`为现有论文version整数；只返回计分上限内的标签，解释分值之和等于规则分。无效账号继续按原接口排除；无新增RLS或锁序例外。实测见[E10验收记录](../../reviews/2026-10-12-e10-validation.md)。
