# E09 专家档案增强与受控导入设计规格

日期：2026-10-12。状态：**APPROVED / 未实施**。阶段：二期。

原需求：A4的真实资料导入基础；B10多维档案部分；不是B11实名认证。依赖：E08；沿用官方目录D01–D04。

目标：补充匹配所需专家字段，提供可追溯资料导入和差异确认，不模拟真实智能采集或实名认证。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 档案字段和可见性
在现有unit/title/discipline_codes上增加province_name可空、doctoral_supervisor和masters_supervisor可空bool（未知不是否）、research_directions及keywords各最多20个/每个2–64码点、source_url可空、source_note可空、source_checked_at可空。地区值使用仓库已核验官方院校文件中的省级名称；不编造省份编码或声称另一个官方地区标准。
province_name白名单由官方院校规范CSV去重生成；title仍为已确认文本，筛选用当前存在值。discipline_codes仍为研究生一级学科/专业学位类别。二级学科需要正式映射资料，不本期伪造；B10学校侧专家搜索和匿名联系不实施。
只有平台审核员可管理和筛选全局档案；学校仍看不到专家姓名、联系方式或详情；专家本人自助档案编辑本期不扩展。导师资格字段为人工记录且显示“未核验/人工维护”，不能显示已实名认证。

## 受控导入
只提供CSV模板，不做爬虫、自动抓网页或定时更新，不下载用户填写的source_url（避免把来源链接变成任意抓取）。UTF-8 BOM可选，最多1MiB/500行。只更新已存在专家；新增专家仍走原创建接口，不批量导入密码/身份号码/银行卡。不接受客户端tenant_id。
CSV列固定为username,unit,title,discipline_codes,province_name,doctoral_supervisor,masters_supervisor,research_directions,keywords,source_url,source_note；列表用分号分隔，bool仅true/false/空表示未知。按username精确匹配，不凭姓名合并；重复行、不存在账号、未知学科、越长字段逐行报错。空白可空字段代表明确清空，预览必须标示；字段缺失/多余整文件422。
POST `/api/v1/platform-review/experts/import:preview` multipart CSV，返回 `{preview_id,expires_at,changes:[{expert_id,username,version,diff}],errors}`；有错误不能apply。临时预览仅保存规范差异不存密码，10分钟有效，绑定actor和当前专家版本/文件SHA。
POST `/experts/import:apply` `{preview_id}`+Idempotency-Key：锁专家UUID升序，重查每条version及资格；过期/任一冲突409且整批不写，不能部分成功。qualification_status、account_status、service_status和conflicts不在导入列，不得被修改。来源记录只是可追溯说明，不等于真实性认证。
新增expert_import_previews（actor、expires_at、payload_hash、canonical_changes、status）；FORCE RLS平台仅本人预览，终态不可篡改。expiry后不再返回差异，按已有精确资源清理机制删除本次临时上传文件；不要引入长期原始个人资料仓库。

## 筛选和验收
平台专家页支持现有学科、province_name、title、两种导师资格三态、方向/关键词精确标签；只对平台可见。字段名必须E10复用，不再建另一专家表。
导入预览和apply diff一致、相同键重放不重复、另一管理员修改档案后409、换actor不能用preview_id、非法列不能修改审核状态；CSV单元格含=+@危险公式前缀拒绝，导出如新增必须转义；无真实来源时显示人工维护。浏览器从模板上传→预览→确认→刷新验证字段。


## 文件落点

修改：backend/app/modules/expert/models.py、schema.py、service.py、router.py；frontend/src/modules/expert-management/pages/RealExpertLibraryPage.vue；frontend/src/api/expertOperations.ts。
新增：backend/app/modules/expert/import_service.py、import_models.py；frontend/src/components/app/ExpertImportDialog.vue；backend/tests/test_expert_profile_import.py；frontend/src/modules/expert-management/__tests__/expertImport.spec.ts；档案字段与预览表迁移。

## 用户审阅重点

仅更新已有专家的CSV；来源链接不自动抓取；一级学科/专业学位类别，不含无来源二级学科。

实施计划：[E09 plan](../plans/2026-10-12-e09-expert-profile-import.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。
