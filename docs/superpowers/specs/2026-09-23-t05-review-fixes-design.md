# T05 复审修复设计

状态：供逐项执行的修复设计；不包含 T06 RLS 实现。依据：[8 项复审发现](../../reviews/2026-09-23-t05-followup-review.md)和已批准 T05 的既有权限/状态语义。

## 边界

只修复 F01–F08，不新增运营功能。保持角色、单租户、单专家、费用/通知延期等已确认范围。独立数据库固定 `127.0.0.1:5433/paper_review_test`；新建唯一 schema，测试结束清理。不迁移开发库、不操作真实材料、不自动提交或推送。

## D1 令牌撤销代际

复用 User 和 AuthSession，不引入外部会话存储。新增 `users.auth_version` 非空整数，默认 1；迁移 `0010_auth_version`，父版本 `0009_pilot_operations`。access JWT 和 download JWT 均增加整数 `auth_version`。签发使用数据库值；读取时比较当前数据库值。缺失、布尔值、字符串、负数或不匹配的 claim 均拒绝 401，不为旧 token 提供兼容绕过。代码升级后旧 token 需重新登录，数据库业务记录不变。

`revoke_user_sessions` 在锁定 User 后，将版本加一并撤销该用户所有未撤销 refresh session；停用、重置密码、暂停租户沿用这个统一函数。启用/恢复不降低版本。普通 refresh 不递增版本，不使同代的其他 access 意外失效。logout 保持当前单 refresh session 语义，本轮不扩展全设备登出。

`load_active_identity` 增加可选 `token_auth_version`；在 token_role 非空（令牌校验模式）时要求合法版本并匹配。登录内部身份读取不传 token 参数。`get_current_user` 和文件专用 token 的 `file_reader` 都调用它；文件读取仍需后续 `can_access_file` 检查任务/文件归属，不能把身份有效当作材料授权。

`create_access_token`、`create_download_token` 新增必填 `auth_version: int` 参数。`issue_tokens` 使用 identity.user 的版本；`authorize_download` 再从有效身份读取版本后签发，不允许从客户端输入版本。签名、audience、purpose、5 分钟文件有效期、DENIED 审计保持现有规则。

## D2 签发与撤销串行

登录、刷新和全会话撤销必须共享 User 行锁，锁保留至调用路由 commit/rollback。登录在取得锁并刷新 ORM 对象后验证密码；刷新可以无锁查询 session 找 user_id，但随后必须先锁 User，再锁并重新读取 AuthSession，重新验证 revoked_at/expires_at 和身份。不得以锁前载入的旧对象判断。

统一锁顺序：成员创建和已有成员命令先锁 Tenant FOR KEY SHARE、刷新并确认 ACTIVE；已有成员随后按 membership → User → assignment 加锁，创建则在检查通过后插入新 User 与 membership。认证签发只锁 User → AuthSession，不反向请求 membership 锁；暂停租户先锁 Tenant FOR UPDATE，再按 user_id 排序锁 User、撤销其 session。成员命令写入审计记录时 tenant_id 外键也需要 Tenant 锁，因此不得先锁 User 再等待 Tenant。暂停保留 FOR UPDATE，以阻止扫描成员后又插入新成员并在暂停提交前签发会话。所有涉及 AuthSession 的写操作避免先锁 session 再等待 User。锁查询使用 populate_existing 刷新。

允许的并发结果：刷新/登录先提交，则之后的重置会撤销其新 session 与 access 版本；重置先提交，则旧密码/旧 refresh 拒绝。绝不允许重置完成后仍有基于旧凭据可续期的会话。两个请求使用同一 refresh，最多一个成功轮换。测试用独立连接和事件屏障，不靠 sleep 猜时序。

## D3 新建论文与批次/资格门禁

create_draft 事务需与 batch close/archive 串行：候选资格定位后按 batch → student membership → eligibility 顺序锁定精确对象，刷新读取状态，再校验 OPEN/ELIGIBLE 及相同 tenant/member/batch，锁持有到新建论文提交。锁等待后发现状态已变即拒绝，不能继续使用首次读取状态。

同一批次行锁也串行本批次新建检查，防止两次创建同时通过 existing 查询；第二次返回现有 409，不增加新状态。当前试点规模无需更复杂的细粒度锁。已有 DRAFT 在 SUBMISSION_CLOSED 仍可编辑和提交；不把“新建需 OPEN”复制到在途业务。

## D4 输入格式

username 和 tenant code 的 before validator 仅对 str 执行 strip/lower，其余类型原样交给字段验证，最终 HTTP 返回 422。不把数字转换成合法账号，不回显密码或数据库异常。

## D5 前端异步与冲突

学校管理员列表加载使用递增 request generation 和请求时 tenant_id；只有两者仍匹配当前选择时才能更新 rows/error/loading。切换立即清空旧列表；旧失败不能覆盖当前成功。请求中的命令捕获目标 tenant/user，不引用后来变化的 selectedTenant。

批次 PATCH 收到 409 后关闭并清空旧编辑对象、刷新列表、展示冲突提示。只有最新 allowed_actions 含 EDIT 的行能重新打开表单；不自动将旧表单套上新版本提交。

## D6 历史身份投影

论文详情是编辑页身份信息的唯一数据源，`/me/eligibility` 仅用于当前新建资格。扩展现有 thesis detail 投影，在有权限看到 student block 的角色中加入 `student.degree_type`（对应该论文资格快照）；增加 `review_batch: {id,name,end_at}`（该论文绑定批次），保留 batch_name 兼容已有读者。不开放 system_admin 或 expert 的学生信息。

ThesisEditPage 保存原始详情并映射 school/college/student_name/student_no/supervisor/degree_type/batch/deadline；删除真实编辑加载中的 fetchEligibility 覆写。缺值显示“未提供”或“未设置”，不添加教授头衔，也不从 degree_type 推导培养层次。历史 batch/eligibility 不可用时明确缺失，不用当前资格替代。现有数据库没有独立培养层次字段，不为修这个问题发明字段。

## 验收门

F01–F08 各有失败再通过的回归；R01–R03 需独立审查锁顺序、撤销覆盖和安全不变量。最后统一检查、本轮浏览器逆序/冲突/历史场景和资源清理记录完成，才恢复 T05 本地验收通过状态。随后可以写 T06 规格；RLS 不属于本设计。
