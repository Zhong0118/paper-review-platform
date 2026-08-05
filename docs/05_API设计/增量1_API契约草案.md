---
title: 增量 1 API 契约草案（C0 基础工程 + C1 用户组织权限）
status: DRAFT
version: 0.1.0
last_updated: 2026-08-04
sources:
  - API设计.md
  - 增量1_字段级数据库设计.md
  - ../02_产品设计/产品与流程设计.md
  - ../09_项目管理/实施计划.md
related_documents:
  - ../04_数据库设计/增量1_字段级数据库设计.md
  - ../10_审查与决策/需求追踪矩阵.md
---

# 增量 1 API 契约草案（C0 + C1）

本文件是 `docs/05_API设计/API设计.md` 的增量细化，覆盖 C0（健康检查、统一协议）与 C1（租户、同步、用户、角色）的请求/响应模型、权限、幂等、审计和错误码。仅作契约草案，OpenAPI 在实现时由真实接口模型生成并纳入一致性检查。

## 1. 公共协议（C0）

### 1.1 响应包装

统一响应结构（成功与错误）：

```json
{
  "request_id": "req_xxxxxxxx",
  "code": "OK",
  "message": "成功",
  "data": {}
}
```

错误响应 `code` 使用 `docs/05_API设计/API设计.md` 第 5 节错误码基线；不返回堆栈、SQL、对象键或敏感身份。

### 1.2 分页

列表使用游标分页：请求 `?limit=20&cursor=<opaque>`，响应：

```json
{
  "data": [],
  "paging": { "next_cursor": null, "has_more": false }
}
```

后台列表（租户/用户管理）可提供页码分页，但同一接口不得混用。排序字段白名单，默认稳定排序含唯一键。

### 1.3 幂等与并发

命令接口（创建租户、指派、提交、发布等）支持 `Idempotency-Key` 请求头。更新资源带 `version`/`If-Match`，冲突返回 `VERSION_CONFLICT`。

### 1.4 认证上下文

`Authorization: Bearer <access_token>`；短期访问令牌 + 可撤销刷新会话。请求上下文包含主体、租户、角色与数据范围。客户端不得自由传入 `tenant_id`。

### 1.5 健康检查

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | `/healthz` | 存活检查 | 公开 |
| GET | `/readyz` | 就绪检查（依赖连通 + 迁移版本兼容） | 公开 |

## 2. C1 API

### 2.1 认证与会话（API-001、API-002）

**POST /auth/login** —— 平台账号登录（专家/审核人员/管理员；学生导师走学校 SSO，见集成）

请求：

```json
{
  "username": "expert_001",
  "password": "********"
}
```

响应 200：

```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "expires_in": 900,
  "user": { "id": "uuid", "display_name": "张专家" },
  "contexts": [
    { "role_code": "expert", "tenant_id": null, "data_scope": {} }
  ]
}
```

错误：`AUTH_REQUIRED`(401) 凭证错误统一返回，不区分用户不存在/密码错误（防枚举）；`RATE_LIMITED`(429)。

**POST /auth/refresh**、**POST /auth/logout** —— 刷新与注销；注销使刷新令牌失效。

**GET /me** —— 当前主体；**GET /me/contexts** —— 可用角色/租户上下文。

### 2.2 租户管理（API-003）

**GET /admin/tenants** —— 分页列表（页码分页）。响应项：

```json
{
  "id": "uuid",
  "code": "school_a",
  "name": "A 大学",
  "status": "ACTIVE",
  "config_version": 1,
  "sync_mapping_version": 1,
  "created_at": "2026-08-04T08:00:00Z"
}
```

**POST /admin/tenants** —— 创建租户（幂等键）。请求：

```json
{
  "code": "school_a",
  "name": "A 大学",
  "sync_mapping": {}
}
```

校验：`code` 唯一、非空、格式 `[a-z0-9_]{2,32}`。

**PATCH /admin/tenants/{id}** —— 更新（`If-Match` 版本）。请求可含 `name`、`status`、`sync_mapping`。

**POST /admin/tenants/{id}:suspend**、**POST /admin/tenants/{id}:resume** —— 启停。`SUSPENDED` 禁止新业务；`resume` 需带理由写入审计。

权限：仅系统管理员（`system_admin`）。

### 2.3 学校同步（API-005）

**POST /integrations/school/sync-jobs** —— 创建同步作业。请求：

