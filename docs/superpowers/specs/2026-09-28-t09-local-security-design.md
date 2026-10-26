# T09-A：本地日志与生产配置门禁

状态：设计完成，未实施。依据 [路线复核](../../reviews/2026-09-28-roadmap-review.md)。两项均不依赖部署环境；不修改现有权限、下载令牌传递/有效期、RLS 或锁顺序。

## A1 访问日志

保留 HTTP 方法、无查询串路径、协议和状态码；对 Uvicorn 访问日志的 request target 去掉整个 query string。所有查询参数均不记日志，避免漏掉未知参数名或编码变体。不得修改传给 ASGI 的实际请求，不改变 token 校验；异常日志和审计仍保留。

在现有 `app/core/logging.py` 增加 `RedactAccessQueryFilter(logging.Filter)` 与可重复调用的 `install_access_log_redaction()`，安装到 `uvicorn.access` logger；在 `create_app()` 安装，覆盖 README 中 CLI 和验收服务入口。标准五元组 `(client, method, target, protocol, status)` 只替换 target；不符合结构的访问记录不得原样输出不可信内容，改为固定的无敏感占位消息。此过滤器仅作用访问日志，不碰错误栈和业务 logger。无查询的普通请求保持原样，多次创建 app 不重复叠加过滤器。

通过真实 Uvicorn 子进程验证两种入口。成功与失败下载都不能出现原始 token/查询值，方法、路径、状态仍可观察；保存日志前先在内存中断言并去敏，验收文档不复制凭据。代理/CDN 日志无法由 Python 应用保证，明确留在 T09-B。若启动器会重置日志配置，调整安装时机并以真实进程测试证明，不能只依赖单元测试。

## A2 配置与演示种子

production 模式拒绝默认 JWT 密钥、空白密钥和 UTF-8 编码不足 32 字节的密钥；拒绝默认或纯空白 seed 密码；保留三个不同数据库登录的现有校验。错误信息仅含字段名和要求，不含实际值。长度是最低校验，真实部署仍需安全随机生成。

`seed_database()` 在任何查询/写入前拒绝 production；`python -m app.seed` 在建立数据库连接前同样拒绝 production。该命令是演示数据种子，不承担生产首个管理员引导。开发及隔离验收照旧使用虚构 seed。生产管理员引导和专家账号安全发放/恢复归 T09-B，不能靠放开演示 seed 完成。

配置测试使用 `_env_file=None` 和虚构 URL，不连接数据库、不读实际 `.env`。由于当前 Pydantic 异常可能带入原始输入，须验证启动错误文本不包含测试秘密，必要时用 `hide_input_in_errors=True`；测试不能打印包含秘密的结构化异常。文档只列环境变量名和安全要求。

## 验收边界

A1 和 A2 分别先红灯再修复，各有定向测试和一份实际验收记录；A2 收口执行统一检查。数据库只用 5433/paper_review_test 独立 schema。两项通过仅称 T09-A 本地完成，不声称 TLS、代理日志、生产文件目录或 Hosted CI 已验证。
