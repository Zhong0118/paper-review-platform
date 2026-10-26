# T01：试点开发基线复验

复验日期：2026-09-22  
结论：**通过**。T01 范围内没有发现阻断项，T02 可以开始。

## 代码快照

- 工作目录：`/Users/zhongxu/Desktop/0-Inbox/paper-review-platform`
- 分支：`codex/slice-7a1-file-integrity`
- 复验起始 HEAD：`39a8962c489163018a49ef5058171925c4faaa9d`
- 修复代码提交：`b92cdc2`，已确认是当前 HEAD 的祖先。
- 旧基线 `12ab023` 不包含本轮完整修复，不能用于后续任务。
- 复验开始前 `git status --short` 无输出；7B-4、7B-5、7B-6 记录及对应源码、回归测试均存在。
- 当前提交仅在本地交接，T01 未提交、推送、合并或部署。

## 环境与数据库边界

| 项目 | 实际值 |
|---|---|
| 操作系统 | macOS 27.0，arm64 |
| Python | 3.12.7 |
| pytest | 9.1.1 |
| Node.js | 24.19.0 |
| pnpm | 12.5.1 |
| TypeScript | 5.9.3 |
| Vite / Vitest | 8.1.3 / 4.1.10 |
| Docker / Compose | 28.1.1 / 2.35.1-desktop.1 |
| PostgreSQL | 16.15；容器内 5432，仅映射到宿主机 `127.0.0.1:5433` |
| 测试数据库 | `paper_review_test` |

测试配置的基础连接目标为本项目宿主机 5433；`backend/tests/conftest.py` 将测试数据库固定为 `paper_review_test`，每次通过真实 Alembic 迁移创建独立 `test_*` schema。后端全套结束后复查该测试库，残留 `test_*` schema 数量为 0。未执行开发业务库的迁移、清表或 seed，未读取或输出 `.env` 中的凭据。

## 实际执行结果

以下命令均在上述 HEAD 上于本次 T01 重新执行；历史数字只用于对照。

| 检查 | 命令 | 退出码 | 结果 |
|---|---|---:|---|
| 后端全套 | `STORAGE_ROOT=$(mktemp -d /tmp/paper-review-test.XXXXXX) backend/.venv/bin/pytest backend/tests -c backend/pyproject.toml -q --tb=short` | 0 | 141 passed，3 warnings，110.82 秒 |
| 前端单元测试 | `node_modules/.bin/vitest run`（`frontend/`） | 0 | 54 files、405 tests passed，11.93 秒 |
| 前端类型检查 | `node_modules/.bin/vue-tsc --build`（`frontend/`） | 0 | 通过，无错误输出 |
| 前端真实模式构建 | `VITE_DEMO_MODE=false node_modules/.bin/vite build`（`frontend/`） | 0 | 通过，1907 modules transformed，837 ms |

后端三条警告与既有基线一致：

1. Python `crypt` 将在 Python 3.13 移除的弃用警告，来源为 passlib。
2. `argon2.__version__` 接口弃用警告，来源为 passlib 的 argon2 handler。
3. `test_open_objection_unique_per_thesis` 结束时出现 SQLAlchemy `transaction already deassociated from connection` 警告。

前端构建成功，但保留两类非阻断提示：`@vueuse/core` 中两个 PURE 注释位置无法由 Rolldown 解释；主入口压缩后约 1.16 MB，超过 Vite 默认 500 kB chunk 提示阈值。T01 不改变打包策略。

验证产生的临时存储位于独立 `/private/tmp/paper-review-test.*` 目录，复验后已清理。前端 `dist/` 为现有忽略产物，没有形成受跟踪差异。

## 未覆盖范围

- 本次只执行本地自动化基线，没有运行远端 Hosted CI，也没有验证推送、合并或部署。
- 没有重新执行浏览器端多角色主链；既有 Chrome PDF 记录仍是历史证据，不算本次重新观察。
- 没有覆盖其他浏览器、移动端、大型或复杂 PDF、容量及故障恢复。
- RLS、生产认证、私有存储、备份恢复和非 seed 运营入口仍未完成；测试通过不代表可生产上线。

## T02 开工判断

T02 具备开工条件：修复快照完整，四项基线命令全部退出 0，测试数据库边界及临时 schema 清理已核实，工作区在记录写入前保持干净。T02 应按现有计划把相同检查固化为本地统一入口和 CI 配置，并继续把“本地通过”与“远端 CI 已验证”分开记录。

