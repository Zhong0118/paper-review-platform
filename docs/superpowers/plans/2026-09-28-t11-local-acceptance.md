# T11-A Local Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Inline execution; no automatic commit/push/deploy.

**Goal:** 完成完整六角色浏览器验收，并形成可交接的本地试点候选版本。

**Architecture:** 复用隔离 operations 服务和真实前端，以浏览器观察+API读回+既有回归交叉验证；仅修验收证实的问题。

**Tech Stack:** 现有 acceptance_server、Vite、浏览器工具、pytest/Vitest 与 scripts/check.sh。

**Spec:** [验收设计与14行矩阵](../specs/2026-09-28-t11-local-acceptance-design.md)。

## Global Constraints

- 虚构数据、5433/paper_review_test 独立 schema/存储；不迁移开发库。
- 前端必须 VITE_DEMO_MODE=false；浏览器/API结果分栏，未运行不写PASS。
- 不提交、推送、部署；服务结束只清理本次精确资源。

### T11-A1：完整浏览器矩阵与定向修复

**Files:** 更新 `docs/reviews/pilot-acceptance-matrix.md`，新增 `docs/reviews/2026-09-28-t11-a-browser-validation.md`；若发现 bug，仅修改实际命中模块及相应 tests，不预先创建猜测的业务改动。

**Interfaces:** operations 环境与真实页面，不新增公开接口。每个矩阵行记录 browser 和 API 两种状态及证据引用。

- [x] 读 README 和 `backend/scripts/acceptance_server.py --help` 后以其当前参数启动 operations；保留输出的 resource_id/schema/storage/端口，凭据不写日志报告。使用空闲本地端口；只停止自己的 PID。
- [x] 前端用 `cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite --host 127.0.0.1 --port 5186`，若端口占用选空闲端口，不杀现有服务；依当前 Vite 配置将代理指向本次 backend 端口（不能假定 8011 会自动代理）。
- [x] 按设计矩阵逐行执行六角色；浏览器新建的数据必须刷新后仍在，关键动作独立 API/SQL核对。PDF 正文与匿名内容必须实际查看。记录合成材料文件 hash，报告不得含 token/密码。
- [x] 发现 bug：先写能复现的 pytest/Vitest 测试并跑失败，再最小修复、定向回归、重走失败页面；例：若409后显示成功，断言页面保留错误和服务器原值，禁止只删提示断言。如果改变需求/权限/锁序才停止报告；普通组件问题自行修复。
- [x] 完成记录后正常停止服务，查询本次 schema/角色/存储/端口都清理；检查不误删旁边另一测试环境。矩阵有 NOT RUN 就保持 T11-A1 未通过，不用 HTTP 代替。

### T11-A2：统一验证与交接封板

**Files:** 新增 `docs/reviews/2026-09-28-local-pilot-release-candidate.md`；更新 CURRENT、AGENT_HANDOFF、任务板和统一执行包的状态列；可生成去敏路径清单，不复制 .env/私有PDF/备份包。

**Interfaces:** 输出可交接的事实清单，不引入生产发布动作。

- [x] 逐项核对 T09-A1/A2、T07-1～4、T08-1～3、T10-A1/A2、T11-A1 的实际记录和未测项；未交付不能被测试总数掩盖。
- [x] 从仓库根运行 `./scripts/check.sh`、`bash scripts/tests/check_test.sh`、`git diff --check`。实现有新变动时重跑受影响验证；无新变动不重复全量。
- [x] 报告当前实际分支/HEAD、migration head、版本、全部命令/退出码、浏览器矩阵、备份恢复、已知warnings与正式部署阻断。T02 Hosted CI 仍未运行则明确写出。
- [x] `git status --short` 核对未提交/未跟踪实现完整；提醒同目录换模型可继续，跨机器需传递完整去敏快照。未经新授权不提交。T11-A本地PASS不自动将T09/T10/T11 B部分标完成。
