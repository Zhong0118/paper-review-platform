<script setup lang="ts">
/**
 * 统一数据区状态（规格 §10.3）：加载、空集合、筛选无匹配、失败、不可见、冲突、未配置。
 * 失败与冲突用 role=alert；其余为 status。不显示 0 或“暂无”冒充失败。
 */
export type BlockKind = 'loading' | 'empty' | 'nomatch' | 'error' | 'forbidden' | 'conflict' | 'unconfigured'
const props = defineProps<{ kind: BlockKind; title: string; compact?: boolean }>()
const alerting = props.kind === 'error' || props.kind === 'conflict'
</script>

<template>
  <div class="block" :class="[`block--${kind}`, { 'block--compact': compact }]" :role="alerting ? 'alert' : 'status'">
    <div v-if="kind === 'loading'" class="block__skeleton" aria-hidden="true"><i /><i /><i /></div>
    <p class="block__title">{{ title }}</p>
    <div v-if="$slots.default" class="block__body"><slot /></div>
    <div v-if="$slots.actions" class="block__actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.block {
  display: grid;
  gap: 8px;
  justify-items: start;
  padding: 32px 24px;
}
.block--compact {
  padding: 16px;
}
.block__title {
  font-size: 15px;
  font-weight: 600;
}
.block__body {
  max-width: 56ch;
  color: var(--ws-muted);
}
.block__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.block--error,
.block--conflict {
  border-left: 3px solid var(--ws-danger);
  background: var(--ws-danger-soft);
}
.block--error .block__body,
.block--conflict .block__body {
  color: var(--ws-text);
}
.block--unconfigured {
  border-left: 3px solid var(--ws-warning);
  background: var(--ws-warning-soft);
}
.block__skeleton {
  display: grid;
  width: min(520px, 100%);
  gap: 10px;
}
.block__skeleton i {
  height: 12px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--ws-sunken), var(--ws-page), var(--ws-sunken));
  background-size: 200% 100%;
  animation: shimmer 1.2s linear infinite;
}
.block__skeleton i:nth-child(2) {
  width: 80%;
}
.block__skeleton i:nth-child(3) {
  width: 60%;
}
@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
