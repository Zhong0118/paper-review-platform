# 7B-4 终止与改派最小闭环

延续既有 0+1/2 规格和用户授权的修复范围，不引入费用、期限、多专家或撤回审批。

- 学校仅可终止本校未完成论文（DRAFT、SUBMITTED、PREPARING、READY_FOR_DISPATCH、UNDER_REVIEW、RESULT_PROCESSING）；请求必须含 version 和非空 reason。COMPLETED/TERMINATED 拒绝。经 workflow.transition 转 TERMINATED；CREATED/ACTIVE/RESULT_READY 轮次 CANCELLED，INVITED/IN_REVIEW 任务 CANCELLED。历史任务、草稿及正式结果不删除。学校准备页按服务端动作显示终止入口，二次确认。
- 百杰 POST /expert-tasks/{id}:reassign，body expert_id。仅当前版本 ACTIVE 轮次、UNDER_REVIEW、旧任务 INVITED/IN_REVIEW、目标为另一专家可改派。新专家复用 assign 的学科、状态、回避及单席位约束；同事务旧任务 CANCELLED、新任务 INVITED 且 replaces_task_id 指向旧任务。校验失败整体回滚。REJECTED 使用既有再派；SUBMITTED 不可改派。
- 两命令与提交/接拒/发布使用相同论文→任务锁序，刷新缓存对象；不同幂等键竞争不会重复生成任务，同键相同载荷重放、不同载荷冲突。记录操作者审计。
- 平台队列仅暴露可改派旧任务 ID（平台专用），在真实派单页选中后选择新专家并二次确认。学校列表不暴露专家身份。
- 验证权限/跨租户、版本、无效目标不取消旧任务、旧专家不可再保存或提交/读材料、重复改派、正式结果保护与全套回归。无迁移/新增依赖。

真实派单/改派操作不显示演示用固定 300 元费用；费用仍未启用，保持切片 2 豁免约定。
