<script setup lang="ts">
/**
 * 正式反馈正文（学生、导师共用，只读）：发布元数据 → 结论与总分 → 总体评价 → 主要问题 → 修改建议 → 分项评分。
 * 全部文本按纯文本插值渲染；不显示发布日期（接口没有给出，不用本地时间代替）。
 */
import type { FeedbackView } from './publishedFeedback'

defineProps<{ view: FeedbackView; title: string; context?: string[] }>()
</script>

<template>
  <article class="paper">
    <div v-if="view.correctionPending" class="notice" role="status" data-correction-pending>
      评阅专家提出的更正正在处理。学校确认前，你看到的仍是当前已发布的版本；确认后这里会显示新的发布版本。
    </div>
    <div v-else-if="view.corrected" class="notice" role="status" data-corrected>
      这是学校确认更正后的发布版本。更正前的版本仍保留在记录中，不会被删除。
    </div>

    <header class="paper__head">
      <p v-if="context?.length" class="paper__ctx muted"><span v-for="entry in context" :key="entry">{{ entry }}</span></p>
      <h1 class="paper__title">{{ title }}</h1>
      <p class="paper__meta muted">{{ view.items.length }} 位匿名专家，评分规则 {{ view.ruleVersion }}</p>
    </header>

    <section class="verdict" aria-label="评阅结论">
      <div>
        <p class="verdict__label">结论</p>
        <p class="verdict__value" data-outcome>{{ view.outcome.label }}</p>
      </div>
      <div>
        <p class="verdict__label">总分</p>
        <p class="verdict__value num" data-total>{{ view.total }}<small> / {{ view.maxTotal }}</small></p>
      </div>
      <div v-if="view.items.length === 1">
        <p class="verdict__label">专家建议</p>
        <p class="verdict__value verdict__value--sm">{{ view.items[0].recommendation || '未填写' }}</p>
      </div>
      <p v-if="view.outcome.code === 'REVISION_REQUIRED'" class="verdict__note muted">“修改后通过”是评分档位，不代表已经验收修改稿。</p>
    </section>

    <section v-for="item in view.items" :key="item.alias" class="expert" :aria-label="view.items.length > 1 ? `匿名专家 ${item.alias}` : '专家意见'">
      <h2 v-if="view.items.length > 1" class="expert__head">匿名专家 {{ item.alias }}<span class="muted">　{{ item.total }} 分，{{ item.recommendation || '未填写建议' }}</span></h2>
      <section class="block">
        <h3>总体评价</h3>
        <p v-if="item.overall.trim()" class="pre">{{ item.overall }}</p>
        <p v-else class="missing">未填写总体评价。</p>
      </section>
      <section class="block">
        <h3>主要问题</h3>
        <p v-if="item.issues.trim()" class="pre">{{ item.issues }}</p>
        <p v-else class="missing">未填写主要问题。</p>
      </section>
      <section class="block" data-advice>
        <h3>修改建议</h3>
        <p v-if="item.advice.kind === 'v1'" class="missing">此历史发布版本未收录修改建议。它发布于该项加入之前，不代表专家没有提出建议。</p>
        <p v-else-if="!item.advice.text.trim()" class="missing">未填写修改建议。</p>
        <p v-else class="pre">{{ item.advice.text }}</p>
      </section>
      <section class="block">
        <h3>分项评分</h3>
        <p class="muted small">只显示各项得分；专家的分项评价文字不对外发布。</p>
        <table class="scores">
          <tbody>
            <tr v-for="score in item.scores" :key="score.key">
              <th scope="row">{{ score.label }}</th>
              <td class="bar" aria-hidden="true"><span :style="{ width: `${score.max ? Math.min(100, (score.score / score.max) * 100) : 0}%` }" /></td>
              <td class="num">{{ score.score }} <span class="muted">/ {{ score.max }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>

    <slot />
  </article>
</template>

<style scoped>
.paper {
  display: grid;
  gap: 28px;
  padding: 40px 56px 48px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.notice {
  padding: 10px 14px;
  border-left: 3px solid var(--ws-action);
  background: var(--ws-action-soft);
  font-size: 14px;
  line-height: 1.7;
}
.paper__head {
  display: grid;
  gap: 8px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ws-border);
}
.paper__ctx {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 13px;
}
.paper__title {
  font-family: var(--ws-font-reading);
  font-size: 26px;
  font-weight: 700;
  line-height: 1.4;
}
.paper__meta {
  font-size: 13px;
}
.verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 48px;
  padding: 18px 20px;
  border-radius: var(--ws-radius-panel);
  background: var(--ws-page);
}
.verdict__label {
  color: var(--ws-muted);
  font-size: 12px;
}
.verdict__value {
  font-size: 24px;
  font-weight: 650;
  line-height: 1.3;
}
.verdict__value small {
  color: var(--ws-muted);
  font-size: 14px;
  font-weight: 400;
}
.verdict__value--sm {
  font-size: 18px;
}
.verdict__note {
  flex-basis: 100%;
  font-size: 13px;
}
.expert {
  display: grid;
  gap: 28px;
}
.expert + .expert {
  padding-top: 28px;
  border-top: 1px solid var(--ws-border);
}
.expert__head {
  font-size: 17px;
  font-weight: 650;
}
.expert__head .muted {
  font-size: 14px;
  font-weight: 400;
}
.block {
  max-width: 42em;
}
.block h3 {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 650;
}
.block p {
  font-size: 16px;
  line-height: 1.8;
}
.block .small {
  margin-bottom: 6px;
  font-size: 13px;
}
.pre {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.block .missing {
  padding: 10px 14px;
  border: 1px dashed var(--ws-border-strong);
  border-radius: var(--ws-radius);
  color: var(--ws-muted);
  font-size: 14px;
}
.scores {
  width: 100%;
  max-width: 560px;
  border-collapse: collapse;
}
.scores th {
  width: 1%;
  padding: 8px 16px 8px 0;
  font-weight: 400;
  text-align: left;
  white-space: nowrap;
}
.scores td {
  padding: 8px 0 8px 12px;
  white-space: nowrap;
}
.bar {
  width: 100%;
  /* 满分轨道：让 80% 与满分看得出差别 */
  background: linear-gradient(var(--ws-sunken), var(--ws-sunken)) left center / 100% 6px no-repeat content-box;
}
.bar span {
  display: block;
  height: 6px;
  border-radius: 3px;
  background: var(--ws-action);
  opacity: 0.75;
}
@media (max-width: 640px) {
  .paper {
    padding: 22px 18px 28px;
  }
  .paper__title {
    font-size: 21px;
  }
  .verdict {
    gap: 12px 28px;
  }
  .scores th {
    padding-right: 10px;
  }
}
</style>
