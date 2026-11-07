<script setup lang="ts">
/**
 * 状态标签（R3-0 起与 StatusBadge 同一外观，U4 计划 §19.1）：文字本身说明状态，不只靠颜色。
 * 旧 tone 名保留：action 对应品牌色（当前待处理）。
 */
import { Badge } from '@/components/ui/badge'

export type PillTone = 'neutral' | 'action' | 'warning' | 'danger' | 'success'
const props = defineProps<{ tone?: PillTone }>()
const VARIANT = { neutral: 'neutral', action: 'brand', warning: 'warning', danger: 'danger', success: 'success' } as const
</script>

<template>
  <Badge :variant="VARIANT[props.tone ?? 'neutral']" class="pill" :class="`pill--${props.tone ?? 'neutral'}`" :data-tone="props.tone ?? 'neutral'"><slot /></Badge>
</template>
