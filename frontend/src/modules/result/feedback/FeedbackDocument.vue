<script setup lang="ts">
/**
 * 正式反馈阅读稿（reading 模板，v3 §9.3；R1 样板，R3-4 起学生 / 导师页面共用）。
 * 顺序：更正提示 → 标题与来源 → 结论一行（不做仪表盘）→ 总体评价 → 主要问题 → 修改建议 → 分项评分 → 页面附加内容（插槽）。
 * 全部文本按纯文本插值；不显示发布日期（接口没有给出，不用本地时间代替）；v1 快照的修改建议按“未收录”说明，不当成没写。
 */
import StatusBadge from '@/components/app/data/StatusBadge.vue'

import type { FeedbackView } from './publishedFeedback'

defineProps<{ view: FeedbackView; title: string; context?: string[] }>()
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
      <p class="text-sm text-muted-foreground">{{ view.items.length }} 位匿名专家评阅，评分规则 {{ view.ruleVersion }}</p>
    </header>

    <section class="grid gap-2" aria-label="评阅结论">
      <p class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span class="flex items-baseline gap-2"><span class="text-sm text-muted-foreground">结论</span><StatusBadge :tone="view.outcome.code === 'REVISION_REQUIRED' ? 'warning' : view.outcome.code === 'FAIL' ? 'danger' : 'success'" class="text-sm" data-outcome>{{ view.outcome.label }}</StatusBadge></span>
        <span class="flex items-baseline gap-2"><span class="text-sm text-muted-foreground">总分</span><span class="tabular text-lg font-semibold" data-total>{{ view.total }}</span><span class="tabular text-sm text-muted-foreground">/ {{ view.maxTotal }}</span></span>
        <span v-if="view.items.length === 1" class="flex items-baseline gap-2"><span class="text-sm text-muted-foreground">专家建议</span><span class="font-medium">{{ view.items[0]!.recommendation || '未填写' }}</span></span>
      </p>
      <p v-if="view.outcome.code === 'REVISION_REQUIRED'" class="text-sm text-muted-foreground">“修改后通过”是评分档位，不代表已经验收修改稿。</p>
    </section>

    <section v-for="item in view.items" :key="item.alias" class="grid gap-8" :aria-label="view.items.length > 1 ? `匿名专家 ${item.alias}` : '专家意见'">
      <h3 v-if="view.items.length > 1" class="border-t pt-6 text-lg font-semibold">
        匿名专家 {{ item.alias }}<span class="tabular ml-3 text-sm font-normal text-muted-foreground">{{ item.total }} 分，{{ item.recommendation || '未填写建议' }}</span>
      </h3>
      <section v-for="block in [{ h: '总体评价', t: item.overall, miss: '未填写总体评价。' }, { h: '主要问题', t: item.issues, miss: '未填写主要问题。' }]" :key="block.h" class="grid max-w-[42em] gap-2">
        <h4 class="text-md font-semibold">{{ block.h }}</h4>
        <p v-if="block.t.trim()" class="text-md leading-[1.75] break-words whitespace-pre-line">{{ block.t }}</p>
        <p v-else class="rounded-md border border-dashed border-border-strong px-4 py-2.5 text-muted-foreground">{{ block.miss }}</p>
      </section>
      <section class="grid max-w-[42em] gap-2" data-advice>
        <h4 class="text-md font-semibold">修改建议</h4>
        <p v-if="item.advice.kind === 'v1'" class="rounded-md border border-dashed border-border-strong px-4 py-2.5 text-muted-foreground">此历史发布版本未收录修改建议。它发布于该项加入之前，不代表专家没有提出建议。</p>
        <p v-else-if="!item.advice.text.trim()" class="rounded-md border border-dashed border-border-strong px-4 py-2.5 text-muted-foreground">未填写修改建议。</p>
        <p v-else class="text-md leading-[1.75] break-words whitespace-pre-line">{{ item.advice.text }}</p>
      </section>
      <section class="grid gap-2">
        <h4 class="text-md font-semibold">分项评分</h4>
        <p class="text-sm text-muted-foreground">只显示各项得分；专家的分项评价文字不对外发布。</p>
        <table class="w-full max-w-[560px] text-sm">
          <tbody>
            <tr v-for="score in item.scores" :key="score.key" class="border-b last:border-b-0">
              <th scope="row" class="w-px py-2 pr-4 text-left font-normal whitespace-nowrap">{{ score.label }}</th>
              <td class="py-2" aria-hidden="true">
                <span class="block h-1.5 rounded-full bg-muted"><span class="block h-full rounded-full bg-primary/70" :style="{ width: `${score.max ? Math.min(100, (score.score / score.max) * 100) : 0}%` }" /></span>
              </td>
              <td class="tabular w-px py-2 pl-4 text-right whitespace-nowrap">{{ score.score }} <span class="text-muted-foreground">/ {{ score.max }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </section>

    <slot />
  </article>
</template>
