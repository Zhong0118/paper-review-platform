<script setup lang="ts">
import type { SchoolBill, SchoolBillStatus } from '@/demo/types'

defineProps<{ rows: SchoolBill[] }>()

const labels: Record<SchoolBillStatus, string> = { FROZEN:'额度已冻结',CONSUMED:'已消费',RELEASED:'已释放',CANCELLED:'已取消',REVERSED:'已冲正' }
const formatAmount = (amount:number)=>new Intl.NumberFormat('zh-CN',{minimumFractionDigits:2}).format(amount)
</script>

<template>
  <div class="bill-table-wrap">
    <table class="bill-table">
      <thead><tr><th>账单号</th><th>盲审编号</th><th>费用规则</th><th>金额</th><th>状态</th><th>冻结时间</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :data-bill-id="row.id">
          <td><code>{{ row.id }}</code></td><td><strong>{{ row.anonymousId }}</strong></td><td>{{ row.ruleVersion }}</td><td>¥ {{ formatAmount(row.amount) }}</td><td><span :data-status="row.status">{{ labels[row.status] }}</span></td><td>{{ row.createdAt }}</td><td><button type="button">查看流水</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!rows.length" class="bill-table__empty">当前没有送审账单。确认送审并成功冻结额度后，账单会显示在这里。</p>
  </div>
</template>

<style scoped>
.bill-table-wrap{overflow-x:auto;border:1px solid #d8e0e6;background:#fff}.bill-table{width:100%;min-width:58rem;border-collapse:collapse}.bill-table th,.bill-table td{padding:.78rem .85rem;border-bottom:1px solid #e7ebee;text-align:left;font-size:.72rem}.bill-table th{background:#f7f9fb;color:#667581;font-size:.66rem;font-weight:650}.bill-table code{font-family:var(--font-data);color:#667581}.bill-table strong{color:#1b4f8a;font-family:var(--font-data)}.bill-table [data-status]{display:inline-flex;padding:.2rem .45rem;border-radius:.25rem;background:#eef2f5;color:#4a5b68;font-weight:650}.bill-table [data-status='FROZEN']{background:var(--color-billing-frozen-soft);color:var(--color-billing-frozen)}.bill-table [data-status='CONSUMED']{background:#edf7ee;color:#2e6b32}.bill-table button{border:0;background:transparent;color:#1b4f8a;font-weight:650;cursor:pointer}.bill-table__empty{margin:0;padding:2rem;color:#71808c;text-align:center}
</style>
