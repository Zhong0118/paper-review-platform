# E04 全部与近一年统一时间范围设计规格

日期：2026-10-12。状态：**APPROVED / 2026-10-13已本地验证**。阶段：一期。

原需求：B4。依赖：E01；执行顺序在E03之后。

目标：让论文业务列表和统计使用一致的时间范围，不归档、不删除数据、不改变详情权限。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 范围与日期定义（已认可）
范围覆盖学生论文列表、学校送审准备/进度/结果列表、平台派单队列、专家任务列表、导师已发布论文列表，以及E05看板。学校/专家名录、系统用户、词典、异议待办不按此全局切换隐藏；否则老论文仍待处理的异议可能消失。页面明确“论文与评阅列表范围”，B4的“所有页面所有数据”不宣称全覆盖。
参数 `time_scope=all|past_year`，默认all保持既有行为。past_year按Asia/Shanghai当前日期回溯一个公历年，从该日00:00起，闰日不存在取当月最后一天；下界包含，未来created_at数据不计入（上界为请求as_of）。统一基准为论文theses.created_at，不因专家改派、更正、更新updated_at而重新进入一年内。专家任务/导师结果通过所属论文过滤。页面显示日期依据和下界。
未结任务可能因时间范围隐藏，因此选择past_year时必须提示“较早建立论文的未结任务可能未显示，可切换全部”；不悄悄把老未结项插回列表破坏口径。

## 接口与前端契约
拟新增 `resolve_time_scope(scope: str, as_of: datetime) -> tuple[datetime|None, datetime]`；`apply_thesis_scope(query, scope, as_of)`仅添加参数化过滤，必须在已有身份/租户过滤内组合。非法scope422；时间以服务端计算，不接受任意客户端日期改变范围。
现有列表响应形状保持兼容，以响应头`X-Time-Scope`、`X-Time-From`（all为空）、`X-As-Of`说明；统计接口响应也包含相同meta。各端同一个筛选组件 `TimeScopeSelect`。URL查询优先；个人本地偏好键`time-scope:v1:{userId}:{role}:{tenantId-or-platform}`，未知值回退all，退出后清理内存，不存token。
请求切换使用generation丢弃过期响应；列表筛选和数量必须同一scope。E05列表钻取带scope及快照时间校验；待办详情深链接不按列表范围404，仍执行正常权限检查。

## 验收
冻时测试含边界、闰年、时区跨日、范围外未结项；all仍返回老数据，past_year只返回范围内；别校不因参数绕过权限。创建日相同论文在各角色入口范围一致；刷新保留设置，切换账号不串；HTTP旧接口消费者不因包装改变而失效。


## 文件落点

拟新增：backend/app/shared/time_scope.py；frontend/src/components/app/TimeScopeSelect.vue；frontend/src/composables/useTimeScope.ts；backend/tests/test_time_scope.py；frontend/src/components/app/__tests__/timeScope.spec.ts。
现有修改：backend/app/modules/thesis/router.py、service.py；backend/app/modules/dispatch/router.py、service.py；backend/app/modules/result/service.py；frontend/src/api/theses.ts、dispatch.ts、schoolReview.ts、results.ts；相应真实列表页面。

## 用户审阅重点

近一年按论文创建日、公历年；默认全部；范围不包含专家名录与异议待办。

实施计划：[E04 plan](../plans/2026-10-12-e04-data-time-scope.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 2026-10-13 用户批准的最窄补充

真实RLS复验发现：已拒绝/取消任务仍可由本人列出，但所属论文行不可由专家读取，直接JOIN会误删这些任务。用户明确回复“批准这项最窄日期查询（建议）”：仅允许专家判断本人任务所属论文创建日是否处于给定区间，返回boolean；不返回正文、作者、学校信息，不恢复文件访问。

采用固定SQL的只读SECURITY DEFINER函数，绑定当前专家与本人任务关系；仅迁移owner的限定RLS读取政策服务于此固定函数，业务角色对论文表的SELECT政策保持原样。函数固定schema/search_path，禁止PUBLIC执行，仅业务连接可调用；其他角色、其他专家和未知任务返回false。API日期仍由服务端计算。all模式保持原任务查询；past_year通过boolean谓词筛选，无需专家读取拒绝任务的论文行。按实际head新增0024迁移，复验SQL负向、往返和恢复。

实测与限制：[E04验收记录](../../reviews/2026-10-12-e04-validation.md)。
