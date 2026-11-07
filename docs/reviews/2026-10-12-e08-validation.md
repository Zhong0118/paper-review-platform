# E08 PDF材料转换验收

执行日期：2026-10-28。状态：**已本地验收**。增强模块累计8/10（一期6/6、二期2/4），下一项E09。

分支 `codex/slice-7a1-file-integrity`；基线/当前HEAD均为 `80ce25c92485a5e1d2ffc59d2cbe57bb712ecf0a`。上一步运行环境诊断文档已保留。本次没有提交、推送、部署；开发数据库没有迁移。数据库验证仅用本机5433 / paper_review_test的本次独立schema，迁移头0026、35张业务表FORCE RLS。

## 实现范围

- 学生本人当前可编辑DRAFT可合并、按明确页序提取一个片段、删除指定页；最多10个来源、1000输出页、输入合计与输出受现有上传字节上限约束。
- 同用途追加文件通过 `POST /files/{id}:complete-transform-source` 完成校验但不绑定；普通complete重试也不会将其绑定。原始/匿名用途不能混合，不接受跨学生、历史版本或伪造来源。
- `POST /theses/{id}/pdf-transforms` 生成READY成品，当前绑定不变；学生通过既有文件接口预览后，调用 `POST /pdf-transforms/{id}:apply` 确认应用。`:cancel`只取消待确认状态。三者使用原响应信封；finish请求含expected_version。
- 转换在数据库事务之外运行，结束后重验有效身份、草稿状态、版本、来源SHA和当前用途绑定。论文→按UUID排序的相关文件锁；重复生成返回同一成品，重复apply只绑定一次。来源字节保留，应用后旧匿名报告失效，须重新检测。
- 新操作表保留来源、SHA、页序、输出和READY/APPLIED/CANCELLED状态；来源字段不可更新，只授予status/updated_at更新。未绑定材料不向学校/平台等角色开放。下载token仍在每次读取时重新鉴权。
- 用户批准Docker Linux执行方式后落地：512MiB内存与内存交换合计、60秒超时、非root、只读根、禁网、移除capabilities，仅挂载本次input/output临时目录。实际检查cgroup并设置进程地址空间限制；不可用返回503，不回退。镜像基础digest和pypdf版本固定。
- Vue真实页面支持来源顺序、页码范围、上传追加、生成预览、应用、取消和失败提示；组件卸载/身份变化丢弃迟到响应并释放Blob URL。

## 文件

新增后端 `app/modules/files/transform_{worker,runtime,models,service,router}.py`、`alembic/versions/0026_pdf_transforms.py`、`scripts/build_pdf_worker.py` 和 `pdf-worker/`。修改文件完成/授权、API/ORM注册与恢复清单。

新增前端 `api/pdfTransforms.ts`、`components/app/PdfTransformDialog.vue`，接入学生ThesisEditPage；更新组件类型声明。新增后端/前端转换测试，调整RLS/恢复计数及两个历史文件测试的夹具。完整工作树见[文件清单](evidence/2026-10-28-e08/working-tree.txt)。

## 测试先行及排查

- 纯转换占位实现下9项失败（退出1）→真实页序、提取、删页、空输出/重复/非法页、加密/主动内容/大小拒绝通过。
- 两阶段接口未注册时用例返回404（退出1）→READY不绑定、预览、幂等、并发apply、旧字节保留、提交后拒绝应用通过。
- 前端空组件3项失败（退出1）→预览后才能应用、非法页码拦截、冲突保留、迟到响应丢弃通过。
- 恢复首次失败于旧的34表校验（退出1）→补入35表及操作记录摘要后实际备份、重建恢复、文件/报告/操作状态复核通过。
- 最初直接把链接查询叠加到文件RLS造成查询规划膨胀；取消本次测试查询后，改为保持调用者RLS的SECURITY INVOKER PL/pgSQL查询边界，未放宽条件。后续功能、权限和恢复回归通过。
- 扩大回归首次84通过、15失败。只读提取已提交快照80ce25c到临时目录，两个代表用例同样失败（退出1），确认属于旧测试前置条件：HTTP超级用户绕过RLS，使平台错误读取了匿名检测记录；直接服务并发测试缺少事务身份上下文。文件访问测试改用真实非owner业务/认证角色，测试管理会话仅作审计观察和故障注入；并发测试绑定已验证身份。原断言保留，19项重新通过。未改业务权限以迎合测试。
- Docker Hub首次构建连接超时；复用本机已有官方Python镜像，固定其digest后构建成功。构建脚本只发送Dockerfile与worker源码，不发送.env或材料目录。

## 本次实际命令与结果

