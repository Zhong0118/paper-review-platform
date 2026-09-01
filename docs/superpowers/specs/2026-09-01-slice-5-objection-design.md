---
title: 切片 5 结果异议
status: DRAFT
version: 0.1.0
last_updated: 2026-09-01
sources:
  - docs/02_产品设计/产品与流程设计.md
  - docs/superpowers/specs/2026-09-01-slice-4-summary-publish-design.md
---

# 切片 5：结果异议

学生在结果**已发布**（论文 `COMPLETED`）后登记异议；学校受理并回填结论。异议**不改变**论文宏观状态，不改专家原始分。不做完整在线复核轮次、不设默认异议期限。

## 状态

`SUBMITTED` → `PROCESSING`（学校开始处理）→ `RESOLVED`（回填结论）。学生不能撤回已提交异议（本切片）。同一论文同时最多一条未办结异议。

## API `/api/v1`

- `POST /my/theses/{id}/objections` 学生；body `reason` 必填、`request` 可选；附件本切片可省略（file purpose `objection` 可后补）
- `GET /my/theses/{id}/objections` 学生看本人
- `GET /school-review/objections` 学校本租户列表
- `POST /school-review/objections/{id}:start` → PROCESSING
- `POST /school-review/objections/{id}:record-resolution` body `channel`=`ONLINE|OFFLINE`，`conclusion` 必填 → RESOLVED

未发布论文 POST → 409。跨租户 404。学校投影可见学生姓名；学生投影无专家身份。

## 表

`objections`：tenant_id, thesis_id, student_membership_id, reason, request, status, channel, conclusion, timestamps, version

## 前端

PAGE-012 非演示显示异议表单（仅 COMPLETED 且无未办结）。PAGE-019 走真实列表与回填，去掉写死三行演示。不改 scenarioService。

## 测试

发布后学生可提交；论文 stage 仍 COMPLETED；重复未办结 409；学校办结后学生看见结论；发布前 409；other.student 404。
