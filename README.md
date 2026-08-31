# 百杰校审平台

第三方多校论文送审与双向盲审平台。当前施工切片：**登录 + 学生提交到待送审**。

现行规格：[docs/superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md](docs/superpowers/specs/2026-08-31-slice-0-1-auth-submit-ready-design.md)

本仓库的 `docs/superpowers/plans/2026-08-10-*.md`、`2026-08-11-*`、`2026-08-12-*` 是前端演示历史，不再作为实现依据。

## 本地运行

Postgres 使用独立 Docker 容器，宿主机端口 **5433**，不要复用本机或其它项目的 5432。

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
uvicorn app.main:app --reload --port 8000
```

前端：

```bash
cd frontend
pnpm install
# 真实 API：确保 VITE_DEMO_MODE 不是 true
pnpm dev
```

`GET /healthz` 存活检查；`GET /readyz` 在未迁移前返回 `not_migrated`。

学校 SSO、派单、评阅、费用尚未实现。演示模式（`VITE_DEMO_MODE=true`）仍可点旧前端，但不代表后端已完成。
