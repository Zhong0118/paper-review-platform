# 7A-3 修复受控文件读取

依据审查 A4/A5；本轮仅修文件读取。

- 授权返回 5 分钟文件专用 JWT，固定 audience、file_id、用途、sub/role/tenant。响应 expires_at 与 JWT exp 一致。
- GET content 支持该 query token，也保留普通 Bearer 经 API 读取。文件 token 不可用作通用登录凭据，普通 access token 不可放入 query 冒充下载令牌；出现无效 query token 时不退回 Bearer。
- 每次读取复核账号 ACTIVE、文件归属/角色和当前专家任务。专家只能读当前版本、ACTIVE 轮次、IN_REVIEW 任务的匿名文件；共享旧版本文件引用用关系查询，不假定 file_id 只有一个引用。提交/取消任务后的后续请求拒绝。
- 未完成或物理文件缺失均安全拒绝，不暴露路径。GET 返回 Cache-Control: no-store。
- 授权和读取成功/拒绝写文件审计，包括 request_id、对象 id、操作人（令牌无效时不信任其身份）。不记录 token 或内容。拒绝审计也持久化。
- 兼容性：保留普通 API Bearer；旧通用下载 token 的 data_scope.purpose=download 不再当作登录凭据接受，旧链接需重新授权。
- 不改上传生命周期、不新增表/迁移或对象存储。不能撤回已经下载到用户设备的字节，也不承诺中途取消已经通过校验的在途响应。

验证：授权 URL 可读、token 不可调 /me/上传、文件限定/过期/错误签名、停用账号、任务完成后撤销、撤回复用文件、缺失文件安全响应、成功拒绝审计与旧链兼容。
