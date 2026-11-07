<script setup lang="ts">
import type { OperationsQueue } from '@/demo/types'

defineProps<{
  queues: { key: OperationsQueue; label: string; count: number }[]
  active: OperationsQueue
}>()
const emit = defineEmits<{ 'update:active': [queue: OperationsQueue] }>()
</script>

<template>
  <nav class="operations-queues" aria-label="送审运营队列">
    <button
      v-for="queue in queues"
      :key="queue.key"
      type="button"
      :data-operations-queue="queue.key"
      :class="{ active: queue.key === active }"
      :aria-pressed="queue.key === active"
      @click="emit('update:active', queue.key)"
    >
      <span>{{ queue.label }}</span>
      <b>{{ queue.count }}</b>
    </button>
  </nav>
</template>

<style scoped>
.operations-queues {
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  border: 1px solid #d8e0e6;
  background: #fff;
}
.operations-queues button {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 0;
  border-right: 1px solid #e2e7eb;
  background: #fff;
  color: #5b6a76;
  font-size: 0.7rem;
  cursor: pointer;
}
.operations-queues button:last-child {
  border-right: 0;
}
.operations-queues button.active {
  box-shadow: inset 0 -3px var(--color-primary);
  background: var(--color-primary-50);
  color: #123d6b;
}
.operations-queues b {
  font-family: var(--font-data);
  font-size: 0.78rem;
}
@media (max-width: 1000px) {
  .operations-queues {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .operations-queues button {
    border-bottom: 1px solid #e2e7eb;
  }
}
@media (max-width: 640px) {
  .operations-queues {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
