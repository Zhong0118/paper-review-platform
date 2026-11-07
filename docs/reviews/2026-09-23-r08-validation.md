# R08 修复集合本地验收与交接

日期：2026-09-23。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`。T01–T05 与 R01–R08 仍在原工作树，未提交、推送、合并或部署；未修改 `docs/99_原始材料`。本次只用 `127.0.0.1:5433/paper_review_test` 的独立迁移 schema 和虚构材料，未迁移开发业务库。

## F01–F08 复核

| 发现 | 本地结果与证据 |
|---|---|
| F01 旧 access 复活 | R01 的 `test_token_revocation.py` 覆盖重置、停用→启用、暂停→恢复后的 access/refresh 失效；本次后端全套通过。旧 access 令牌需重新登录。 |
| F02 撤销与签发竞争 | R02 的 `test_auth_concurrency.py` 覆盖 reset/refresh 两种提交顺序、同 refresh 单次轮换、成员重置/暂停锁环与在途成员创建。独立复核发现的死锁和创建漏锁已修复并复看；见 [R02 记录](2026-09-23-r02-concurrency-blocker.md)。 |
| F03 文件令牌绕过身份 | R01 的文件授权及下载用例覆盖暂停、成员/角色/密码变更后的拒绝与审计；本次后端全套通过。 |
| F04 归档批次出现新草稿 | R03 的 `test_batch_creation_concurrency.py` 覆盖创建/关闭先后、双创建和资格停用交错；独立复核未报告新的可证实高优先级缺陷，见 [R03 记录](2026-09-23-r03-concurrency.md)。资格暂停先提交这一独立交错仍未有专门测试。 |
| F05 非字符串输入 500 | R04 的 username/code 参数化用例验证 422 且无写入；见 [R04 记录](2026-09-23-r04-validation.md)。 |
| F06 学校管理员串行 | R05 的延迟 Promise 用例覆盖旧成功、旧失败、清空和刷新；本次浏览器快速切换 A→B→试点学校并刷新，面板只显示试点学校管理员。浏览器没有强制逆序网络响应；该条件由单元测试覆盖。 |
| F07 批次 409 旧表单 | R06 的测试覆盖刷新后无 EDIT 及重新从最新 DRAFT 打开。本次浏览器独立 API 会话先开放批次至版本 2，再由页面提交版本 1：PATCH 实际返回 409，页面显示冲突、旧表单消失，列表显示 OPEN 且无编辑动作。 |
| F08 历史论文身份漂移 | R07 后端测试覆盖旧论文、新资格/导师/学位与角色 404；前端测试覆盖缺值。本次浏览器学生首页显示当前新资格 `R08新批次`，但旧论文编辑页显示旧导师 `赵文博`、`工学硕士`、`2026 年春季硕士论文盲审` 和“未设置”截止时间，无新导师/新批次覆盖。 |

R01–R03 的独立安全/并发复核结果在 R02/R03 记录中；已发现的 P1 锁问题均有失败再通过的测试。本轮未发现仍可复现的 F01–F08 阻断项。该结论只针对已设计并验证的路径，不是全库安全证明。

## 统一检查与浏览器

首次 `DATABASE_URL=...5433/paper_review_test ./scripts/check.sh`：后端 234 passed / 3 warnings；前端 426 passed、4 项在默认并行度下超过 5 秒，脚本退出码 1，类型检查与构建未执行。四个超时用例单独合跑 63/63 通过；`vitest run --maxWorkers=4` 全套 430/430 通过。将统一脚本前端阶段限制为 4 个 worker 后，重新完整执行同一入口：**退出码 0，后端 234 passed / 3 warnings，前端 430 passed / 59 files，`vue-tsc --build` 退出码 0，`VITE_DEMO_MODE=false vite build` 退出码 0**。`git diff --check` 退出码 0。

统一脚本的行为测试初跑因仍预期旧命令 `vitest run` 而退出 1；同步两处期望为 `vitest run --maxWorkers=4` 后，`bash scripts/tests/check_test.sh`、`bash -n scripts/check.sh scripts/tests/check_test.sh` 和最终 `git diff --check` 均退出 0。只调整脚本及其测试期望，未再改变业务代码。

后端警告为 passlib 对 Python `crypt`、argon2 版本接口的弃用警告，以及异议测试的 SQLAlchemy `transaction already deassociated from connection`。构建仍提示第三方 `@vueuse/core` PURE 注释位置和约 1.16 MB 主 chunk；构建成功，不把提示记作零风险。

浏览器验收使用 `operations` 临时场景，端口 8011/5186。真实页面登录系统管理员、学校审核、学生测试账号；只在隔离场景建立虚构旧论文、新资格及待冲突批次。后台日志确认冲突 PATCH 409 与随后列表 GET 200，历史论文 GET 200。浏览器页与两服务正常关闭后，精确验收 schema `test_6140a8efd1fe4d969b7ceb5f4aecfeeb` 不存在，测试库 `test_%`/`acceptance_%` schema 总数 0，精确临时存储目录不存在，8011/5186 无监听。

## 保留边界

Hosted CI、正式数据、生产 RLS、部署/恢复、容量和完整多角色/跨浏览器验收：**NOT RUN**。资格暂停先于新建论文的独立交错尚未有专门用例；现有实现会在锁后复核状态，但本次不把静态判断当作该交错的运行证据。应用内 PDF 正文渲染未在本轮重验。缺少部署条件、试点时间和正式数据要求，不能据此放行上线。

R08 的本地修复集合验收通过。下一项只具备 **R09：T06/RLS 设计与任务细化** 的前置条件；RLS 策略、数据库角色及迁移尚未获本项授权实施。
