<script setup lang="ts">
import { computed } from 'vue'
import type { ExpertTaskSummary } from '@/demo/types'

const props = defineProps<{
  rows: ExpertTaskSummary[]
}>()

defineEmits<{
  accept: [task: ExpertTaskSummary]
  reject: [task: ExpertTaskSummary]
}>()

const statusLabels: Record<ExpertTaskSummary['status'], string> = {
  INVITED: '待接受',
  IN_REVIEW: '评阅中',
  SUBMITTED: '已完成',
  REJECTED: '已拒绝',
  ACCEPT_TIMEOUT: '已超时',
  CANCELLED: '已撤销',
}

/** 列表行动作：由服务端允许动作派生（页面不自行推断）。 */
function actionFor(task: ExpertTaskSummary): { kind: string; label: string; route: string } | null {
  const allowed = task.allowedActions ?? []
  if (allowed.includes('ACCEPT_TASK')) {
    return { kind: 'accept', label: '接受', route: '/expert/invitation' }
  }
  if (allowed.includes('CONTINUE_REVIEW')) {
    return { kind: 'continue', label: '继续评阅', route: '/expert/review' }
  }
  if (allowed.includes('VIEW_SUBMITTED')) {
    return { kind: 'view', label: '查看', route: '/expert/review' }
  }
  return null
}

const rows = computed(() => props.rows)
</script>

<template>
  <div class="task-table" data-expert-task-table>
    <header class="task-table__head">
      <span>状态</span>
      <span>匿名任务编号</span>
      <span>匿名题目</span>
      <span>送审方向</span>
      <span>接单截止</span>
      <span>评阅截止</span>
      <span>费用</span>
      <span>操作</span>
    </header>
    <article
      v-for="task in rows"
      :key="task.id"
      class="task-table__row"
      :data-expert-task="task.id"
      :data-overdue="task.overdue ? 'true' : 'false'"
    >
      <span class="task-table__status">
        <mark :data-status="task.status">{{ statusLabels[task.status] }}</mark>
        <mark v-if="task.overdue" class="task-table__overdue" data-overdue-tag>已逾期</mark>
        <mark v-if="task.correctionPending" class="task-table__correction" data-correction-tag>
          需要更正
        </mark>
      </span>
      <code>{{ task.anonymousId }}</code>
      <strong>{{ task.anonymousTitle }}</strong>
      <span>{{ task.discipline?.name ?? '—' }}</span>
      <time>{{ task.status === 'INVITED' && task.acceptBy ? task.acceptBy : '—' }}</time>
      <time>{{ task.status === 'INVITED' ? '—' : (task.dueAt || '—') }}</time>
      <b>¥ {{ Number(task.fee ?? 0).toFixed(2) }}</b>
      <span class="task-table__action">
        <button
          v-if="actionFor(task)?.kind === 'accept'"
          type="button"
          data-action="accept-task"
          @click="$emit('accept', task)"
        >
          {{ actionFor(task)?.label }}
        </button>
        <button
          v-else-if="actionFor(task)?.kind === 'reject'"
          type="button"
          data-action="reject-task"
          @click="$emit('reject', task)"
        >
          {{ actionFor(task)?.label }}
        </button>
        <RouterLink
          v-else-if="actionFor(task)"
          :to="{ path: actionFor(task)!.route, query: { task_id: task.id } }"
          :data-action="
            actionFor(task)!.kind === 'continue' ? 'continue-review' : 'view-submitted'
          "
        >
          {{ actionFor(task)?.label }}
        </RouterLink>
        <span v-else class="task-table__none">—</span>
      </span>
    </article>
    <p v-if="rows.length === 0" class="task-table__empty">当前分组暂无任务。</p>
  </div>
</template>

<style scoped>
.task-table {
  overflow-x: auto;
  border: 1px solid #d8e0e6;
  background: #fff;
}

.task-table__head,
.task-table__row {
  display: grid;
  grid-template-columns: 9.5rem 8.5rem minmax(14rem, 1fr) 9rem 9rem 9rem 6.5rem 6.5rem;
  gap: 0.8rem;
  align-items: center;
  min-width: 74rem;
  padding: 0.75rem 1rem;
}

.task-table__head {
  background: #f6f8fa;
  color: #687681;
  font-size: 0.65rem;
  font-weight: 650;
}

.task-table__row {
  border-top: 1px solid #e5eaee;
  color: #52626e;
  font-size: 0.7rem;
}

.task-table__row code,
.task-table__row b {
  font-family: var(--font-data);
}

.task-table__row code {
  color: #1b4f8a;
}

.task-table__row time {
  color: #7c8993;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.task-table__status {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.task-table__row mark {
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  background: #eef2f5;
  color: #53636f;
  font-size: 0.68rem;
  white-space: nowrap;
}

.task-table__row mark[data-status='INVITED'] {
  background: #eef5fc;
  color: #1b4f8a;
}

.task-table__row mark[data-status='IN_REVIEW'] {
  background: #fdf3df;
  color: #8a6114;
}

.task-table__row mark[data-status='SUBMITTED'] {
  background: #e5f2e7;
  color: #2e6b3b;
}

.task-table__row mark[data-status='REJECTED'],
.task-table__row mark[data-status='CANCELLED'] {
  background: #f3f4f5;
  color: #7c8993;
}

.task-table__row .task-table__overdue {
  background: #fbeaea;
  color: #b03232;
}

.task-table__row .task-table__correction {
  background: #f3e8fd;
  color: #6b3fa0;
}

.task-table__action {
  display: flex;
  justify-content: flex-start;
}

.task-table__action button {
  padding: 0.35rem 0.7rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.3rem;
  background: #1b4f8a;
  color: #fff;
  font-weight: 650;
  cursor: pointer;
}

.task-table__action a {
  color: #1b4f8a;
  font-weight: 650;
  text-decoration: none;
}

.task-table__action .task-table__none {
  color: #a8b3bc;
}

.task-table__empty {
  margin: 0;
  padding: 1rem;
  border-top: 1px solid #e5eaee;
  color: #7c8993;
  font-size: 0.72rem;
}

@media (max-width: 900px) {
  .task-table__head {
    display: none;
  }

  .task-table__row {
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem 0.9rem;
    min-width: 0;
    padding: 0.9rem 1rem;
  }

  .task-table__row code {
    grid-column: 1 / -1;
  }

  .task-table__row > span:nth-of-type(4) {
    display: none;
  }

  .task-table__action {
    justify-content: flex-end;
  }
}
</style>
