<script setup lang="ts">
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { computed, nextTick, onMounted, ref, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useStudentPortalService } from '@/demo/serviceProvider'
import { createThesis as createThesisApi, deleteThesis, getThesis, listTheses, withdrawThesis } from '@/api/theses'
import { toStudentThesisDetail } from '@/api/adapters'
import { fetchEligibility } from '@/api/auth'
import type {
  DemoAction,
  StudentAction,
  StudentEligibility,
  StudentThesisDetail,
} from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import EligibilityCard from '../components/EligibilityCard.vue'
import StudentProgressTimeline from '../components/StudentProgressTimeline.vue'
import StudentDemoScenarioController from '../components/StudentDemoScenarioController.vue'
import StudentThesisDetailDrawer from '../components/StudentThesisDetailDrawer.vue'
import StudentThesisFilters, {
  type StudentThesisFilter,
} from '../components/StudentThesisFilters.vue'
import StudentThesisTable from '../components/StudentThesisTable.vue'

type ConfirmationAction = 'DELETE_DRAFT' | 'WITHDRAW_BEFORE_DISPATCH' | 'REQUEST_WITHDRAWAL'

const authStore = useAuthStore()
const timeScope = useTimeScope()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const router = useRouter()
const service = demoEnabled ? useStudentPortalService() : null
const theses = ref<StudentThesisDetail[]>([])
const eligibility = ref<StudentEligibility | null>(null)
const selectedThesisId = ref<string | null>(null)
const filter = ref<StudentThesisFilter>('ALL')
const search = ref('')
const loading = ref(true)
const listError = ref('')
const feedback = ref('')
const eligibilityReason = ref('')
const creating = ref(false)
const drawerOpen = ref(false)
const confirmationAction = ref<ConfirmationAction | null>(null)
const withdrawalReason = ref('')
const actionPending = ref(false)
const demoDialogOpen = ref(false)
const overlayOpener = ref<HTMLElement | null>(null)
const dashboardRoot = ref<HTMLElement>()
const confirmationDialog = ref<HTMLElement>()
const cancelConfirmation = ref<HTMLButtonElement>()

const selectedThesis = computed(
  () => theses.value.find((thesis) => thesis.id === selectedThesisId.value) ?? null,
)

function needsStudentAction(thesis: StudentThesisDetail) {
  return (
    thesis.allowedActions.includes('EDIT_THESIS') || thesis.allowedActions.includes('DELETE_DRAFT')
  )
}

function isInReview(thesis: StudentThesisDetail) {
  return ['SCHOOL_REVIEW', 'EXPERT_REVIEW', 'RESULT_PROCESSING'].includes(
    thesis.studentVisibleStage,
  )
}

const stats = computed(() => ({
  needsAction: theses.value.filter(needsStudentAction).length,
  inReview: theses.value.filter(isInReview).length,
  completed: theses.value.filter((thesis) => thesis.studentVisibleStage === 'COMPLETED').length,
}))

function matchesFilter(thesis: StudentThesisDetail, value: StudentThesisFilter) {
  if (value === 'NEEDS_ACTION') return needsStudentAction(thesis)
  if (value === 'IN_REVIEW') return isInReview(thesis)
  if (value === 'COMPLETED') return thesis.studentVisibleStage === 'COMPLETED'
  return true
}

function matchingTheses(value = filter.value, query = search.value) {
  const normalized = query.trim().toLocaleLowerCase()
  return theses.value.filter((thesis) => {
    if (!matchesFilter(thesis, value)) return false
    if (!normalized) return true
    return [thesis.title, thesis.anonymousId, thesis.discipline.code, thesis.discipline.name].some(
      (candidate) => candidate.toLocaleLowerCase().includes(normalized),
    )
  })
}

const filteredTheses = computed(() => matchingTheses())

function chooseInitialThesis() {
  const next = theses.value.find(needsStudentAction) ?? theses.value[0] ?? null
  selectedThesisId.value = next?.id ?? null
}

function keepSelectionVisible(candidates: StudentThesisDetail[]) {
  if (candidates.some((thesis) => thesis.id === selectedThesisId.value)) return
  selectedThesisId.value = candidates[0]?.id ?? null
  drawerOpen.value = false
}

