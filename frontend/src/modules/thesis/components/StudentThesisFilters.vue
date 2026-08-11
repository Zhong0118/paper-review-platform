<script lang="ts">
export type StudentThesisFilter = 'ALL' | 'NEEDS_ACTION' | 'IN_REVIEW' | 'COMPLETED'
</script>

<script setup lang="ts">
defineProps<{
  modelValue: StudentThesisFilter
  search: string
  stats: { needsAction: number; inReview: number; completed: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: StudentThesisFilter]
  'update:search': [value: string]
}>()

const filters: Array<{ key: StudentThesisFilter; label: string; stat?: keyof typeof statNames }> = [
  { key: 'ALL', label: '全部论文' },
  { key: 'NEEDS_ACTION', label: '待我处理', stat: 'needsAction' },
  { key: 'IN_REVIEW', label: '送审中', stat: 'inReview' },
  { key: 'COMPLETED', label: '已完成', stat: 'completed' },
]

const statNames = {
  needsAction: 'needs-action',
  inReview: 'in-review',
  completed: 'completed',
} as const
</script>

<template>
  <section class="workspace-filters" aria-label="论文筛选与统计">
    <div class="workspace-filters__tabs" role="group" aria-label="按处理状态筛选">
      <button
        v-for="item in filters"
        :key="item.key"
        type="button"
        :class="{ 'is-active': modelValue === item.key }"
        :aria-pressed="modelValue === item.key"
        :data-filter="item.key"
        :data-stat="item.stat ? statNames[item.stat] : undefined"
        @click="emit('update:modelValue', item.key)"
      >
        <span>{{ item.label }}</span>
        <strong v-if="item.stat">{{ stats[item.stat] }}</strong>
      </button>
    </div>
    <label class="workspace-filters__search">
      <span>搜索论文</span>
      <input
        data-search-theses
        type="search"
        :value="search"
        placeholder="题目、盲审编号或专业"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </label>
  </section>
</template>

<style scoped>
.workspace-filters {
  display: flex;
  gap: 1rem;
  align-items: end;
  justify-content: space-between;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.workspace-filters__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.workspace-filters__tabs button {
  display: inline-flex;
  min-height: 2.5rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.workspace-filters__tabs button.is-active {
  border-color: var(--color-primary);
  background: var(--color-primary-50);
  color: var(--color-primary-active);
}

.workspace-filters__tabs strong {
  font-family: var(--font-data);
  font-size: 0.75rem;
}

.workspace-filters__search {
  display: grid;
  min-width: min(19rem, 100%);
  gap: 0.25rem;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.workspace-filters__search input {
  min-height: 2.5rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
}

@media (max-width: 640px) {
  .workspace-filters {
    align-items: stretch;
    flex-direction: column;
  }

  .workspace-filters__tabs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .workspace-filters__tabs button {
    justify-content: space-between;
  }
}
</style>
