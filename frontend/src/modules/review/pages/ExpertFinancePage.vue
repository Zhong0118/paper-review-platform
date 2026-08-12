<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { ExpertAccountSummary, ExpertLedgerEntry, WithdrawalRequest } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

const service = useScenarioService()

const account = ref<ExpertAccountSummary | null>(null)
const ledger = ref<ExpertLedgerEntry[]>([])
const withdrawals = ref<WithdrawalRequest[]>([])
const loading = ref(true)
const pageError = ref('')
const amountInput = ref<number | null>(null)
const amountError = ref('')
const confirmOpen = ref(false)
const submitting = ref(false)
const submitError = ref('')
const confirmDialog = ref<HTMLElement | null>(null)
const confirmDialogOpener = ref<HTMLElement | null>(null)

/** 金额按 Decimal 语义展示（演示为 number，页面格式化两位小数，见设计 §9）。 */
const formatAmount = (value: number) => `¥ ${value.toFixed(2)}`

const availableAmount = computed(() => account.value?.availableAmount ?? 0)

const statusLabels: Record<WithdrawalRequest['status'], string> = {
  PENDING: '待审核',
  REVIEWING: '待付款',
  PAID: '已付款',
  REJECTED: '已驳回',
  REVERSED: '已冲正',
}

const statusTone: Record<WithdrawalRequest['status'], string> = {
  PENDING: 'warning',
  REVIEWING: 'warning',
  PAID: 'success',
  REJECTED: 'danger',
  REVERSED: 'neutral',
}

const ledgerLabels: Record<ExpertLedgerEntry['kind'], string> = {
  REVIEW_CREDIT: '评阅收入',
  WITHDRAWAL: '提现冻结',
  RELEASE: '驳回解冻',
  PAYMENT: '提现付款',
  REVERSAL: '付款冲正',
}

const withdrawableAmount = computed(() =>
  typeof amountInput.value === 'number' && amountInput.value > 0 ? amountInput.value : 0,
)

async function loadFinance() {
  loading.value = true
  pageError.value = ''
  try {
    const [accountValue, ledgerValue, withdrawalsValue] = await Promise.all([
      service.getExpertAccount(),
      service.listExpertLedger(),
      service.listWithdrawals(),
    ])
    account.value = accountValue
    ledger.value = ledgerValue
    withdrawals.value = withdrawalsValue
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : '费用数据加载失败。'
  } finally {
    loading.value = false
  }
}

onMounted(loadFinance)

/** 申请提现：金额必填且 ≤ 可提现（页面校验，服务端仍兜底），通过后打开二次确认。 */
function requestWithdrawal() {
  amountError.value = ''
  submitError.value = ''
  // v-model 在 type="number" 输入框上直接绑定数值（可能为 null/空）
  const amount = typeof amountInput.value === 'string' ? Number(amountInput.value) : amountInput.value
  if (amount == null || !Number.isFinite(amount) || amount <= 0) {
    amountError.value = '请输入提现金额。'
    return
  }
  if (amount > availableAmount.value) {
    amountError.value = '提现金额不能超过可提现余额。'
    return
  }
  confirmOpen.value = true
  if (document.activeElement instanceof HTMLElement) {
    confirmDialogOpener.value = document.activeElement
  }
  void nextTick().then(() =>
    confirmDialog.value
      ?.querySelector<HTMLElement>('[data-action="confirm-withdrawal"]')
      ?.focus(),
  )
}

async function cancelWithdrawal() {
  if (submitting.value) return
  confirmOpen.value = false
  submitError.value = ''
  await nextTick()
  confirmDialogOpener.value?.focus()
  confirmDialogOpener.value = null
}

function handleConfirmKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelWithdrawal()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    confirmDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
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