```json
{
  "tenant_code": "school_a",
  "record_types": ["student", "organization", "batch", "eligibility"],
  "source_payload": { "students": [], "organizations": [], "batches": [], "eligibilities": [] }
}
```

校验：来源签名（`X-Source-Signature`）；`tenant_code` 解析租户。响应 202：

```json
{
  "sync_job_id": "uuid",
  "status": "PENDING"
}
```

**GET /integrations/school/sync-jobs/{id}** —— 查询进度：

```json
{
  "sync_job_id": "uuid",
  "status": "PARTIAL",
  "total": 100,
  "success": 98,
  "failed": 2,
  "failed_records": [
    { "external_id": "2024001", "record_type": "student", "reason": "字段映射缺失: degree_type" }
  ]
}
```

幂等：同一 `source_payload` 哈希重放返回原作业；逐条记录 `payload_hash` 去重，`source_version` 排序，迟到旧版本 `SKIPPED`。

权限：可信系统主体（签名校验）；系统管理员查看作业。

### 2.4 用户与角色授权（API-004）

**GET /admin/users** —— 列表（可含租户/角色过滤）。**POST /admin/users** —— 创建平台账号。**PATCH /admin/users/{id}** —— 启停/锁定。

**POST /admin/role-assignments** —— 分配角色。请求：

```json
{
  "user_id": "uuid",
  "role_code": "school_reviewer",
  "tenant_id": "uuid",
  "data_scope": { "organization_ids": ["uuid1", "uuid2"] },
  "effective_from": "2026-08-04T00:00:00Z",
  "effective_until": null
}
```

**DELETE /admin/role-assignments/{id}** —— 撤销角色（不物理删除历史，设失效时间）。

权限：系统管理员；学校角色必须带 `tenant_id`，平台角色（`system_admin`/`platform_reviewer`/`expert`）不要求。

审计：角色分配/撤销、租户启停、同步作业、账号启停写 `audit_events`。

## 3. 权限与投影（C1）

| 调用方 | 可返回 | 必须排除 |
|---|---|---|
| 系统管理员 | 租户、用户、角色、同步作业 | 论文正文、评阅内容、盲审映射 |
| 学校系统主体 | 同步作业状态 | 其他租户数据 |
| 平台账号用户 | 本人资料、本人上下文 | 他人令牌、密码、完整联系方式 |

`/admin/*` 仅系统管理员；`/me` 所有已认证用户；同步接口仅可信系统主体。

## 4. 审计要求（C1）

以下操作写 `audit_events`（TABLE-038），含 `actor_id`、`action`、`object_type`、`object_id`、`tenant_id`、`before`/`after`（快照）、`request_id`：

- 租户创建/更新/启停；
- 同步作业创建/完成/失败（记录失败摘要，不含敏感正文）；
- 用户创建/启停；
- 角色分配/撤销；
- 登录成功/失败、登出。

## 5. 测试用例细化（C1）

| 场景 | 类型 | 关联 |
|---|---|---|
| 跨租户 ID 访问组织/批次/资格 | 集成/越权 | TC-001、AC-001 |
| 同步首次/重复/乱序/源版本更正 | 集成 | TC-002、AC-002 |
| 同步字段映射按租户 JSON 生效、版本化 | 集成 | TC-024 |
| 五角色逐项允许/拒绝接口 | 契约/安全 | TC-003、AC-003 |
| 系统管理员默认无业务内容权限 | 安全 | AC-004 |
| 幂等键重复创建租户/同步 | 契约 | NFR-003 |
| 版本冲突更新租户 | 契约 | NFR-004 |
| 登录失败防枚举、限流 | 安全 | NFR-001 |

## 6. 页面字段（C1）

- PAGE-017 租户与权限：租户列表（code/name/status）、租户详情（sync_mapping 编辑器）、用户列表、角色分配（role_code + tenant_id + data_scope + 有效期）；
- PAGE-001 登录：账号/密码登录表单；学校 SSO 入口按钮；
- PAGE-017 同步状态：同步作业列表（status/进度/失败原因）、字段映射配置。

前端字段与后端 DTO 严格对应，API 类型由 OpenAPI 生成或严格同步，不维护漂移副本。

## 7. 契约冻结条件

- 本草案在编码准入前由用户确认；
- 学校真实同步协议提供后替换 `sync_mapping` 示例与 `source_payload` 结构；
- OpenAPI 在首个接口实现时由真实模型生成，纳入一致性检查。
