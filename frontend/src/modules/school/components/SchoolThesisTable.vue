<script setup lang="ts">
import StatusTag from '@/components/app/StatusTag.vue'
import type { DemoThesisSummary, SubmissionSource } from '@/demo/types'

defineProps<{ rows: DemoThesisSummary[] }>()
const emit = defineEmits<{ select: [id: string] }>()

const sourceLabels: Record<SubmissionSource, string> = {
  STUDENT: '学生自提',
  SCHOOL_MANUAL: '学校代传',
  SCHOOL_BATCH: '批量导入',
}

function responsibilityLabel(row: DemoThesisSummary) {
  if (row.submissionSource === 'STUDENT' && row.stage === 'DRAFT') return '等待学生修改'
  if (row.submissionSource !== 'STUDENT' && row.stage !== 'COMPLETED') return '学校可继续处理'
  return '按当前流程处理'
}
</script>

<template>
  <div class="school-table-wrap">
    <table class="school-table">
      <thead>
        <tr>
          <th>学生</th><th>论文</th><th>专业</th><th>来源</th><th>材料状态</th><th>处理责任</th><th>更新时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" @click="emit('select', row.id)">
          <td><strong>{{ row.studentName }}</strong><small>{{ row.studentId }}</small></td>
          <td><strong>{{ row.title }}</strong><small>{{ row.anonymousId }}</small></td>
          <td><code>{{ row.discipline.code }}</code><span>{{ row.discipline.name }}</span></td>
          <td><span class="source-label">{{ sourceLabels[row.submissionSource] }}</span></td>
          <td><StatusTag :status="row.stage" /></td>
          <td><span class="responsibility">{{ responsibilityLabel(row) }}</span></td>
          <td><time>{{ row.updatedAt }}</time></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.school-table-wrap { overflow-x: auto; border: 1px solid #dce3e9; background: white; }
.school-table { width: 100%; min-width: 62rem; border-collapse: collapse; font-size: 0.75rem; }
.school-table th { padding: 0.75rem; border-bottom: 1px solid #d8e0e6; background: #f4f6f8; color: #596773; text-align: left; }
.school-table td { padding: 0.8rem 0.75rem; border-bottom: 1px solid #e7ebee; color: #40505c; vertical-align: top; }
.school-table tr:last-child td { border-bottom: 0; }
.school-table strong, .school-table small, .school-table code, .school-table td > span:not(.source-label) { display: block; }
.school-table strong { max-width: 25rem; color: #263744; line-height: 1.45; }
.school-table small, .school-table time { color: #7b8791; font-family: var(--font-data); font-size: 0.6875rem; }
.school-table code { margin-bottom: 0.15rem; color: #1b4f8a; font-family: var(--font-data); font-weight: 700; }
.source-label { display: inline-flex; padding: 0.2rem 0.45rem; border: 1px solid #cbd8e3; border-radius: 999px; background: #eef4f9; white-space: nowrap; }
.responsibility { color:#53636f;font-size:.7rem;white-space:nowrap; }
</style>
