<script setup lang="ts">
/**
 * 正式反馈阅读稿（reading 模板，v3 §9.3；R1 样板，R3-4 起学生 / 导师页面共用）。
 * 顺序：更正提示 → 标题与来源 → 结论一行（不做仪表盘）→ 总体评价 → 主要问题 → 修改建议 → 分项评分 → 页面附加内容（插槽）。
 * P1-1：结论与意见改用共享的 ReviewVerdict / ReviewOpinion；P1-4：抬头不再显示规则版本。
 * 全部文本按纯文本插值；不显示发布日期（接口没有给出，不用本地时间代替）；v1 快照的修改建议按“未收录”说明，不当成没写。
 */
import ReviewOpinion, { type OpinionSection } from '@/components/app/review/ReviewOpinion.vue'
import ReviewVerdict from '@/components/app/review/ReviewVerdict.vue'

import type { FeedbackItem, FeedbackView } from './publishedFeedback'

defineProps<{ view: FeedbackView; title: string; context?: string[] }>()

const LEGACY_ADVICE = '此历史发布版本未收录修改建议。它发布于该项加入之前，不代表专家没有提出建议。'
const sections = (item: FeedbackItem): OpinionSection[] => [
  { key: 'overall', heading: '总体评价', text: item.overall, missing: '未填写总体评价。' },
  { key: 'issues', heading: '主要问题', text: item.issues, missing: '未填写主要问题。' },
  item.advice.kind === 'v1'
    ? { key: 'advice', heading: '修改建议', text: '', missing: LEGACY_ADVICE }
    : { key: 'advice', heading: '修改建议', text: item.advice.text, missing: '未填写修改建议。' },
]
</script>

<template>
  <article class="grid gap-8" data-feedback>
    <p v-if="view.correctionPending" class="rounded-md border-l-[3px] border-primary bg-primary-soft px-4 py-2.5" role="status" data-correction-pending>
      评阅专家提出的更正正在处理。学校确认前，你看到的仍是当前已发布的版本；确认后这里会显示新的发布版本。
    </p>
    <p v-else-if="view.corrected" class="rounded-md border-l-[3px] border-primary bg-primary-soft px-4 py-2.5" role="status" data-corrected>
      这是学校确认更正后的发布版本。更正前的版本仍保留在记录中，不会被删除。
    </p>

    <header class="grid gap-2 border-b pb-6">
      <p v-if="context?.length" class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><span v-for="entry in context" :key="entry">{{ entry }}</span></p>
      <h2 class="text-2xl font-semibold text-balance">{{ title }}</h2>
      <p class="text-sm text-muted-foreground">{{ view.items.length }} 位匿名专家评阅</p>
    </header>

    <ReviewVerdict :outcome="view.outcome" :total="view.total" :max-total="view.maxTotal" :recommendation="view.items.length === 1 ? view.items[0]!.recommendation : undefined" />

    <section v-for="item in view.items" :key="item.alias" class="grid gap-6" :aria-label="view.items.length > 1 ? `匿名专家 ${item.alias}` : '专家意见'">
      <h3 v-if="view.items.length > 1" class="border-t pt-6 text-lg font-semibold">
        匿名专家 {{ item.alias }}<span class="tabular ml-3 text-sm font-normal text-muted-foreground">{{ item.total }} 分，{{ item.recommendation || '未填写建议' }}</span>
      </h3>
      <ReviewOpinion :sections="sections(item)" :scores="item.scores" scores-caption="只显示各项得分；专家的分项评价文字不对外发布。" />
    </section>

    <slot />
  </article>
</template>
