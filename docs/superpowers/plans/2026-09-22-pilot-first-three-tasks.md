# 试点准备前三项 Implementation Plan

> **For agentic workers:** 使用 executing-plans inline 逐项执行；无需自行创建子 agent 或新任务。每次只完成一个任务及其验证，不自动扩展下一项。

**Goal:** 让新 agent 可以接续修复后的工作树，并建立可靠、可复现的开发验收入口。

**Architecture:** 沿用现有 FastAPI、SQLAlchemy、Vue 和独立 Postgres 测试设施。不新增业务架构；把现有测试与临时验收经验固化成最少的脚本和证据。

**Tech Stack:** Python >=3.12、Postgres 16、Vue 3、TypeScript、Vitest、Vite；Node 满足 frontend/package.json 的版本约束。

**Spec:** ../specs/2026-09-22-pilot-delivery-scope.md

## Global Constraints

遵守上述 Spec 全局约束、根 AGENTS.md 及 docs/CURRENT.md。不可把本地 tests 通过写成远端 CI/浏览器/生产验收通过。禁止读取或展示实际 .env 密钥；以 .env.example 提供的开发默认配置或显式测试配置执行。

## T01：交接工作树与基线复验

**现有证据：** 分支 codex/slice-7a1-file-integrity，修复代码已于 2026-09-22 提交为 b92cdc2，交接文档在其后单独提交。接手时核对最新 HEAD 与提交关系；旧基线 12ab023 不包含这些修复。

**读取：** AGENTS.md、docs/CURRENT.md、README.md、frontend/package.json、backend/pyproject.toml、backend/tests/conftest.py、backend/tests/test_file_concurrency.py。

**交付文件：** 新建 docs/reviews/pilot-baseline.md；只在确有启动问题时最小修改 README.md 或测试配置。

**输入/输出：** 输入是当前完整工作树；输出是带日期、实际 branch/HEAD、dirty 状态、环境版本、测试命令及结果的基线记录，T02/T03 引用它。

- [ ] 读取 git status --short；确认 CURRENT 的 7B-4/5/6 文档和对应源码/新增测试存在。不能只 fetch/checkout HEAD 后假定修复还在。
- [ ] 若同目录换模型，直接保留工作树。已有本地修复与文档提交；若换机器，先确认最新快照已传递，不携带 .env、storage、依赖、索引。当前未推送，需要推送时取得具体授权；快照未同步则不在旧 checkout 上实现后续任务。
- [ ] 检查 Postgres 5433 是本项目专用；确认测试指向 paper_review_test。不要直接在开发库执行 alembic 或清表。
- [ ] 执行下列基线命令并记录退出码。现有依赖不足时依照清单安装，不改锁文件来凑通过。

从仓库根执行后端：
```sh
STORAGE_ROOT=$(mktemp -d /tmp/paper-review-test.XXXXXX) backend/.venv/bin/pytest backend/tests -c backend/pyproject.toml -q --tb=short
```
从 frontend 执行（已装依赖时避开本机 corepack 二次下载）：
```sh
node_modules/.bin/vitest run
node_modules/.bin/vue-tsc --build
VITE_DEMO_MODE=false node_modules/.bin/vite build
```

- [ ] 记录当前实际数量；历史参考后端 141、前端 405。不通过时报告具体差异，不能硬凑数量。测试 fixtures 已在新 schema 运行真实迁移。
- [ ] git diff --check；检查本任务新增差异；完成基线记录。没有业务变更不另写镜像测试。

**验收：** 上述命令退出 0，迁移 fixture 成功，无业务库变更；已有 crypt/argon2、fixture 事务及 bundle 提示准确记录。若执行环境不具备条件，写实际阻断，不标记完成。

## T02：统一本地检查与 CI

**依赖：** T01 通过；本任务不发布到远端。

**文件：** 新建 scripts/check.sh、.github/workflows/check.yml；修改 README.md 的验证入口。保持 frontend/package.json、pnpm-lock.yaml 和 backend/pyproject.toml 现有依赖，非必要不改。

**接口：** scripts/check.sh 从任意 cwd 能定位仓库根，检查后端/前端；失败返回非零。需测试目录时用专用临时目录并只清理自己创建的目录。脚本不安装系统软件、不自动重置库或更改 .env。

