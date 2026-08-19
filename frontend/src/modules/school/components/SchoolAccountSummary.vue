<script setup lang="ts">
import type { SchoolAccountSummary } from '@/demo/types'

defineProps<{ account: SchoolAccountSummary }>()

const formatAmount = (amount: number) =>
  new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
</script>

<template>
  <section class="account-summary" aria-label="学校账户额度摘要">
    <article data-account="available"><span>可用额度</span><strong>¥ {{ formatAmount(account.availableAmount) }}</strong><small>可用于确认新送审</small></article>
    <article data-account="frozen"><span>冻结额度</span><strong>¥ {{ formatAmount(account.frozenAmount) }}</strong><small>已确认送审，等待有效评阅</small></article>
    <article data-account="month"><span>本月消费</span><strong>¥ {{ formatAmount(account.consumedAmount) }}</strong><small>有效评阅形成的送审账单</small></article>
    <article data-account="total"><span>累计消费</span><strong>¥ {{ formatAmount(account.consumedAmount) }}</strong><small>演示账户当前累计</small></article>
  </section>
</template>

<style scoped>
.account-summary{display:grid;grid-template-columns:repeat(4,minmax(10rem,1fr));border:1px solid #d8e0e6;background:#fff}.account-summary article{padding:1rem;border-right:1px solid #e1e6ea}.account-summary article:last-child{border-right:0}.account-summary span,.account-summary strong,.account-summary small{display:block}.account-summary span{color:#6d7b86;font-size:.7rem}.account-summary strong{margin:.35rem 0;color:#233b50;font-family:var(--font-data);font-size:1.35rem}.account-summary small{color:#82909a;font-size:.65rem;line-height:1.5}[data-account='frozen']{background:var(--color-billing-frozen-soft)}@media(max-width:760px){.account-summary{grid-template-columns:1fr 1fr}.account-summary article:nth-child(2n){border-right:0}}
</style>
