# 百杰校审平台

第三方多校论文送审与双向盲审平台。

**当前已交付（真实 API，分支施工规格为准）：** 登录 → 学生提交与匿名门禁 → 学校确认送出 → 百杰派单 → 专家接拒与在线评阅 → 学校进度 → 汇总发布 → 异议登记。  
**尚未实现：** 学校 SSO、代传/批量导入、超时催审、多专家冲突、费用冻结与提现、PostgreSQL RLS。

## 现行规格（按切片阅读）

| 切片 | 规格 | 内容 |
|---|---|---|
| 0+1 | [auth-submit-ready](docs/superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md) | 登录、提交、匿名门禁到待送审 |
| 2 | [dispatch-accept](docs/superpowers/specs/2026-08-31-slice-2-dispatch-accept-design.md) | 确认送出、派单、接拒 |
| 3 | [online-review](docs/superpowers/specs/2026-09-01-slice-3-online-review-design.md) | 评阅草稿与最终提交 |
| 4 | [summary-publish](docs/superpowers/specs/2026-09-01-slice-4-summary-publish-design.md) | 汇总与学校发布 |
| 5 | [objection](docs/superpowers/specs/2026-09-01-slice-5-objection-design.md) | 发布后异议 |
| 6 | [school-progress](docs/superpowers/specs/2026-09-01-slice-6-school-progress-design.md) | 学校评审进度 |

**先读现状：** [docs/CURRENT.md](docs/CURRENT.md)。文档导航：[docs/README.md](docs/README.md)。8 月演示计划已归档到 `docs/superpowers/archive/`。`docs/99_原始材料/` 只读。

## 本地运行

Postgres 使用独立 Docker，宿主机 **5433**，不要复用其它项目的 5432。

```bash
docker compose up -d postgres
```

后端：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

前端（真实 API）：

```bash
cd frontend
pnpm install
VITE_DEMO_MODE=false pnpm dev
```

## 开发检查

安装上述后端开发依赖和前端依赖，并确认本项目 Postgres 正在宿主机 5433 运行后，在仓库根执行：

```bash
./scripts/check.sh
```

脚本按自身路径定位仓库，因此也可以从其他目录通过脚本的相对或绝对路径调用。该入口依次运行后端测试、前端单元测试、类型检查和 `VITE_DEMO_MODE=false` 生产构建；任一步失败都会立即返回非零。执行前会确认测试目标是本机 5433 上的 `paper_review_test`，不会接受 5432 或其他数据库目标。缺少 `.venv`、`node_modules` 或数据库时，先按“本地运行”安装并启动依赖，再重新执行。

`.github/workflows/check.yml` 使用相同入口及独立 CI 数据库。只有工作流实际在远端运行成功后，才能记录为远端 CI 已通过；本地成功不代替该证据。

## 隔离验收环境

验收入口只接受本机 5433，并在 `paper_review_test` 中创建单次临时 schema；需要后端 dev 依赖。仓库根执行：

```bash
backend/.venv/bin/python backend/scripts/acceptance_server.py --scenario accepted --port 8011
```

`--scenario` 支持 `empty`（默认）、`accepted`、`published` 和 `operations`。服务只监听 `127.0.0.1`，启动时输出本地地址、场景、资源 ID、临时存储路径及非敏感对象 ID；不会输出 token 或密码。

`operations` 在隔离 schema 中通过现有服务建立虚构学校 `pilot-operations`、OPEN 批次、学校管理员、学生、导师和送审资格。该场景的测试专用密码为 `PilotOnly!2026Test`；可用 `admin.system`、`pilot.school`、`pilot.student` 登录真实模式前端，分别查看“租户与权限”、“批次与评审规则 / 成员与送审资格”、“我的论文”。这些账号和密码仅存在于该次临时验收资源，退出即删除；不得用于开发或生产数据。

另开终端启动真实模式前端，不修改 `.env.local`：

```bash
cd frontend
VITE_DEMO_MODE=false \
VITE_API_PROXY_TARGET=http://127.0.0.1:8011 \
node_modules/.bin/vite --host 127.0.0.1 --port 5186 --strictPort
```

用 `Ctrl-C` 正常停止验收服务会删除本次 schema 和存储目录。强制杀进程可能来不及清理：此时只对启动日志打印的单个 `resource_id`，连接宿主机 5433 的 `paper_review_test` 执行 `DROP SCHEMA "<完整 resource_id>" CASCADE`；再核对并对日志打印的完整 `storage_root` 执行 `find "<完整 storage_root>" -depth -delete`。禁止使用 `test_*` 或目录前缀通配清理。

本机若存在 `frontend/.env.local` 且 `VITE_DEMO_MODE=true`，会走旧演示，不代表后端已完成。

种子账号密码默认 `ChangeMe!dev-only`：`student.lin`、`school.wang`、`platform.chen`、`expert.zhou`、`supervisor.zhao`、`admin.system`。

`GET /healthz` 存活；`GET /readyz` 在未迁移时返回 `not_migrated`。

### PDF 材料校验（7A-2）

更新后在 backend 环境执行 `pip install -e ".[dev]"`；运行依赖新增 pypdf，ReportLab 仅用于生成真实测试 PDF。原始版和匿名版必须是有效、未加密的 PDF；单文件默认上限 50 MiB，可通过 backend/.env 的 MAX_UPLOAD_BYTES（正整数字节数）调整。图片、空白页或无法可靠提取文本的材料进入人工复核；自动 PASS 仍需学校确认。旧伪 PDF 在重新提交时会被拒绝，需要重新上传。此切片无数据库迁移。

### 生产配置安全边界

开发默认 JWT_SECRET/SEED_PASSWORD 仅供本地虚构数据使用。APP_ENV=production
必须显式配置非默认、至少32字节的 JWT_SECRET，以及非默认非空的 SEED_PASSWORD；
JWT 密钥应安全随机生成。校验错误不会回显输入值。
production 禁止运行 `python -m app.seed` 或直接调用演示种子函数。
生产首个管理员引导与专家账号恢复尚未交付，按 T09-B 实施，不使用演示 seed 替代。
Uvicorn 访问日志已移除整个查询字符串；实际代理/CDN日志仍须在部署时单独验证去敏。
