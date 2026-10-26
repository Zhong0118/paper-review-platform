<script setup lang="ts">
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { computed, nextTick, onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { acceptTask, listExpertTasks } from '@/api/expertTasks'
import type { ExpertTaskSummary } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import ExpertTaskTable from '../components/ExpertTaskTable.vue'
import ExpertDemoScenarioController from '@/modules/expert-management/components/ExpertDemoScenarioController.vue'

const router = useRouter()
const authStore = useAuthStore()
const timeScope = useTimeScope()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const demoDialogOpen = ref(false)

const tabs: Array<{ value: string; label: string; matcher: (t: ExpertTaskSummary) => boolean }> = [
  {
    value: 'INVITED',
    label: '待接受',
    matcher: (t) => t.status === 'INVITED',
  },
  {
    value: 'IN_REVIEW',
    label: '评阅中',
    matcher: (t) => t.status === 'IN_REVIEW',
  },
  {
    value: 'SUBMITTED',
    label: '已完成',
    matcher: (t) => t.status === 'SUBMITTED',
  },
  {
    value: 'REJECTED',
    label: '已拒绝',
    matcher: (t) => t.status === 'REJECTED',
  },
  {
    value: 'CANCELLED',
    label: '已撤销',
    matcher: (t) => t.status === 'CANCELLED',
  },
  {
    value: 'CORRECTION_PENDING',
    label: '需要更正',
    matcher: (t) => t.correctionPending === true,
  },
]

const tasks = ref<ExpertTaskSummary[]>([])
const loading = ref(true)
const activeTab = ref('INVITED')
const error = ref('')

// 接单确认对话框状态
const acceptTarget = ref<ExpertTaskSummary | null>(null)
const acceptPending = ref(false)
const acceptDialog = ref<HTMLElement | null>(null)
const acceptDialogOpener = ref<HTMLElement | null>(null)
const acceptError = ref('')

const visibleTasks = computed(() =>
  tasks.value.filter((t) => tabs.find((tab) => tab.value === activeTab.value)?.matcher(t)),
)

const tabCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const tab of tabs) {
    counts.set(tab.value, tasks.value.filter(tab.matcher).length)
  }
  return counts
})

let listGeneration = 0
async function loadTasks() {
  const request = ++listGeneration
  loading.value = true; error.value = ''; tasks.value = []
  try {
    const loaded = demoEnabled && service
      ? await service.listExpertTasks({ own: true })
      : (await listExpertTasks(...timeScope.request())).map((row) => ({
          id: row.id,
          status: row.status,
          anonymousId: row.anonymous_id ?? row.id.slice(0, 8),
          anonymousTitle: row.anonymous_title ?? '匿名论文',
          discipline: { code: row.discipline_code ?? '', name: row.discipline_name ?? '' },
          fee: 0,
          dueAt: '',
          overdue: false,
          allowedActions: row.allowed_actions ?? (row.status === 'INVITED' ? ['ACCEPT_TASK'] : []),
        })) as ExpertTaskSummary[]
    if (request !== listGeneration) return
    tasks.value = loaded
    // 默认停留在第一个非空分组，避免空 Tab 白屏
    activeTab.value =
      tabs.find((tab) => tasks.value.some(tab.matcher))?.value ?? tabs[0].value
  } catch (err) {
    if (request !== listGeneration) return
    error.value = err instanceof Error ? err.message : '任务列表加载失败。'
  } finally {
    if (request === listGeneration) loading.value = false
  }
}

onMounted(loadTasks)

function selectTab(value: string) {
  activeTab.value = value
}

async function requestAccept(task: ExpertTaskSummary) {
  acceptTarget.value = task
  acceptError.value = ''
  if (document.activeElement instanceof HTMLElement) {
    acceptDialogOpener.value = document.activeElement
  }
  await nextTick()
  acceptDialog.value?.querySelector<HTMLElement>('[data-action="confirm-accept-task"]')?.focus()
}

async function cancelAccept() {
  if (acceptPending.value) return
  acceptTarget.value = null
  acceptError.value = ''
  await nextTick()
  acceptDialogOpener.value?.focus()
  acceptDialogOpener.value = null
}

function handleAcceptKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelAccept()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    acceptDialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select, textarea, input',
    ) ?? [],
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

