<script setup lang="ts">
import StatusTag from '@/components/app/StatusTag.vue'
import type {
  DemoAction,
  DemoThesisSummary,
  StudentThesisDetail,
  SubmissionSource,
} from '@/demo/types'

type ThesisRow = DemoThesisSummary | StudentThesisDetail

const props = defineProps<{ rows: ThesisRow[]; selectedThesisId?: string | null }>()
const emit = defineEmits<{
  action: [action: DemoAction, row: ThesisRow]
  detail: [row: ThesisRow]
  select: [id: string]
}>()

const sourceLabels: Record<SubmissionSource, string> = {
  STUDENT: '学生自提',
  SCHOOL_MANUAL: '学校代传',
  SCHOOL_BATCH: '学校批量导入',
}

function responsibilityLabel(row: DemoThesisSummary) {
  if (row.submissionSource === 'STUDENT' && row.stage === 'DRAFT') return '请修改后重新提交'
  if (row.submissionSource !== 'STUDENT' && row.stage !== 'COMPLETED') return '学校可继续处理'
  return '无需处理'
}

function selectRow(row: ThesisRow) {
  emit('select', row.id)
}

function emitAction(action: DemoAction, row: ThesisRow) {
  selectRow(row)
  emit('action', action, row)
}

function openRowDetail(row: ThesisRow) {
  selectRow(row)
  emit('detail', row)
}

function showContextAction(row: ThesisRow) {
  return !props.selectedThesisId || row.id === props.selectedThesisId
}
</script>

<template>
  <div class="thesis-table-wrap">
    <table class="thesis-table" role="grid">
      <thead>
        <tr>
          <th>论文</th>
          <th>批次</th>
          <th>专业代码 / 名称</th>
          <th>接入来源</th>
          <th>状态</th>
          <th>当前责任</th>
          <th>更新时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-thesis-id="row.id"
          :aria-selected="row.id === selectedThesisId"
          :class="{ 'is-selected': row.id === selectedThesisId }"
          tabindex="0"
          @click="selectRow(row)"
          @keydown.enter.prevent="selectRow(row)"
          @keydown.space.prevent="selectRow(row)"
        >
          <td data-label="论文">
            <strong>{{ row.title }}</strong>
            <small>{{ row.anonymousId }}</small>
          </td>
          <td data-label="批次">{{ row.batchName }}</td>
          <td data-label="专业代码 / 名称">
            <code>{{ row.discipline.code }}</code>
            <span>{{ row.discipline.name }}</span>
          </td>
          <td data-label="接入来源">
            <span class="source-badge" :data-source="row.submissionSource">
              {{ sourceLabels[row.submissionSource] }}
            </span>
          </td>
          <td data-label="状态"><StatusTag :status="row.stage" /></td>
          <td data-label="当前责任">
            <span class="responsibility">{{ responsibilityLabel(row) }}</span>
          </td>
          <td data-label="更新时间">
            <time>{{ row.updatedAt }}</time>
          </td>
          <td data-label="操作" class="thesis-table__actions">
            <button
              v-if="showContextAction(row) && row.allowedActions.includes('EDIT_THESIS')"
              type="button"
              data-action="edit-thesis"
              @click.stop="emitAction('EDIT_THESIS', row)"
            >
              编辑
            </button>
            <button
              v-if="showContextAction(row) && row.allowedActions.includes('VIEW_THESIS')"
              type="button"
              data-action="view-thesis"
              @click.stop="emitAction('VIEW_THESIS', row)"
            >
              查看
            </button>
            <button
              v-if="showContextAction(row) && row.allowedActions.includes('DELETE_DRAFT')"
              type="button"
              data-action="delete-draft"
              @click.stop="emitAction('DELETE_DRAFT', row)"
            >
              删除草稿
            </button>
            <button
              v-if="
                showContextAction(row) && row.allowedActions.includes('WITHDRAW_BEFORE_DISPATCH')
              "
              type="button"
              data-action="withdraw-before-dispatch"
              @click.stop="emitAction('WITHDRAW_BEFORE_DISPATCH', row)"
            >
              撤回
            </button>
            <button
              v-if="showContextAction(row) && row.allowedActions.includes('REQUEST_WITHDRAWAL')"
              type="button"
              data-action="request-withdrawal"
              @click.stop="emitAction('REQUEST_WITHDRAWAL', row)"
            >
              申请撤回
            </button>
            <button
              v-if="showContextAction(row) && row.allowedActions.includes('VIEW_RESULT')"
              type="button"
              data-action="view-result"
              @click.stop="emitAction('VIEW_RESULT', row)"
            >
              查看结果
            </button>
            <button type="button" data-action="open-detail" @click.stop="openRowDetail(row)">
              详情
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="rows.length === 0" class="thesis-table__empty">暂无论文记录</p>
  </div>
</template>

<style scoped>
.thesis-table-wrap {
  overflow: hidden;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.thesis-table {
  width: 100%;
  border-collapse: collapse;
  color: var(--color-text-primary);
  font-size: 0.75rem;
}

.thesis-table th {
  padding: 0.75rem;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-secondary);
  font-weight: 700;
  text-align: left;
  white-space: nowrap;
}

.thesis-table td {
  padding: 0.875rem 0.75rem;
  border-bottom: 1px solid var(--color-border);
  vertical-align: top;
}

.thesis-table tbody tr:last-child td {
  border-bottom: 0;
}

.thesis-table tbody tr {
  cursor: pointer;
}

.thesis-table tbody tr.is-selected {
  box-shadow: inset 3px 0 var(--color-primary);
  background: var(--color-primary-50);
}

.thesis-table td strong,
.thesis-table td small,
.thesis-table td code,
.thesis-table td > span:not(.source-badge) {
  display: block;
}

.thesis-table td strong {
  max-width: 24rem;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
  line-height: 1.55;
}

.thesis-table td small,
.thesis-table time {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.thesis-table td code {
  margin-bottom: 0.2rem;
  color: var(--color-primary);
  font-family: var(--font-data);
  font-weight: 700;
}

.source-badge {
  display: inline-flex;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-fill);
  white-space: nowrap;
}

.source-badge[data-source='SCHOOL_MANUAL'],
.source-badge[data-source='SCHOOL_BATCH'] {
  border-color: var(--color-primary);
  background: var(--color-primary-soft);
  color: var(--color-primary-active);
}

.responsibility {
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;
}

.thesis-table__actions button {
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
}

.thesis-table__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.thesis-table__empty {
  margin: 0;
  padding: 2rem;
  color: var(--color-text-secondary);
  text-align: center;
}

@media (max-width: 900px) {
  .thesis-table-wrap {
    overflow: visible;
    border: 0;
    background: transparent;
  }

  .thesis-table,
  .thesis-table tbody,
  .thesis-table tr,
  .thesis-table td {
    display: block;
  }

  .thesis-table thead {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    clip: rect(0 0 0 0);
  }

  .thesis-table tr {
    margin-bottom: 0.75rem;
    border: 1px solid var(--color-border);
    background: var(--color-bg);
  }

  .thesis-table td {
    display: grid;
    grid-template-columns: 7rem minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
  }

  .thesis-table td::before {
    color: var(--color-text-secondary);
    content: attr(data-label);
    font-size: 0.6875rem;
    font-weight: 650;
  }
}
</style>
