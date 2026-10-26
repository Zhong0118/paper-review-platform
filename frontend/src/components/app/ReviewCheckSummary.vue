<script setup lang="ts">
import type { CheckSummary } from '@/api/reviewChecks'
defineProps<{ summary?: CheckSummary | null }>()
const labels: Record<string, string> = { OWN_HISTORY_SIMILARITY: '本人历史评语相似片段', SHORT_OVERALL: '总体评价偏短', SHORT_ISSUES: '主要问题偏短',
  REPEATED_SENTENCE: '长句重复', EXPLICIT_CONCLUSION_CONFLICT: '明确结论与评分档位不同',
  PHONE_CANDIDATE: '疑似手机号', ID_NUMBER_CANDIDATE: '疑似身份证号' }
</script>
<template>
  <div class="check-summary">
    <p v-if="!summary">评语规则检查：历史结果未检测。</p>
    <template v-else>
      <p>评语规则检查：{{ summary.codes.length ? '提示已由专家确认' : '本轮规则未命中提示' }}，不代表质量认证。</p>
      <p v-for="code in summary.codes" :key="code">{{ labels[code] ?? '受控词表提示' }}：{{ summary.counts[code] }}处</p>
      <small>规则 {{ summary.rule_version }} · {{ new Date(summary.confirmed_at).toLocaleString() }}</small>
    </template>
  </div>
</template>
<style scoped>.check-summary { margin-top: .75rem; padding: .75rem; background: #f4f7fa; font-size: .8rem; } p { margin: .3rem 0; } small { color: #53636f; }</style>
