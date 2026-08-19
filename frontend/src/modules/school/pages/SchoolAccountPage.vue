<script setup lang="ts">
import { onMounted, ref } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { SchoolAccountSummary as Account, SchoolBill } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'

import SchoolAccountSummary from '../components/SchoolAccountSummary.vue'
import SchoolBillTable from '../components/SchoolBillTable.vue'

const service=useScenarioService()
const account=ref<Account>({currency:'CNY',availableAmount:0,frozenAmount:0,consumedAmount:0})
const bills=ref<SchoolBill[]>([])
onMounted(async()=>{await service.loginAs('school_reviewer');account.value=await service.getSchoolAccount();bills.value=await service.getSchoolBills()})
</script>

<template>
  <PortalLayout :menu-items="menusByRole.school_reviewer??[]" active-path="/school/account" context-label="学校端 · 海岳大学" user-name="王老师">
    <div class="school-account-page">
      <PageHeader eyebrow="PAGE-024 · SCHOOL ACCOUNT" title="学校账户与账单" description="查看本校可用与冻结额度，并按盲审编号追溯每一笔送审费用。额度由百杰根据线下充值或合同录入，学校端只读。" />
      <BlindRail audience="本校账户额度、学生与送审账单" hidden-from="专家身份、专家提现余额和其他学校账务" stage="学校付费 · 学生无支付入口" />
      <SchoolAccountSummary :account="account" />
      <section class="bill-section"><header><div><span>REVIEW BILL LEDGER</span><h2>送审账单</h2></div><p>冻结、消费、释放和冲正均保留原始流水</p></header><SchoolBillTable :rows="bills" /></section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.school-account-page{display:grid;min-width:0;gap:1rem}.school-account-page>*{min-width:0}.bill-section>header{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:.55rem}.bill-section header span{color:#6c7984;font-family:var(--font-data);font-size:.65rem;letter-spacing:.12em}.bill-section h2{margin:.15rem 0 0;color:#273a48;font-family:var(--font-display);font-size:1rem}.bill-section header p{margin:0;color:#74818c;font-size:.68rem}@media(max-width:620px){.bill-section>header{align-items:start;flex-direction:column}}
</style>
