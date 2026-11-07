<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'

import StatusTag from '@/components/app/StatusTag.vue'
import type { StudentAction, StudentThesisDetail, SubmissionSource } from '@/demo/types'

defineProps<{ thesis: StudentThesisDetail }>()
const emit = defineEmits<{ close: []; action: [action: StudentAction] }>()
const drawer = ref<HTMLElement>()
const closeButton = ref<HTMLButtonElement>()

const sourceLabels: Record<SubmissionSource, string> = {
  STUDENT: '学生自提',
  SCHOOL_MANUAL: '学校代传',
  SCHOOL_BATCH: '学校批量导入',
}

function filePurposeLabel(purpose: StudentThesisDetail['files'][number]['purpose']) {
  return purpose === 'SCHOOL_ARCHIVE' ? '原始版' : '匿名版'
}

function fileSize(size: number) {
  if (size === 0) return '大小待校验'
  return `${(size / 1024 / 1024).toFixed(2)} MB`
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    drawer.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? focusable.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === focusable.length - 1
      ? 0
      : activeIndex + 1
  event.preventDefault()
  focusable[nextIndex]?.focus()
}

onMounted(() => {
  void nextTick(() => closeButton.value?.focus())
})
</script>

<template>
  <div class="drawer-backdrop" @click.self="emit('close')">
    <aside
      ref="drawer"
      class="thesis-drawer"
      data-thesis-detail-drawer
      :data-thesis-id="thesis.id"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thesis-detail-title"
      @keydown="handleKeydown"
    >
      <header>
        <div>
          <span>{{ thesis.anonymousId }} · {{ sourceLabels[thesis.submissionSource] }}</span>
          <h2 id="thesis-detail-title">{{ thesis.title || '未命名论文' }}</h2>
        </div>
        <button
          ref="closeButton"
          type="button"
          aria-label="关闭论文详情"
          data-action="close-detail"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <dl class="thesis-drawer__facts">
        <div>
          <dt>当前状态</dt>
          <dd><StatusTag :status="thesis.stage" /></dd>
        </div>
        <div>
          <dt>送审批次</dt>
          <dd>{{ thesis.batchName }}</dd>
        </div>
        <div>
          <dt>学科专业</dt>
          <dd>{{ thesis.discipline.code }} {{ thesis.discipline.name }}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd>{{ thesis.updatedAt }}</dd>
        </div>
      </dl>

      <section v-if="thesis.publicReason" class="thesis-drawer__reason">
        <h3>学校公开说明</h3>
        <p>{{ thesis.publicReason }}</p>
      </section>

      <section>
        <h3>材料文件</h3>
        <ul v-if="thesis.files.length" class="thesis-drawer__files">
          <li v-for="file in thesis.files" :key="file.id">
            <strong>{{ filePurposeLabel(file.purpose) }}</strong>
            <span>{{ file.name }}</span>
            <small>{{ fileSize(file.size) }} · {{ file.validationStatus }}</small>
          </li>
        </ul>
        <p v-else class="thesis-drawer__empty">暂无可展示的文件元数据。</p>
      </section>

      <section>
        <h3>公开时间线</h3>
        <ol v-if="thesis.timeline.length" class="thesis-drawer__timeline">
          <li v-for="event in [...thesis.timeline].reverse()" :key="event.id">
            <time>{{ event.occurredAt }}</time>
            <p>{{ event.message }}</p>
          </li>
        </ol>
        <p v-else class="thesis-drawer__empty">暂无公开流程记录。</p>
      </section>

      <footer>
        <button
          v-if="thesis.allowedActions.includes('EDIT_THESIS')"
          type="button"
          data-action="edit-thesis"
          @click="emit('action', 'EDIT_THESIS')"
        >
          继续编辑
        </button>
        <button
          v-if="thesis.allowedActions.includes('DELETE_DRAFT')"
          class="is-danger"
          type="button"
          data-action="delete-draft"
          @click="emit('action', 'DELETE_DRAFT')"
        >
          删除草稿
        </button>
        <button
          v-if="thesis.allowedActions.includes('WITHDRAW_BEFORE_DISPATCH')"
          type="button"
          data-action="withdraw-before-dispatch"
          @click="emit('action', 'WITHDRAW_BEFORE_DISPATCH')"
        >
          撤回至草稿
        </button>
        <button
          v-if="thesis.allowedActions.includes('REQUEST_WITHDRAWAL')"
          type="button"
          data-action="request-withdrawal"
          @click="emit('action', 'REQUEST_WITHDRAWAL')"
        >
          申请撤回
        </button>
        <button
          v-if="thesis.allowedActions.includes('VIEW_RESULT')"
          type="button"
          data-action="view-result"
          @click="emit('action', 'VIEW_RESULT')"
        >
          查看结果
        </button>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: flex;
  justify-content: end;
  background: color-mix(in srgb, var(--color-primary-active) 42%, transparent);
}

.thesis-drawer {
  display: grid;
  width: min(34rem, 100%);
  height: 100%;
  align-content: start;
  gap: 1.25rem;
  overflow-y: auto;
  padding: 1.25rem;
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.thesis-drawer > header {
  display: flex;
  gap: 1rem;
  align-items: start;
  justify-content: space-between;
  padding-bottom: 1rem;
  border-bottom: 2px solid var(--color-blind-rail);
}

.thesis-drawer header span,
.thesis-drawer time,
.thesis-drawer small {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.thesis-drawer h2,
.thesis-drawer h3 {
  font-family: var(--font-display);
}

.thesis-drawer h2 {
  margin: 0.25rem 0 0;
  font-size: 1.25rem;
}

.thesis-drawer h3 {
  margin: 0 0 0.625rem;
  font-size: 0.9375rem;
}

.thesis-drawer header button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 1.5rem;
}

.thesis-drawer__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.thesis-drawer__facts div {
  padding: 0.75rem;
  border: 1px solid var(--color-border);
}

.thesis-drawer dt {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.thesis-drawer dd {
  margin: 0.25rem 0 0;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.thesis-drawer__files,
.thesis-drawer__timeline {
  display: grid;
  gap: 0.5rem;
  padding: 0;
  margin: 0;
  list-style: none;
}

.thesis-drawer__files li,
.thesis-drawer__timeline li {
  display: grid;
  gap: 0.2rem;
  padding: 0.75rem;
  border-left: 3px solid var(--color-primary);
  background: var(--color-primary-50);
}

.thesis-drawer__files span,
.thesis-drawer__timeline p {
  overflow-wrap: anywhere;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
}

.thesis-drawer__timeline p,
.thesis-drawer__empty {
  margin: 0;
}

.thesis-drawer__reason {
  padding: 0.875rem;
  border-left: 3px solid var(--color-warning);
  background: var(--color-fill);
}

.thesis-drawer__reason p {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 0.8125rem;
  line-height: 1.65;
}

.thesis-drawer__empty {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
}

.thesis-drawer > footer {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.thesis-drawer footer button {
  min-height: 2.5rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  cursor: pointer;
}

.thesis-drawer footer button.is-danger {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

@media (max-width: 480px) {
  .thesis-drawer__facts {
    grid-template-columns: 1fr;
  }
}
</style>
