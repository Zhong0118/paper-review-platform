<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { CorrectionRequest, ReviewVersion } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import CorrectionDetailPanel from '../components/CorrectionDetailPanel.vue'
import PlatformDemoScenarioController from '@/modules/dispatch/components/PlatformDemoScenarioController.vue'

type ConfirmationKind = 'APPROVE' | 'REJECT'

const service = useScenarioService()
const authStore = useAuthStore()
/** 演示场景控制器：仅 VITE_DEMO_MODE=true 时渲染入口（见 Task 10）。 */
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const demoDialogOpen = ref(false)

const rows = ref<CorrectionRequest[]>([])
const loading = ref(true)
const listError = ref('')
const feedback = ref('')
const actionError = ref('')
const statusFilter = ref('')
const selectedId = ref('')
const versions = ref<ReviewVersion[]>([])
const opinion = ref('')
const actionPending = ref(false)
const confirmationAction = ref<ConfirmationKind | null>(null)
const confirmDialog = ref<HTMLElement>()
const cancelConfirm = ref<HTMLButtonElement>()
const overlayOpener = ref<HTMLElement | null>(null)
const pageRoot = ref<HTMLElement>()

const statusLabels: Record<CorrectionRequest['status'], string> = {
  PENDING: '待审批',
  APPROVED: '已批准',
  REJECTED: '已驳回',
}

const selectedRequest = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null,
)

const visibleRows = computed(() =>
  statusFilter.value ? rows.value.filter((row) => row.status === statusFilter.value) : rows.value,
)

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

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
    : pageRoot.value?.querySelector<HTMLElement>('[data-action="open-correction-detail"]')
  target?.focus()
  overlayOpener.value = null
}

async function refreshRows() {
  rows.value = await service.listCorrectionRequests()
}

async function loadRequests() {
  loading.value = true
  listError.value = ''
  try {
    await refreshRows()
  } catch (error) {
    listError.value = errorMessage(error)
  } finally {
    loading.value = false
  }
}

async function openDetail(request: CorrectionRequest) {
  rememberOverlayOpener()
  selectedId.value = request.id
  versions.value = await service.listReviewVersions(request.taskId)
}

async function closeDetail() {
  selectedId.value = ''
  versions.value = []
  await restoreOverlayOpener()
}

async function openConfirmation(kind: ConfirmationKind) {
  opinion.value = ''
  confirmationAction.value = kind
  await nextTick()
  cancelConfirm.value?.focus()
}

async function closeConfirmation(force = false) {
  if (actionPending.value && !force) return
  confirmationAction.value = null
  if (!force) opinion.value = ''
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
    confirmDialog.value?.querySelectorAll<HTMLElement>('textarea, button:not(:disabled)') ?? [],
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
  const request = selectedRequest.value
  const action = confirmationAction.value
  if (!request || !action || actionPending.value) return
  if (!opinion.value.trim()) return

  actionPending.value = true
  feedback.value = ''
  actionError.value = ''
  try {
    const updated = await service.decideCorrection(
      request.id,
      action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      opinion.value.trim(),
    )
    rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
    versions.value = await service.listReviewVersions(request.taskId)
    feedback.value =
      action === 'APPROVE'
        ? `已批准并生成新版本（${updated.newVersionId ?? ''}），原版本只读保留。`
        : '已驳回更正申请，原评阅版本保持不变。'
    await closeConfirmation(true)
  } catch (error) {
    await closeConfirmation(true)
    actionError.value = `${errorMessage(error)}，本次操作未执行。`
  } finally {
    actionPending.value = false
    if (!confirmationAction.value) await restoreOverlayOpener()
  }
}

