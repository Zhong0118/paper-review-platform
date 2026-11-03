<script setup lang="ts">
import ExtensionPanel from '../components/ExtensionPanel.vue'
import { deadlineLabel } from "@/api/taskTiming"
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { useOperationsDashboard } from '@/composables/useOperationsDashboard'
import type { StatusFilter } from '@/api/dashboard'
import TaskProgressSummary from '@/modules/school/components/TaskProgressSummary.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch, onBeforeUnmount } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { DispatchCandidate } from '@/api/dispatch'
import { assignExpert, candidateUnavailableReason, dispatchCandidates, dispatchQueue, reassignExpert } from '@/api/dispatch'
import type { DispatchThesisSeed, ExpertTaskSummary, OperationsQueue } from '@/demo/types'
import { isDueSoon } from '@/modules/expert-management/services/platformOperationService'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import CandidateExpertTable, { type ExpertCandidate } from '../components/CandidateExpertTable.vue'
import DispatchDetailPanel from '../components/DispatchDetailPanel.vue'
import FeeRuleSnapshot from '../components/FeeRuleSnapshot.vue'
import OperationsQueueTable from '../components/OperationsQueueTable.vue'
import PlatformDemoScenarioController from '../components/PlatformDemoScenarioController.vue'
import type { ExpertMatchCandidate } from '@/demo/types'

type ConfirmationKind = 'ASSIGN' | 'REASSIGN' | 'REMIND' | 'EXTEND'

const timeScope = useTimeScope()
const dashboard = useOperationsDashboard(true, timeScope)
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const authStore = useAuthStore()
const demoDialogOpen = ref(false)

const queues = ref<{ key: OperationsQueue; label: string; count: number }[]>([])
const activeQueue = ref<OperationsQueue>('PENDING_ASSIGNMENT')
const dispatchTheses = ref<DispatchThesisSeed[]>([])
const selectedThesisId = ref('')
const matches = ref<ExpertMatchCandidate[]>([])
const candidateDetails = ref<Record<string, DispatchCandidate>>({})
const reassignableTasks = ref<Record<string, { id: string; expert_id: string }>>({})
const showExtensions=ref(false)
const clockLabels = ref<Record<string,string>>({})
const selectedReplacement = computed(() => reassignableTasks.value[selectedThesisId.value])
const canReassign = computed(() => !demoEnabled && Boolean(selectedReplacement.value) && !loading.value && !candidatesLoading.value && !actionPending.value && selectedExpertIds.value.length === 1 && matches.value.some(row => row.id === selectedExpertIds.value[0] && !row.conflictHit && (candidateDetails.value[row.id]?.allowed_actions?.includes('REASSIGN_EXPERT') ?? true)))
const selectedExpertIds = ref<string[]>([])
const assigned = ref(false)
const actionPending = ref(false)
const feedback = ref('')
const listError = ref('')
const actionError = ref('')
const loading = ref(true)
let candidateRequest = 0
const candidatesLoading = ref(false)
const candidateResultReady = ref(false)
/** 移动端断点（≤900px）：候选专家列表切换为卡片视图，与专家库/任务列表一致。 */
const isMobile = ref(false)

const selectedThesis = computed(
  () => dispatchTheses.value.find((thesis) => thesis.id === selectedThesisId.value) ?? null,
)

const queueLabels: Record<OperationsQueue, string> = {
  PENDING_ASSIGNMENT: '待匹配',
  PENDING_ACCEPTANCE: '专家待接受',
  IN_REVIEW: '评阅中',
  DUE_SOON: '即将逾期',
  OVERDUE: '已逾期',
  PENDING_REASSIGNMENT: '已拒绝待改派',
  PENDING_SUPPLEMENT: '邀请超时',
  CORRECTION_PENDING: '更正处理中',
  SETTLEMENT_PENDING: '待结算',
  COMPLETED: '已完成',
}

const queueOrder: OperationsQueue[] = [
  'PENDING_ASSIGNMENT',
  'PENDING_ACCEPTANCE',
  'IN_REVIEW',
  'DUE_SOON',
  'OVERDUE',
  'PENDING_REASSIGNMENT',
  'PENDING_SUPPLEMENT',
  'CORRECTION_PENDING',
  'SETTLEMENT_PENDING',
  'COMPLETED',
]

function matchRow(
  candidate: ExpertMatchCandidate,
): 'eligible' | 'conflicted' | 'secondary' {
  if (candidate.conflictHit) return 'conflicted'
  return candidate.activeTasks >= 3 ? 'secondary' : 'eligible'
}

function aliasFor(candidateId: string) {
  const index = matches.value.findIndex((candidate) => candidate.id === candidateId)
  return index >= 0 ? `E-${String(index + 1).padStart(3, '0')}` : candidateId
}

