<script setup lang="ts">
import WorkflowSteps from '@/components/app/WorkflowSteps.vue'
import type { StudentVisibleStage } from '@/demo/types'

defineProps<{ current: Exclude<StudentVisibleStage, 'TERMINATED'> }>()

const steps = [
  { key: 'MATERIALS', label: '材料准备', description: '填写信息与材料' },
  { key: 'SCHOOL_REVIEW', label: '学校审核', description: '核验材料与匿名版' },
  { key: 'EXPERT_REVIEW', label: '送审评阅', description: '等待匿名专家评阅' },
  { key: 'RESULT_PROCESSING', label: '结果处理', description: '学校核对并发布' },
  { key: 'COMPLETED', label: '已完成', description: '查看评审意见' },
]
</script>

<template>
  <div :data-student-stage="current">
    <WorkflowSteps :steps="steps" :current="current" />
  </div>
</template>
