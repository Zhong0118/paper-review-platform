# T07：试点专家资料、状态与回避维护设计

状态：待实施；2026-09-28 路线复核已修订。本轮已补齐请求契约和账号有效性边界；写权限与写接口在 T07-2 同片验收。依据 [T04 试点范围](2026-09-22-pilot-scope-decisions.md)、[任务板](../plans/2026-09-22-pilot-task-board.md)与现有单专家派单主链。T06 已在隔离库完成 28 表 RLS；本设计不表示可上线。

## 目标与边界

百杰平台运营人员能用真实 API 维护最多约 10 位试点专家的账号与派单资料，暂停/恢复新接单、设置回避；候选与直接派单使用同一实时规则。已有邀请、在途任务和历史正式结果保持原记录，不因资料变化重写或自动终止。首批仍为一篇论文、一位专家、六维评分。费用、通知、批量导入、SSO、专家自助资质材料与统计预测不在 T07 内；演示页的数据不算真实能力。

## 领域模型

`users` 仍保存登录名、密码哈希、展示姓名和账号状态；`user_role_assignments` 的全局 `expert` 角色保持 `tenant_id=NULL`。`experts` 保存平台运营字段：单位、职称、受控学科编码列表、服务状态 `AVAILABLE/UNAVAILABLE`、资格状态 `PENDING/APPROVED/REJECTED`、整数 `version`。已有种子专家迁移为 `APPROVED`，原 `AVAILABLE` 语义不变；新建专家默认 `PENDING`，不可派单。展示用研究方向标签不作为派单规则，首批不持久化；费用字段不进入真实 API。

`expert_conflicts` 仅接受 `SUPERVISOR_NAME`（精确规范化姓名）及 `TENANT_ID`（现存学校 UUID 字符串）。使用学校 ID，避免名称变更使回避失效；不接受任意文字的“回避学校”。同一专家、类型和值唯一。修改回避时保留旧记录审计，不改变既有任务。导师同名回避继续沿用现有自动判断。

## 接口与权限

仅 `platform_reviewer` 可管理共享专家库；学校、系统管理员、学生、导师及其他专家不能调用管理 API。平台只看必要专家账号字段，不获得密码哈希或论文原文。

- `GET /api/v1/platform-review/experts`：返回全部专家的 ID、账号、姓名、单位、职称、学科、资格/服务状态、回避学校/导师、版本；不返回密码、联系方式、任务中的学生信息或费用。
- `POST /api/v1/platform-review/experts`：创建全局专家账号、角色和专家档案；输入登录名、展示名、初始密码、单位、职称及学科编码。密码只写哈希，响应绝不回显。用户名冲突 409；无效/停用学科 422。一次事务内完成，成功时同事务记录成功审计，失败整体回滚。
- `PATCH /api/v1/platform-review/experts/{id}`：仅改单位、职称、学科编码；请求带 `version`，旧版本 409。展示姓名、登录名和密码修改不在本项实现；当前没有可供平台使用的全局专家账号恢复流程，不得向用户声称已有。正式试点前由 T09-B 明确安全发放及恢复方案。
- `POST .../{id}:review-qualification`：`APPROVED/REJECTED` + 非空理由；`POST .../{id}:set-service-status`：`AVAILABLE/UNAVAILABLE` + 非空理由。使用相同版本检查与审计。暂停或驳回只禁止新的派单，原任务继续履约；恢复服务不自动批准资格。
- `PUT .../{id}/conflicts`：带专家版本，以完整集合替换两类回避；先验证所有学校 ID 存在，输入去重，单事务原子替换；审计记录变更摘要，不写敏感全文。配置变化立即影响新指派。

不存在的专家及无权限读取一律按现有敏感资源惯例返回 404；角色根本不允许访问管理命令时可用现行 403。直接提交旧候选 ID 仍须服务端重新检查状态、资格、学科与回避，不信前端候选。还须校验目标账号为 ACTIVE 且具有有效全局 expert 身份；身份失效的目标不能获得新任务。候选列表同样排除或明确禁选。目标身份在派单锁内读取时须有效；本项不提供全局账号停用或改角色命令，不承诺与管理员直接 SQL 修改的线性化。服务状态/资格/回避的并发通过 Expert 锁串行化。全局账号维护仅允许 T09-B 停服务维护；不新增 User 锁。若未来加入在线停账号命令，须另行设计双方锁协议。

## 锁、RLS 与历史稳定性