function candidateRows(): ExpertCandidate[] {
  return matches.value.map((candidate) => ({
    id: candidate.id,
    rowType: matchRow(candidate),
    alias: aliasFor(candidate.id),
    name: candidate.name,
    unit: candidate.unit,
    title: candidate.title,
    discipline: { ...candidate.discipline },
    fields: [...candidate.fields],
    keywordHits: [...candidate.keywordHits],
    conflictHit: candidate.conflictHit,
    conflictReason: candidate.conflictReason,
    activeTasks: candidate.activeTasks,
    acceptanceRate: candidate.acceptanceRate,
    onTimeRate: candidate.onTimeRate,
    avgCompletionDays: candidate.avgCompletionDays,
    feeStandard: candidate.feeStandard,
    matchReason: candidate.matchReason,
    ...(!demoEnabled ? { workload: candidateDetails.value[candidate.id]?.workload, matchScore: candidateDetails.value[candidate.id]?.match_score,
      matchReasons: candidateDetails.value[candidate.id]?.match_reasons,
      matchRuleVersion: candidateDetails.value[candidate.id]?.match_rule_version,
      exclusionReasons: candidateDetails.value[candidate.id]?.unavailable_reasons } : {}),
  }))
}

const canAssign = computed(() => {
  const thesis = selectedThesis.value
  return (
    thesis !== null &&
    thesis.status === 'PENDING_DISPATCH' &&
    selectedExpertIds.value.length > 0 &&
    !assigned.value &&
    !actionPending.value &&
    (demoEnabled || (!loading.value && !candidatesLoading.value && selectedExpertIds.value.every(id => matches.value.some(row => row.id === id && !row.conflictHit && (candidateDetails.value[id]?.allowed_actions?.includes('ASSIGN_EXPERT') ?? true)))))
  )
})

const selectedExpert = computed(() =>
  matches.value.find((candidate) => candidate.id === selectedExpertIds.value[0]),
)

const rejectedTasks = computed(() =>
  tasks.value.filter((task) => task.status === 'REJECTED'),
)

const tasks = ref<ExpertTaskSummary[]>([])

const isBusyQueue = computed(() =>
  ['PENDING_ACCEPTANCE', 'IN_REVIEW', 'DUE_SOON', 'OVERDUE'].includes(activeQueue.value),
)

const activeQueueTasks = computed(() => {
  switch (activeQueue.value) {
    case 'PENDING_ACCEPTANCE':
      return tasks.value.filter((task) => task.status === 'INVITED')
    case 'IN_REVIEW':
      // 评阅中：非逾期、非临期（临期与逾期任务各自进入专属队列，避免重复展示）
      return tasks.value.filter(
        (task) => task.status === 'IN_REVIEW' && !task.overdue && !isDueSoon(task),
      )
    case 'DUE_SOON':
      // 临期：评阅中且 ≤3 天内到期（与平台队列计数同一判定）
      return tasks.value.filter(
        (task) => task.status === 'IN_REVIEW' && !task.overdue && isDueSoon(task),
      )
    case 'OVERDUE':
      // 逾期：overdue 是时限布尔属性，不是独立状态
      return tasks.value.filter((task) => task.status === 'IN_REVIEW' && task.overdue)
    case 'PENDING_REASSIGNMENT':
      return rejectedTasks.value
    default:
      return []
  }
})

function queueToThesisStatus(queue: OperationsQueue): DispatchThesisSeed['status'] | null {
  if (queue === 'PENDING_ASSIGNMENT') return 'PENDING_DISPATCH'
  if (queue === 'COMPLETED') return 'COMPLETED'
  return null
}

async function refreshQueueCounts() {
  if (!service) return
  const counts = await service.listOperationsQueues()
  queues.value = queueOrder.map((key) => ({ key, label: queueLabels[key], count: counts[key] }))
}

async function refreshDispatchTheses() {
  if (!service) return
  dispatchTheses.value = await service.listDispatchTheses()
  if (
    selectedThesisId.value &&
    !dispatchTheses.value.some((thesis) => thesis.id === selectedThesisId.value)
  ) {
    selectedThesisId.value = ''
  }
}

async function refreshTasks() {
  if (!service) return
  tasks.value = await service.listExpertTasks()
}