## T02：统一检查入口与 CI 配置

执行日期：2026-09-22  
结论：**本地通过，远端待验证**。

本任务新增 `scripts/check.sh`、`scripts/tests/check_test.sh` 和 `.github/workflows/check.yml`，并在 README 增加统一验证入口。脚本从自身位置解析仓库根，可从任意当前目录调用；它不会安装依赖、修改 `.env`、重置数据库或输出连接凭据。

### 失败传播与安全门

隔离 harness 使用临时目录和受控假可执行文件运行真实 `scripts/check.sh`，获得以下结果：

- 正常路径按后端测试、前端测试、类型检查、真实模式构建的顺序执行。
- 人为令 `vitest` 返回 17 时，统一入口同样返回 17，且不再执行 `vue-tsc` 和 Vite。
- 人为提供 `127.0.0.1:5432/paper_review_test` 时，脚本在运行 pytest 前拒绝目标。
- 移除 pytest 可执行文件时，脚本返回非零并报告缺失的 `backend/.venv/bin/pytest`。
- `bash -n scripts/check.sh scripts/tests/check_test.sh` 与 `scripts/tests/check_test.sh` 均退出 0。

### 统一入口本地复验

从仓库根执行 `./scripts/check.sh`，退出码 0：

| 检查 | 本次结果 |
|---|---|
| 数据库安全门 | `127.0.0.1:5433/paper_review_test` 通过 |
| 后端 | 141 passed，3 warnings，123.46 秒 |
| 前端测试 | 54 files、405 tests passed，31.84 秒 |
| 类型检查 | 通过 |
| 真实模式构建 | 1907 modules transformed，1.94 秒，构建通过 |

警告与 T01 相同：后端仍有 passlib `crypt`、argon2 版本接口和既有事务 fixture 三条警告；前端仍有第三方 PURE 注释和 chunk 大小提示。统一入口为每次运行创建并清理自己的临时存储目录；测试库临时 schema 仍由 fixture 管理。

### CI 配置状态

工作流使用 Python 3.12、Node 24.12.0、pnpm 12.5.1、`--frozen-lockfile` 和 PostgreSQL 16。CI 的独立测试账号只存在于临时 service 容器，容器 5432 映射 runner 5433；工作流安装后端 dev 依赖和前端依赖后调用同一个 `scripts/check.sh`，不依赖本机 `.venv`、`.env` 或 `node_modules`，也不包含部署、推送或自动合并步骤。

本地已用 Ruby YAML 解析器确认工作流文件语法可读，但当前没有 actionlint，且未推送到 GitHub，因此状态只能记为“配置完成，Hosted CI 未运行”。首次远端成功必须另行记录，不能由本地通过代替。

## T03：隔离验收入口与矩阵

执行日期：2026-09-22  
结论：**隔离入口与最小浏览器闭环通过；完整多角色浏览器矩阵仍有明确未测项。**

本任务新增 `backend/scripts/acceptance_server.py`、`backend/tests/test_acceptance_server.py` 和 `docs/reviews/pilot-acceptance-matrix.md`，并在 README 增加隔离场景的启动和精确清理说明。入口仅监听 loopback，固定使用宿主机 5433 的 `paper_review_test`，每次创建唯一迁移 schema 和独立临时存储；支持 `empty`、`accepted`、`published` 三种虚构场景。

入口边界测试 **10 passed，2 warnings**。覆盖数据库目标和端口拒绝、默认参数、三种退出路径的资源清理，以及真实子进程 SIGINT；实现过程中复现并修复显式端口字符串校验和 Uvicorn 信号重抛导致清理阶段 `CancelledError` 两项问题。

T03 代码完成后再次从仓库根运行 `./scripts/check.sh`，退出码 0：

| 检查 | 本次结果 |
|---|---|
| 数据库安全门 | `127.0.0.1:5433/paper_review_test` 通过 |
| 后端 | 151 passed，3 warnings，122.76 秒 |
| 前端测试 | 54 files、405 tests passed，19.35 秒 |
| 类型检查 | 通过 |
| 真实模式构建 | 1907 modules transformed，967 ms，构建通过 |

