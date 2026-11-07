<script setup lang="ts">
import type { StudentObjection, StudentObjectionStatus } from '@/demo/types'

defineProps<{ objection: StudentObjection }>()

const labels: Record<StudentObjectionStatus, string> = {
  SUBMITTED: '已提交',
  PROCESSING: '处理中',
  RESOLVED: '已办结',
}
</script>

<template>
  <section
    class="objection-timeline"
    :data-objection-status="objection.status"
    aria-labelledby="objection-status-title"
    tabindex="-1"
  >
    <header>
      <div>
        <span>OBJECTION STATUS</span>
        <h2 id="objection-status-title">异议处理时间线</h2>
      </div>
      <strong>{{ labels[objection.status] }}</strong>
    </header>
    <ol>
      <li class="is-complete">
        <b>已提交</b>
        <time>{{ objection.submittedAt }}</time>
      </li>
      <li :class="{ 'is-complete': ['PROCESSING', 'RESOLVED'].includes(objection.status) }">
        <b>处理中</b>
        <time>{{ objection.processingAt || '等待学校受理' }}</time>
      </li>
      <li :class="{ 'is-complete': objection.status === 'RESOLVED' }">
        <b>已办结</b>
        <time>{{ objection.resolvedAt || '等待处理结论' }}</time>
      </li>
    </ol>
    <div class="objection-timeline__summary">
      <p><b>异议理由：</b>{{ objection.reason }}</p>
      <p><b>处理诉求：</b>{{ objection.request }}</p>
      <p v-if="objection.publicResolution"><b>学校结论：</b>{{ objection.publicResolution }}</p>
    </div>
  </section>
</template>

<style scoped>
.objection-timeline {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.objection-timeline header {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.objection-timeline header span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.objection-timeline h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.objection-timeline header strong {
  color: var(--color-primary);
  font-size: 0.8125rem;
}

.objection-timeline ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 1rem;
  list-style: none;
}

.objection-timeline li {
  display: grid;
  gap: 0.25rem;
  padding-left: 0.75rem;
  border-left: 3px solid var(--color-border);
  color: var(--color-text-disabled);
}

.objection-timeline li.is-complete {
  border-left-color: var(--color-primary);
  color: var(--color-text-primary);
}

.objection-timeline time {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.objection-timeline__summary {
  padding: 0.875rem 1rem;
  border-top: 1px solid var(--color-border);
}

.objection-timeline__summary p {
  margin: 0.35rem 0;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

@media (max-width: 640px) {
  .objection-timeline ol {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
}
</style>