function updateFilter(value: StudentThesisFilter) {
  filter.value = value
  keepSelectionVisible(matchingTheses(value, search.value))
}

function updateSearch(value: string) {
  search.value = value
  keepSelectionVisible(matchingTheses(filter.value, value))
}

function selectThesis(id: string) {
  selectedThesisId.value = id
  feedback.value = ''
}

let listGeneration = 0
async function loadWorkspaceData(preserveSelection = true) {
  const request = ++listGeneration
  loading.value = true
  listError.value = ''
  try {
    const [loadedEligibility, loaded] = await Promise.all([
      demoEnabled && service
        ? service.getStudentEligibility()
        : fetchEligibility().then((elig) => ({
            eligible: elig.eligible,
            status: (elig.status as StudentEligibility['status']) || 'ELIGIBLE',
            reason: elig.eligible ? '' : '当前没有有效送审资格',
            batchId: elig.batch_id,
            batchName: elig.batch_name,
            deadline: elig.deadline,
          })),
      demoEnabled && service
        ? service.listStudentTheses()
        : listTheses(...timeScope.request()).then((items) => items.map(toStudentThesisDetail)),
    ])
    if (request !== listGeneration) return
    eligibility.value = loadedEligibility
    eligibilityReason.value = loadedEligibility.eligible ? '' : loadedEligibility.reason
    theses.value = loaded
    if (!preserveSelection || !loaded.some((thesis) => thesis.id === selectedThesisId.value)) {
      chooseInitialThesis()
    }
  } catch {
    if (request !== listGeneration) return
    listError.value = '论文列表加载失败，请重新加载。'
  } finally {
    if (request === listGeneration) loading.value = false
  }
}

function replaceThesis(detail: StudentThesisDetail) {
  theses.value = theses.value.map((thesis) => (thesis.id === detail.id ? detail : thesis))
  selectedThesisId.value = detail.id
  keepSelectionVisible(matchingTheses())
}

async function refreshSelectedThesis() {
  if (!selectedThesisId.value) return
  if (demoEnabled && service) {
    replaceThesis(await service.getStudentThesis(selectedThesisId.value))
    return
  }
  replaceThesis(toStudentThesisDetail(await getThesis(selectedThesisId.value)))
}

async function refreshDemoProjection() {
  await loadWorkspaceData(true)
}

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return String(error.code)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

async function createThesis() {
  if (creating.value || eligibilityReason.value) return
  creating.value = true
  feedback.value = ''
  try {
    const created =
      demoEnabled && service
        ? await service.createStudentDraft()
        : toStudentThesisDetail(
            await createThesisApi({
              title: '未命名论文',
              abstract: '待补充摘要',
              discipline_code: '0812',
              discipline_name: '计算机科学与技术',
              keywords: ['盲审'],
            }),
          )
    await router.push({ path: '/student/thesis/edit', query: { thesisId: created.id } })
  } catch (error) {
    if (errorCode(error) === 'NOT_ELIGIBLE') eligibilityReason.value = errorMessage(error)
    else feedback.value = errorMessage(error)
  } finally {
    creating.value = false
  }
}

function rememberOverlayOpener() {
  if (document.activeElement instanceof HTMLElement) {
    overlayOpener.value = document.activeElement
  }
}

async function restoreOverlayOpener() {
  await nextTick()
  await nextTick()
  const selectedRow = selectedThesisId.value
    ? dashboardRoot.value?.querySelector<HTMLElement>(
        `[data-thesis-id="${selectedThesisId.value}"]`,
      )
    : undefined
  const target = overlayOpener.value?.isConnected
    ? overlayOpener.value
    : (selectedRow ??
      dashboardRoot.value?.querySelector<HTMLElement>('[data-action="create-thesis"]'))
  target?.focus()
  overlayOpener.value = null
}

function openDetail(row: { id: string }) {
  rememberOverlayOpener()
  selectThesis(row.id)
  drawerOpen.value = true
}

async function closeDrawer() {
  drawerOpen.value = false
  await restoreOverlayOpener()
}

