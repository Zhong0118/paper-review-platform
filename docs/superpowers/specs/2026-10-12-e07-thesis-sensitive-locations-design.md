# E07 论文敏感信息逐页定位设计规格

日期：2026-10-12。状态：**APPROVED / 已本地验证（2026-10-26）**。阶段：二期。

原需求：B6，部分覆盖；自动替换及语义一致性延期。依赖：一期E06验收记录。

目标：保留现有身份泄露检测并新增逐页命中、学校自定义字面词表与标题文字核对提示。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 首版边界
在现有PDF解析限制内逐页提取，不做OCR、不承诺文字框坐标。页码为PDF物理页序号，从1开始，不等于正文印刷页码。正文页命中提供页码、短上下文和命中词；文件名、Info/XMP元数据命中page_number=null并明确来源。
身份姓名/学号/导师检查继续使用既有StudentEligibility，仅授权学生本人及本校审核可看详细发现；专家和平台不获得身份词表或命中原文。系统管理员不能读取正文。图片、空白或不可靠提取仍REVIEW_REQUIRED，任何缺陷不得因为新检测而变PASS。
学校新增字面词表（最多200词，每词2–64码点，拒绝空白/重复），不用任意正则；词条含级别WARN或BLOCK及说明，默认WARN；已有身份命中维持FAIL。词表须学校确认，不存在所谓内置官方敏感词库。字面命中可能误报，学校可按现有人工核验流程确认并留理由，不自动替换文字。
标题核对：当前版本title去空白/NFKC后是否出现在前两页可提取文字；不出现仅WARN TITLE_NOT_FOUND；无法提取则NOT_CHECKED，不判标题与全文语义矛盾。没有警示不代表内容一致。

## 模型与接口
拟新增 `extract_pdf_pages(data: bytes) -> PdfInspection`，含pages（page_number,text,uncertain）、metadata、uncertain；保留`inspect_pdf`现有三元返回契约，内部调用新函数拼接，避免改变原有文件校验调用者。
新增`tenant_sensitive_terms`配置表：tenant_id唯一、terms JSON、version；FORCE RLS本校审核员维护，学生只可调用本人材料检测不直接读全部词表。GET/PUT `/api/v1/school-admin/sensitive-terms`，PUT带expected_version；上次版本不符409。
POST `/api/v1/theses/{id}/sensitive-checks`与学校路径`/school-review/theses/{id}/sensitive-checks`：只检查当前可读的anonymous版本，body `{expected_version,file_id}`；服务端校验绑定/归属，不能以file_id扫任意文件。
结果绑定 `{thesis_version_id,file_id,file_sha256,detector_version,terms_version}`；finding `{kind,source,page_number,matched_text,context,severity}`，上下文最多120码点。扩展现有anonymization_checks的findings及检测来源元数据，不混淆原人工确认；词表/文件/论文版本变化使旧自动报告失效，需要重新检测再确认。
读/预览操作不新增作者信息返回给平台和专家；报告只在现有论文权限范围取回，禁止公开下载链接。审计仅记录计数与版本，不记录命中姓名和整页文本。

## UI与验收
学校论文核验区域新增报告面板、按页分组，点击跳到当前受控PDF页；浏览器无法自动定位时明确显示物理页码，不假装标注坐标。学生本人可检查草稿匿名版。标题提示有可见解释，不宣称内容真实性检测。
两页各一个身份词，报告准确区分页1/页2；PDF印刷页码与物理页不同；元数据命中无页码；图片页仍人工复核；换文件旧报告失效；别校file_id 404；检测后报告不得出现在专家API。

## 文件落点

修改：backend/app/modules/files/pdf.py；backend/app/modules/thesis/detector.py、models.py、router.py、service.py；frontend/src/modules/thesis/pages/ThesisEditPage.vue；frontend/src/modules/school/pages/ReviewProgressPage.vue。
新增：backend/app/modules/thesis/sensitive_terms.py；frontend/src/components/app/SensitiveFindingPanel.vue；frontend/src/api/sensitiveChecks.ts；frontend/src/modules/school/pages/SensitiveTermsPage.vue；router/routes.ts和menus.ts对应角色入口；配置表及检查来源迁移；backend/tests/test_sensitive_locations.py；frontend/src/modules/thesis/__tests__/sensitiveLocations.spec.ts。

## 用户审阅重点

首版提供物理页码而非精确框坐标；无OCR/自动替换；标题仅文字核对。

实施计划：[E07 plan](../plans/2026-10-12-e07-thesis-sensitive-locations.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 实际交付

E07-01/02/03已完成，见[验收记录](../../reviews/2026-10-12-e07-validation.md)。学校入口使用实际匿名核验页面PreparationListPage；检测来源另加输入摘要，防止同版本ID草稿的标题/摘要/身份变化漏判失效。学生词表访问由限定当前本人匿名文件的匹配函数实现，不直接暴露完整词表。原首版边界不变。
