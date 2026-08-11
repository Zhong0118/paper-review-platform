<script setup lang="ts">
import { ref } from 'vue'

import type { WithdrawalHistoryEntry, WithdrawalRequest } from '@/demo/types'

const props = defineProps<{
  withdrawal: WithdrawalRequest
}>()

defineEmits<{
  close: []
  approve: []
  reject: []
  fillPayment: []
}>()

/** 收款信息默认脱敏；完整查看需重认证 + 审计（演示以提示 + 确认实现）。 */
const revealRequested = ref(false)

const historyLabels: Record<WithdrawalHistoryEntry['action'], string> = {
  SUBMIT: '提交申请',
  APPROVE: '审核通过',
  REJECT: '审核驳回',
  PAYMENT_SUCCESS: '付款成功',
  PAYMENT_FAILED: '付款失败',
  REVERSE: '冲正',
}

const statusLabels: Record<WithdrawalRequest['status'], string> = {
  PENDING: '待审核',
  REVIEWING: '待付款（审核通过）',
  PAID: '已付款',
  REJECTED: '已驳回',
  REVERSED: '已冲正',
}

function historyLabel(action: WithdrawalHistoryEntry['action']) {
  return historyLabels[action]
}

function statusLabel(status: WithdrawalRequest['status']) {
  return statusLabels[status]
}
</script>

<template>
  <section class="withdrawal-detail" data-withdrawal-detail aria-label="提现申请详情">
    <header class="withdrawal-detail__header">
      <div>
        <span>WITHDRAWAL DETAIL</span>
        <h2>提现申请详情</h2>
      </div>
      <button type="button" class="withdrawal-detail__close" aria-label="关闭" @click="$emit('close')">
        ×
      </button>
    </header>

    <dl class="withdrawal-detail__facts">
      <div>
        <dt>提现单号</dt>
        <dd><code>{{ props.withdrawal.id }}</code></dd>
      </div>
      <div>
        <dt>申请专家</dt>
        <dd>{{ props.withdrawal.expertName }}（{{ props.withdrawal.expertId }}）</dd>
      </div>
      <div>
        <dt>申请金额</dt>
        <dd>¥ {{ props.withdrawal.amount.toFixed(2) }}</dd>
      </div>
      <div>
        <dt>申请时间</dt>
        <dd>{{ props.withdrawal.requestedAt }}</dd>
      </div>
    </dl>

    <section class="withdrawal-detail__section">
      <h3>可提现依据</h3>
      <p>{{ props.withdrawal.withdrawableBasis }}</p>
    </section>

    <section class="withdrawal-detail__section">
      <h3>冻结流水</h3>
      <p>{{ props.withdrawal.freezeLedger }}</p>
    </section>

    <section class="withdrawal-detail__section">
      <h3>收款信息</h3>
      <dl class="withdrawal-detail__bank">
        <div>
          <dt>收款银行</dt>
          <dd>{{ props.withdrawal.bankName }}</dd>
        </div>
        <div>
          <dt>收款账号</dt>
          <dd class="withdrawal-detail__masked" data-masked-account>{{ props.withdrawal.maskedAccount }}</dd>
        </div>
      </dl>
      <p class="withdrawal-detail__privacy">
        账号默认脱敏展示。完整查看需重新认证并写入审计记录（演示以确认提示实现，不展示真实银行卡号）。
      </p>
      <template v-if="!revealRequested">
        <button
          type="button"
          class="withdrawal-detail__reveal"
          data-action="reveal-account"
          @click="revealRequested = true"
        >
          完整查看（需重认证 + 审计）
        </button>
      </template>
      <section v-else class="withdrawal-detail__reveal-confirm" data-reveal-confirm>
        <p>
          演示模式：完整账号查看需重新认证（短信验证码）并写入审计记录；本次演示仅展示脱敏信息，不会显示真实银行卡号。
        </p>
        <footer>
          <button type="button" data-action="cancel-reveal" @click="revealRequested = false">取消</button>
          <button type="button" class="is-primary" data-action="confirm-reveal" @click="revealRequested = false">
            已确认，继续查看（演示）
          </button>
        </footer>
      </section>
    </section>

    <section class="withdrawal-detail__section">
      <h3>历史处理记录</h3>
      <ul class="withdrawal-detail__history">
        <li v-for="entry in props.withdrawal.history" :key="`${entry.action}-${entry.at}`">
          <time>{{ entry.at }}</time>
          <span>{{ historyLabel(entry.action) }}</span>
          <p>{{ entry.note }}</p>
        </li>
        <li v-if="props.withdrawal.history.length === 0">暂无处理记录。</li>
      </ul>
    </section>

    <footer v-if="props.withdrawal.status === 'PENDING'" class="withdrawal-detail__actions">
      <button type="button" data-action="reject-withdrawal" @click="$emit('reject')">驳回</button>
      <button type="button" class="is-primary" data-action="approve-withdrawal" @click="$emit('approve')">
        审核通过
      </button>
    </footer>
    <footer v-else-if="props.withdrawal.status === 'REVIEWING'" class="withdrawal-detail__actions">
      <button type="button" class="is-primary" data-action="fill-payment" @click="$emit('fillPayment')">
        回填付款结果
      </button>
    </footer>
    <p v-else class="withdrawal-detail__decided">
      {{ statusLabel(props.withdrawal.status) }}<template v-if="props.withdrawal.reason"> · 审核意见：{{ props.withdrawal.reason }}</template>
      <template v-if="props.withdrawal.paymentNote"><br />{{ props.withdrawal.paymentNote }}</template>
    </p>
  </section>
