# T05 交付后复审

> 2026-09-23 R08 更新：下列发现是修复前的复现记录。F01–F08 已逐项修复并通过本地定向及统一验证；R01–R03 的 P1 独立复核发现也已处理。实际结果、浏览器验收和剩余边界见 [R08 验收记录](2026-09-23-r08-validation.md)。Hosted CI、RLS 与生产放行仍未完成。

日期：2026-09-23。范围：`codex/slice-7a1-file-integrity` / HEAD `39a8962` 上未提交的 T01–T05，重点审查 T05 新增运营能力及其与旧主链的连接。未提交、推送、部署或修改开发业务库。

结论：**实现和既有测试通过，但复审发现 8 项问题；T05 改为“已实现、复审待修”，先完成修复，再进入 T06。** 194 项后端、422 项前端通过不等于覆盖了撤销、并发和历史数据场景。本次没有修复下表业务代码，只增加审查证据和交接计划。

## 规格与行为审查

| ID | 级别 | 问题与证据 | 位置 | 修复任务 |
|---|---|---|---|---|
| F01 | P1 | 密码重置后旧 access 请求 `/api/v1/me` 仍 200；disable 后 401、enable 后同一旧 access 又 200。只撤销 refresh session，没有 access 撤销代际。 | `backend/app/modules/user/service.py:194`；`auth/service.py:40`；`auth/deps.py:48` | R01 |
| F02 | P1 | refresh 读取身份后暂停，reset-password 提交，再放行 refresh；刷新产生的新 refresh 仍可再次刷新 200。撤销和签发没有共享锁。 | `backend/app/modules/auth/service.py:154` | R02 |
| F03 | P1 | 暂停租户 200 后，Bearer `/me` 为 401，但暂停前取得的文件专用 token 仍返回 200 和 PDF 正文。文件读取仅检查 User ACTIVE，没有有效角色/租户/membership 门禁。 | `backend/app/modules/files/router.py:127` | R01 |
| F04 | P1 | create_draft 通过资格检查后暂停；管理员关闭提交并归档成功，再放行创建，产生 `ARCHIVED + DRAFT`。新建未与批次状态命令共享锁。 | `backend/app/modules/thesis/service.py:61,233`；`tenant/service.py:346` | R03 |
| F05 | P2 | POST 成员的 `username:123` 返回 500；before validator 调用 `.strip()` 抛 AttributeError。tenant code 有同样实现模式。 | `backend/app/modules/user/schema.py:15`；`tenant/schema.py:25` | R04 |
| F06 | P2 | 学校 A、B 管理员列表请求逆序返回，当前学校为 B，却展示 A 的管理员；后续操作把 A 的用户 ID 与 B 租户 ID 拼接。 | `frontend/src/modules/system/pages/TenantPermissionsPage.vue:64` | R05 |
| F07 | P2 | 批次 PATCH 409 后只刷新 rows，编辑表单仍携带旧 version；连续保存发出版本 `[3,3]`，刷新两次后仍停留 edit。 | `frontend/src/modules/school/pages/BatchRulesPage.vue:88` | R06 |
| F08 | P2 | 查看历史论文时，`loadDraft` 用 `/me/eligibility` 的当前 OPEN 批次资格覆写旧论文的批次/导师/截止时间。 | `frontend/src/modules/thesis/pages/ThesisEditPage.vue:118`；`backend/app/modules/tenant/service.py:391` | R07 |

规格依据：T05 设计 §4.3 要求身份和撤销门禁；§4.5 要求仅 OPEN 新建、无未完成论文才能归档；§4.7 要求已有论文按原批次和历史资格展示；§5 规定输入错误为 422；§8–9 要求真实页面正确处理当前对象、失败和冲突。

## 编码规范审查

没有发现本轮读取范围内对 `docs/99_原始材料` 的修改，也没有向 `scenarioService.ts` 添加业务。客户端运营输入没有 tenant_id，已有接口保留角色与租户约束。本次不把文件体积、重复模板或命名偏好列为必须重构项。F05 同时违反稳定错误处理约定，F06/F07 属于页面状态一致性问题；不重复计数。

## 复现与验证口径

- F01/F02/F05：独立审查实际调用 `acceptance_environment("operations")` 和 ASGI HTTP；F01 实测 old access 200、old refresh 401、disable 401、enable 后 200；F02 通过事件屏障控制刷新/重置顺序后验证新 refresh 200；F05 数字 username HTTP 500。临时 schema/存储退出时清理。
- F03：主审在 operations 场景中使用虚构 PDF，先授权下载，再暂停学校。输出：`suspend=200, bearer_me=401, download_grant=200, content_is_pdf=True`。未记录 token 或真实材料。
- F04：可重跑 [并发探针](probes/t05_batch_race.py)：`PYTHONPATH=backend backend/.venv/bin/python docs/reviews/probes/t05_batch_race.py`。实际输出 close/archive/create 均 200，状态 `[["ARCHIVED", "DRAFT"]]`。这是故障观察脚本，不应当当作绿色回归测试；修复任务需转换为安全不变量断言。
- F06/F07：独立审查直接提取当前页面函数，以内存 mock 的延迟 Promise/409 响应复现；尚不是挂载 Vue 的端到端测试。任务要求补 Vue 定向回归。
- F08：由两端源码可确定，尚未新增历史批次浏览器复现；R07 必须先写旧批次/新资格的失败测试。
- 本轮已有最终前端命令 `vitest run && vue-tsc --build && VITE_DEMO_MODE=false vite build` 退出 0（422 tests / 58 files）；此前统一检查退出 0（后端 194、当时前端 420），后续前端变动已单独复验。没有冒用此结果证明 F01–F08 已修复。

## 明确未覆盖

这次是 T05 的定向复审，不是全库无漏洞证明。RLS、生产配置、容量、完整多角色浏览器矩阵、Hosted CI 均未验证。`_locked_member` 未使用 populate_existing 仅作为调查线索：目前没有证明路由保留了旧对象，**不计入缺陷**。

8 项按问题计数，不是上线完成率。建议交给较便宜模型逐项执行 [修复计划](../superpowers/plans/2026-09-23-t05-review-fixes.md)，R01–R03 经独立安全/并发复核后再宣告关闭。T06 的实现依赖这些身份和状态边界先稳定。
