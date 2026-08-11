<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status: string
  overdue?: boolean
  label?: string
}>()

const statusLabels: Record<string, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  PREPARING: '送审准备中',
  READY_FOR_DISPATCH: '待送审',
  UNDER_REVIEW: '送审中',
  RESULT_PROCESSING: '结果处理中',
  TERMINATED: '已终止',
  REVIEW_REQUIRED: '待人工复核',
  PENDING_ASSIGNMENT: '待派单',
  PENDING_ACCEPTANCE: '待接单',
  IN_REVIEW: '评阅中',
  COMPLETED: '已完成',
  RETURNED: '已退回',
  FAILED: '处理失败',
}

const statusTone = computed(() => {
  if (props.status === 'COMPLETED') return 'success'
  if (['RETURNED', 'FAILED', 'TERMINATED'].includes(props.status)) return 'danger'
  if (['REVIEW_REQUIRED', 'PENDING_ACCEPTANCE'].includes(props.status)) return 'warning'
  if (['IN_REVIEW', 'UNDER_REVIEW'].includes(props.status)) return 'primary'
  if (props.status === 'RESULT_PROCESSING') return 'processing'
  return 'neutral'
})

const displayLabel = computed(() => props.label ?? statusLabels[props.status] ?? props.status)
</script>

<template>
  <span class="status-group" :aria-label="overdue ? `${displayLabel}，已逾期` : displayLabel">
    <span class="status-tag" :class="`status-tag--${statusTone}`" :data-status="status">
      {{ displayLabel }}
    </span>
    <span v-if="overdue" class="overdue-tag" data-overdue="true">已逾期</span>
  </span>
</template>

<style scoped>
.status-group {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  align-items: center;
}

.status-tag,
.overdue-tag {
  display: inline-flex;
  align-items: center;
  min-height: 1.625rem;
  padding: 0.125rem 0.625rem;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 650;
  line-height: 1.25;
  white-space: nowrap;
}

.status-tag--neutral {
  color: #4b5966;
  background: #edf1f4;
  border-color: #d7dee4;
}

.status-tag--primary {
  color: #123d6b;
  background: #e8f0f9;
  border-color: #c7d6e6;
}

.status-tag--success {
  color: #1f6326;
  background: #edf7ee;
  border-color: #b9dcbc;
}

.status-tag--warning,
.overdue-tag {
  color: #9c3d00;
  background: #fff3e8;
  border-color: #f3c59f;
}

.status-tag--processing {
  color: var(--color-result-processing);
  background: var(--color-result-processing-soft);
  border-color: #d5cee5;
}

.status-tag--danger {
  color: #9e2020;
  background: #fceded;
  border-color: #e9b8b8;
}
</style>
