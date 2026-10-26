# E06 列表列显示与顺序偏好设计规格

日期：2026-10-12。状态：**LOCAL_VERIFIED / 2026-10-26一期封板**。阶段：一期。

原需求：B2。依赖：E05；一期最后收口。

目标：在三个常用真实列表支持个人列显隐、顺序调整和恢复默认，持久化不影响数据权限。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 首版覆盖及契约
接学校论文表SchoolThesisTable、专家任务表ExpertTaskTable、平台候选专家表CandidateExpertTable。专家档案当前是卡片布局，不为列设置把整页重构成表格；B2“所有列表”记录为部分覆盖。
共享组合式函数 `useColumnPreferences(tableId, schemaVersion, allowedColumns)`；ColumnSpec `{id,label,required,defaultVisible}`，顺序为输入默认。必需的论文/任务标识列及操作列不能隐藏，操作列固定末尾。其余列支持显示隐藏、拖动、键盘上移/下移，且至少保留一个业务数据列。
拟新增纯函数`normalizeColumns(savedOrder: string[], columns: ColumnSpec[]): {order:string[]}`：合法唯一已保存列先排列，缺失列按定义顺序追加，actions固定末尾；显隐另存visibleIds，required永远可见。

偏好键`columns:v1:{userId}:{role}:{tenantId-or-platform}:{tableId}`，仅保存列ID、顺序、schemaVersion，不保存记录内容或token。第一版本浏览器持久化，不宣称跨设备同步。未知旧列丢弃、新列按默认追加、重复ID去重，损坏存储恢复默认。

## 权限与交互
角色允许列来自代码中的安全白名单，服务端响应仍按权限裁剪；改localStorage/拖动请求不得获取隐藏敏感字段。无后端新表/迁移。
提供“列设置”“恢复默认”；改动即时生效，不改变查询筛选。视图宽度不足横向滚动而不是压缩到不可读；键盘可操作，焦点在重排后保持对应列。

## 验收
刷新后保持；更换用户/角色/租户不串；旧版本偏好升级；拖动和键盘结果一致；清空所有可选列仍保留必须列；恢复默认只清当前表偏好。实际浏览器检查三列表，而非仅测试独立组件。
一期收口运行全量、迁移/RLS/恢复检查及E01–E06浏览器矩阵，完成后记录当前head、dirty工作树与证据；二期实施前核对此记录，不将计划待审状态自动改成可执行。


## 文件落点

拟新增：frontend/src/composables/useColumnPreferences.ts；frontend/src/components/app/ColumnPreferences.vue；frontend/src/components/app/__tests__/columnPreferences.spec.ts。
修改：frontend/src/modules/school/components/SchoolThesisTable.vue；frontend/src/modules/review/components/ExpertTaskTable.vue；frontend/src/modules/dispatch/components/CandidateExpertTable.vue及其真实父页面传入稳定用户身份。

## 用户审阅重点

一期首版三个列表、本浏览器持久化；其余列表逐项扩展，不计全平台完成。

实施计划：[E06 plan](../plans/2026-10-12-e06-table-column-preferences.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 2026-10-26 实施细化

三个真实父页面显式传入当前身份。组合式函数保留三参数入口，并增加可选第四参数响应式身份，便于独立组件验证和身份切换。学校论文标识列必显，新增固定末尾“查看”操作；专家匿名任务编号必显；平台候选专家标识及选择操作必显。真实模式窄屏仍为可横向滚动的表格，候选专家演示模式继续使用原移动卡片。未增加后端表、迁移或权限。

实际验证见[E06验收记录](../../reviews/2026-10-12-e06-validation.md)。
