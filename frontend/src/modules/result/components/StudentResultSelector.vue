<script setup lang="ts">
import type { StudentThesisDetail } from '@/demo/types'

defineProps<{ theses: StudentThesisDetail[]; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="result-selector">
    <span>选择本人论文</span>
    <select
      data-student-result-selector
      :value="modelValue"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="thesis in theses" :key="thesis.id" :value="thesis.id">
        {{ thesis.title || '未命名论文' }} · {{ thesis.anonymousId }}
      </option>
    </select>
  </label>
</template>

<style scoped>
.result-selector {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.result-selector span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
}

.result-selector select {
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border: 1px solid #b9c5ce;
  border-radius: var(--radius-sm);
  background: white;
  color: var(--color-text-primary);
  font: inherit;
}

@media (max-width: 640px) {
  .result-selector {
    grid-template-columns: 1fr;
  }
}
</style>