async function openConfirmation(action: ConfirmationAction) {
  confirmationAction.value = action
  withdrawalReason.value = ''
  drawerOpen.value = false
  await nextTick()
  cancelConfirmation.value?.focus()
}

async function closeConfirmation() {
  if (actionPending.value) return
  confirmationAction.value = null
  withdrawalReason.value = ''
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
    confirmationDialog.value?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') ??
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
  const action = confirmationAction.value
  const thesisId = selectedThesisId.value
  if (!action || !thesisId || actionPending.value) return
  if (action !== 'DELETE_DRAFT' && !withdrawalReason.value.trim()) return
  actionPending.value = true
  feedback.value = ''
  try {
    if (action === 'DELETE_DRAFT') {
      if (demoEnabled && service) await service.deleteStudentDraft(thesisId)
      else await deleteThesis(thesisId)
      confirmationAction.value = null
      await loadWorkspaceData(false)
      keepSelectionVisible(matchingTheses())
      feedback.value = '草稿已删除。'
      return
    }

    const reason = withdrawalReason.value.trim()
    if (action === 'WITHDRAW_BEFORE_DISPATCH') {
      if (demoEnabled && service) {
        replaceThesis(await service.withdrawStudentThesis(thesisId, reason))
      } else {
        const selected = theses.value.find((item) => item.id === thesisId)
        const version = Number((selected as { version?: number } | undefined)?.version ?? 1)
        replaceThesis(toStudentThesisDetail(await withdrawThesis(thesisId, version, reason)))
      }
      feedback.value = '论文已撤回，可继续修改材料。'
    } else if (demoEnabled && service) {
      await service.requestStudentWithdrawal(thesisId, reason)
      await refreshSelectedThesis()
      feedback.value = '撤回申请已提交学校处理。'
    } else {
      feedback.value = '派单后撤回申请尚未接入真实接口。'
    }
    confirmationAction.value = null
    withdrawalReason.value = ''
  } catch (error) {
    confirmationAction.value = null
    if (errorCode(error) === 'STATE_CONFLICT') {
      await refreshSelectedThesis()
      feedback.value = '论文状态已更新，本次操作未执行。'
    } else {
      feedback.value = `${errorMessage(error)} 请重试。`
    }
  } finally {
    actionPending.value = false
    if (!confirmationAction.value) await restoreOverlayOpener()
  }
}

async function handleAction(action: DemoAction, row?: { id: string }) {
  if (row) {
    rememberOverlayOpener()
    selectThesis(row.id)
  }
  if (action === 'EDIT_THESIS' && selectedThesisId.value) {
    await router.push({ path: '/student/thesis/edit', query: { thesisId: selectedThesisId.value } })
  } else if (action === 'VIEW_RESULT' && selectedThesisId.value) {
    await router.push({ path: '/student/results', query: { thesisId: selectedThesisId.value } })
  } else if (action === 'VIEW_THESIS') {
    drawerOpen.value = true
  } else if (['DELETE_DRAFT', 'WITHDRAW_BEFORE_DISPATCH', 'REQUEST_WITHDRAWAL'].includes(action)) {
    await openConfirmation(action as ConfirmationAction)
  }
}

function handleDrawerAction(action: StudentAction) {
  void handleAction(action)
}

