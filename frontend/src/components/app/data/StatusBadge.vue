<script setup lang="ts">
/**
 * 状态标签（v3 §7）：颜色按含义——普通多用中性，当前待处理用品牌色，警告琥珀，阻断红，成功绿。
 * 文字本身说明状态，不只靠颜色。
 */
import { Badge } from '@/components/ui/badge'

export type StatusTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'success'
withDefaults(defineProps<{ tone?: StatusTone }>(), { tone: 'neutral' })
</script>

<template>
  <Badge :variant="tone" data-status-badge :data-tone="tone"><slot /></Badge>
</template>
