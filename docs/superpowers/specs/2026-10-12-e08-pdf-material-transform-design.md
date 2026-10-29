# E08 PDF材料合并拆分与删页设计规格

日期：2026-10-12。状态：**APPROVED / 未实施**。阶段：二期。

原需求：B9。依赖：E07。

目标：对本人可编辑草稿中的材料执行受控PDF转换，预览后以新文件绑定，不覆盖原文件。

## 共同约束

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 操作范围
仅学生本人DRAFT且版本is_editable的材料可处理；学校不得因此获得代传/编辑论文能力。平台、专家、导师和管理员均不能执行转换。其他角色如需编辑，另立权限设计。
选择当前草稿已完成上传且完整性有效的同purpose PDF；original与anonymous不可混合。merge按用户给定文件顺序/页序输出一个PDF；extract显式选页输出一个新PDF（界面拆分为每次生成一个片段，可重复操作）；delete_pages用补集生成新PDF，禁止空输出。不能宣称一次生成多个分册的批处理。
最多10个源文件，合计输入和输出均不超过当前max_upload_bytes，输出最多1000页；当前项目为单purpose绑定一文件，多源合并允许使用同草稿上传会话中已完成但尚未绑定的文件，必须仍有upload_version_id归属。不得从历史已送审文件或任意storage_key取输入。

## 安全转换与提交契约
POST `/api/v1/theses/{id}/pdf-transforms` `{expected_version,purpose,operation,sources:[{file_id,pages:[1,2]}]}`，服务端推导路径/sha。operation MERGE|EXTRACT|DELETE_PAGES，页码1-based且在范围内；EXTRACT/MERGE允许明确顺序但拒绝重复页（防误操作），DELETE_PAGES页码表示删除集合。
请求校验身份和源摘要后，在本次专有临时目录运行受限子进程pypdf转换；仅传服务端生成的文件路径及页码计划，禁用外部文件引用、脚本/附件/表单等主动内容，不支持输入则422。子进程限制60秒、512MiB可用内存（Mac/Linux现有执行环境，资源限制不可用则启动检查报不支持，不能静默无界运行）。终止仅本次子进程；清理只针对本次创建并核对归属的临时目录。
计算在数据库锁外；生成后论文→相关文件稳定UUID排序锁，重新校验DRAFT/current_version/sourceSHA。状态变化409，不绑定结果。幂等以来源版本、来源SHA、操作和页码摘要绑定，相同请求只返回同一成品。
生成新的FileObject（server_computed_sha、来源操作审计），通过现有上传完成语义校验并保存为待确认成品，不立刻替换ThesisVersionFile。返回 `{operation_id,new_file_id,page_count,source_version,status:'READY'}`，预览通过既有文件授权且仍受草稿所有权约束；复用文件授权需明确允许该草稿所属且完成的未绑定成品，不开放任意未绑定文件。
POST `/pdf-transforms/{operation_id}:apply` `{expected_version}`仅绑定该成品到原purpose；事务内重查条件、标记操作APPLIED。并发重复apply只绑定一次。已过期操作409。取消只解除待用成品标记，不删除来源文件。新增pdf_transform_operations保存来源/状态/输出关联，FORCE RLS学生本人可读写，仅白名单状态字段可更新。
新绑定使既有匿名报告不再匹配；重新检测确认后才能送审。审计记ID、页数、动作、哈希，不写文件正文。结果文件不保留原Info/XMP身份元数据，但仍必须检测，不能宣称已经匿名。

## 验收
真实PDF输出可打开且页序正确；删除所有页422；跨purpose/跨学生/冻结版本/伪造源ID拒绝；处理期间提交草稿导致最后绑定409；超时不挂服务；产物未确认前原文件关联不变；确认后旧文件字节不变；新报告绑定新SHA；恢复包括操作记录及新旧文件。


## 文件落点

新增：backend/app/modules/files/transform_service.py、transform_worker.py、transform_models.py、transform_router.py；frontend/src/components/app/PdfTransformDialog.vue；frontend/src/api/pdfTransforms.ts；backend/tests/test_pdf_transforms.py；frontend/src/modules/thesis/__tests__/pdfTransforms.spec.ts；操作表迁移。
修改：backend/app/modules/files/service.py、pdf.py；backend/app/modules/thesis/service.py；backend/app/api.py、db/models.py；frontend/src/modules/thesis/pages/ThesisEditPage.vue。

## 用户审阅重点

仅本人可编辑草稿；拆分一次一个片段；需要先预览再应用；不支持学校代传。

实施计划：[E08 plan](../plans/2026-10-12-e08-pdf-material-transform.md)。需求总表：[两期路线图](../plans/2026-10-12-enhancement-roadmap.md)。

## 已确认的运行方式补充（2026-10-28）

用户已明确同意使用本机Docker的Linux工作进程：转换容器限制512MiB内存、禁网、仅开放本次临时目录，父进程执行60秒超时并只终止本次拥有的容器。后端/前端仍在原环境；不引入常驻队列。容器根文件系统只读、非root、移除capabilities，内存与交换总额均为512MiB。运行方式不可用时明确报不支持，不回退无界执行。此决定解决[macOS资源限制阻断](../../reviews/2026-10-28-e08-runtime-blocker.md)，原权限、两阶段确认与锁序不变。


## 实施契约补充（2026-10-28）

同用途追加源使用现有prepare/put，再调用 `POST /api/v1/files/{id}:complete-transform-source`；完成校验但不绑定，普通complete重放也不绑定。取消路由为 `POST /api/v1/pdf-transforms/{id}:cancel`，请求含expected_version；取消仅将READY标记为CANCELLED，保留记录及文件。操作记录额外保存生成时的用途绑定，apply据此拒绝同一草稿版本内的替换竞态。状态与来源表在0026迁移落地，既有下载token语义不变。

[本地验收](../../reviews/2026-10-12-e08-validation.md)；[转换环境构建](../../../backend/pdf-worker/README.md)。