onMounted(() => void loadWorkspaceData(false))
watch([timeScope.scope, timeScope.identity], () => { if (!demoEnabled && authStore.user) { theses.value = []; selectedThesisId.value = null; void loadWorkspaceData(false) } })
onBeforeUnmount(() => { listGeneration++ })
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('student', demoEnabled)"
    active-path="/student/dashboard"
    :context-label="demoEnabled ? '学生端 · 海岳大学' : '学生端 · ' + (authStore.user?.tenantCode ?? '本校')"
    :user-name="authStore.user?.displayName ?? '林知远'"
    :background-locked="drawerOpen || Boolean(confirmationAction) || demoDialogOpen"
  >
    <div ref="dashboardRoot" class="student-dashboard">
      <PageHeader
        eyebrow="PAGE-002 · STUDENT DESK"
        title="我的论文"
        description="选择一篇论文，即可查看该论文的五阶段进度、公开时间线和当前可执行操作。"
      >
        <template #actions>
          <button
            class="primary-action"
            type="button"
            data-action="create-thesis"
            :disabled="creating || !eligibility?.eligible"
            @click="createThesis"
          >
            {{ creating ? '正在新建…' : '新建论文' }}
          </button>
        </template>
      </PageHeader>

      <TimeScopeSelect v-if="!demoEnabled" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <BlindRail
        audience="本人论文、公开流程和学校处理说明"
        hidden-from="评审专家身份、内部派单队列和账务信息"
        stage="学生五阶段"
      />

      <div class="student-dashboard__overview">
        <EligibilityCard
          :eligible="eligibility?.eligible ?? false"
          :batch-name="eligibility?.batchName ?? '资格信息加载中'"
          :deadline="eligibility?.deadline || '未设置'"
        />
        <article class="deadline-card">
          <span>当前批次说明</span>
          <strong>五阶段</strong>
          <p>材料提交后由学校审核；送审期间不公开专家身份。</p>
        </article>
      </div>
      <p v-if="eligibilityReason" class="eligibility-note" role="alert">
        {{ eligibilityReason }}
      </p>

      <p v-if="feedback" class="workspace-feedback" role="status">{{ feedback }}</p>

      <section v-if="listError" class="workspace-error" role="alert">
        <p>{{ listError }}</p>
        <button type="button" data-action="reload-theses" @click="loadWorkspaceData(false)">
          重新加载
        </button>
      </section>
      <p v-else-if="loading" class="workspace-loading" role="status">正在加载论文记录…</p>

      <template v-else>
        <StudentThesisFilters
          :model-value="filter"
          :search="search"
          :stats="stats"
          @update:model-value="updateFilter"
          @update:search="updateSearch"
        />

        <section v-if="theses.length === 0" class="workspace-empty">
          <span aria-hidden="true">稿</span>
          <h2>还没有论文记录</h2>
          <p>新建论文后可保存材料草稿，并在提交后查看学校审核与送审进度。</p>
        </section>

        <template v-else>
          <StudentProgressTimeline v-if="selectedThesis" :thesis="selectedThesis" />

          <section class="thesis-list" aria-labelledby="thesis-list-title">
            <header>
              <div>
                <span>THESIS RECORDS</span>
                <h2 id="thesis-list-title">论文记录</h2>
              </div>
              <small>显示 {{ filteredTheses.length }} / {{ theses.length }} 篇</small>
            </header>
            <StudentThesisTable
              :rows="filteredTheses"
              :selected-thesis-id="selectedThesisId"
              @select="selectThesis"
              @detail="openDetail"
              @action="handleAction"
            />
          </section>
        </template>
      </template>
    </div>

    <StudentDemoScenarioController
      :enabled="demoEnabled"
      @changed="refreshDemoProjection"
      @reset-dialog-change="demoDialogOpen = $event"
    />

    <template #modal>
      <StudentThesisDetailDrawer
        v-if="drawerOpen && selectedThesis"
        :thesis="selectedThesis"
        @close="closeDrawer"
        @action="handleDrawerAction"
      />

      <div v-if="confirmationAction" class="dialog-backdrop">
        <section
          ref="confirmationDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-dialog-title"
          @keydown="handleConfirmationKeydown"
        >
          <h2 id="action-dialog-title">
            {{
              confirmationAction === 'DELETE_DRAFT'
                ? '确认删除草稿？'
                : confirmationAction === 'REQUEST_WITHDRAWAL'
                  ? '确认提交撤回申请？'
                  : '确认撤回至草稿？'
            }}
          </h2>
          <p v-if="confirmationAction === 'DELETE_DRAFT'">
            删除后该草稿及其本地演示材料记录将不再显示。
          </p>
          <template v-else>
            <p v-if="confirmationAction === 'REQUEST_WITHDRAWAL'">
              申请将提交学校处理，当前送审评阅阶段不会改变。
            </p>
            <p v-else>撤回后论文返回材料准备阶段，已提交记录仍保留在公开时间线中。</p>
            <label>
              <span>撤回理由</span>
              <textarea
                v-model="withdrawalReason"
                name="withdrawalReason"
                rows="4"
                placeholder="请说明撤回原因"
              />
            </label>
          </template>
          <footer>
            <button
              ref="cancelConfirmation"
              type="button"
              data-action="cancel-confirmation"
              @click="closeConfirmation"
            >
              取消
            </button>
            <button
              v-if="confirmationAction === 'DELETE_DRAFT'"
              class="is-danger"
              type="button"
              data-action="confirm-delete-draft"
              :disabled="actionPending"
              @click="confirmAction"
            >
              {{ actionPending ? '正在删除…' : '确认删除草稿' }}
            </button>
            <button
              v-else
              type="button"
              data-action="confirm-withdrawal"
              :disabled="actionPending || !withdrawalReason.trim()"
              @click="confirmAction"
            >
              {{
                actionPending
                  ? '正在提交…'
                  : confirmationAction === 'REQUEST_WITHDRAWAL'
                    ? '确认提交申请'
                    : '确认撤回'
              }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.student-dashboard {
  display: grid;
  min-width: 0;
  gap: 1.25rem;
}

.primary-action,
.workspace-error button,
.action-dialog button {
  min-height: 2.5rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-bg);
  font-weight: 700;
  cursor: pointer;
}

