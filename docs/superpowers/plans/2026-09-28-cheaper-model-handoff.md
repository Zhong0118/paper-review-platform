# 页面实现与验收交接（低成本模型）

本入口供同目录切换模型使用。先核对 CURRENT 和统一包最新状态；本文件不将尚在运行的测试或T10阻断标为完成。

**2026-10-03 最新状态：** 原13项和复审F01–F03均已本地验证，见[补修记录](../../reviews/2026-10-03-followup-fix-validation.md)：后端414、前端454、类型与真实构建通过。当前没有应机械重做的本地任务；B阶段等待真实条件与授权。下方仅保留历史指令。

## 历史交接工作（已执行，保留背景）

1. **T07-3**：真实专家库页面与菜单。按已验证的API做创建、编辑、资格审批/驳回、暂停/恢复及两类回避；不要加入费用、统计、资质材料上传或密码恢复。创建重试保留同一个Idempotency-Key；版本409刷新后由用户再次决定，不能静默拿新version自动重放。
2. **T07-4**：专家模块API、SQL和浏览器验收及全量检查。当前后端还包含T08新增迁移；T07空库往返使用独立schema明确指定0017，不对开发库降级。此前后端验证不替代本项浏览器验收。
3. **T08-3**：专家表单从任务rules接口加载六维规则；学校批次页只读显示固定规则；学校、学生、导师展示同一outcome。保留demo分支，真实模式加载失败不能用假模板；切任务时清空旧规则，沿用generation屏障。
4. **T11-A1/A2**：必须等T10-A1/A2解决并完成后才做最终六角色浏览器矩阵和全量封板。可以先完成上述页面，不因T10工具链阻断空等；不能因此宣布剩余包完成或上线。

具体文件、字段、测试命令和验收场景已在[T07计划](2026-09-28-t07-expert-operations.md)、[T08计划](2026-09-28-t08-fixed-review-rules.md)、[T11计划](2026-09-28-t11-local-acceptance.md)。T10是未完成的困难项，先读[工具链与清理边界阻断](../../reviews/2026-09-28-t10-toolchain-blocker.md)，不在页面接线时顺手改恢复方案。

### 容易遗漏的接线

- `frontend/src/api/dispatch.ts`候选类型增加qualification_status，`DispatchWorkbenchPage.vue`把非APPROVED加入不可选原因；服务状态仍是UNAVAILABLE，不另造PAUSED。
- expert-options的学校是回避对象ID，不是操作者tenant_id。所有业务身份仍来自token。
- `GET /api/v1/expert/tasks/{task_id}/rules`与`GET /api/v1/school-review/review-rule`均只读。结果投影增加rule_snapshot/outcome，其他旧字段保留。
- 无summary的学校结果两字段为null；已发布学生/导师字段非空。“修改后通过”只代表评分档位，不代表平台已验收修改稿。
- 真实页面不得显示未接线的服务统计、费率、材料上传或全局账号恢复入口。

## 历史执行提示词（勿作为当前任务入口）

```text
接手 /Users/zhongxu/Desktop/0-Inbox/paper-review-platform。
先核对实际分支、HEAD、全部未提交和未跟踪文件，保留现有工作；参考分支codex/slice-7a1-file-integrity、HEAD39a8962。
读AGENTS.md、docs/CURRENT.md、docs/AGENT_HANDOFF.md、
docs/superpowers/plans/2026-09-28-pilot-execution-pack.md、
docs/superpowers/plans/2026-09-28-cheaper-model-handoff.md。

本次依次执行尚未完成的T07-3、T07-4、T08-3，采用inline，不创建子agent。
每项只读对应设计/计划及相关源码，先失败测试再最小接线，核对真实API字段、角色与旧请求屏障。
已经验证的T07-2和T08后端不得重复实现或放宽RLS；如果当前验收记录仍有失败，先报告实际失败项。
每项完成更新统一包和验收链接；模块边界按计划跑全量、类型检查、真实模式构建。
浏览器只记录实际操作和观察，HTTP不能替代浏览器PASS。
数据库仅用本机5433/paper_review_test独立schema；禁止迁移开发库。
不改原始材料，不加费用/通知/SSO/多专家，不提交、推送、部署或清理已有工作。
T10当前有单独阻断，不在本次页面任务中重试安装或擅改资源删除方案；T11最终封板等待T10完成。
交付时报告文件、实际命令/退出码、API与浏览器分别覆盖什么、未测项与后续入口。
```
