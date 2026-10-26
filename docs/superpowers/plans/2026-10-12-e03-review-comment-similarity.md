# E03 本人历史评语相似性检查 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 按任务 inline 执行；用户既定约束禁止自动子agent、提交或推送。用户已审阅认可，并于2026-10-13授权按顺序执行。

**Goal:** 只对专家本人既往正式评语提供可复现的重复与相似片段提示，不泄露其他专家或学校数据。

**Architecture:** 一期模块；依赖E02。复用现有FastAPI/SQLAlchemy/Postgres RLS及Vue真实模式接口。以规格中的状态、字段、权限与响应契约为准，候选新文件不代表现有功能。

**Tech Stack:** Python 3.12、FastAPI、SQLAlchemy、Alembic、Postgres、pytest；Vue 3、TypeScript、Vitest；PDF处理复用pypdf，无LLM或外部支付/通话依赖。

**Spec:** [同名设计](../specs/2026-10-12-e03-review-comment-similarity-design.md)

**Status:** LOCAL_VERIFIED / 2026-10-13已完成并本地验证；规划依据head 39a8962及保留的工作树，不允许执行者回退到该head。

## Global Constraints

- 文档状态为 APPROVED：用户已认可本规格，2026-10-13授权按路线图顺序实施；偏离已确认权限或业务语义时再报告。设计完成不计实现完成。
- 在当前工作树 inline 执行，不创建子agent；保留未提交/未跟踪文件，不提交、推送、部署，不改 docs/99_原始材料。
- 客户端不得传 tenant_id；保留六角色边界、FORCE RLS、文件token语义与论文→任务锁顺序；学校不得获知专家身份，专家不得获知作者/导师身份。
- 数据库仅本机5433/paper_review_test独立schema；迁移串行。新的迁移编号按实施时真实head顺延，不预先占用编号，不修改旧迁移。
- 新接口、类型、文件均为本次拟新增契约，非现有能力；沿用现有响应信封、错误码、审计及幂等设施，不引入通用工作流/插件平台。
- 按失败测试→最小实现→定向验证推进；不得删断言、绕过RLS或用演示接口通过验收。新表必须加入权限与恢复清单；有数据的破坏性降级必须拒绝。
- 若真实旧数据不能确定性回填、需要偏离规格权限/锁序、同一问题两次修复失败，记录最小用例和具体阻断，停止依赖工作。

## 文件与接口

拟新增：backend/app/modules/review/comment_similarity.py；backend/tests/test_comment_similarity.py；frontend/src/modules/review/__tests__/reviewSimilarity.spec.ts。
修改E02 comment_checks.py、ReviewCheckPanel.vue、reviewChecks.ts；review/service.py及E01 correction_service.py；如需本人历史RLS新增迁移，不改0015；模板排除短语存backend/data/review-checks-v1.json的新版本。

接口的具体字段与状态表见规格“契约”相关段落。每项开始先用CodeGraph理解列出的实际调用者；语义检索用zvec并传绝对root，精确文件/符号用rg。不要重读全仓历史，不自行重建索引。实施前核对新文件是否已由后续工作创建，已有则验证关系后精准修改。

## 第一条失败用例种子

以下是拟新增测试的可执行断言示例，不是本次已经运行的测试。集成fixture写在所列新测试文件中，复用`tests.conftest.isolated_runtime_roles`或`acceptance_environment`及`tests.helpers.login/auth`；角色、数据状态按注释创建，不用mock替代RLS/数据库。纯函数接口由本规格新增。

```python
from app.modules.review.comment_similarity import compare_comments

def test_exact_reuse_is_not_a_plagiarism_verdict():
    text = '研究设计没有交代样本选择依据，建议补充抽样过程并解释样本代表性。'
    report = compare_comments(text, [{'id':'own-result-1','text':text}])
    assert report['matches'][0]['kind'] == 'EXACT'
    assert 'plagiarism_rate' not in report
```

集成async用例使用pytest.mark.asyncio；示例省略装饰仅为突出断言，正式测试必须添加。字段来源由真实响应/数据库fixture读取，不填猜测ID。新fixture只创建本次拥有的虚构资源。