</template>

<style scoped>
.withdrawal-detail {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #cbd8e3;
  background: #fff;
}

.withdrawal-detail__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid #dce4ea;
}

.withdrawal-detail__header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.65rem;
  letter-spacing: 0.12em;
}

.withdrawal-detail__header h2 {
  margin: 0.15rem 0 0;
  color: #263744;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.withdrawal-detail__close {
  border: 0;
  background: transparent;
  color: #7c8993;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.withdrawal-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem 1rem;
  margin: 0;
}

.withdrawal-detail__facts dt,
.withdrawal-detail__bank dt {
  color: #78848e;
  font-size: 0.68rem;
}

.withdrawal-detail__facts dd,
.withdrawal-detail__bank dd {
  margin: 0.2rem 0 0;
  color: #3e4e5a;
  font-size: 0.74rem;
}

.withdrawal-detail__facts code {
  color: #1b4f8a;
  font-family: var(--font-data);
}

.withdrawal-detail__section h3 {
  margin: 0 0 0.4rem;
  color: #3e4e5a;
  font-size: 0.75rem;
}

.withdrawal-detail__section > p {
  margin: 0;
  color: #52626e;
  font-size: 0.74rem;
  line-height: 1.65;
}

.withdrawal-detail__bank {
  display: grid;
  gap: 0.45rem;
  margin: 0 0 0.6rem;
}

.withdrawal-detail__masked {
  font-family: var(--font-data);
  letter-spacing: 0.06em;
}

.withdrawal-detail__privacy {
  margin: 0 0 0.6rem;
  color: #7c8993;
  font-size: 0.68rem;
  line-height: 1.6;
}

.withdrawal-detail__reveal {
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  font-size: 0.7rem;
  font-weight: 650;
  cursor: pointer;
}

.withdrawal-detail__reveal-confirm {
  display: grid;
  gap: 0.6rem;
  padding: 0.75rem;
  border: 1px solid #e2c9a1;
  background: color-mix(in srgb, var(--color-warning) 8%, #fff);
}

.withdrawal-detail__reveal-confirm p {
  margin: 0;
  color: #5d4630;
  font-size: 0.72rem;
  line-height: 1.65;
}

.withdrawal-detail__reveal-confirm footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.withdrawal-detail__reveal-confirm button {
  min-height: 2rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  font-size: 0.7rem;
  font-weight: 650;
  cursor: pointer;
}

.withdrawal-detail__reveal-confirm button.is-primary {
  background: var(--color-primary);
  color: var(--color-bg);
}

.withdrawal-detail__history {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.withdrawal-detail__history li {
  display: grid;
  grid-template-columns: 8rem 5rem 1fr;
  gap: 0.5rem;
  align-items: baseline;
  padding: 0.5rem 0.6rem;
  border: 1px solid #e2e8ee;
  background: #f7fafc;
}

.withdrawal-detail__history time {
  color: #7c8993;
  font-family: var(--font-data);
  font-size: 0.65rem;
}

.withdrawal-detail__history span {
  color: #1b4f8a;
  font-size: 0.7rem;
  font-weight: 650;
}

.withdrawal-detail__history p {
  margin: 0;
  color: #52626e;
  font-size: 0.7rem;
  line-height: 1.55;
}

.withdrawal-detail__actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  padding-top: 0.75rem;
  border-top: 1px solid #e2e8ee;
}

.withdrawal-detail__actions button {
  min-height: 2.25rem;
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-primary);
  font-weight: 650;
  cursor: pointer;
}

.withdrawal-detail__actions button.is-primary {
  background: var(--color-primary);
  color: var(--color-bg);
}

.withdrawal-detail__decided {
  margin: 0;
  padding: 0.7rem;
  border: 1px solid #e2e8ee;
  background: #f7fafc;
  color: #52626e;
  font-size: 0.74rem;
  line-height: 1.65;
}

@media (max-width: 900px) {
  .withdrawal-detail__facts {
    grid-template-columns: 1fr;
  }

  .withdrawal-detail__history li {
    grid-template-columns: 1fr;
  }
}
</style>