派单保持 `theses →（改派时旧 expert_tasks）→ 目标 experts` 锁顺序：在读取目标资格、状态、回避并创建任务前，对目标专家行 `FOR UPDATE`。维护资料、资格、状态、回避只锁该专家行，不再取得论文/任务锁；故并发结果按谁先取得专家锁线性化，不形成反向锁链。配置先完成则新派单拒绝；派单先完成则随后暂停/添加回避可以成功，已建立任务保留，后续新派单拒绝。“双方都成功”在第二种顺序合法，不能写成无条件互斥断言。候选列表是提示，直接派单在锁内重新校验。T06 结果读取和历史任务不重新计算专家资格/回避；服务状态变化不撤销已发文件令牌，令牌仍由任务状态/当前论文约束。

`0016_expert_operations` 只加字段、约束及只读所需列权限，不提前开放写权限；T07-2 的 `0017_expert_management` 与写接口一起交付窄 GRANT/RLS：平台可创建自己 provision 的全局 expert 用户/角色/档案，只读必要专家账号；专家本人仅读本人档案；其他身份默认拒绝。升级先核对旧专家学科与状态、回填资格。保守降级策略：0016/0017 只允许在 experts 和 expert_conflicts 均为空时降级；存在任何专家即明确拒绝，交由停写后前向修复或 T10 配套备份恢复处理。不能凭资格等字段猜测专家是否在升级后创建，也不能静默丢字段或移除有效回避。已有 seed 专家的生产形态不承诺 Alembic 往返；迁移测试分别验证空库往返、旧数据升级与有数据降级拒绝。降级不删除已有用户、专家及任务，旧数据冲突也应拒绝而不是猜测。

## 实施与验收边界

按四个可独立复核的小片施工：T07-1 后端只读投影与迁移/权限；T07-2 创建、资料/状态/资格/回避写命令及派单并发门禁；T07-3 真实模式专家库页面接线并保持演示模式；T07-4 隔离主链与跨角色/迁移/浏览器总验收。每片先失败测试再最小实现，使用 5433 `paper_review_test` 唯一 schema。必须覆盖暂停/驳回/回避目标不能经直接 API 派单、改派同样拒绝、在途和已发布历史不漂移、两个并发事务与 R02/R03 锁顺序、普通业务账号 RLS 和无权限负向。T07 完成仍不代表 T08–T11 或上线放行。

## 可直接实施的请求契约（本轮补齐）

所有管理输入 `extra="forbid"`；所有响应沿用 `ok(data)`。角色错误 403，目标不可见 404，版本过期 `VERSION_CONFLICT` 409，规则不满足 `STATE_TRANSITION_DENIED` 409，格式/目录无效 `VALIDATION_FAILED` 422。用户名冲突使用现有账号服务冲突格式 409，不返回冲突账号资料。创建返回 201，其余成功 200。

| 命令 | 请求字段 | 返回 data |
|---|---|---|
| GET experts | 无分页；试点约 10 名 | ExpertView 数组 |
| POST experts | username、display_name、initial_password、unit、title、discipline_codes | ExpertView |
| PATCH experts/{id} | version、unit、title、discipline_codes（均必填，替换这三项） | ExpertView |
| POST :review-qualification | version、status=APPROVED/REJECTED、reason | ExpertView |
| POST :set-service-status | version、status=AVAILABLE/UNAVAILABLE、reason | ExpertView |
| PUT /conflicts | version、items=[{kind,value}] | ExpertView |
| GET /api/v1/platform-review/expert-options | 无 | {schools:[{id,name,status}], disciplines:[{code,name}]} |

ExpertView 固定为 `{id,user_id,username,display_name,account_status,unit,title,discipline_codes,qualification_status,service_status,conflicts,version}`；conflicts 是 `{kind,value}` 数组。密码和账号恢复凭据绝不进入返回、审计或幂等响应。学校选择只返回 id/name/status；学科只返回启用项；沿用平台已有 tenants/discipline_catalog SELECT，不扩大到学校成员信息。

用户名沿用 CreateTenantUserInput 的 strip/lower、3–64、`^[a-z0-9._-]+$`；display_name strip 后 1–128；密码不 trim，12–128 字符；unit/title strip 后 0–128；学科数组 1–20 项，每项现存启用 code，去重后按 code 排序。version 为严格正整数。reason strip 后 1–500。items 最多 100 条：导师姓名 strip 后 1–128、保持大小写/字形不做模糊扩展；学校 UUID 统一规范字符串，现存学校即有效（停用学校也可以设置回避）；规范化后去重并稳定排序。保留现有自动导师同名判断，学校回避先检查，不能被“导师名为空”的提前返回跳过。

后端使用现有 ExpertServiceStatus.UNAVAILABLE 表示暂停，避免再增加 PAUSED 枚举；真实页面文案显示“暂停接单”，演示模式继续使用自己的投影。0016 遇旧非 AVAILABLE/UNAVAILABLE 数据应报具体计数拒绝，不能擅自重写未知状态。