const filterLabels = { ALL: '派单队列', WAITING: '待派论文', INVITED: '邀请中任务', IN_REVIEW: '评阅中任务', SUBMITTED: '已提交任务' }
let listGeneration = 0
async function loadWorkbench(refreshMetrics = true) {
  const request = ++listGeneration
  loading.value = true
  listError.value = ''
  feedback.value = ''
  actionError.value = ''
  try {
    if (!demoEnabled) {
      if (refreshMetrics) void dashboard.load()
      dashboard.resetList()
      dispatchTheses.value = []
      ++candidateRequest
      candidateResultReady.value = false
      selectedExpertIds.value = []
      matches.value = []
      candidateDetails.value = {}
      assigned.value = false
      clockLabels.value={}
      reassignableTasks.value = {}
      const [scope, report] = timeScope.request()
      let listAsOf = ''
      const queue = await dispatchQueue(scope, meta => { report(meta); listAsOf = meta.asOf }, dashboard.status.value)
      if (request !== listGeneration) return
      dashboard.receiveList(['ALL', 'WAITING'].includes(dashboard.status.value) ? queue.length : queue.reduce((n, row) => n + (row.tasks?.length ?? 0), 0), listAsOf)
      clockLabels.value=Object.fromEntries(queue.map(item=>[item.thesis_id,(item.tasks??[]).map(t=>deadlineLabel(t.status,t.deadline)).filter(Boolean).join(' · ')]))
      reassignableTasks.value = Object.fromEntries(queue.filter(item => item.allowed_actions.includes('REASSIGN_EXPERT') && item.reassignable_task).map(item => [item.thesis_id, item.reassignable_task!]))
      dispatchTheses.value = queue.map((item) => ({
        id: item.thesis_id,
        title: item.title,
        studentName: item.student_name,
        status: item.allowed_actions.includes('ASSIGN_EXPERT') ? 'PENDING_DISPATCH' : item.stage === 'COMPLETED' || item.stage === 'RESULT_PROCESSING' ? 'COMPLETED' : 'IN_REVIEW',
        discipline: { code: item.discipline_code, name: item.discipline_code },
      })) as unknown as DispatchThesisSeed[]
      queues.value = [
        {
          key: 'PENDING_ASSIGNMENT',
          label: '待匹配',
          count: queue.filter((item) => item.allowed_actions.includes('ASSIGN_EXPERT')).length,
        },
      ]
      selectedThesisId.value = dispatchTheses.value.find(item => item.status === 'PENDING_DISPATCH')?.id ?? Object.keys(reassignableTasks.value)[0] ?? ''
      if (selectedThesisId.value) await selectThesis(selectedThesisId.value, true)
      return
    }
    if (!service) return
    await Promise.all([refreshQueueCounts(), refreshDispatchTheses(), refreshTasks()])
    if (
      selectedThesisId.value &&
      !dispatchTheses.value.some((thesis) => thesis.id === selectedThesisId.value)
    ) {
      selectedThesisId.value = ''
    }
    if (!selectedThesisId.value) {
      const pending = dispatchTheses.value.find(
        (thesis) => thesis.status === 'PENDING_DISPATCH',
      )
      const withRejectedTask = dispatchTheses.value.find((thesis) =>
        tasks.value.some(
          (task) => task.thesisId === thesis.id && task.status === 'REJECTED',
        ),
      )
      selectedThesisId.value = pending?.id ?? withRejectedTask?.id ?? ''
    }
    if (selectedThesisId.value) await selectThesis(selectedThesisId.value, true)
  } catch (error) {
    if (request !== listGeneration) return
    listError.value = error instanceof Error ? error.message : '加载失败，请重试。'
  } finally {
    if (request === listGeneration) loading.value = false
  }
}

async function selectThesis(thesisId: string, silent = false) {
  selectedThesisId.value = thesisId
  selectedExpertIds.value = []
  if (!silent) assigned.value = false
  matches.value = []
  candidateDetails.value = {}
  candidateResultReady.value = false
  const request = ++candidateRequest
  if (!thesisId) { candidatesLoading.value = false; return }
  if (!demoEnabled) {
    candidatesLoading.value = true
    actionError.value = ''
    try {
      const rows = await dispatchCandidates(thesisId)
      if (request !== candidateRequest) return
      candidateDetails.value = Object.fromEntries(rows.map(row => [row.expert_id,row]))
      matches.value = rows.map((row) => ({
        id: row.expert_id,
        name: row.display_name || row.username || '',
        unit: row.unit ?? '',
        title: row.title ?? '',
        discipline: { code: row.discipline_codes[0] ?? '', name: row.discipline_codes.join(',') },
        fields: row.research_directions ?? [],
        keywordHits: row.match_reasons?.filter(hit => hit.kind === 'keyword').map(hit => hit.tag) ?? [],
        conflictHit: Boolean(candidateUnavailableReason(row)) || row.expert_id === reassignableTasks.value[thesisId]?.expert_id,
        conflictReason: candidateUnavailableReason(row) || (row.expert_id === reassignableTasks.value[thesisId]?.expert_id ? '当前任务专家' : ''),
        activeTasks: 0,
        acceptanceRate: '—',
        onTimeRate: '—',
        avgCompletionDays: 0,
        feeStandard: 0,
        matchReason: candidateUnavailableReason(row) || (row.allowed_actions?.includes('REASSIGN_EXPERT') ? '可改派' : '可派'),
      })) as unknown as ExpertMatchCandidate[]
      refreshRows()
      candidateResultReady.value = true
    } catch (error) {
      if (request === candidateRequest) actionError.value = error instanceof Error ? error.message : '候选专家加载失败'
    } finally {
      if (request === candidateRequest) candidatesLoading.value = false
    }
    return
  }
  if (!service) return
  matches.value = (await service.listExpertMatches(thesisId)).map((candidate) => candidate)
  refreshRows()
}

function refreshRows() {
  candidateRows()
}

const confirmation = ref<{ kind: ConfirmationKind; taskId: string | null } | null>(null)
const reassignExpertId = ref('')
const reason = ref('')
const extendDays = ref(7)
const confirmDialog = ref<HTMLElement>()
const overlayOpener = ref<HTMLElement | null>(null)
const workbenchRoot = ref<HTMLElement>()

function rememberOverlayOpener() {
  if (document.activeElement instanceof HTMLElement) {
    overlayOpener.value = document.activeElement
  }
}

async function restoreOverlayOpener() {
  await nextTick()
  await nextTick()
  const target = overlayOpener.value?.isConnected
    ? overlayOpener.value
    : workbenchRoot.value?.querySelector<HTMLElement>('[data-thesis-row]')
  target?.focus()
  overlayOpener.value = null
}