- [ ] 先验证失败传播：在隔离副本/测试 harness 中使一个子检查失败，确认总命令非零；缺失依赖/数据库时明确报错，不能继续报告成功。
- [ ] 实现 fail-fast 脚本，调用 T01 四条检查；记录命令名称和退出结果，不把 token/完整环境变量写日志。为后端显式选择 5433 测试环境，拒绝意外 5432/非测试写入目标。
- [ ] CI 使用 Python 3.12 和满足 engines 的 Node（例如 24.12.0），安装项目 dev 依赖。pnpm 版本先从锁文件/项目实际工具确认并固定，使用 frozen lockfile；不编造当前项目已有 packageManager 设置。
- [ ] Postgres service 容器 5432 映射 runner 5433，独立测试凭据，仅 CI 使用。tests/conftest.py 所需创建测试库/临时 schema 权限只授予测试账号，不复制给生产账号。
- [ ] CI 调用相同检查入口。先本地执行脚本与 YAML/配置核对；未获推送授权或未运行 Hosted CI 时明确标为“配置完成，远端未验证”。
- [ ] 更新 README 与 docs/reviews/pilot-baseline.md，注明运行、失败排查、远端状态。

**验收：** 本地统一入口通过；人为子检查失败能阻断；workflow 不依赖本机 .venv/.env/node_modules，不包含部署或自动合并。远端首次通过是后续独立证据，不由本地成功代替。

## T03：隔离验收入口与多角色矩阵

**依赖：** T01/T02 本地通过。禁止连接真实学校资料。

**复用：** backend/tests/conftest.py 的 migrated_test_schema / _test_url；backend/tests/helpers.py 的 ready_thesis / accepted_task / published_thesis；backend/tests/pdf_samples.py；app.seed、app.main:create_app、app.db.session:get_session；frontend 的 VITE_DEMO_MODE=false 与 VITE_API_PROXY_TARGET。

**新建：** backend/scripts/acceptance_server.py、docs/reviews/pilot-acceptance-matrix.md。需要自动回归时新建 backend/tests/test_acceptance_server.py；不复制大量业务流程到脚本。

**接口：** Python CLI 支持 --scenario empty|accepted|published 和 --port；仅 loopback 监听，使用独立测试库临时 schema/存储，默认 empty。输出本地地址、场景和非敏感 task_id；不输出 token/真实密码。需安装 dev 依赖。

- [ ] 先写边界测试：目标库/端口校验、异常退出清理；测试断言不得连接开发业务表、不得删除其他 schema/目录。
- [ ] 最小实现上下文管理器，复用真实迁移/seed/helpers；通过 override get_session 把每个请求绑定隔离 schema。不能只设置全局 DATABASE_URL 后误 seed 开发库。
- [ ] 为普通退出、Ctrl-C 和初始化失败清理自建临时资源；记录强制杀进程可能残留及按明确资源 ID 清理的办法，禁止通配删除 test_*。
- [ ] 真实模式启动前端，采用 README 命令和代理目标，禁止修改本机 .env.local 作为隐藏依赖。
- [ ] 按矩阵逐行验证：学生提交/退回重提；学校匿名复核/送出/终止；平台派单/拒绝再派/改派；专家接拒/PDF/草稿/最终提交；学校发布；导师和学生查看；异议新建/办结/再次新建；跨角色/跨租户负向场景。
- [ ] 矩阵列出角色、前置场景、操作、预期、实际证据、状态。既有测试/历史浏览器证据可引用，但不得写成此次重新观察。未做的浏览器或材料明确 NOT RUN。
- [ ] 实际至少复验一个从界面操作到后端持久化的流程，并在退出后确认端口、schema、文件清理。浏览器仅使用环境允许的操作工具，不绕过安全拦截。
- [ ] 更新 CURRENT、基线记录与矩阵。发现新 bug 另编号、写最小复现；不扩展到未批准的运营模块。

**验收：** 其他开发者按文档可创建/清理隔离场景；入口不依赖 /tmp 旧脚本；矩阵准确区分已验证/未验证/失败。任何单行失败不能把整矩阵标为完成。
