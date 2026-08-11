<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { PaymentResult, WithdrawalRequest } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import WithdrawalDetailPanel from '../components/WithdrawalDetailPanel.vue'

type ConfirmationKind = 'APPROVE' | 'REJECT' | 'PAYMENT'

const service = useScenarioService()
const authStore = useAuthStore()

const rows = ref<WithdrawalRequest[]>([])
const loading = ref(true)
const listError = ref('')
const feedback = ref('')
const actionError = ref('')
const statusFilter = ref('')
const selectedId = ref('')
const opinion = ref('')
const voucherNo = ref('')
const actionPending = ref(false)
const confirmationAction = ref<ConfirmationKind | null>(null)
const paymentResult = ref<PaymentResult | null>(null)
const confirmDialog = ref<HTMLElement>()
const cancelConfirm = ref<HTMLButtonElement>()
const overlayOpener = ref<HTMLElement | null>(null)
const pageRoot = ref<HTMLElement>()

const statusLabels: Record<WithdrawalRequest['status'], string> = {
  PENDING: '待审核',
  REVIEWING: '待付款',
  PAID: '已付款',
  REJECTED: '已驳回',
  REVERSED: '已冲正',
}

const selectedWithdrawal = computed(
  () => rows.value.find((row) => row.id === selectedId.value) ?? null,
)

const visibleRows = computed(() =>
  statusFilter.value ? rows.value.filter((row) => row.status === statusFilter.value) : rows.value,
)

const stats = computed(() => ({
  pending: rows.value.filter((row) => row.status === 'PENDING').length,
  reviewing: rows.value.filter((row) => row.status === 'REVIEWING').length,
  paid: rows.value.filter((row) => row.status === 'PAID').length,
  total: rows.value.reduce((sum, row) => sum + row.amount, 0),
}))

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
    : pageRoot.value?.querySelector<HTMLElement>('[data-action="open-withdrawal-detail"]')
  target?.focus()
  overlayOpener.value = null
}

async function refreshRows() {
  rows.value = await service.listWithdrawals()
}