onMounted(() => {
  void loadRequests()
})
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.platform_reviewer ?? []"
    active-path="/platform/corrections"
    context-label="百杰运营端 · 评阅更正审批"
    :user-name="authStore.user?.displayName ?? '陈岚'"
    :background-locked="Boolean(confirmationAction) || Boolean(selectedRequest) || demoDialogOpen"
  >
    <div ref="pageRoot" class="correction-page">
      <PlatformDemoScenarioController
        :enabled="demoEnabled"
        @changed="loadRequests"
        @reset-dialog-change="demoDialogOpen = $event"
      />
      <PageHeader
        eyebrow="PAGE-020 · RESULT CORRECTIONS"
        title="评阅更正审批"
        description="核对专家最终提交后的更正申请。批准后生成新评阅版本，原始版本只读保留并可审计；驳回需填写原因。"
      />
      <BlindRail
        audience="申请专家身份、更正理由与结果版本差异"
        hidden-from="学校只接收获准发布的版本；不访问论文原始版；审批人不得直接修改专家原始分数或评语"
        stage="版本化更正审批"
      />
      <p v-if="listError" role="alert" class="correction-page__error">{{ listError }}</p>
      <p v-if="actionError" role="alert" class="correction-page__error">{{ actionError }}</p>
      <p v-if="feedback" role="status" class="correction-page__feedback">{{ feedback }}</p>

      <section class="correction-page__filters">
        <label>
          <span>状态</span>
          <select v-model="statusFilter" data-filter="correction-status">
            <option value="">全部</option>
            <option value="PENDING">待审批</option>
            <option value="APPROVED">已批准</option>
            <option value="REJECTED">已驳回</option>
          </select>
        </label>
        <small>显示 {{ visibleRows.length }} / {{ rows.length }} 条更正申请</small>
      </section>

      <section class="correction-list" aria-label="更正申请列表">
        <header class="correction-list__head">
          <span>申请编号</span>
          <span>专家</span>
          <span>匿名论文号</span>
          <span>申请时间</span>
          <span>状态</span>
          <span>操作</span>
        </header>
        <article
          v-for="row in visibleRows"
          :key="row.id"
          class="correction-list__row"
          data-correction-request
        >
          <code>{{ row.id }}</code>
          <strong>{{ row.expertName }}</strong>
          <span>{{ row.anonymousId }}</span>
          <time>{{ row.requestedAt }}</time>
          <mark :data-status="row.status">{{ statusLabels[row.status] }}</mark>
          <button type="button" data-action="open-correction-detail" @click="openDetail(row)">
            {{ row.status === 'PENDING' ? '查看差异' : '查看处理' }}
          </button>
        </article>
        <p v-if="visibleRows.length === 0" class="correction-list__empty">暂无更正申请。</p>
      </section>
    </div>

    <template #modal>
      <div v-if="selectedRequest" class="dialog-backdrop" @click.self="closeDetail">
        <div class="detail-sheet">
          <CorrectionDetailPanel
            :request="selectedRequest"
            :versions="versions"
            @close="closeDetail"
            @approve="openConfirmation('APPROVE')"
            @reject="openConfirmation('REJECT')"
          />
        </div>
      </div>

      <div v-if="confirmationAction" class="dialog-backdrop">
        <section
          ref="confirmDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-dialog-title"
          @keydown="handleConfirmationKeydown"
        >
          <h2 id="action-dialog-title">
            {{ confirmationAction === 'APPROVE' ? '确认批准并生成新版本？' : '确认驳回更正申请？' }}
          </h2>
          <template v-if="confirmationAction === 'APPROVE'">
            <p v-if="selectedRequest?.impactWarning" data-impact-warning>
              {{ selectedRequest.impactWarning }}
            </p>
            <p>批准后将生成新评阅版本（版本号升级），原始版本只读保留并建立版本关系。</p>
          </template>
          <p v-else>驳回后原评阅版本保持不变，专家可重新提交更正申请。</p>
          <label>
            <span>审核意见（必填）</span>
            <textarea
              v-model="opinion"
              name="correctionOpinion"
              rows="4"
              placeholder="请填写审核意见，作为审批依据"
            />
          </label>
          <footer>
            <button
              ref="cancelConfirm"
              type="button"
              data-action="cancel-confirmation"
              @click="() => closeConfirmation()"
            >
              取消
            </button>
            <button
              type="button"
              :data-action="
                confirmationAction === 'APPROVE' ? 'confirm-correction-approve' : 'confirm-correction-reject'
              "
              :disabled="actionPending || !opinion.trim()"
              @click="confirmAction"
            >
              {{ actionPending ? '正在提交…' : confirmationAction === 'APPROVE' ? '确认批准' : '确认驳回' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.correction-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.correction-page__error,
.correction-page__feedback {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
}

.correction-page__error {
  border: 1px solid #e5b6b6;
  background: #fceded;
  color: #9c2929;
}

.correction-page__feedback {
  border: 1px solid #c9dcf0;
  background: #eef5fc;
  color: #1b4f8a;
}

.correction-page__filters {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.correction-page__filters label {
  display: grid;
  gap: 0.35rem;
}

.correction-page__filters label > span {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 650;
}

.correction-page__filters select {
  min-width: 11rem;
  height: 2.25rem;
  padding: 0 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.correction-page__filters small {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.correction-list {
  border: 1px solid #d8e0e6;
  background: #fff;
}

.correction-list__head,
.correction-list__row {
  display: grid;
  grid-template-columns: 8rem 7rem 7rem 1fr 6rem 7rem;
  gap: 0.8rem;
  align-items: center;
  padding: 0.75rem 1rem;
}

.correction-list__head {
  background: #f6f8fa;
  color: #687681;
  font-size: 0.65rem;
  font-weight: 650;
}

.correction-list__row {
  border-top: 1px solid #e5eaee;
  color: #52626e;
  font-size: 0.7rem;
}

.correction-list__row code {
  color: #1b4f8a;
  font-family: var(--font-data);
}

.correction-list__row time {
  color: #7c8993;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.correction-list__row mark {
  justify-self: start;
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  background: #eef2f5;
  color: #53636f;
  font-size: 0.68rem;
}

.correction-list__row mark[data-status='PENDING'] {
  background: #fdf3df;
  color: #8a6114;
}

.correction-list__row mark[data-status='APPROVED'] {
  background: #e5f2e7;
  color: #2e6b3b;
}

.correction-list__row mark[data-status='REJECTED'] {
  background: #fbeaea;
  color: #9c2929;
}

.correction-list__row button {
  justify-self: start;
  border: 0;
  background: transparent;
  color: #1b4f8a;
  font-weight: 650;
  cursor: pointer;
}

.correction-list__empty {
  margin: 0;
  padding: 1rem;
  border-top: 1px solid #e5eaee;
  color: #7c8993;
  font-size: 0.72rem;
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

.detail-sheet {
  width: min(42rem, 100%);
  max-height: 90vh;
  overflow-y: auto;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
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

.action-dialog h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p,
.action-dialog label {
  margin: 0;
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

.action-dialog button {
  min-height: 2.25rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: var(--color-bg);
  font-weight: 650;
  cursor: pointer;
}

.action-dialog footer button:first-child {
  background: var(--color-bg);
  color: var(--color-primary);
}

.action-dialog button:disabled {
  border-color: var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .correction-list__head {
    display: none;
  }

  .correction-list__row {
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
  }

  .correction-list__row code {
    grid-column: 1 / -1;
  }

  .correction-list__row button {
    justify-self: end;
  }
}

@media (max-width: 480px) {
  .correction-page__filters {
    align-items: stretch;
    flex-direction: column;
  }

  .correction-page__filters select {
    min-width: 0;
    width: 100%;
  }
}
</style>
