<script setup lang="ts">
import ColumnPreferences from '@/components/app/ColumnPreferences.vue'
import { useColumnPreferences, type ColumnIdentity } from '@/composables/useColumnPreferences'
import StatusTag from '@/components/app/StatusTag.vue'
import type { DemoThesisSummary, SubmissionSource } from '@/demo/types'

const props = defineProps<{ rows: DemoThesisSummary[]; preferenceIdentity?: ColumnIdentity | null }>()
const preferences = useColumnPreferences('school-theses', 1, () => [
  { id: 'student', label: '学生', required: false, defaultVisible: true },
  { id: 'thesis', label: '论文', required: true, defaultVisible: true },
  { id: 'discipline', label: '专业', required: false, defaultVisible: true },
  { id: 'source', label: '来源', required: false, defaultVisible: true },
  { id: 'stage', label: '材料状态', required: false, defaultVisible: true },
  { id: 'responsibility', label: '处理责任', required: false, defaultVisible: true },
  { id: 'updated', label: '更新时间', required: false, defaultVisible: true },
  ...(props.preferenceIdentity ? [{ id: 'actions', label: '操作', required: true, defaultVisible: true }] : []),
], () => props.preferenceIdentity ?? null)
const { visibleColumns } = preferences
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
  <ColumnPreferences v-if="preferenceIdentity" :preferences="preferences" label="学校论文" />
  <div class="school-table-wrap">
    <table class="school-table">
      <thead>
        <TransitionGroup name="table-columns" tag="tr">
          <th v-for="column in visibleColumns" :key="column.id" :data-column-header="column.id">{{ column.label }}</th>
        </TransitionGroup>
      </thead>
      <tbody>
        <TransitionGroup name="table-columns" tag="tr" v-for="row in rows" :key="row.id" @click="emit('select', row.id)">
          <td v-for="column in visibleColumns" :key="column.id" :data-column-cell="column.id">
            <template v-if="column.id === 'student'"><strong>{{ row.studentName }}</strong><small>{{ row.studentId }}</small></template>
            <template v-else-if="column.id === 'thesis'"><strong>{{ row.title }}</strong><small>{{ row.anonymousId }}</small></template>
            <template v-else-if="column.id === 'discipline'"><code>{{ row.discipline.code }}</code><span>{{ row.discipline.name }}</span></template>
            <span v-else-if="column.id === 'source'" class="source-label">{{ sourceLabels[row.submissionSource] }}</span>
            <StatusTag v-else-if="column.id === 'stage'" :status="row.stage" />
            <span v-else-if="column.id === 'responsibility'" class="responsibility">{{ responsibilityLabel(row) }}</span>
            <time v-else-if="column.id === 'updated'">{{ row.updatedAt }}</time>
            <button v-else-if="column.id === 'actions'" class="view-action" type="button" @click.stop="emit('select', row.id)">查看</button>
          </td>
        </TransitionGroup>
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
.view-action { border: 0; background: transparent; color: #1b4f8a; cursor: pointer; transition: transform .15s; }
.view-action:hover { transform: scale(1.04); }
.view-action:active { transform: scale(.97); }
.table-columns-enter-active, .table-columns-leave-active, .table-columns-move { transition: opacity .18s, transform .18s; }
.table-columns-enter-from, .table-columns-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .table-columns-enter-active, .table-columns-leave-active, .table-columns-move { transition: none; } }
</style>
