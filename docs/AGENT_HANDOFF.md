# 新 agent 接手入口

更新时间：2026-09-22。用途：无需读取长聊天即可接续工作。

## 先读与先做

1. 根 AGENTS.md、docs/CURRENT.md。
2. docs/superpowers/specs/2026-09-22-pilot-delivery-scope.md。
3. docs/superpowers/plans/2026-09-22-pilot-task-board.md。
4. docs/superpowers/plans/2026-09-22-pilot-first-three-tasks.md，仅执行被指定的一项。

默认下一项 T01；本轮只编写计划，没有实施 T01–T11。

## 不可丢失的状态

- 工作目录 /Users/zhongxu/Desktop/0-Inbox/paper-review-platform。
- 分支 codex/slice-7a1-file-integrity；修复代码快照 b92cdc2，交接文档在其后单独提交。接手时用 git log 核对最新文档提交及实际 HEAD。
- 同目录换 agent 继续使用现有工作树。当前提交仅在本地，尚未推送；新机器/云 agent 必须先接收最新代码及文档快照，不能使用旧基线 12ab023 代替。
- 不执行 git reset --hard / git clean，不丢弃旧改动。未经明确授权不提交、推送、开 PR、合并或部署。
- 本地 .codegraph/ 与 .zvec-grep/ 已有索引；CodeGraph 优先定位源码，语义检索可用 zg query，精确定位用 rg。CLI 的 zg query 不支持 --root，应在仓库 cwd 执行。新环境缺索引时不自行创建。

## 已交付与限制

原审查 18/18 缺陷已修复并有对应验证，详见 docs/reviews/2026-09-21-full-project-audit.md。该比例不是项目上线完成率。

2026-09-22 提交前重新验证：后端 141 passed / 3 warnings；前端 405 passed / 54 files；类型检查/真实模式 build 通过。普通 Chrome 已显示真实匿名 PDF 正文。其他浏览器、大型复杂材料、多角色完整浏览器矩阵不应声称已全部覆盖。

无正式部署；RLS、非 seed 运营入口、生产认证/存储/恢复等仍需按试点范围推进。历史空目录、演示页面和枚举不算已实现能力。

## 可直接复制给执行 agent 的任务

> 请接手此仓库，读取 docs/AGENT_HANDOFF.md 及其指向的规划边界和前三项计划。本次只执行 T01：保护并核对完整工作树、复验开发基线、产出 docs/reviews/pilot-baseline.md。保留所有未提交修改，不读出真实密钥，不改开发数据库，不自动提交/推送/部署。按实际测试结果报告；完成后停在 T01 的交付边界，说明 T02 是否具备开工条件。若本地缺少现有修复，先报告代码快照缺口，不能从旧 HEAD 继续。

完成 T01 后，把上述任务编号替换为 T02，并引用上一项证据；T03 同理。后续 T04–T11 需先满足业务决定及切片规格，不盲目连续执行。