async function openConfirmation(kind: ConfirmationKind, taskId: string | null) {
  if (actionPending.value) return
  rememberOverlayOpener()
  reassignExpertId.value = !demoEnabled && kind === 'REASSIGN' ? selectedExpertIds.value[0] ?? '' : ''
  reason.value = kind === 'REASSIGN' ? '' : ''
  extendDays.value = 7
  confirmation.value = { kind, taskId }
  await nextTick()
  confirmDialog.value?.querySelector<HTMLButtonElement>('[data-action="cancel-confirmation"]')?.focus()
}

async function closeConfirmation(force = false) {
  if (actionPending.value && !force) return
  confirmation.value = null
  if (!force) {
    reassignExpertId.value = ''
    reason.value = ''
  }
  await restoreOverlayOpener()
}

function handleConfirmationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeConfirmation()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    confirmDialog.value?.querySelectorAll<HTMLElement>('select, input, textarea, button:not(:disabled)') ??
      [],
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

async function confirmAction() {
  const current = confirmation.value
  if (!current || actionPending.value) return
  if (current.kind === 'REASSIGN' && (!reassignExpertId.value || (demoEnabled && !reason.value.trim()))) return
  actionPending.value = true
  feedback.value = ''
  try {
    let message = ''
    if (current.kind === 'ASSIGN') {
      const thesis = selectedThesis.value
      const expertId = selectedExpertIds.value[0]
      if (!thesis || !expertId) return
      if (!demoEnabled) {
        await assignExpert(thesis.id, expertId, { idempotencyKey: crypto.randomUUID() }, candidateDetails.value[expertId]?.candidate_version)
      } else if (service) {
        await service.assignExpertToThesis(thesis.id, expertId)
      }
      assigned.value = true
      message = '已生成 1 个评审任务，论文进入「专家待接受」队列。'
    } else if (current.kind === 'REASSIGN' && current.taskId && !demoEnabled) {
      await reassignExpert(current.taskId, reassignExpertId.value, { idempotencyKey: crypto.randomUUID() }, candidateDetails.value[reassignExpertId.value]?.candidate_version)
      message = '已取消旧任务并邀请替代专家，历史记录保留。'
    } else if (current.kind === 'REASSIGN' && current.taskId && service) {
      await service.reassignExpertTask(
        current.taskId,
        reassignExpertId.value,
        reason.value.trim(),
      )
      message = `已改派（原因：${reason.value.trim()}），新任务等待专家接单。`
    } else if (current.kind === 'REMIND' && current.taskId && service) {
      await service.remindExpertTask(current.taskId)
      message = '已发送催审提醒（演示投影）。'
    } else if (current.kind === 'EXTEND' && current.taskId && service) {
      await service.extendExpertTask(current.taskId, extendDays.value)
      message = `已延期 ${extendDays.value} 天。`
    }
    await loadWorkbench()
    // loadWorkbench 会清空反馈，成功消息在重载之后写入。
    feedback.value = message
    await closeConfirmation(true)
  } catch (error) {
    await closeConfirmation(true)
    actionError.value =
      error instanceof Error ? `${error.message}，本次操作未执行。` : '操作未完成，请重试。'
    if (!demoEnabled && (error as { response?: { status?: number } })?.response?.status === 409) {
      await loadWorkbench()
      actionError.value = '专家档案或论文状态已变化 候选已刷新 请重新选择并确认'
    } else if (error instanceof Error && 'code' in error && String((error as { code: unknown }).code) === 'STATE_CONFLICT') {
      await loadWorkbench()
      feedback.value = '论文状态已更新，本次操作未执行。'
    } else {
      feedback.value = ''
    }
  } finally {
    actionPending.value = false
    if (!confirmation.value) await restoreOverlayOpener()
  }
}

function queueThesisRows() {
  return dispatchTheses.value.filter(
    (thesis) => thesis.status === queueToThesisStatus(activeQueue.value),
  )
}

onMounted(() => {
  updateMobileFlag()
  window.addEventListener('resize', updateMobileFlag)
  void loadWorkbench()
})

function updateMobileFlag() {
  isMobile.value = (typeof window !== 'undefined' ? window.innerWidth : 0) <= 900
}

