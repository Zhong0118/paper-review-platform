<script setup lang="ts">
import { computed } from 'vue'

import type { ReviewTaskStatus, SchoolBillStatus, ThesisStage } from '@/demo/types'

const props = defineProps<{
  stage: ThesisStage
  taskStatus?: ReviewTaskStatus
  billStatus?: SchoolBillStatus
}>()

const stageLabels: Record<ThesisStage, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  PREPARING: '送审准备中',
  READY_FOR_DISPATCH: '待送审',
  UNDER_REVIEW: '送审中',
  RESULT_PROCESSING: '结果处理中',
  COMPLETED: '已完成',
  TERMINATED: '已终止',
}

const taskLabels: Record<ReviewTaskStatus, string> = {
  INVITED: '待专家接单',
  IN_REVIEW: '专家评阅中',
  SUBMITTED: '专家已提交',
  REJECTED: '专家已拒绝',
  ACCEPT_TIMEOUT: '接单已超时',
  CANCELLED: '任务已取消',
}

const billLabels: Record<SchoolBillStatus, string> = {
  FROZEN: '额度已冻结',
  CONSUMED: '账单已消费',
  RELEASED: '额度已释放',
  CANCELLED: '账单已取消',
  REVERSED: '账单已冲正',
}

const stageLabel = computed(() => stageLabels[props.stage])
</script>

<template>
  <aside class="scenario-ribbon" aria-label="主线业务状态">
    <div class="scenario-ribbon__lead">
      <span>主线论文</span>
      <strong>HY-2026-0042</strong>
    </div>
    <div class="scenario-ribbon__state" :data-stage="stage">
      <span>论文阶段</span>
      <strong>{{ stageLabel }}</strong>
    </div>
    <div v-if="taskStatus" class="scenario-ribbon__state" :data-task-status="taskStatus">
      <span>专家任务</span>
      <strong>{{ taskLabels[taskStatus] }}</strong>
    </div>
    <div v-if="billStatus" class="scenario-ribbon__state" :data-bill-status="billStatus">
      <span>学校账务</span>
      <strong>{{ billLabels[billStatus] }}</strong>
    </div>
  </aside>
</template>

<style scoped>
.scenario-ribbon {
  display: grid;
  grid-template-columns: minmax(11rem, 1.2fr) repeat(3, minmax(9rem, 1fr));
  overflow: hidden;
  border: 1px solid #d7dfe6;
  background: #fff;
}

.scenario-ribbon > div {
  min-height: 4rem;
  padding: 0.7rem 0.9rem;
  border-right: 1px solid #e1e6ea;
}

.scenario-ribbon > div:last-child {
  border-right: 0;
}

.scenario-ribbon span,
.scenario-ribbon strong {
  display: block;
}

.scenario-ribbon span {
  color: #71808c;
  font-size: 0.68rem;
}

.scenario-ribbon strong {
  margin-top: 0.28rem;
  color: #2d3e4b;
  font-family: var(--font-data);
  font-size: 0.78rem;
}

.scenario-ribbon__lead {
  box-shadow: inset 4px 0 var(--color-primary);
  background: var(--color-primary-50);
}

[data-bill-status='FROZEN'] {
  background: var(--color-billing-frozen-soft);
}

[data-stage='RESULT_PROCESSING'] {
  background: var(--color-result-processing-soft);
}

@media (max-width: 760px) {
  .scenario-ribbon {
    grid-template-columns: 1fr 1fr;
  }

  .scenario-ribbon > div:nth-child(2n) {
    border-right: 0;
  }
}
</style>