async function loadWorkbench() {
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

async function openDetail(withdrawal: WithdrawalRequest) {
  rememberOverlayOpener()
  selectedId.value = withdrawal.id
}

async function closeDetail() {
  selectedId.value = ''
  await restoreOverlayOpener()
}

async function openConfirmation(kind: ConfirmationKind) {
  opinion.value = ''
  voucherNo.value = ''
  paymentResult.value = null
  confirmationAction.value = kind
  await nextTick()
  cancelConfirm.value?.focus()
}

async function confirmPaymentResult(result: PaymentResult) {
  paymentResult.value = result
  await confirmAction()
}

async function closeConfirmation(force = false) {
  if (actionPending.value && !force) return
  confirmationAction.value = null
  paymentResult.value = null
  if (!force) {
    opinion.value = ''
    voucherNo.value = ''
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
    confirmDialog.value?.querySelectorAll<HTMLElement>('textarea, input, button:not(:disabled)') ?? [],
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

function confirmDisabled() {
  if (actionPending.value) return true
  const kind = confirmationAction.value
  if (!kind) return true
  if (kind === 'APPROVE' || kind === 'REJECT') return !opinion.value.trim()
  if (kind === 'PAYMENT') return !voucherNo.value.trim()
  return true
}

async function confirmAction() {
  const withdrawal = selectedWithdrawal.value
  const kind = confirmationAction.value
  if (!withdrawal || !kind || actionPending.value) return
  if (confirmDisabled()) return

  actionPending.value = true
  feedback.value = ''
  actionError.value = ''
  try {
    if (kind === 'APPROVE' || kind === 'REJECT') {
      const updated = await service.reviewWithdrawal(
        withdrawal.id,
        kind === 'APPROVE' ? 'APPROVE' : 'REJECT',
        opinion.value.trim(),
      )
      rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
      feedback.value =
        kind === 'APPROVE'
          ? '已审核通过，提现进入线下付款（待付款）。'
          : '已驳回提现申请并解除冻结。'
    } else {
      const result: PaymentResult = paymentResult.value ?? 'SUCCESS'
      const updated = await service.recordWithdrawalPayment(
        withdrawal.id,
        result,
        voucherNo.value.trim(),
      )
      rows.value = rows.value.map((row) => (row.id === updated.id ? updated : row))
      feedback.value =
        result === 'SUCCESS'
          ? '已回填付款结果，提现状态更新为已付款。'
          : '已记录付款失败，提现保持待付款，可重新线下付款后再次回填。'
    }
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
  void loadWorkbench()
})
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.platform_reviewer ?? []"
    active-path="/platform/settlements"
    context-label="百杰运营端 · 结算处理"
    :user-name="authStore.user?.displayName ?? '陈岚'"
    :background-locked="Boolean(confirmationAction) || Boolean(selectedWithdrawal)"
  >
    <div ref="pageRoot" class="settlement-page">
      <PageHeader
        eyebrow="PAGE-022 · SETTLEMENTS"
        title="结算处理工作台"
        description="审核专家提现申请并回填线下付款结果。收款信息默认脱敏，完整查看需重认证并写入审计（演示以确认提示实现）。"
      />
      <BlindRail
        audience="专家身份、可提现余额、冻结流水与付款处理记录"
        hidden-from="学校不可见专家提现；学生与导师不可访问本页；不出现完整收款账号"
        stage="人工审核 · 线下付款回填（演示投影）"
      />
      <p v-if="listError" role="alert" class="settlement-page__error">{{ listError }}</p>
      <p v-if="actionError" role="alert" class="settlement-page__error">{{ actionError }}</p>
      <p v-if="feedback" role="status" class="settlement-page__feedback">{{ feedback }}</p>

      <section class="settlement-page__stats" aria-label="结算统计">
        <article>
          <span>待审核</span>
          <strong data-stat="pending">{{ stats.pending }}</strong>
        </article>
        <article>
          <span>待付款</span>
          <strong data-stat="reviewing">{{ stats.reviewing }}</strong>
        </article>
        <article>
          <span>已付款</span>
          <strong data-stat="paid">{{ stats.paid }}</strong>
        </article>
        <article>
          <span>申请总额（演示投影）</span>
          <strong data-stat="total">¥ {{ stats.total.toFixed(2) }}</strong>
        </article>
      </section>

      <section class="settlement-page__filters">
        <label>
          <span>状态</span>
          <select v-model="statusFilter" data-filter="withdrawal-status">
            <option value="">全部</option>
            <option value="PENDING">待审核</option>
            <option value="REVIEWING">待付款</option>
            <option value="PAID">已付款</option>
            <option value="REJECTED">已驳回</option>
            <option value="REVERSED">已冲正</option>
          </select>
        </label>
        <small>显示 {{ visibleRows.length }} / {{ rows.length }} 笔提现申请</small>
      </section>

      <section class="settlement-table" aria-label="提现申请列表">
        <header class="settlement-table__head">
          <span>提现单号</span>
          <span>专家</span>
          <span>金额</span>
          <span>申请时间</span>
          <span>状态</span>
          <span>操作</span>
        </header>
        <article
          v-for="row in visibleRows"
          :key="row.id"
          class="settlement-table__row"
          data-withdrawal-row
        >
          <code>{{ row.id }}</code>
          <strong>{{ row.expertName }}</strong>
          <b>¥ {{ row.amount.toFixed(2) }}</b>
          <time>{{ row.requestedAt }}</time>
          <mark :data-status="row.status">{{ statusLabels[row.status] }}</mark>
          <button type="button" data-action="open-withdrawal-detail" @click="openDetail(row)">
            {{ row.status === 'PENDING' ? '查看处理' : '查看记录' }}
          </button>
        </article>
        <p v-if="visibleRows.length === 0" class="settlement-table__empty">暂无提现申请。</p>
      </section>
    </div>

    <template #modal>
      <div v-if="selectedWithdrawal" class="dialog-backdrop" @click.self="closeDetail">
        <div class="detail-sheet">
          <WithdrawalDetailPanel
            :withdrawal="selectedWithdrawal"
            @close="closeDetail"
            @approve="openConfirmation('APPROVE')"
            @reject="openConfirmation('REJECT')"
            @fill-payment="openConfirmation('PAYMENT')"
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
            {{
              confirmationAction === 'APPROVE'
                ? '确认审核通过？'
                : confirmationAction === 'REJECT'
                  ? '确认驳回提现申请？'
                  : '回填线下付款结果'
            }}
          </h2>
          <template v-if="confirmationAction === 'APPROVE'">
            <p>审核通过后提现进入线下付款（待付款），不自动发起支付；线下付款完成后需人工回填结果。</p>
          </template>
          <template v-else-if="confirmationAction === 'REJECT'">
            <p>驳回后将解除冻结金额，专家可重新提交提现申请；处理记录只追加。</p>
          </template>
          <template v-else-if="confirmationAction === 'PAYMENT'">
            <p>
              回填成功后提现状态更新为已付款，凭证号只读保留，重复回填不会重复计账（幂等）；付款失败后提现保持待付款，可重新线下付款后再回填。
            </p>
            <label>
              <span>线下付款凭证号（必填）</span>
              <input
                v-model="voucherNo"
                type="text"
                name="voucherNo"
                placeholder="如：V20260812-01"
              />
            </label>
          </template>
          <label v-if="confirmationAction === 'APPROVE' || confirmationAction === 'REJECT'">
            <span>审核意见（必填）</span>
            <textarea
              v-model="opinion"
              name="withdrawalOpinion"
              rows="4"
              placeholder="请填写审核意见"
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
            <template v-if="confirmationAction === 'APPROVE' || confirmationAction === 'REJECT'">
              <button
                type="button"
                :data-action="
                  confirmationAction === 'APPROVE' ? 'confirm-withdrawal-approve' : 'confirm-withdrawal-reject'
                "
                :disabled="confirmDisabled()"
                @click="confirmAction"
              >
                {{ actionPending ? '正在提交…' : '确认' }}
              </button>
            </template>
            <template v-else-if="confirmationAction === 'PAYMENT'">
              <button
                type="button"
                class="is-danger"
                data-action="confirm-payment-failed"
                :disabled="confirmDisabled()"
                @click="() => confirmPaymentResult('FAILED')"
              >
                {{ actionPending ? '正在提交…' : '记录付款失败' }}
              </button>
              <button
                type="button"
                data-action="confirm-payment-success"
                :disabled="confirmDisabled()"
                @click="() => confirmPaymentResult('SUCCESS')"
              >
                {{ actionPending ? '正在提交…' : '确认付款成功' }}
              </button>
            </template>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.settlement-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.settlement-page__error,
.settlement-page__feedback {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
}

.settlement-page__error {
  border: 1px solid #e5b6b6;
  background: #fceded;
  color: #9c2929;
}

.settlement-page__feedback {
  border: 1px solid #c9dcf0;
  background: #eef5fc;
  color: #1b4f8a;
}

.settlement-page__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.75rem;
}

.settlement-page__stats article {
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.settlement-page__stats span,
.settlement-page__stats strong {
  display: block;
}

.settlement-page__stats span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.settlement-page__stats strong {
  margin-top: 0.5rem;
  color: var(--color-primary);
  font-family: var(--font-data);
  font-size: 1.5rem;
}

.settlement-page__filters {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.875rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.settlement-page__filters label {
  display: grid;
  gap: 0.35rem;
}

.settlement-page__filters label > span {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 650;
}

.settlement-page__filters select {
  min-width: 11rem;
  height: 2.25rem;
  padding: 0 0.55rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.settlement-page__filters small {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.settlement-table {
  border: 1px solid #d8e0e6;
  background: #fff;
}

.settlement-table__head,
.settlement-table__row {
  display: grid;
  grid-template-columns: 9rem 7rem 8rem 1fr 6rem 7rem;
  gap: 0.8rem;
  align-items: center;
  padding: 0.75rem 1rem;
}

.settlement-table__head {
  background: #f6f8fa;
  color: #687681;
  font-size: 0.65rem;
  font-weight: 650;
}

.settlement-table__row {
  border-top: 1px solid #e5eaee;
  color: #52626e;
  font-size: 0.7rem;
}

.settlement-table__row code,
.settlement-table__row b {
  color: #1b4f8a;
  font-family: var(--font-data);
}

.settlement-table__row time {
  color: #7c8993;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.settlement-table__row mark {
  justify-self: start;
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  background: #eef2f5;
  color: #53636f;
  font-size: 0.68rem;
}

.settlement-table__row mark[data-status='PENDING'] {
  background: #fdf3df;
  color: #8a6114;
}

.settlement-table__row mark[data-status='REVIEWING'] {
  background: #e8eef9;
  color: #2b4f8a;
}

.settlement-table__row mark[data-status='PAID'] {
  background: #e5f2e7;
  color: #2e6b3b;
}

.settlement-table__row mark[data-status='REJECTED'] {
  background: #fbeaea;
  color: #9c2929;
}

.settlement-table__row mark[data-status='REVERSED'] {
  background: #f0eef6;
  color: #5b4a8a;
}

.settlement-table__row button {
  justify-self: start;
  border: 0;
  background: transparent;
  color: #1b4f8a;
  font-weight: 650;
  cursor: pointer;
}

.settlement-table__empty {
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

.action-dialog input,
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

.action-dialog button.is-danger {
  border-color: #c14a4a;
  background: #fff;
  color: #c14a4a;
}

.action-dialog button:disabled {
  border-color: var(--color-border);
  background: var(--color-fill);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}

@media (max-width: 900px) {
  .settlement-page__stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .settlement-table__head {
    display: none;
  }

  .settlement-table__row {
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    padding: 0.9rem 1rem;
  }

  .settlement-table__row code {
    grid-column: 1 / -1;
  }

  .settlement-table__row button {
    justify-self: end;
  }
}

@media (max-width: 480px) {
  .settlement-page__filters {
    align-items: stretch;
    flex-direction: column;
  }

  .settlement-page__filters select {
    min-width: 0;
    width: 100%;
  }
}
</style>