onUnmounted(() => {
  ++candidateRequest
  window.removeEventListener('resize', updateMobileFlag)
})
watch([timeScope.scope, timeScope.identity], () => { if (!demoEnabled && authStore.user) void loadWorkbench() })
function showStatus(status: StatusFilter) {
  if (status === dashboard.status.value) void loadWorkbench(false)
  else void dashboard.drill(status)
}
watch(dashboard.status, () => { if (!demoEnabled) void loadWorkbench(false) })
onBeforeUnmount(() => { listGeneration++; candidateRequest++ })
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('platform_reviewer', demoEnabled)"
    active-path="/platform/dispatch"
    context-label="平台端 · 派审运营"
    :user-name="authStore.user?.displayName ?? '陈岚'"
    :background-locked="Boolean(confirmation) || demoDialogOpen"
  >
    <div ref="workbenchRoot" class="dispatch-page">
      <PlatformDemoScenarioController
        :enabled="demoEnabled"
        @changed="loadWorkbench()"
        @reset-dialog-change="demoDialogOpen = $event"
      />
      <PageHeader
        eyebrow="PAGE-007 · REVIEW OPERATIONS"
        title="送审运营台"
        :description="demoEnabled ? '按运营队列管理待派单、接单、评阅、逾期、改派与补审；候选排序可解释，最终由运营人工确认。' : '按论文创建范围核对待派、邀请、评阅和提交数量 点击卡片查看对应列表'"
      />
      <TimeScopeSelect v-if="!demoEnabled" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <BlindRail
        audience="平台运营可见学生、导师与专家身份及匹配依据"
        hidden-from="仅访问匿名论文，不提供原始版；身份不得外泄给学校或专家"
        stage="送审全程运营"
      />
      <p v-if="listError" role="alert" class="dispatch-page__error">{{ listError }}</p>
      <p v-if="actionError" role="alert" class="dispatch-page__error">{{ actionError }}</p>
      <p v-if="feedback" role="status" class="dispatch-page__feedback">{{ feedback }}</p>

      <div v-if="!demoEnabled"><button type="button" :aria-expanded="showExtensions" @click="showExtensions=!showExtensions">评阅延期审批</button>
        <Transition name="timing-panel"><ExtensionPanel v-if="showExtensions" @changed="loadWorkbench()" /></Transition></div>
      <TaskProgressSummary v-if="!demoEnabled" live :data="dashboard.data.value" :loading="dashboard.loading.value" :error="dashboard.error.value" @filter="showStatus" @retry="dashboard.load" />
      <div v-if="!demoEnabled" class="live-filter">
        <strong>{{ filterLabels[dashboard.status.value] }}</strong>
        <button type="button" @click="showStatus('ALL')">查看派单队列</button>
        <button type="button" @click="loadWorkbench()">刷新</button>
        <p v-if="dashboard.listCount.value !== null" role="status">{{ dashboard.changed.value ? '数据已更新 · ' : '' }}当前 {{ dashboard.listCount.value }} {{ ['ALL', 'WAITING'].includes(dashboard.status.value) ? '篇论文' : '个任务' }} <small v-if="dashboard.listAsOf.value">· 列表更新于 {{ new Date(dashboard.listAsOf.value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }} 北京时间</small></p>
        <p v-if="loading" role="status">正在加载任务列表…</p>
        <button v-if="listError" type="button" @click="loadWorkbench(false)">重试列表</button>
      </div>
      <OperationsQueueTable v-if="demoEnabled" v-model:active="activeQueue" :queues="queues" />

      <section v-if="demoEnabled || (!loading && !listError)" class="queue-panel" :data-queue-panel="activeQueue" aria-label="队列内容">
        <template v-if="!demoEnabled && dashboard.status.value === 'SUBMITTED'">
          <h2>已提交任务</h2><p>仅展示任务状态 正式评语和评分由学校核对</p>
          <article v-for="thesis in dispatchTheses" :key="thesis.id" data-submitted-task>{{ thesis.title }} · 已提交</article>
          <p v-if="!dispatchTheses.length">当前范围暂无已提交任务</p>
        </template>
        <template v-else-if="activeQueue === 'PENDING_ASSIGNMENT'">
          <div class="queue-panel__split">
            <div>
              <header class="queue-panel__header">
                <h2>待派列表</h2>
                <small>选择论文查看候选专家；单专家评审，一次只能指派 1 位。</small>
              </header>
              <ul class="dispatch-list">
                <li v-for="thesis in queueThesisRows()" :key="thesis.id" :data-thesis-row="thesis.id">
                  <button
                    type="button"
                    :data-thesis-id="thesis.id"
                    :class="{ active: thesis.id === selectedThesisId }"
                    @click="selectThesis(thesis.id)"
                  >
                    <strong>{{ thesis.anonymousId }}</strong>
                    <span>{{ thesis.title }}</span>
                    <small>{{ thesis.discipline.name }} · {{ thesis.tenantName }}</small>
                  </button>
                </li>
                <li v-if="queueThesisRows().length === 0" class="dispatch-list__empty">
                  待派列表为空：没有等待指派的论文。
                </li>
              </ul>
            </div>
            <div v-if="!demoEnabled && Object.keys(reassignableTasks).length">
              <h3>待接单 / 评阅中（可改派）</h3>
              <button v-for="thesis in dispatchTheses.filter(row => reassignableTasks[row.id])" :key="thesis.id"
                type="button" :data-thesis-id="thesis.id" @click="selectThesis(thesis.id)">{{ thesis.title }} {{ clockLabels[thesis.id] }}</button>
            </div>
            <DispatchDetailPanel :thesis="selectedThesis" />
          </div>

          <div class="dispatch-grid">
            <section class="candidate-section">
              <header>
                <div>
                  <span>MATCHED CANDIDATES</span>
                  <h2>候选专家</h2>
                </div>
                <small>回避命中项已自动禁选，无法强制跳过</small>
              </header>
              <CandidateExpertTable :preference-identity="demoEnabled ? null : authStore.user"
                v-if="selectedThesisId"
                v-model="selectedExpertIds"
                :rows="candidateRows()"
                :mobile="isMobile"
                :show-demo-metrics="demoEnabled"
                :show-ranking="!demoEnabled"
                :result-ready="candidateResultReady"
              />
              <p v-else class="candidate-section__empty">请先选择一篇待派论文。</p>
            </section>
            <FeeRuleSnapshot v-if="demoEnabled" amount="300.00" currency="¥" version="FEE-2026-SPRING-v1" settlement="专家提交有效终审意见后进入学校人工结算清单" />
          </div>

          <footer class="dispatch-footer">
            <p v-if="!selectedThesis" role="status">请先选择一篇待派论文。</p>
            <p v-else role="status">
              已选 {{ selectedExpertIds.length }} 位专家；{{ demoEnabled ? '演示批次' : '试点规则' }}固定为单专家，只能选择 1 位。
            </p>
            <button
              type="button"
              data-action="assign-experts"
              :disabled="!canAssign"
              @click="openConfirmation('ASSIGN', null)"
            >
              {{ actionPending ? '正在指派…' : assigned ? '已指派（只读）' : '指派选中专家' }}
            </button>
            <button v-if="selectedReplacement && !demoEnabled" type="button" data-action="reassign-selected" :disabled="!canReassign"
              @click="openConfirmation('REASSIGN', selectedReplacement.id)">改派给选中专家</button>
          </footer>
        </template>

        <template v-else-if="isBusyQueue">
          <header class="queue-panel__header">
            <h2>{{ queueLabels[activeQueue] }}</h2>
            <small>展示当前评阅中任务的进度；催审与延期会写入运营审计。</small>
          </header>
          <ul class="task-list">
            <li
              v-for="task in activeQueueTasks"
              :key="task.id"
              class="task-row"
              :data-task-id="task.id"
              :data-overdue="task.overdue ? 'true' : 'false'"
            >
              <div class="task-row__main">
                <strong>{{ task.anonymousId }}</strong>
                <span>{{ task.anonymousTitle }}</span>
                <small>评阅截止 {{ task.dueAt }}<template v-if="demoEnabled"> · 费用 ¥ {{ task.fee.toFixed(2) }}</template></small>
              </div>
              <div class="task-row__actions">
                <button
                  type="button"
                  data-action="remind-task"
                  @click="openConfirmation('REMIND', task.id)"
                >
                  催审
                </button>
                <button
                  type="button"
                  data-action="extend-task"
                  @click="openConfirmation('EXTEND', task.id)"
                >
                  延期
                </button>
              </div>
            </li>
            <li v-if="activeQueueTasks.length === 0" class="dispatch-list__empty">
              当前队列为空。
            </li>
          </ul>
        </template>

        <template v-else-if="activeQueue === 'PENDING_REASSIGNMENT'">
          <header class="queue-panel__header">
            <h2>已拒绝待改派</h2>
            <small>专家已拒绝接单；选择替代专家并填写原因后重新指派（原任务关闭，保留历史）。</small>
          </header>
          <ul class="task-list">
            <li
              v-for="task in rejectedTasks"
              :key="task.id"
              class="task-row"
              :data-task-id="task.id"
            >
              <div class="task-row__main">
                <strong>{{ task.anonymousId }}</strong>
                <span>{{ task.anonymousTitle }}</span>
                <small>原任务已拒绝<template v-if="demoEnabled"> · 费用 ¥ {{ task.fee.toFixed(2) }}</template></small>
              </div>
              <button
                type="button"
                data-action="reassign-task"
                @click="openConfirmation('REASSIGN', task.id)"
              >
                改派
              </button>
            </li>
            <li v-if="rejectedTasks.length === 0" class="dispatch-list__empty">
              当前队列为空。
            </li>
          </ul>
        </template>

        <template v-else>
          <header class="queue-panel__header">
            <h2>{{ queueLabels[activeQueue] }}</h2>
            <small>该队列由论文与任务状态投影生成；演示数据为本地快照。</small>
          </header>
          <ul class="dispatch-list">
            <li v-for="thesis in queueThesisRows()" :key="thesis.id" :data-thesis-id="thesis.id">
              <div class="dispatch-list__plain">
                <strong>{{ thesis.anonymousId }}</strong>
                <span>{{ thesis.title }}</span>
                <small>{{ thesis.discipline.name }} · {{ thesis.tenantName }} · 第 {{ thesis.round }} 轮</small>
              </div>
            </li>
            <li v-if="queueThesisRows().length === 0" class="dispatch-list__empty">
              当前队列为空。
            </li>
          </ul>
        </template>
      </section>
    </div>

    <template #modal>
      <div v-if="confirmation" class="dialog-backdrop">
          <section
            ref="confirmDialog"
            class="action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-dialog-title"
            @keydown="handleConfirmationKeydown"
          >
            <h2 id="action-dialog-title">
              {{
                confirmation.kind === 'ASSIGN'
                  ? '确认指派选中专家？'
                  : confirmation.kind === 'REASSIGN'
                    ? '确认改派？'
                    : confirmation.kind === 'REMIND'
                      ? '确认催审？'
                      : '确认延期？'
              }}
            </h2>
            <template v-if="confirmation.kind === 'ASSIGN'">
              <p>
                指派后论文进入「专家待接受」队列；同一论文只保留 1 个当前有效任务，无法重复指派。
              </p>
              <dl class="action-dialog__facts">
                <div>
                  <dt>论文</dt>
                  <dd>{{ selectedThesis?.anonymousId }} · {{ selectedThesis?.title }}</dd>
                </div>
                <div>
                  <dt>专家</dt>
                  <dd>{{ selectedExpert?.name }}（{{ selectedExpert?.unit }} · {{ selectedExpert?.title }}）</dd>
                </div>
                <div>
                  <dt>费用</dt>
                  <dd>{{ demoEnabled ? '¥ 300.00（固化于本批次规则）' : '未启用' }}</dd>
                </div>
              </dl>
            </template>
            <template v-else-if="confirmation.kind === 'REASSIGN'">
              <p>改派将关闭原任务（CANCELLED）并在同一轮次新建任务，历史记录保留。</p>
              <p v-if="!demoEnabled">替代专家：{{ selectedExpert?.name }}</p>
              <label v-if="demoEnabled">
                <span>替代专家（必选）</span>
                <select v-model="reassignExpertId" name="reassignExpertId">
                  <option value="" disabled>请选择替代专家</option>
                  <option v-for="candidate in matches" :key="candidate.id" :value="candidate.id" :disabled="!candidate.selectable">
                    {{ candidate.name }}（{{ candidate.unit }} · {{ candidate.title }}）{{ candidate.selectable ? '' : ' · 不可指派' }}
                  </option>
                </select>
              </label>
              <label v-if="demoEnabled">
                <span>改派原因（必填）</span>
                <textarea
                  v-model="reason"
                  name="reassignReason"
                  rows="3"
                  placeholder="如：原专家出差无法接单"
                />
              </label>
            </template>
            <template v-else-if="confirmation.kind === 'REMIND'">
              <p>将向专家发送催审提醒（演示投影，不模拟真实通知发送）。</p>
            </template>
            <template v-else>
              <label>
                <span>延期天数（1–30）</span>
                <input v-model.number="extendDays" type="number" min="1" max="30" name="extendDays" />
              </label>
              <p>延期后评阅截止时间顺延，并写入运营审计。</p>
            </template>
            <footer>
              <button
                type="button"
                data-action="cancel-confirmation"
                @click="() => closeConfirmation()"
              >
                取消
              </button>
              <button
                type="button"
                :data-action="
                  confirmation.kind === 'ASSIGN'
                    ? 'confirm-assign'
                    : confirmation.kind === 'REASSIGN'
                      ? 'confirm-reassign'
                      : confirmation.kind === 'REMIND'
                        ? 'confirm-remind'
                        : 'confirm-extend'
                "
                :disabled="
                  actionPending ||
                  (confirmation.kind === 'REASSIGN' && (!reassignExpertId || (demoEnabled && !reason.trim())))
                "
                @click="confirmAction"
              >
                {{ actionPending ? '正在提交…' : '确认' }}
              </button>
            </footer>
          </section>
        </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.timing-panel-enter-active,.timing-panel-leave-active{transition:opacity .18s,transform .18s}.timing-panel-enter-from,.timing-panel-leave-to{opacity:0;transform:translateY(3px)}

.live-filter { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; padding: .9rem 1rem; border: 1px solid #dce3e9; background: white; }
.live-filter > strong { margin-right: auto; color: #263744; }
.live-filter > p { flex-basis: 100%; margin: .2rem 0 0; color: #687682; font-size: .75rem; }
.live-filter button { padding: .45rem .75rem; border: 1px solid #cbd7e2; border-radius: .25rem; background: #f7fafc; color: #1b4f8a; cursor: pointer; transition: background .15s, transform .15s; }
.live-filter button:hover { background: #eaf2fa; transform: translateY(-1px); }
.live-filter button:active { transform: scale(.98); }
.queue-panel > h2 { margin: 1rem 1rem .5rem; color: #263744; font-size: 1rem; }
.queue-panel > p { margin: .5rem 1rem 1rem; color: #687682; font-size: .8rem; }
[data-submitted-task] { padding: 1rem; border-top: 1px solid #e3e8ec; color: #334b60; font-size: .85rem; animation: row-appear .18s ease; }
@keyframes row-appear { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { [data-submitted-task] { animation: none; } .live-filter button { transition: none; } }

.dispatch-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}
.dispatch-page__error,
.dispatch-page__feedback {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
}
.dispatch-page__error {
  border: 1px solid #e5b6b6;
  background: #fceded;
  color: #9c2929;
}
.dispatch-page__feedback {
  border: 1px solid #bcd9bf;
  background: #edf7ee;
  color: #27672d;
}
.queue-panel {
  display: grid;
  min-width: 0;
  gap: 1rem;
}
.queue-panel__split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.queue-panel__header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}
.queue-panel__header h2 {
  margin: 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 1rem;
}
.queue-panel__header small {
  color: #78848e;
  font-size: 0.68rem;
}
.dispatch-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dispatch-list li > button {
  display: grid;
  width: 100%;
  gap: 0.2rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid #d8e0e6;
  border-radius: var(--radius-sm);
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.dispatch-list li > button:hover {
  border-color: var(--color-primary);
}
.dispatch-list li > button.active {
  border-color: var(--color-primary);
  background: var(--color-primary-50);
}
.dispatch-list strong {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.72rem;
}
.dispatch-list span {
  color: #32434f;
  font-size: 0.76rem;
}
.dispatch-list small {
  color: #89939b;
  font-size: 0.65rem;
}
.dispatch-list__plain {
  display: grid;
  gap: 0.2rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid #d8e0e6;
  border-radius: var(--radius-sm);
  background: #fff;
}
.dispatch-list__empty {
  padding: 1.25rem 0.85rem;
  border: 1px dashed #d3dbe2;
  border-radius: var(--radius-sm);
  background: #fbfcfd;
  color: #89939b;
  font-size: 0.72rem;
  text-align: center;
}
.task-list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid #d8e0e6;
  border-radius: var(--radius-sm);
  background: #fff;
}
.task-row[data-overdue='true'] {
  border-color: #e5b6b6;
  background: #fdf5f5;
}
.task-row__main {
  display: grid;
  gap: 0.2rem;
}
.task-row__main strong {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.72rem;
}
.task-row__main span {
  color: #32434f;
  font-size: 0.76rem;
}
.task-row__main small {
  color: #89939b;
  font-size: 0.65rem;
}
.task-row__actions {
  display: flex;
  flex: none;
  gap: 0.5rem;
}
.task-row button,
.task-row__actions button {
  min-height: 2.1rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.3rem;
  background: #fff;
  color: #1b4f8a;
  font-weight: 650;
  cursor: pointer;
}
.dispatch-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 19rem;
  gap: 1rem;
  align-items: start;
}
.candidate-section {
  min-width: 0;
}
.candidate-section > header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 0.55rem;
}
.candidate-section header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
}
.candidate-section h2 {
  margin: 0.15rem 0 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 1rem;
}
.candidate-section small {
  color: #78848e;
  font-size: 0.68rem;
}
.candidate-section__empty {
  margin: 0;
  padding: 1.5rem 0;
  border: 1px dashed #d3dbe2;
  border-radius: var(--radius-sm);
  background: #fbfcfd;
  color: #89939b;
  font-size: 0.72rem;
  text-align: center;
}
.dispatch-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid #cfd9e1;
  background: rgb(255 255 255 / 0.96);
  box-shadow: 0 -0.5rem 1.5rem rgb(31 55 76 / 0.06);
}
.dispatch-footer p {
  margin: 0;
  color: #586874;
  font-size: 0.72rem;
}
.dispatch-footer button {
  min-height: 2.5rem;
  padding: 0.45rem 0.8rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.35rem;
  background: #1b4f8a;
  color: white;
  font-weight: 650;
  cursor: pointer;
}
.dispatch-footer button:disabled {
  border-color: #c5ced6;
  background: #dde3e8;
  color: #7e8992;
  cursor: not-allowed;
}
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgb(15 30 45 / 0.45);
}
.action-dialog {
  width: min(30rem, 100%);
  max-height: min(38rem, calc(100vh - 2rem));
  overflow-y: auto;
  padding: 1.15rem 1.25rem;
  border-radius: var(--radius-lg);
  background: #fff;
  box-shadow: var(--shadow-md);
}
.action-dialog h2 {
  margin: 0 0 0.6rem;
  color: #263744;
  font-family: var(--font-display);
  font-size: 1rem;
}
.action-dialog p {
  margin: 0 0 0.8rem;
  color: #586874;
  font-size: 0.72rem;
  line-height: 1.6;
}
.action-dialog__facts {
  display: grid;
  gap: 0.45rem;
  margin: 0 0 0.9rem;
  padding: 0.75rem;
  border: 1px solid #e2e7eb;
  border-radius: var(--radius-sm);
  background: #f8fafb;
}
.action-dialog__facts div {
  display: grid;
  grid-template-columns: 4rem 1fr;
  gap: 0.5rem;
}
.action-dialog__facts dt {
  color: #78848e;
  font-size: 0.7rem;
}
.action-dialog__facts dd {
  margin: 0;
  color: #3e4e5a;
  font-size: 0.72rem;
}
.action-dialog label {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.7rem;
  color: #5b6a76;
  font-size: 0.72rem;
}
.action-dialog select,
.action-dialog textarea,
.action-dialog input[type='number'] {
  min-height: 2.3rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid #cbd8e3;
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
}
.action-dialog textarea {
  resize: vertical;
}
.action-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  margin-top: 0.8rem;
}
.action-dialog footer button {
  min-height: 2.4rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid #c5ced6;
  border-radius: var(--radius-sm);
  background: #fff;
  color: #4b5966;
  font-weight: 650;
  cursor: pointer;
}
.action-dialog footer button:last-child {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #fff;
}
.action-dialog footer button:disabled {
  border-color: #c5ced6;
  background: #dde3e8;
  color: #7e8992;
  cursor: not-allowed;
}
@media (max-width: 1000px) {
  .queue-panel__split,
  .dispatch-grid {
    grid-template-columns: 1fr;
  }
}
</style>
