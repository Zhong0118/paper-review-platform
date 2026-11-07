<script setup lang="ts">
import type { StudentThesisDetail } from '@/demo/types'

import ThesisStageRail from './ThesisStageRail.vue'

defineProps<{ thesis: StudentThesisDetail }>()

const stageLabels = {
  MATERIALS: '材料准备',
  SCHOOL_REVIEW: '学校审核',
  EXPERT_REVIEW: '送审评阅',
  RESULT_PROCESSING: '结果处理',
  COMPLETED: '已完成',
  TERMINATED: '流程已终止',
} as const
</script>

<template>
  <section
    class="student-progress"
    :data-selected-thesis="thesis.id"
    aria-labelledby="student-progress-title"
  >
    <header>
      <div>
        <span>CURRENT THESIS · {{ thesis.anonymousId }}</span>
        <h2 id="student-progress-title">{{ thesis.title || '未命名论文' }}</h2>
      </div>
      <strong>{{ stageLabels[thesis.studentVisibleStage] }}</strong>
    </header>
    <ThesisStageRail
      v-if="thesis.studentVisibleStage !== 'TERMINATED'"
      :current="thesis.studentVisibleStage"
    />
    <p v-else class="student-progress__terminated">
      {{ thesis.publicReason || '流程已终止，请联系学校了解公开原因。' }}
    </p>
  </section>
</template>

<style scoped>
.student-progress {
  display: grid;
  gap: 0.625rem;
}

.student-progress > header {
  display: flex;
  gap: 1rem;
  align-items: end;
  justify-content: space-between;
}

.student-progress header span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
}

.student-progress h2 {
  margin: 0.2rem 0 0;
  color: var(--color-text-primary);
  font-family: var(--font-display);
  font-size: 1rem;
}

.student-progress header strong {
  color: var(--color-primary-active);
  font-size: 0.8125rem;
}

.student-progress__terminated {
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--color-danger);
  background: var(--color-bg);
  color: var(--color-danger);
}

@media (max-width: 640px) {
  .student-progress > header {
    align-items: start;
    flex-direction: column;
  }
}
</style>
