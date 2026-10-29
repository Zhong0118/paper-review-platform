<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getReviewChecks, type CheckAck, type CheckFinding, type CheckReport, type CheckTarget } from '@/api/reviewChecks'
import type { ReviewScoreInput } from '@/demo/types'

const props = defineProps<{ target: CheckTarget; payload: ReviewScoreInput }>()
const emit = defineEmits<{ ack: [value: CheckAck | null]; locate: [finding: CheckFinding] }>()
const report = ref<CheckReport | null>(null)
const confirmed = ref<string[]>([])
const loading = ref(false)
const error = ref('')
let generation = 0
const labels: Record<string, string> = { overallComment: '总体评价', issues: '主要问题', revisionAdvice: '修改建议',
  strengths: '主要优点', recommendation: '评审结论' }
const codes = computed(() => [...new Set(report.value?.findings.map(item => item.code) ?? [])].sort())
const acknowledgement = computed<CheckAck | null>(() => report.value && codes.value.every(code => confirmed.value.includes(code))
  ? { payload_hash: report.value.payload_hash, rule_version: report.value.rule_version, codes: codes.value } : null)
watch(acknowledgement, value => emit('ack', value), { immediate: true, flush: 'sync' })
watch(() => JSON.stringify([props.target, props.payload]), () => {
  generation++; report.value = null; confirmed.value = []; error.value = ''; loading.value = false
}, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })
async function check() {
  if (loading.value) return
  const own = ++generation
  report.value = null; confirmed.value = []; error.value = ''; loading.value = true
  try {
    const data = await getReviewChecks(props.target, props.payload)
    if (own !== generation) return
    if (data.status !== 'COMPLETE') throw new Error('检查未完成，请重试')
    report.value = data
  } catch (err) {
    if (own === generation) error.value = err instanceof Error ? err.message : '检查失败，请重试'
  } finally { if (own === generation) loading.value = false }
}
function excerpt(finding: CheckFinding) {
  const value = finding.field.startsWith('evaluations.')
    ? props.payload.evaluations?.[finding.field.slice(12) as keyof NonNullable<ReviewScoreInput['evaluations']>]
    : props.payload[finding.field as keyof ReviewScoreInput]
  const points = Array.from(typeof value === 'string' ? value : '')
  return { before: points.slice(Math.max(0, finding.start - 15), finding.start).join(''),
    match: points.slice(finding.start, finding.end).join(''), after: points.slice(finding.end, finding.end + 15).join('') }
}
</script>

<template>
  <section class="review-checks" aria-label="评语提交前检查">
    <h3>评语提交前检查</h3>
    <p>规则提示仅供核对，不认定评阅不合格，不会自动改写评语。编辑后需重新检查。</p>
    <button type="button" data-action="check-comments" :disabled="loading" @click="check">{{ loading ? '正在检查…' : error ? '重试检查' : '检查当前评语' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="report">
      <p data-check-coverage>规则 {{ report.rule_version }} · 词表 {{ report.coverage.dictionary_version }} · {{ report.coverage.dictionary_entries }} 条词条</p>
      <p>{{ report.coverage.description }}</p>
      <p v-if="!report.findings.length" role="status">本轮规则未命中提示，不代表论文或评语质量已获认证。</p>
      <section v-if="report.similarity" class="similarity-coverage" aria-label="本人历史评语范围内相似性提示">
        <h4>本人历史评语范围内相似性提示</h4>
        <p>仅比较本人过去 {{ report.similarity.coverage.window_days }} 天、最近 {{ report.similarity.coverage.limit }} 条有效结果，本次检查 {{ report.similarity.coverage.examined }} 条；排除本任务全部版本。</p>
        <p v-if="report.similarity.coverage.truncated">历史结果超过上限，仅检查最近 {{ report.similarity.coverage.limit }} 条，未覆盖全部历史。</p>
        <p v-if="report.similarity.status === 'NO_HISTORY'">没有可比较的本人历史评语，不代表质量合格。</p>
        <p v-else-if="report.similarity.status === 'INSUFFICIENT_TEXT'">去除通用模板后不足20个字符，本次未作相似性判断。</p>
        <p v-else>命中 {{ report.similarity.hit_count }} 条；最高字符3-gram Jaccard相似度 {{ report.similarity.max_similarity.toFixed(3) }}（近似阈值 {{ report.similarity.threshold }}，至少40字符）。这是重复线索，不是抄袭率或质量认定。</p>
      </section>
      <section v-for="code in codes" :key="code" class="check-category">
        <div v-for="(finding, index) in report.findings.filter(item => item.code === code)" :key="index">
          <p>{{ labels[finding.field] ?? '分项评价' }}：{{ finding.message }}</p>
          <p class="excerpt">{{ excerpt(finding).before }}<mark>{{ excerpt(finding).match }}</mark>{{ excerpt(finding).after }}</p>
          <p v-if="finding.suggestion">建议：{{ finding.suggestion }}</p>
          <button type="button" @click="emit('locate', finding)">定位原文</button>
        </div>
        <label><input v-model="confirmed" type="checkbox" :value="code" :data-check-code="code">已核对本类提示，保留当前意见</label>
      </section>
    </template>
  </section>
</template>

<style scoped>
.review-checks { display: grid; min-width: 0; overflow-wrap: anywhere; gap: .7rem; border: 1px solid #c8d7e4; background: #f7fafc; padding: 1rem; }
h3, h4, p { margin: 0; } .similarity-coverage { display: grid; gap: .5rem; } p { font-size: .85rem; line-height: 1.6; } button { justify-self: start; padding: .4rem .7rem; }
.check-category { display: grid; gap: .6rem; padding: .7rem; border-left: 3px solid #b38a38; background: #fff; }
.check-category > div { display: grid; gap: .35rem; } .excerpt { white-space: pre-wrap; overflow-wrap: anywhere; }
mark { background: #ffe5a1; } label { display: flex; align-items: center; gap: .5rem; font-size: .85rem; }
</style>
