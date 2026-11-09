<script setup lang="ts">
/**
 * 评阅结论一行（P1-1）：结论徽章、总分、可选的专家建议。学生 / 导师反馈、学校结果、专家本人只读页共用。
 * 不做仪表盘；“修改后通过”附一句说明。
 * G1-2：每项上面一行小字标签；总分用宋体大字号；可选显示评阅人数（学校结果页用）。
 */
import { computed } from 'vue'

import StatusBadge, { type StatusTone } from '@/components/app/data/StatusBadge.vue'

const props = withDefaults(
  defineProps<{
    outcome: { code: string; label: string } | null
    total: number
    maxTotal: number
    /** 不传则不显示这一项；传空字符串显示“未填写” */
    recommendation?: string | null
    recommendationLabel?: string
    /** 传了才显示“评阅 N 位匿名专家” */
    reviewerCount?: number
  }>(),
  { recommendation: undefined, recommendationLabel: '专家建议' },
)

const tone = computed<StatusTone>(() => {
  const code = props.outcome?.code
  if (code === 'REVISION_REQUIRED') return 'warning'
  if (code === 'FAIL') return 'danger'
  return 'success'
})
</script>

<template>
  <section class="grid gap-2" aria-label="评阅结论" data-review-verdict>
    <dl class="m-0 flex flex-wrap items-end gap-x-10 gap-y-3">
      <div class="grid gap-1">
        <dt class="text-xs text-muted-foreground">总分</dt>
        <dd class="m-0 flex items-baseline gap-1.5">
          <span class="tabular font-display text-[52px] leading-none font-semibold" data-total>{{ total }}</span>
          <span class="tabular text-base text-faint">/ {{ maxTotal }}</span>
        </dd>
      </div>
      <div v-if="outcome" class="grid gap-1">
        <dt class="text-xs text-muted-foreground">结论</dt>
        <dd class="m-0"><StatusBadge :tone="tone" class="h-7 px-3 text-base font-semibold" data-outcome :data-tone="tone">{{ outcome.label }}</StatusBadge></dd>
      </div>
      <div v-if="recommendation !== undefined && recommendation !== null" class="grid gap-1">
        <dt class="text-xs text-muted-foreground">{{ recommendationLabel }}</dt>
        <dd class="m-0 leading-7 font-medium">{{ recommendation || '未填写' }}</dd>
      </div>
      <div v-if="reviewerCount !== undefined" class="grid gap-1">
        <dt class="text-xs text-muted-foreground">评阅</dt>
        <dd class="m-0 leading-7" data-reviewer-count>{{ reviewerCount }} 位匿名专家</dd>
      </div>
    </dl>
    <p v-if="outcome?.code === 'REVISION_REQUIRED'" class="text-sm text-muted-foreground">“修改后通过”是评分档位，不代表已经验收修改稿。</p>
  </section>
</template>
