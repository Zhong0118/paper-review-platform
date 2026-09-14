# 盲审平台项目工作规范

现行状态与切片表：[docs/CURRENT.md](docs/CURRENT.md)。怎么跑：仓库根 [README.md](README.md)。

## 1. 项目定位

第三方多校论文送审与双向盲审平台。当前交付是**一条垂直主链**（一篇论文、一个专家、平台账密），不是完整运营后台。

空模块目录（`finance` / `notice` / `statistics` / `integration` / `template` 等）不是进度，不要为填目录而写代码。

## 2. 文档优先级

1. `docs/CURRENT.md` 与 `docs/superpowers/specs/2026-08-31-*`、`2026-09-01-*`（现行施工规格）
2. `CONTEXT.md`（领域术语）
3. `docs/00`–`10`、`docs/superpowers/archive/`（历史；冲突时以切片为准）
4. `docs/99_原始材料/`：只读。不得删除、覆盖、重命名、直接改写。

## 3. 编码约定（现行）

- 先写切片规格，再写测试，再写实现。用户说「继续」且上一刀已有规格时，按该规格 inline 执行。
- 不要往 `frontend/src/demo/scenarioService.ts` 加业务。
- 客户端不得传 `tenant_id`；租户来自 token。
- `theses.stage` 只允许 `workflow.transition` 写入。
- 学校看不到专家姓名；专家看不到原文和作者。敏感缺失与无权限对外多为 `RESOURCE_NOT_FOUND`。
- 测试用独立 Postgres（5433 / `paper_review_test`），不要复用其它项目的 5432。
- 不删除 `docs/99_原始材料/`。不上生产前必须补 RLS（延期，未取消）。

## 4. 角色（实现口径）

平台账密种子登录（SSO 未做）：学生、学校审核、百杰审核、专家、导师、系统管理员。系统管理员默认不读论文正文。
