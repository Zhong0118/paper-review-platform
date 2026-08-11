<script setup lang="ts">
export interface WorkflowStep {
  key: string
  label: string
  description?: string
}

defineProps<{
  steps: WorkflowStep[]
  current: string
}>()
</script>

<template>
  <ol class="workflow" aria-label="流程进度">
    <li
      v-for="(step, index) in steps"
      :key="step.key"
      class="workflow__step"
      :class="{
        'workflow__step--current': step.key === current,
        'workflow__step--complete': steps.findIndex((item) => item.key === current) > index,
      }"
      :aria-current="step.key === current ? 'step' : undefined"
    >
      <span class="workflow__index">{{ String(index + 1).padStart(2, '0') }}</span>
      <span>
        <strong>{{ step.label }}</strong>
        <small v-if="step.description">{{ step.description }}</small>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.workflow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  padding: 0;
  margin: 0;
  list-style: none;
  border: 1px solid #dce3e9;
  background: #fff;
}

.workflow__step {
  display: flex;
  min-height: 4.5rem;
  gap: 0.625rem;
  align-items: center;
  padding: 0.75rem;
  border-right: 1px solid #e6ebef;
  color: #77838e;
}

.workflow__step:last-child {
  border-right: 0;
}

.workflow__index {
  font-family: var(--font-data);
  font-size: 0.75rem;
}

.workflow__step strong,
.workflow__step small {
  display: block;
}

.workflow__step small {
  margin-top: 0.125rem;
  font-size: 0.6875rem;
}

.workflow__step--complete {
  color: #2e7d32;
  background: #f7fbf7;
}

.workflow__step--current {
  box-shadow: inset 0 -3px #1b4f8a;
  color: #123d6b;
  background: #f4f8fc;
}
</style>