真实模式浏览器使用 `accepted` 场景完成专家登录、精确任务路由和六维 80 分草稿保存；独立 HTTP 会话重新登录并读回相同分值和总体评价。`published` 场景实际由学生 API 读回 80 分发布结果。退出后相应端口、schema 和存储均已清理。逐角色状态、实际证据和 NOT RUN 项见[隔离验收矩阵](pilot-acceptance-matrix.md)。

## T04 开工判断

T03 的技术前置已经具备，但 T04 不能直接进入业务实现。下一步需要用户明确试点学校与账号规模、评审人数和评分规则、部署方式，以及 SSO、代传/批量导入、收费是否为首批必需项；决定记录完成后再为 T05–T10 编写具体切片。Hosted CI、其余角色完整浏览器流程、应用内 PDF 正文渲染、跨浏览器/移动端、RLS 和生产部署仍未验证。

## T05-C：运营页面与非 seed 主链入口

执行日期：2026-09-23。分支 `codex/slice-7a1-file-integrity`，HEAD 仍为 `39a8962`；T01–T05 改动均保留在未提交工作树。

系统租户、学校批次、学校成员及资格页面已接入真实 API；新增 `/school/members`（PAGE-025）。`operations` 验收场景以独立测试 schema 准备虚构运营对象，子进程 SIGINT 和异常清理测试通过。真实浏览器分别用系统、学校和非 seed 学生账号验证：建立虚构学校、查看 OPEN 批次及学生/导师资格、建立一篇 DRAFT。独立 API 会话和同一隔离库只读查询核对论文 tenant、batch、student membership 与资格关系。完整步骤见 [隔离验收矩阵](pilot-acceptance-matrix.md)。

| 检查 | 命令 | 退出码 | 实际结果 |
|---|---|---:|---|
| acceptance 定向 | `backend/.venv/bin/pytest backend/tests/test_acceptance_server.py -c backend/pyproject.toml -q --tb=short` | 0 | 11 passed，2 warnings |
| 统一全套 | `./scripts/check.sh` | 0 | 后端 194 passed，3 warnings；前端当时 420 passed（58 files）；类型检查和真实模式构建通过 |
| 最后前端调整复验 | `node_modules/.bin/vitest run && node_modules/.bin/vue-tsc --build && VITE_DEMO_MODE=false node_modules/.bin/vite build`（`frontend/`） | 0 | 422 passed（58 files），类型检查和构建通过 |

统一全套之后仅改动了前端演示菜单和成员编辑 409 冲突交互；因此后端全套的 194 项结果仍对应最终后端代码，前端最终结果以 422 项为准。后端三条既有警告仍来自 passlib `crypt`、argon2 版本接口和一条 SQLAlchemy 事务警告；构建仍有第三方 PURE 注释及大 chunk 提示。验收结束后 8011/5186 无监听，测试库 `test_*` schema 为 0，临时验收存储目录不存在。没有修改开发业务库、提交、推送或部署。

T06 可以开始写数据隔离/RLS 的具体规格和验证方案；RLS 尚未实施。Hosted CI、正式数据、生产配置/恢复、完整多角色浏览器矩阵和跨浏览器验收仍未运行，不能据此放行试点上线。

## 2026-09-23 复审更新

既有通过数字保留为运行证据。新增复审发现 8 项待修问题（4 P1 / 4 P2），详见 [复审报告](2026-09-23-t05-followup-review.md)。T05 状态改为已实现、复审待修；R01–R08 关闭前不进入 T06 实施。

## 2026-09-23 R08 修复集合复验

上述复审结论属于修复前快照。R01–R08 本地修复和验收已完成，逐项证据见 [R08 验收记录](2026-09-23-r08-validation.md)。首次统一检查后端 234 passed / 3 warnings，前端因默认并行下 4 项 5 秒超时而退出 1；四项合跑 63/63 通过，前端限制 4 个 worker 后全套 430/430 通过。`scripts/check.sh` 加入该并行限制后，重新运行完整 `./scripts/check.sh` **退出 0**：后端 234 passed / 3 warnings，前端 430 passed / 59 files，类型检查与真实模式构建均通过。`git diff --check` 退出 0。

隔离 `operations` 浏览器复验学校快速切换、批次真实 409 冲突和历史论文身份显示，结束后测试 schema、临时存储和监听端口均已清理。Hosted CI、生产 RLS、完整多角色/跨浏览器矩阵仍未运行；下一项仅为 R09 的 T06/RLS 设计，不据此放行部署。
