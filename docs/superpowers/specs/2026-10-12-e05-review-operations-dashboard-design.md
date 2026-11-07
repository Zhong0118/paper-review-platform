# E05 真实评审运营看板设计规格

日期：2026-10-12。状态：**APPROVED / LOCAL_VERIFIED（2026-10-26）**。阶段：一期。

原需求：A1；A11仅数据展示基础。依赖：E04，E01生效版本读取。

目标：以真实查询展示评审工作量和已发布分数分布，明确逾期统计未配置，并提供可核对的列表入口。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 页面和口径
学校扩展现有评审进度页；平台扩展派单工作台摘要，不新建大型BI子系统。学校只看本校；平台只看已有派单授权论文的任务运营数据，不新增读取评分、评语或论文正文的权利；系统管理员不显示业务看板。
待派论文数：符合既有ASSIGN_EXPERT条件的论文；邀请中任务数：当前有效轮次INVITED；评阅中任务数：IN_REVIEW；已提交任务数：SUBMITTED，结果更正不重复计数。源码核对发现ExpertTask尚无真实接单/评阅截止字段，现有overdue计数初始化0未计算。本期明确返回overdue_tasks=null及overdue_status=NOT_CONFIGURED，页面显示“未配置截止规则，暂不统计”，不能把0当作真实无逾期。截止日期配置和自动逾期计算需另审业务规则，不在本期暗加。将来逾期是其他状态的重叠子集，不能直接相加。取消、旧轮次、终止论文不计当前任务数。
学校评分分布只统计当前有效发布，按现行规则0–59/60–79/80–100分段，未发布不计；更正激活只替换同一论文的分值，不增加论文数。标注分母、范围、更新时间及“已发布论文”，不宣传智能质量分析。

## 接口
拟新增GET `/api/v1/school-review/dashboard?time_scope=all|past_year` 返回 `{as_of,time_scope,time_from,cards:{waiting_theses,invited_tasks,in_review_tasks,submitted_tasks,overdue_tasks:null},overdue_status:'NOT_CONFIGURED',published_score_bands:[{code,count}],published_count}`。
平台GET `/api/v1/platform-review/dashboard`只返回运营cards和meta，无评分字段。聚合复用E04与现有候选/当前轮次条件，不能另写一套状态含义。单次响应使用同一数据库只读一致快照；异步并行读不同快照造成计数不一致不接受。
钻取URL带scope与明确status_filter，列表提供与卡片相同过滤逻辑及as_of；点击后若数据已变动，显示“数据已更新”与新计数，不承诺不同请求时刻永久相同。不在服务器返回专家姓名给学校，匿名化不能仅在前端做。

## 展示和验收
卡片+简明分布条形图即可，优先复用已有组件，不为美化引入新图表依赖。加载、空数据、局部失败明确分开；请求失败不能显示全0。卡片标题保留“论文/任务”单位。
测试取消任务、改派、同论文更正、旧轮次、跨学校、边界分59/60/79/80、scope范围及正常空数据。学校卡片到列表能解释每条计数；平台无评分/正文数据可抓取。


## 文件落点

现有占位文件改为真实实现：backend/app/modules/statistics/dashboard_service.py、router.py。
拟新增：frontend/src/api/dashboard.ts；backend/tests/test_dashboard_metrics.py；frontend/src/modules/school/__tests__/dashboardMetrics.spec.ts。
现有修改：backend/app/api.py；frontend/src/modules/school/pages/ReviewProgressPage.vue；frontend/src/modules/school/components/TaskProgressSummary.vue；frontend/src/modules/dispatch/pages/DispatchWorkbenchPage.vue；E04列表过滤函数。

## 用户审阅重点

评分分布仅本校已发布论文；逾期首版NOT_CONFIGURED，不能用旧占位0统计；平台只运营指标。

实施计划：[E05 plan](../plans/2026-10-12-e05-review-operations-dashboard.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 2026-10-26 实施记录

[验收记录](../../reviews/2026-10-12-e05-validation.md)。权限、锁序、时间和发布口径按原规格；无迁移。

共用投影使用一次SELECT读取当前论文/轮次/任务及学校最新发布值，服务端在该结果集计算指标。已删除的占位router保持删除，新增dashboard_router.py；学校与平台页面复用TaskProgressSummary和useOperationsDashboard。

钻取参数status_filter为ALL/WAITING/INVITED/IN_REVIEW/SUBMITTED。学校进度返回filtered_count、as_of与overdue_status，totals.overdue改为null。平台默认列表仍仅派单阶段，明确SUBMITTED筛选可列出已有授权论文的已提交任务，响应不含分数/评语。分段code采用0-59/60-79/80-100。无独立评分钻取或AI分析。