async function confirmAccept() {
  const target = acceptTarget.value
  if (!target || acceptPending.value) return
  acceptPending.value = true
  acceptError.value = ''
  try {
    if (!demoEnabled) {
      await acceptTask(target.id)
      acceptTarget.value = null
      await router.push({ path: '/expert/review', query: { task_id: target.id } })
      return
    }
    if (service) await service.acceptExpertTask(target.id)
    acceptTarget.value = null
    await router.push({ path: '/expert/review', query: { task_id: target.id } })
  } catch (err) {
    acceptError.value = err instanceof Error ? err.message : '接受任务失败，请稍后重试。'
    acceptPending.value = false
  }
}
watch([timeScope.scope, timeScope.identity], () => { if (!demoEnabled && useAuthStore().user) void loadTasks() })
onBeforeUnmount(() => { listGeneration++ })
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('expert', demoEnabled)"
    active-path="/expert/tasks"
    context-label="专家端 · 双盲评阅"
    :user-name="useAuthStore().user?.displayName ?? '周明远教授'"
    :background-locked="Boolean(acceptTarget) || demoDialogOpen"
  >
    <div class="tasks-page">
      <ExpertDemoScenarioController
        :enabled="demoEnabled"
        @changed="loadTasks"
        @reset-dialog-change="demoDialogOpen = $event"
      />
      <PageHeader
        eyebrow="PAGE-008 · EXPERT TASKS"
        title="评审任务"
        :description="demoEnabled ? '仅展示本人任务。接单前仅见匿名概要、截止时间、费用与评审说明；接受后才能查看匿名论文材料。' : '仅展示本人任务。接单前仅见匿名概要与评审说明；接受后才能查看匿名论文材料。'"
      />
      <TimeScopeSelect v-if="!demoEnabled" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <BlindRail
        audience="匿名论文概要与本人任务"
        hidden-from="学生姓名、学号、导师、学校原始论文和其他专家意见"
        stage="待接受"
      />

      <nav class="task-tabs" aria-label="任务分组">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          class="task-tabs__tab"
          :class="{ 'is-active': activeTab === tab.value }"
          :data-tab="tab.value"
          :aria-current="activeTab === tab.value ? 'page' : undefined"
          @click="selectTab(tab.value)"
        >
          {{ tab.label }}<span data-tab-count>{{ tabCounts.get(tab.value) ?? 0 }}</span>
        </button>
      </nav>

      <p v-if="error" class="tasks-page__error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="tasks-page__loading">正在加载任务…</p>
      <ExpertTaskTable :preference-identity="demoEnabled ? null : authStore.user" v-else :rows="visibleTasks" :show-fee="demoEnabled" @accept="requestAccept" />
    </div>

    <template #modal>
      <div v-if="acceptTarget" class="dialog-backdrop">
        <section
          ref="acceptDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-dialog-title"
          @keydown="handleAcceptKeydown"
        >
          <h2 id="accept-dialog-title">确认接受评审任务？</h2>
          <p>
            接受后视同同意双盲评阅约定与回避声明：仅可见匿名版论文材料，不得向任何第三方披露评审内容，也不得联系论文作者。
          </p>
          <p>
            任务 <strong>{{ acceptTarget.anonymousId }}</strong> ·
            评阅截止 <time>{{ acceptTarget.dueAt || '未设置' }}</time>
            <template v-if="demoEnabled"> · 费用 <strong>¥ {{ acceptTarget.fee.toFixed(2) }}</strong></template>
          </p>
          <p v-if="acceptError" class="action-dialog__error" role="alert">{{ acceptError }}</p>
          <footer>
            <button
              type="button"
              data-action="cancel-accept"
              :disabled="acceptPending"
              @click="cancelAccept"
            >
              取消
            </button>
            <button
              type="button"
              data-action="confirm-accept-task"
              :disabled="acceptPending"
              @click="confirmAccept"
            >
              {{ acceptPending ? '正在接受…' : '确认接受并进入评阅' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.tasks-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.tasks-page__error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.tasks-page__loading {
  margin: 0;
  padding: 0.6rem 0.75rem;
  color: #7c8993;
  font-size: 0.72rem;
}

.task-tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
}

.task-tabs__tab {
  display: inline-flex;
  flex-shrink: 0;
  gap: 0.4rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border: 1px solid #cfd8df;
  border-radius: 0.3rem;
  background: #fff;
  color: #586874;
  font-size: 0.7rem;
  cursor: pointer;
}

.task-tabs__tab span {
  min-width: 1.15rem;
  padding: 0.05rem 0.3rem;
  border-radius: 0.9rem;
  background: #eef2f5;
  color: #687681;
  font-family: var(--font-data);
  font-size: 0.62rem;
}

.task-tabs__tab.is-active {
  border-color: #1b4f8a;
  background: #e8f0f9;
  color: #123d6b;
  font-weight: 650;
}

.task-tabs__tab.is-active span {
  background: #1b4f8a;
  color: #fff;
}

.dialog-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, #0d2b47 50%, transparent);
}

.action-dialog {
  display: grid;
  width: min(30rem, 100%);
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: 0 0.5rem 2rem rgb(13 43 71 / 35%);
}

.action-dialog h2,
.action-dialog p {
  margin: 0;
}

.action-dialog h2 {
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p {
  color: #4b5966;
  font-size: 0.78rem;
  line-height: 1.65;
}

.action-dialog__error {
  color: #b03232 !important;
}

.action-dialog footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.action-dialog button {
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  background: #fff;
  color: #3a4a58;
  font-weight: 650;
  cursor: pointer;
}

.action-dialog button[data-action='confirm-accept-task'] {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}

.action-dialog button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}
</style>