/** 二次确认提交（防重复：提交中禁用按钮；成功即关闭对话框并联动刷新余额）。 */
async function confirmWithdrawal() {
  const amount = withdrawableAmount.value
  if (amount <= 0 || submitting.value) return
  submitting.value = true
  submitError.value = ''
  try {
    await service.submitWithdrawal(amount)
    confirmOpen.value = false
    amountInput.value = null
    await loadFinance()
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '提现申请失败，请稍后重试。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.expert ?? []"
    active-path="/expert/finance"
    context-label="专家端 · 双盲评阅"
    :user-name="useAuthStore().user?.displayName ?? '周明远教授'"
  >
    <div class="finance-page">
      <PageHeader
        eyebrow="PAGE-014 · EXPERT FINANCE"
        title="费用与提现"
        description="仅展示本人有效评阅收入、可提现余额与提现处理状态。送审学校的账户额度不在专家端展示；演示数据为本地快照，不宣称真实结算与支付。"
      />
      <BlindRail
        audience="本人评阅收入、可提现余额与提现记录"
        hidden-from="学校账户、其他专家收入与论文作者身份"
        stage="有效评阅入账 · 人工付款"
      />

      <p v-if="pageError" class="finance-page__error" role="alert">{{ pageError }}</p>
      <p v-else-if="loading" class="finance-page__loading">正在加载费用数据…</p>

      <template v-else>
        <section class="account">
          <article class="account__card" data-account="available">
            <span>可提现余额</span>
            <strong>{{ formatAmount(availableAmount) }}</strong>
            <p>来自费用流水汇总（只读）：有效评阅入账合计，扣除冻结中的提现。</p>
          </article>
          <article class="account__card" data-account="frozen">
            <span>冻结金额</span>
            <strong>{{ formatAmount(account?.pendingAmount ?? 0) }}</strong>
            <p>提现申请审核与线下付款期间的冻结金额；驳回或付款完成后解除。</p>
          </article>
        </section>

        <section class="withdraw">
          <header>
            <h2>申请提现</h2>
            <p>金额为必填项，不得超过可提现余额；提交后等待平台审核，审核通过后由运营线下付款（演示不自动调用支付）。</p>
          </header>
          <div class="withdraw__form">
            <label class="withdraw__field">
              <span>提现金额（元）</span>
              <input
                v-model="amountInput"
                type="number"
                min="0.01"
                step="0.01"
                inputmode="decimal"
                placeholder="请输入提现金额"
                data-field="withdrawal-amount"
                aria-describedby="withdrawal-amount-error"
                @keyup.enter="requestWithdrawal"
              />
            </label>
            <p v-if="amountError" id="withdrawal-amount-error" class="withdraw__error" role="alert">
              {{ amountError }}
            </p>
            <button type="button" class="withdraw__submit" data-action="submit-withdrawal" @click="requestWithdrawal">
              提交申请
            </button>
          </div>
        </section>

        <section class="records">
          <header class="records__head">
            <h2>提现记录</h2>
            <p>提交后只能查看状态，不能自行修改；驳回原因与付款信息由平台审核/回填后展示。</p>
          </header>
          <p v-if="withdrawals.length === 0" class="records__empty">暂无提现记录。</p>
          <ul v-else class="records__list">
            <li v-for="record in withdrawals" :key="record.id" class="record" data-withdrawal-record>
              <div class="record__meta">
                <code>{{ record.id }}</code>
                <time>{{ record.requestedAt }}</time>
                <strong>{{ formatAmount(record.amount) }}</strong>
                <span class="record__status" :data-tone="statusTone[record.status]">
                  {{ statusLabels[record.status] }}
                </span>
              </div>
              <p class="record__note">
                付款时间：{{ record.paidAt ?? '尚未付款' }}
                <template v-if="record.voucherNo"> · 凭证号 {{ record.voucherNo }}</template>
                <template v-if="record.reason"> · 平台意见：{{ record.reason }}</template>
              </p>
            </li>
          </ul>
        </section>

        <section class="ledger">
          <header class="ledger__head">
            <h2>费用流水</h2>
            <p>只读、可审计、只追加：有效评阅任务入账与提现处理记录，不支持覆盖或删除。</p>
          </header>
          <p v-if="ledger.length === 0" class="ledger__empty">暂无费用流水。</p>
          <div v-else class="ledger__table">
            <header class="ledger__row ledger__row--head">
              <span>流水号</span>
              <span>类型</span>
              <span>时间</span>
              <span>金额</span>
              <span>说明</span>
            </header>
            <article v-for="entry in ledger" :key="entry.id" class="ledger__row" data-ledger-row>
              <code>{{ entry.id }}</code>
              <span>{{ ledgerLabels[entry.kind] }}</span>
              <time>{{ entry.occurredAt }}</time>
              <b :data-tone="entry.amount >= 0 ? 'credit' : 'debit'">
                {{ entry.amount >= 0 ? '+' : '-' }} {{ formatAmount(Math.abs(entry.amount)) }}
              </b>
              <span>{{ entry.description }}</span>
            </article>
          </div>
        </section>
      </template>
    </div>

    <template #modal>
      <div v-if="confirmOpen" class="dialog-backdrop">
        <section
          ref="confirmDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="withdrawal-dialog-title"
          @keydown="handleConfirmKeydown"
        >
          <h2 id="withdrawal-dialog-title">确认提交提现申请？</h2>
          <p>
            将冻结可提现余额
            <strong class="action-dialog__amount">{{ formatAmount(withdrawableAmount) }}</strong
            >，提交后仅可查看状态，等待平台审核。演示阶段由运营线下付款回填，不自动调用支付。
          </p>
          <p v-if="submitError" class="action-dialog__error" role="alert">{{ submitError }}</p>
          <footer>
            <button type="button" data-action="cancel-withdrawal" :disabled="submitting" @click="cancelWithdrawal">
              取消
            </button>
            <button
              type="button"
              data-action="confirm-withdrawal"
              :disabled="submitting"
              @click="confirmWithdrawal"
            >
              {{ submitting ? '正在提交…' : '确认提交' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.finance-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.finance-page__error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.finance-page__loading {
  margin: 0;
  padding: 0.6rem 0.75rem;
  color: #7c8993;
  font-size: 0.72rem;
}

.account {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.account__card {
  display: grid;
  gap: 0.3rem;
  padding: 1rem;
  border: 1px solid var(--color-border, #d8e0e6);
  background: #fff;
}

.account__card span {
  color: #71808c;
  font-size: 0.68rem;
}

.account__card strong {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 1.6rem;
}

.account__card p {
  margin: 0;
  color: #7a8791;
  font-size: 0.66rem;
  line-height: 1.6;
}

.withdraw,
.records,
.ledger {
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--color-border, #d8e0e6);
  background: #fff;
}

.withdraw header h2,
.records__head h2,
.ledger__head h2 {
  margin: 0;
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.withdraw header p,
.records__head p,
.ledger__head p {
  margin: 0.25rem 0 0;
  color: #7a8791;
  font-size: 0.68rem;
  line-height: 1.6;
}

.withdraw__form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: start;
}

.withdraw__field {
  display: grid;
  gap: 0.3rem;
}

.withdraw__field span {
  color: #4b5966;
  font-size: 0.7rem;
}

.withdraw__field input {
  width: 100%;
  padding: 0.55rem 0.7rem;
  border: 1px solid #c9d3da;
  border-radius: 0.3rem;
  background: #fff;
  color: #1f2d3a;
  font-family: var(--font-data);
  font-size: 0.85rem;
}

.withdraw__field input:focus {
  outline: 2px solid #1b4f8a;
  outline-offset: 1px;
}

.withdraw__error {
  grid-column: 1 / -1;
  margin: 0;
  color: #b03232;
  font-size: 0.7rem;
}

.withdraw__submit {
  padding: 0.55rem 1rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.3rem;
  background: #1b4f8a;
  color: #fff;
  font-weight: 650;
  cursor: pointer;
}

.records__list {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.record {
  display: grid;
  gap: 0.4rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid #e3e8ec;
  border-radius: 0.3rem;
}

.record__meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.record__meta code,
.record__meta strong,
.ledger__row code,
.ledger__row b {
  font-family: var(--font-data);
  color: #1b4f8a;
}

.record__meta time,
.record__note,
.ledger__row time {
  color: #71808c;
  font-size: 0.68rem;
}

.record__meta strong {
  font-size: 0.85rem;
}

.record__status {
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.68rem;
}

.record__status[data-tone='success'] {
  background: #edf7ee;
  color: #28642d;
}

.record__status[data-tone='warning'] {
  background: #fdf6e5;
  color: #8a6d1f;
}

.record__status[data-tone='danger'] {
  background: #fbeaea;
  color: #b03232;
}

.record__note {
  margin: 0;
  line-height: 1.6;
}

.records__empty,
.ledger__empty {
  margin: 0;
  padding: 0.75rem;
  border: 1px dashed #d8e0e6;
  color: #7a8791;
  font-size: 0.72rem;
  text-align: center;
}

.ledger__table {
  border: 1px solid #e3e8ec;
}

.ledger__row {
  display: grid;
  grid-template-columns: 6.5rem 5rem 8rem 7rem minmax(0, 1fr);
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  align-items: center;
}

.ledger__row--head {
  background: #f6f8fa;
  color: #687681;
  font-size: 0.65rem;
  font-weight: 650;
}

.ledger__row:not(.ledger__row--head) {
  border-top: 1px solid #e5eaee;
  color: #52626e;
  font-size: 0.7rem;
}

.ledger__row b[data-tone='credit'] {
  color: #28642d;
}

.ledger__row b[data-tone='debit'] {
  color: #b03232;
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

.action-dialog__amount {
  color: #1b4f8a;
  font-family: var(--font-data);
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
  border: 1px solid var(--color-border, #d8e0e6);
  border-radius: 0.3rem;
  background: #fff;
  color: #3a4a58;
  font-weight: 650;
  cursor: pointer;
}

.action-dialog button[data-action='confirm-withdrawal'] {
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

@media (max-width: 640px) {
  .account {
    grid-template-columns: 1fr;
  }

  .withdraw__form {
    grid-template-columns: 1fr;
  }

  .ledger__row {
    grid-template-columns: 1fr 1fr;
  }

  .ledger__row > :nth-child(4),
  .ledger__row > :nth-child(5) {
    grid-column: 1 / -1;
  }
}
</style>