命令均从仓库根执行，注明frontend者在frontend目录执行。以下测试数量取自本次输出；两组后端共99个不同用例，不代表全仓全量测试。

| 命令 | 退出码 | 实际结果 |
|---|---:|---|
| `backend/.venv/bin/pytest backend/tests/test_pdf_transforms.py backend/tests/test_pdf_validation.py backend/tests/test_file_lifecycle.py backend/tests/test_sensitive_locations.py backend/tests/test_rls_end_to_end.py backend/tests/test_rls_roles.py backend/tests/test_recovery_drill.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 80通过，包含15个新增转换用例、真实Docker限制/超时、FORCE RLS、空迁移往返、有数据降级拒绝、自有资源真实恢复 |
| `backend/.venv/bin/pytest backend/tests/test_file_access.py backend/tests/test_file_concurrency.py -c backend/pyproject.toml -q --tb=short --show-capture=no` | 0 | 19通过，包含现有文件token、任务失效、撤销权限、并发上传/提交 |
| frontend：`node_modules/.bin/vitest run src/modules/thesis/__tests__/{pdfTransforms,sensitiveLocations,realSubmit.wiring,realThesisIdentity,studentSubmission,studentDemoScenario,studentGoldenPath}.spec.ts` | 0 | 7文件、57通过 |
| frontend：`node_modules/.bin/vue-tsc --build` | 0 | 类型检查通过 |
| frontend：`VITE_DEMO_MODE=false node_modules/.bin/vite build` | 0 | 真实模式构建通过 |
| `DOCKER_BUILDKIT=0 backend/.venv/bin/python backend/scripts/build_pdf_worker.py` | 0 | 本机构建转换镜像成功 |
| `node .superpowers/sdd/2026-10-12-e08-pdf-material-transform/browser-e08.cjs` | 0 | Chrome真实浏览器5组通过 |
| `backend/.venv/bin/python .superpowers/sdd/2026-10-12-e08-pdf-material-transform/check_cleanup.py` | 0 | 本次schema/角色/存储/临时口令及8013、5177服务均已清理 |
| `git diff --check` | 0 | 无新增空白错误 |

环境：macOS，宿主Python3.12.7，Node24.19.0，PostgreSQL16.15，Docker28.1.1；容器Python3.12.15 / pypdf6.19.0；Chrome156.0.8078.49。测试存在passlib/argon2及测试样本add_js弃用提示；构建存在依赖PURE注释警告，均未使检查失败。

日志保存在本机忽略目录 `.superpowers/sdd/2026-10-12-e08-pdf-material-transform/`；可移交的结果及截图见下方，不包含登录口令或token。

## 浏览器与恢复证据

[浏览器5组结果](evidence/2026-10-28-e08/browser-results.json)；[合并预览](evidence/2026-10-28-e08/merge-preview.png)；[提取预览](evidence/2026-10-28-e08/extract-preview.png)；[删页预览](evidence/2026-10-28-e08/delete_pages-preview.png)；[390px窄屏](evidence/2026-10-28-e08/mobile-preview.png)；[资源清理](evidence/2026-10-28-e08/cleanup.json)。

实际浏览器执行合并3页→提取2页→删除后1页，每次均检查确认前后绑定；随后重检并确认报告绑定新文件，再生成并取消一个成品。PDF已在Chrome阅读器渲染，页面无未处理JS错误。窄屏对话框可纵向滚动且无横向溢出。

恢复用例 `test_transform_report_and_owned_recovery` 将原始、旧匿名、新成品3文件及APPLIED记录配套备份，在精确核对本次资源所有权后实际恢复，复核文件摘要、报告来源、操作状态和重复apply。其它RLS恢复用例同时校验35表与权限。浏览器临时服务已关闭；共享Postgres与本地转换镜像保留供后续使用，没有关闭其他项目资源。

## 运行与边界

[构建和运行说明](../../backend/pdf-worker/README.md)。开发数据库本轮未升级，使用自己的开发环境前需按项目既定流程准备迁移与业务/认证数据库角色；本次验收用的是隔离环境，不等于已有开发库已具备0026。

没有做全仓全量回归（按计划留至E10）、真实环境部署、生产数据迁移、恶意PDF全面模糊测试或主机/进程崩溃注入。只测试Docker当前Linux cgroup v2运行方式；普通macOS Python不作为受限转换替代。转换不提供批量分册、OCR、格式检测或匿名自动替换。取消保留操作记录与产物，不引入通用清理器；进程崩溃产生的存储孤立文件须另行核对归属，不可通配删除。

本项无已知阻断。下一项E09专家档案增强与受控导入，仍应按其已批准spec/plan执行；本次未自动开展E09，也未进入真实环境交付。
