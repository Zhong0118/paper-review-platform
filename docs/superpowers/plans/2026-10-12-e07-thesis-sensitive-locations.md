# E07 论文敏感信息逐页定位 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 按任务 inline 执行；用户既定约束禁止自动子agent、提交或推送。用户已审阅认可，并于2026-10-13授权按顺序执行。

**Goal:** 保留现有身份泄露检测并新增逐页命中、学校自定义字面词表与标题文字核对提示。

**Architecture:** 二期模块；依赖一期E06验收记录。复用现有FastAPI/SQLAlchemy/Postgres RLS及Vue真实模式接口。以规格中的状态、字段、权限与响应契约为准，候选新文件不代表现有功能。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy、Alembic、Postgres、pytest；Vue 3、TypeScript、Vitest；PDF处理复用pypdf，无LLM或外部支付/通话依赖。

**Spec:** [同名设计](../specs/2026-10-12-e07-thesis-sensitive-locations-design.md)

**Status:** APPROVED / E07-01/02/03已本地验证（2026-10-26）；规划依据head 39a8962及保留的工作树，不允许执行者回退到该head。

## Global Constraints

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 文件与接口

修改：backend/app/modules/files/pdf.py；backend/app/modules/thesis/detector.py、models.py、router.py、service.py；frontend/src/modules/thesis/pages/ThesisEditPage.vue；frontend/src/modules/school/pages/ReviewProgressPage.vue。
新增：backend/app/modules/thesis/sensitive_terms.py；frontend/src/components/app/SensitiveFindingPanel.vue；frontend/src/api/sensitiveChecks.ts；frontend/src/modules/school/pages/SensitiveTermsPage.vue；router/routes.ts和menus.ts对应角色入口；配置表及检查来源迁移；backend/tests/test_sensitive_locations.py；frontend/src/modules/thesis/__tests__/sensitiveLocations.spec.ts。

接口的具体字段与状态表见规格“契约”相关段落。每项开始先用CodeGraph理解列出的实际调用者；语义检索用zvec并传绝对root，精确文件/符号用rg。不要重读全仓历史，不自行重建索引。实施前核对新文件是否已由后续工作创建，已有则验证关系后精准修改。

## 第一条失败用例种子

以下是拟新增测试的可执行断言示例，不是本次已经运行的测试。集成fixture写在所列新测试文件中，复用`tests.conftest.isolated_runtime_roles`或`acceptance_environment`及`tests.helpers.login/auth`；角色、数据状态按注释创建，不用mock替代RLS/数据库。纯函数接口由本规格新增。

```python
# two_page_identity_pdf使用pypdf+当前PDF测试辅助代码生成两个可提取文字页。
from app.modules.files.pdf import extract_pdf_pages

def test_page_identity_is_preserved(two_page_identity_pdf):
    result = extract_pdf_pages(two_page_identity_pdf)
    assert [p['page_number'] for p in result['pages']] == [1, 2]
    assert result['pages'][0]['text'] != result['pages'][1]['text']
```

集成async用例使用pytest.mark.asyncio；示例省略装饰仅为突出断言，正式测试必须添加。字段来源由真实响应/数据库fixture读取，不填猜测ID。新fixture只创建本次拥有的虚构资源。

### E07-01 逐页解析与旧契约兼容

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“逐页解析与旧契约兼容”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：assert [f["page_number"] for f in body_findings] == [1,2]; metadata_finding["page_number"] is None。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：生成含两页文本/元信息/扫描页的真实PDF失败样本；实现extract_pdf_pages及旧inspect_pdf适配，保留原有大小/加密/提取不确定检测。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e07-validation.md`，不自动git commit。

### E07-02 学校词表、报告绑定与权限

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“学校词表、报告绑定与权限”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：词表更新→旧自动检查不可用于新确认；别校读取404；专家无法获得matched_text。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：新增版本配置与RLS，接当前anonymous关联；报告存文件SHA与检测版本，人工确认前核对来源仍有效。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e07-validation.md`，不自动git commit。

### E07-03 页面定位与二期检查入口

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“页面定位与二期检查入口”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：PDF页1/2导航正确；标题不出现显示WARN；没有自动替换按钮。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：接学校词表编辑、核验报告、学生草稿检查，展示物理页码和标题文字警示；扫描页显示需人工。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e07-validation.md`，不自动git commit。

## 实际验证命令与验收出口

以下命令从仓库根运行；新文件不存在时须先按上文创建失败测试，不能把找不到测试文件当作业务失败证据。

```sh
backend/.venv/bin/pytest backend/tests/test_sensitive_locations.py backend/tests/test_pdf_validation.py backend/tests/test_file_lifecycle.py -c backend/pyproject.toml -q --tb=short --show-capture=no
(cd frontend && node_modules/.bin/vitest run src/modules/thesis/__tests__/sensitiveLocations.spec.ts --maxWorkers=4)
(cd frontend && node_modules/.bin/vue-tsc --build)
(cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build)
git diff --check
```

命令从仓库根启动，前端命令在子shell中执行，不改变后续命令工作目录。期待测试、类型检查和构建退出0，输出数量必须记录实测。 E01、E06、E10出口运行`./scripts/check.sh`，包含全量后端、前端、类型和真实构建；新增数据表时同时复验`backend/tests/test_rls_end_to_end.py`和`backend/tests/test_recovery_drill.py`。其余模块以定向验证为主，发现关联失败才扩大。

浏览器用`scripts.acceptance_server`的独立schema及真实模式前端，按spec验收场景操作；页面不可用记NOT RUN。停止服务后仅由原工具清理本次自建资源，不手工清理现存schema。审阅记录包括变更文件、具体命令/退出码、失败→修复过程、迁移/RLS/恢复与浏览器证据、未覆盖项及下项条件。

完成本模块后仅在用户已批准整期执行时继续顺序下一项；否则停在本项边界。本模块不扩展：首版提供物理页码而非精确框坐标；无OCR/自动替换；标题仅文字核对。

## 实际交付记录

见[验收记录](../../reviews/2026-10-12-e07-validation.md)：后端65、前端25加文件组件/演示回归29、类型及真实构建通过；Chrome6组场景与自有资源备份恢复通过。学校核验入口落在实际PreparationListPage；迁移0025、34表FORCE RLS。停止于E07边界，后续E08按既定规格执行。
