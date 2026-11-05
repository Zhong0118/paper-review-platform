<script setup lang="ts">
/** 状态标签：颜色之外始终有文字与形状，不只靠颜色区分。 */
export type PillTone = 'neutral' | 'action' | 'warning' | 'danger' | 'success'
defineProps<{ tone?: PillTone }>()
</script>

<template>
  <span class="pill" :class="`pill--${tone ?? 'neutral'}`"><i aria-hidden="true" /><slot /></span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--ws-info-soft);
  color: var(--ws-text);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.pill i {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 50%;
  background: var(--ws-faint);
}
.pill--action {
  background: var(--ws-action-soft);
  color: var(--ws-action);
}
.pill--action i {
  background: var(--ws-action);
}
.pill--warning {
  background: var(--ws-warning-soft);
  color: var(--ws-warning);
}
.pill--warning i {
  border-radius: 1px;
  background: var(--ws-warning);
  transform: rotate(45deg);
}
.pill--danger {
  background: var(--ws-danger-soft);
  color: var(--ws-danger);
}
.pill--danger i {
  border-radius: 1px;
  background: var(--ws-danger);
}
.pill--success {
  background: var(--ws-success-soft);
  color: var(--ws-success);
}
.pill--success i {
  background: var(--ws-success);
}
</style>