.primary-action:disabled,
.action-dialog button:disabled {
  border-color: var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

.student-dashboard__overview {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(14rem, 1fr);
  gap: 1rem;
}

.deadline-card {
  padding: 1.25rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.deadline-card > span {
  display: block;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.deadline-card strong {
  display: block;
  margin-top: 0.5rem;
  color: var(--color-primary);
  font-family: var(--font-display);
  font-size: 1.5rem;
}

.deadline-card p {
  margin: 0.5rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  line-height: 1.6;
}

.eligibility-note,
.workspace-feedback,
.workspace-error,
.workspace-loading {
  margin: 0;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text-secondary);
}

.eligibility-note,
.workspace-error {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.workspace-feedback {
  border-left: 3px solid var(--color-info);
}

.workspace-error {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
}

.workspace-error p {
  margin: 0;
}

.workspace-empty {
  display: grid;
  min-height: 15rem;
  place-items: center;
  align-content: center;
  gap: 0.5rem;
  padding: 2rem;
  border: 1px dashed var(--color-border);
  background: var(--color-bg);
  text-align: center;
}

.workspace-empty > span {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border: 1px solid var(--color-blind-rail);
  border-radius: 50%;
  color: var(--color-blind-rail);
  font-family: var(--font-display);
}

.workspace-empty h2,
.workspace-empty p {
  margin: 0;
}

.workspace-empty h2,
.thesis-list h2 {
  font-family: var(--font-display);
}

.workspace-empty p {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
}

.thesis-list > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.625rem;
}

.thesis-list h2 {
  margin: 0.15rem 0 0;
  font-size: 1rem;
}

.thesis-list > header span,
.thesis-list > header small {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.dialog-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, var(--color-primary-active) 50%, transparent);
}

.action-dialog {
  display: grid;
  width: min(28rem, 100%);
  gap: 1rem;
  padding: 1.25rem;
  border-radius: var(--radius-md);
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.action-dialog h2,
.action-dialog p {
  margin: 0;
}

.action-dialog h2 {
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p,
.action-dialog label {
  color: var(--color-text-secondary);
  font-size: 0.8125rem;
  line-height: 1.65;
}

.action-dialog label,
.action-dialog label span {
  display: grid;
  gap: 0.35rem;
}

.action-dialog textarea {
  width: 100%;
  padding: 0.625rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  resize: vertical;
}

.action-dialog footer {
  display: flex;
  gap: 0.5rem;
  justify-content: end;
}

.action-dialog footer button:first-child {
  background: var(--color-bg);
  color: var(--color-primary);
}

.action-dialog button.is-danger {
  border-color: var(--color-danger);
  background: var(--color-danger);
}

@media (max-width: 900px) {
  .student-dashboard__overview {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .workspace-error,
  .action-dialog footer {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