创建必须带 Idempotency-Key（1–128 非空字符）；范围 action=expert-create、actor、tenant=NULL。复用 thesis.service.remember_idempotent/store_idempotent。请求指纹使用规范化 JSON，将 initial_password 替换为 HMAC-SHA256(JWT secret, password) 后再交给现有 hash 函数，不持久化明文/可离线直接猜测的裸密码 hash；返回只存 ExpertView。相同键/同请求重放同一专家，不重复审计；不同请求 409。后续变更由 version 保证至多一次；网络重试旧 version 返回 409，客户端读回刷新后由用户重新决定，禁止自动重放新 version。相同状态但新 version 的命令也加一版本并审计，保持一致语义。

## 0017 权限与身份闭环

- users：平台 SELECT 限已有 Expert 对应账号，或本人 provision 且 provisioned_tenant_id IS NULL 的创建中账号；INSERT 限平台、本人 provision、全局、ACTIVE；不授平台 UPDATE/DELETE 用户资料或密码。
- experts：平台 SELECT/INSERT/UPDATE，仅本人档案对专家开放 SELECT；INSERT 须引用本人新 provision 全局用户；不可改 user_id，禁止 DELETE。新用户/专家/角色在一次事务创建，任一失败整体回滚。
- user_role_assignments：平台 SELECT 仅已有 Expert 的全局 expert assignment（及创建中本人 provision 的全局 expert assignment）；INSERT 仅本人 provision 全局用户 + role.code=expert + tenant_id=NULL。不开放平台 UPDATE/DELETE。需要读有效期以判断候选，但不开放其他身份。
- expert_conflicts：平台 SELECT/INSERT/DELETE，父专家必须可见；不授 UPDATE，替换集合采用 delete+insert。值约束两种 kind；schools UUID 有效性在服务校验。
- User→Expert→RoleAssignment 顺序 flush，expert 的读/插入策略不能反查 assignment，否则和 users/assignment 形成 RLS 递归。确认 pg_policies 与普通账号 SQL 负例无 42P17。
- 父键不可变使用最窄列 GRANT，必要的现有锁用 UPDATE 授权不能变成任意父键写入；不得放宽密码哈希 SELECT。
- assign 中锁 Expert 后，调用现有 load_active_identity 读取目标并检查 role.code=expert、tenant_id=NULL；将目标身份失效的 AUTH_REQUIRED 转成目标 404，不能误报当前平台操作者登录失效。候选失效项不返回；资格/服务状态/回避继续返回原因并禁选。新增 assignment 的平台最窄 SELECT 在本片同时验证。

T07-2 的红灯必须含：disabled/locked 用户、未来生效/已到期/缺失角色、不匹配角色；新建后可登录；直接 SQL 试造平台管理员角色、挂接旧用户、改专家父键、读 hash 均拒绝。账号维护与在线派单间不新增未经设计的锁协议。

## 2026-09-28 递归复核后的实现约束

用户要求优先处理困难项后继续执行。实测 PostgreSQL 在 assignment INSERT 的来源查询与 users SELECT 的角色关联展开时产生 42P17；布尔角色条件不能作为消除查询重写递归的保证。0017 将来源判断提取为 `app_provisioned_user(target uuid, tenant uuid)`：PL/pgSQL、STABLE、**SECURITY INVOKER**、固定 `pg_catalog + 当前迁移 schema` 搜索路径。函数仍通过调用者的 users 列权限与 FORCE RLS 查询，不使用 owner 或 BYPASSRLS，不增加业务角色权限。

旧 school/system assignment INSERT 与新增 platform INSERT 共用该来源判断；旧策略显式保留 `tenant_id IS NOT NULL`，等价于原来的 SQL `=` 对 NULL 的拒绝；平台策略仍要求全局 expert 角色且本人 provision。降级恢复旧 INSERT 策略并删除函数。assignment SELECT 仍限定已有 Expert 的全局 expert 角色，不通过扩大读取范围规避递归。User→Expert→Assignment flush 顺序、论文→旧任务→专家锁序与令牌语义均不变。

验证必须同时包含普通角色创建/登录、旧学校/系统创建回归、直接 SQL 错误角色/来源/父键/密码列拒绝、函数 `prosecdef=false` 和迁移往返；不能仅以 HTTP 创建成功放行。


## 2026-10-03 审计摘要补修

字段细化见 [F03 最小契约](../../reviews/2026-10-03-followup-fix-contract.md)：回避保留按类型的前后数量与增删数量，支持识别同数量替换，不留敏感全文；资格/服务状态保留前后状态与理由存在标记，资料修改保留字段名。版本冲突与事务失败不产生成功审计。不增加敏感历史档案，原权限、版本和幂等契约不变。
