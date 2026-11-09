<script setup lang="ts">
/**
 * 评阅结论一行（P1-1）：结论徽章、总分、可选的专家建议。学生 / 导师反馈、学校结果、专家本人只读页共用。
 * 不做仪表盘；“修改后通过”附一句说明。
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
    <p class="flex flex-wrap items-baseline gap-x-6 gap-y-2">
      <span v-if="outcome" class="flex items-baseline gap-2">
        <span class="text-sm text-muted-foreground">结论</span>
        <StatusBadge :tone="tone" class="text-sm" data-outcome :data-tone="tone">{{ outcome.label }}</StatusBadge>
      </span>
      <span class="flex items-baseline gap-2">
        <span class="text-sm text-muted-foreground">总分</span>
        <span class="tabular text-lg font-semibold" data-total>{{ total }}</span>
        <span class="tabular text-sm text-muted-foreground">/ {{ maxTotal }}</span>
      </span>
      <span v-if="recommendation !== undefined && recommendation !== null" class="flex items-baseline gap-2">
        <span class="text-sm text-muted-foreground">{{ recommendationLabel }}</span>
        <span class="font-medium">{{ recommendation || '未填写' }}</span>
      </span>
    </p>
    <p v-if="outcome?.code === 'REVISION_REQUIRED'" class="text-sm text-muted-foreground">“修改后通过”是评分档位，不代表已经验收修改稿。</p>
  </section>
</template>
