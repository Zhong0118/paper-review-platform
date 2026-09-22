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

本机若存在 `frontend/.env.local` 且 `VITE_DEMO_MODE=true`，会走旧演示，不代表后端已完成。

种子账号密码默认 `ChangeMe!dev-only`：`student.lin`、`school.wang`、`platform.chen`、`expert.zhou`、`supervisor.zhao`、`admin.system`。

`GET /healthz` 存活；`GET /readyz` 在未迁移时返回 `not_migrated`。

### PDF 材料校验（7A-2）

更新后在 backend 环境执行 `pip install -e ".[dev]"`；运行依赖新增 pypdf，ReportLab 仅用于生成真实测试 PDF。原始版和匿名版必须是有效、未加密的 PDF；单文件默认上限 50 MiB，可通过 backend/.env 的 MAX_UPLOAD_BYTES（正整数字节数）调整。图片、空白页或无法可靠提取文本的材料进入人工复核；自动 PASS 仍需学校确认。旧伪 PDF 在重新提交时会被拒绝，需要重新上传。此切片无数据库迁移。
