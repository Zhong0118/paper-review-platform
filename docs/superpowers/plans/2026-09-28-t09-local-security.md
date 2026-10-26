# T09-A Local Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution; do not commit automatically.

**Goal:** 让本地服务不记录下载凭据，并让生产模式拒绝开发默认密钥及演示 seed。

**Architecture:** 在现有日志模块安装访问日志过滤器，不改 HTTP 请求；配置校验和 seed 入口在访问数据库之前失败。保留现有 RLS 和认证流程。

**Tech Stack:** Python/FastAPI、logging、Uvicorn、Pydantic Settings、pytest；PostgreSQL 独立测试库仅供整体验证。

**Spec:** [T09-A 设计](../specs/2026-09-28-t09-local-security-design.md)。

## Global Constraints

- 不修改权限、令牌语义、RLS 或锁顺序；不修改原始材料。
- 数据库仅用 127.0.0.1:5433/paper_review_test 独立 schema，不迁移开发库。
- 不读取/输出真实密钥；不提交、推送、部署。
- 不接入生产代理、不增加日志框架、不扩展账号运营功能。

### T09-A1：访问日志去敏（下一项）

**Files:** 修改 `backend/app/core/logging.py`、`backend/app/main.py`；创建 `backend/tests/test_access_logging.py`；真实服务复用 `backend/scripts/acceptance_server.py`，仅在安装时机验证证明必要时修改该文件；新增 `docs/reviews/2026-09-28-t09-a1-validation.md`。

**Interfaces:** `RedactAccessQueryFilter.filter(record) -> bool` 和 `install_access_log_redaction() -> None`，`create_app()` 调用安装函数。所有 HTTP API 与 token 保持兼容。

- [ ] 先加失败测试，覆盖带 token、多参数、编码参数名、无 query、非标准 record；确认实现缺失/泄漏导致红灯。示例核心断言：

```python
import logging
from app.core.logging import RedactAccessQueryFilter

def test_access_query_removed_without_losing_status():
    record = logging.LogRecord('uvicorn.access', logging.INFO, '', 0,
        '%s - "%s %s HTTP/%s" %d',
        ('client', 'GET', '/api/v1/files/sample?token=SYNTHETIC_SENTINEL&x=hidden', '1.1', 404), None)
    assert RedactAccessQueryFilter().filter(record)
    assert record.args == ('client', 'GET', '/api/v1/files/sample', '1.1', 404)
    assert 'SYNTHETIC_SENTINEL' not in record.getMessage()
```

- [ ] 运行 `backend/.venv/bin/pytest backend/tests/test_access_logging.py -c backend/pyproject.toml -q --tb=short`，记录红灯原因；仅缺实现时进入最小实现。
- [ ] 标准 record 的最小处理如下；另实现异常结构固定占位和安装去重，禁止原样打印未识别的访问参数：

```python
client, method, target, protocol, status = record.args
record.args = (client, method, target.partition('?')[0], protocol, status)
```

- [ ] 测试重复 `create_app()` 只有一个过滤器；起真实 Uvicorn 子进程，分别覆盖 CLI app 入口和 acceptance 入口。先用无效合成 query 观察 401/404 日志；再在隔离 acceptance 主链验证有效下载 200 与失效 token 拒绝，服务输出均无凭据。不要用 ASGITransport 冒充 server 日志验证，不把真实 token 写进断言失败消息。
- [ ] 跑上述定向测试及 `backend/tests/test_file_access.py`、`backend/tests/test_acceptance_server.py`（同一 pytest 命令）；`git diff --check`。停止自己启动的精确进程，核对 schema/角色/存储清理。记录退出码、覆盖入口、未测代理日志。若用户只指定 A1 则停在本项；若用户采用统一执行包授权全部本地任务，则记录通过后继续 A2。

### T09-A2：生产配置与 seed 门禁

**Files:** 修改 `backend/app/core/config.py`、`backend/app/seed.py`、`README.md`；创建 `backend/tests/test_production_safety.py`；保留并回归 `backend/tests/test_rls_roles.py` 的现有配置断言；新增 `docs/reviews/2026-09-28-t09-a2-validation.md`。

**Interfaces:** `Settings` 字段不新增；production 的非法配置抛 ValidationError；production 调用 `seed_database()`/CLI 在首次 DB 操作前抛出不含秘密的明确异常。

- [ ] 先写默认值、空白/短密钥、默认/空白 seed 密码、合规虚构值通过和 development 兼容的矩阵。显式 `_env_file=None`，不依赖操作者 `.env`。核心用例：

```python
with pytest.raises(ValidationError):
    Settings(_env_file=None, app_env='production',
        migration_database_url='postgresql+asyncpg://owner@localhost/test',
        business_database_url='postgresql+asyncpg://business@localhost/test',
        auth_database_url='postgresql+asyncpg://auth@localhost/test')
```

- [ ] 用 AsyncMock session 测 `seed_database()` 拒绝后未调用 execute/commit；CLI 测试替换 session 工厂为“若调用即失败”的替身，验证拒绝先于连接。配置错误文本不得包含合成秘密标记或虚构数据库凭据。运行 `backend/.venv/bin/pytest backend/tests/test_production_safety.py -c backend/pyproject.toml -q --tb=short`，记录红灯。
- [ ] 在 Settings validator 实现设计约束，保留三账号校验；在 seed 函数和 CLI 建连接前共用最小 production 拒绝检查，避免依赖生产库探针。校验逻辑形状：

```python
if self.app_env == 'production':
    if (self.jwt_secret == type(self).model_fields['jwt_secret'].default
            or not self.jwt_secret.strip()
            or len(self.jwt_secret.encode('utf-8')) < 32):
        raise ValueError('production JWT_SECRET requires a non-default secret of at least 32 bytes')
```

- [ ] README 写明默认值仅供开发、生产不允许运行演示 seed、实际管理员引导尚未交付；不写示例真实密码。运行两个新测试文件及 `test_rls_roles.py`、`test_acceptance_server.py`。
- [ ] 模块收口执行 `./scripts/check.sh`、`bash scripts/tests/check_test.sh`、`git diff --check`，记录实际数量与退出码；更新任务板/CURRENT/HANDOFF。仅将 T09-A 标为本地完成，下一项 T07-1，生产发布门禁继续保留。