### E03-01 算法与语料边界

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“算法与语料边界”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：assert compare_comments(text,[{"text":text,"id":"r1"}])["matches"][0]["kind"] == "EXACT"。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：测试模板排除、Jaccard边界、原文片段映射、短文不检测；实现纯函数并返回覆盖描述。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e03-validation.md`，不自动git commit。

### E03-02 权限查询与确认契约

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“权限查询与确认契约”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：同任务更正不命中；其他专家数据不返回；超过200明确truncated=true。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：新增本人有效结果查询，排除当前任务全部版本；固定窗口/上限及fingerprint，加入提交端重新确认流程，写直接SQL负例。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e03-validation.md`，不自动git commit。

### E03-03 面板与真实浏览器

**Files:** 使用上文文件落点中与本项相关的服务/页面和新测试文件；不改无关模块。

**Consumes / Produces:** 消费本模块spec定义的输入及前项已经验证的契约；产出“面板与真实浏览器”对应的真实行为，字段名必须与spec一致。跨模块依赖缺失则停止，不另建兼容假数据。

- [x] 先在所列测试文件添加本项失败用例：完全复制出现提示；确认后提交；改字后需要重查；不会出现外校身份或原文链接。同时覆盖本项涉及的无权限、过期版本或空态。
- [x] 运行下方定向命令，保存失败测试名、实际/预期和退出码；若现有代码已通过则核对证据，避免重复实现。
- [x] 最小实现：展示当前稿相似片段和覆盖范围，保留本人原文；错误不能伪装0命中；造两条本人虚构历史结果复验。
- [x] 重跑定向用例；失败按日志定位，不删断言。数据库命令必须在隔离schema；不要与浏览器验收服务的建库/迁移同时运行。
- [x] 自查本项数据归属、字段映射、状态转移及日志去敏；将实际结果追加到`docs/reviews/2026-10-12-e03-validation.md`，不自动git commit。

## 实际验证命令与验收出口

以下命令从仓库根运行；新文件不存在时须先按上文创建失败测试，不能把找不到测试文件当作业务失败证据。

```sh
backend/.venv/bin/pytest backend/tests/test_comment_similarity.py backend/tests/test_comment_checks.py backend/tests/test_result_corrections.py -c backend/pyproject.toml -q --tb=short --show-capture=no
(cd frontend && node_modules/.bin/vitest run src/modules/review/__tests__/reviewSimilarity.spec.ts --maxWorkers=4)
(cd frontend && node_modules/.bin/vue-tsc --build)
(cd frontend && VITE_DEMO_MODE=false node_modules/.bin/vite build)
git diff --check
```

命令从仓库根启动，前端命令在子shell中执行，不改变后续命令工作目录。期待测试、类型检查和构建退出0，输出数量必须记录实测。 E01、E06、E10出口运行`./scripts/check.sh`，包含全量后端、前端、类型和真实构建；新增数据表时同时复验`backend/tests/test_rls_end_to_end.py`和`backend/tests/test_recovery_drill.py`。其余模块以定向验证为主，发现关联失败才扩大。

浏览器用`scripts.acceptance_server`的独立schema及真实模式前端，按spec验收场景操作；页面不可用记NOT RUN。停止服务后仅由原工具清理本次自建资源，不手工清理现存schema。审阅记录包括变更文件、具体命令/退出码、失败→修复过程、迁移/RLS/恢复与浏览器证据、未覆盖项及下项条件。

完成本模块后仅在用户已批准整期执行时继续顺序下一项；否则停在本项边界。本模块不扩展：首版只查本人历史，365天/200条/0.85为建议范围；不能标记A9全平台查重完整覆盖。

## 本次交付

[验收记录](../../reviews/2026-10-12-e03-validation.md)：扩大77项通过，末尾补修后核心49项、纯边界13项通过；前端474项、类型/真实构建、Chrome原评阅/更正及旧语料指纹409验证通过。未跑后端全量/生产部署；没有新增迁移或RLS策略。下一项E04尚未执行。
