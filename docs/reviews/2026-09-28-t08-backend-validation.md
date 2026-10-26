# T08-1/2：固定规则、历史回填及结果接口

2026-09-28，分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962c489163018a49ef5058171925c4faaa9d`。按用户最新“困难项优先”授权，在T07-2之后先完成后端，页面仍留给T08-3。全部数据为5433/paper_review_test独立schema的虚构夹具；没有迁移开发库、导入真实材料或提交/推送/部署。

环境实测：Python3.12.7、pytest9.1.1、SQLAlchemy2.0.52、Alembic1.19.1、FastAPI0.141.1、PostgreSQL16.15。

## 交付

- `review/rules.py`：固定pilot-single-v1、独立副本、严格快照校验、59/60/79/80/100档位；未知版本/损坏快照409。
- `0018_round_rule_snapshot`：先审计已知旧记录，再回填轮次和旧二字段汇总；拒绝未知规则、错误六维/类型/总分、双席位或汇总映射。保留总分、评语、任务ID、发布记录及时间。新轮次规则必填且不可改；有轮次/汇总时拒绝降级，失败事务恢复原revision和FORCE RLS。
- 提交只接受严格整数，并按所属轮次快照检查维度；汇总复制轮次快照，发布校验一致性。学生/导师投影仅读既有可见汇总与正式结果，不扩大expert_tasks SELECT。
- 新增专家任务rules与学校review-rule只读端点；学校结果增加nullable rule_snapshot/outcome，已发布学生/导师增加非空字段；recommendation仍独立，workflow阶段不变。
- 重复确认不重建规则；撤回重提生成独立轮次；改派仍用原轮次；已有轮次提交不依赖后来修改的默认factory。

## 失败→修复→实测

所有pytest由根目录运行，入口为 `backend/.venv/bin/pytest`，配置参数 `-c backend/pyproject.toml -q --tb=short`。以下命令集合有重叠，不相加当作唯一测试数。

1. `backend/tests/test_review_rules.py`：未实现时退出2，ModuleNotFoundError；实现后退出0，19 passed / 1 warning。
2. `backend/tests/test_rule_snapshot_migration.py -x`：未实现时退出1，找不到0018；实现过程中修正夹具内JSON数字被SQLAlchemy识别为bind参数的问题。随后 `backend/tests/test_review_rules.py backend/tests/test_rule_snapshot_migration.py backend/tests/test_dispatch.py -x`：退出0，37 passed / 2 warnings，32.57s。
3. `backend/tests/test_rule_snapshot_api.py -x`：新接口404红灯，退出1。实现后修正测试使用的另一位种子专家名为expert.qian。`backend/tests/test_rule_snapshot_api.py backend/tests/test_review.py backend/tests/test_review_integrity.py backend/tests/test_publish.py backend/tests/test_dispatch_result_integrity.py backend/tests/test_supervisor_results.py -x`：退出0，44 passed / 2 warnings，87.61s。
4. 扩大检查 `backend/tests --show-capture=no`：退出1，**384 passed / 2 failed / 2 warnings**，651.07s。失败是test_rls_children与test_rls_core两处旧跨校夹具INSERT review_rounds缺少必填rule_snapshot，被新触发器拒绝。补入合法固定快照，保留全部原有跨校拒绝断言，不放宽RLS或数据库约束。
5. 自查补出JSONB数值表示缺陷：数据库 `1 = 1.0`，仅比较JSONB会允许快照表示变化而令严格应用校验失败。定向运行 `backend/tests/test_rule_snapshot_api.py::test_rules_read_boundaries_and_database_immutability 'backend/tests/test_rule_snapshot_migration.py::test_known_legacy_rules_backfill_preserves_business_data[published]' --show-capture=no`：退出1，2 failed / 1 passed，9.95s。修复为比较JSONB规范化文本；轮次触发器和汇总CHECK均拒绝此写入。
6. 最后完整复验上述改动涉及的纯函数、迁移、API及两处跨校用例：

```sh
backend/.venv/bin/pytest \
  backend/tests/test_review_rules.py \
  backend/tests/test_rule_snapshot_migration.py \
  backend/tests/test_rule_snapshot_api.py \
  backend/tests/test_rls_children.py::test_published_result_ids_cannot_expose_another_schools_task_result \
  backend/tests/test_rls_core.py::test_same_user_memberships_in_two_schools_do_not_cross_token_tenant \
  -c backend/pyproject.toml -q --tb=short --show-capture=no
```

退出0，**47 passed / 2 warnings，97.26s**。包括普通SQL快照冻结、汇总约束、无结果/在途/已发布回填与拒绝矩阵、严格整数、损坏规则409、规则访问权限、发布前不可见、发布后档位与匿名投影、student/supervisor直接SQL任务行数仍为0、重复确认/新轮次/改派。

`git diff --check`退出0。只读清理核对：test_schema_count=0、temporary_rls_role_count=0。没有运行持久HTTP服务。原始材料目录无差异。

## 未覆盖与下一步

本轮**不是最终工作树一次全量PASS**：全量先发现两处夹具问题，修复后以47项定向集复验；没有再运行整套后端。前端、类型检查、真实构建、浏览器规则显示尚未执行，属于T07-4/T08-3/T11模块验收。现有警告来自crypt和argon2版本读取的弃用提示。

没有真实旧数据；迁移只证明本仓库已知虚构历史的回填契约。未知来源或真实导入仍须停止。T10-A尚未实现/演练，客户端安装连续失败后的阻断见[工具链记录](2026-09-28-t10-toolchain-blocker.md)。真实部署、异地备份、旧应用构建回退、最终试点放行均NOT RUN。

T08-1/2后端本地验证通过；T08顶层模块未完成。低成本模型可按[交接提示词](../superpowers/plans/2026-09-28-cheaper-model-handoff.md)执行T07-3/4及T08-3，不重复设计后端、不提前封板。

完整工作树清单：[本轮交接快照](2026-09-28-hard-parts-worktree.txt)。63个已跟踪文件有修改、109个未跟踪文件，包含之前累计工作，不全部归于本轮。分支/HEAD保持不变。
