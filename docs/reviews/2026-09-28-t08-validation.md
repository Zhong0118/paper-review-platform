# T08 固定评审规则页面与模块验收

验收收束日期：2026-10-02。分支 `codex/slice-7a1-file-integrity`，HEAD `39a8962`。`0018_round_rule_snapshot`、规则/结果 API 的后端实现与迁移边界见[后端记录](2026-09-28-t08-backend-validation.md)。本项接通真实页面；数据仅来自 5433 `paper_review_test` 独立虚构 schema。

## 页面结果

- 专家任务先取得服务端 `rules` 才出现可提交的六维评分表；显示 `pilot-single-v1`、每维上限和 100 分总分。加载失败不借用演示模板，提供显式重试；快速切任务使用既有 generation 屏障，清除旧规则和旧表单。演示模式仍使用原模板。
- 学校批次规则页只读展示六维权重与 59/60/79/80 分档，不提供修改入口。学校结果、学生结果和导师结果各自读取同一轮次结果投影，显示“评分档位”和规则版本；专家建议仍是独立字段，“修改后通过”不写成学校已验收修改稿。
- 单元回归覆盖未加载规则不可提交、失败/重试、迟到响应隔离、只读学校规则，以及三类结果页面的档位与版本。后端测试覆盖轮次规则不可变、已知历史回填、损坏快照拒绝、发布前不可见、发布后匿名投影和未知规则版本拒绝。

## 实际命令与结果

| 命令/时点 | 退出码与结果 |
|---|---|
| `./scripts/check.sh`（前端最后两处小修正前） | 0：后端 **387 passed / 2 warnings**，前端 **443 passed / 61 files**，类型检查、真实模式构建通过 |
| `cd frontend && node_modules/.bin/vitest run --maxWorkers=4`（规则失败重试后） | 0：**444 passed / 61 files** |
| `cd frontend && node_modules/.bin/vitest run src/modules/expert-management/__tests__/realExpertLibrary.spec.ts --maxWorkers=4`（停用账号提示修复后） | 0：**6 passed / 1 file**；红灯为 1 failed/5 passed |
| `cd frontend && node_modules/.bin/vitest run --maxWorkers=4`（最终前端修复后） | 0：**445 passed / 61 files** |
| `cd frontend && node_modules/.bin/vue-tsc --build`；`VITE_DEMO_MODE=false node_modules/.bin/vite build`（最终前端修复后） | 均 0；Vite 有第三方 PURE 注解及大 chunk 警告，未导致失败 |
| `bash scripts/tests/check_test.sh`；`git diff --check` | 均 0 |

上表是不同时间的重跑记录，不能把测试数量相加；最终前端状态以 445 项为准。后端在此期间未改动，完整后端结果仍为本项起始时实跑的 387 项。

## 浏览器和未覆盖

| 场景 | 实际观察 | 状态 |
|---|---|---|
| 专家 `accepted` | 真实浏览器进入精确 task，看到 `pilot-single-v1`、六维服务端规则和 100 分；匿名 PDF iframe 已加载，未单独检查正文内容 | PASS · 页面规则；PDF 正文 NOT RUN |
| 学校 `operations` | 浏览器 `/school/batch-rules` 展示固定规则、三档和只读提示 | PASS · 浏览器 |
| 已发布 `published` | 学校 `/school/results`、学生 `/student/results`、导师 `/supervisor/results` 均显示同一 80 分“通过”档位、`pilot-single-v1` 和匿名 E-001；专家建议单列 | PASS · 浏览器 |
| 低分/修改后通过、快速切任务、加载失败 | 单元/后端测试覆盖；未逐项浏览器重演 | PASS · 自动化；浏览器 NOT RUN |
| 生产数据回填、Hosted CI、六角色完整主链、部署 | 无真实目标环境/数据 | NOT RUN |

三处浏览器服务均正常停止；精确 schema `test_11160d813e7b40be937fde20042e33d8`、`test_34e344c8088a40f8a104041090bca492`、`test_cf2f078becc74c1d8b317bdd1acc47c1` 与各自存储路径逐一核对不存在，8011–8013/5186–5188 无监听。没有清理其他现存 schema、备份或文件。
