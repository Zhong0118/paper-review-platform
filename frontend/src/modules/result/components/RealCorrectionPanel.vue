<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { correctionCommand, getTaskCorrections, listCorrections, type Correction, type CorrectionAction, type TaskCorrections } from '@/api/corrections'
import type { CheckAck } from '@/api/reviewChecks'
import type { ReviewRuleDimension } from '@/api/review'
import type { ReviewScoreInput } from '@/demo/types'
import ReviewFormPane from '@/modules/review/components/ReviewFormPane.vue'
import ReviewCheckSummary from '@/components/app/ReviewCheckSummary.vue'

const props = defineProps<{ mode: 'expert' | 'platform' | 'school'; taskId?: string; thesisId?: string; initialCorrectionId?: string; dimensions?: ReviewRuleDimension[] }>()
const emit = defineEmits<{ changed: [] }>()
const rows = ref<Correction[]>([])
const context = ref<TaskCorrections | null>(null)
const reason = ref('')
const loading = ref(true)
const pending = ref(false)
const error = ref('')
const notice = ref('')
const selectedId = ref('')
const confirmation = ref<{ action: CorrectionAction; target: string; body: unknown } | null>(null)
let generation = 0
let retryCommand: { signature: string; key: string } | null = null
const visibleRows = computed(() => props.mode === 'school' && props.thesisId
  ? rows.value.filter(row => row.thesis_id === props.thesisId && (!props.initialCorrectionId || row.id === props.initialCorrectionId)) : rows.value)
const selected = computed(() => visibleRows.value.find(row => row.id === selectedId.value))
const open = computed(() => rows.value.some(row => ['REQUESTED', 'APPROVED', 'AWAITING_SCHOOL'].includes(row.status)))
const labels: Record<Correction['status'], string> = {
  REQUESTED: '待平台审批', APPROVED: '已批准，待专家提交', REJECTED: '平台已驳回', CANCELLED: '申请已取消',
  AWAITING_SCHOOL: '待学校确认', ACTIVATED: '更正已生效', SCHOOL_REJECTED: '学校未予确认',
}
const fieldLabels: Record<string, string> = { topicValue: '选题价值', literatureTheory: '文献与理论基础', methodology: '研究方法', innovation: '创新性', writingStandards: '写作与学术规范', resultsWorkload: '研究成果与工作量', recommendation: '评审建议', overallComment: '总体评价', issues: '主要问题', strengths: '主要优点', revisionAdvice: '修改建议', evaluations: '分项评价' }
function fieldValue(value: unknown): string {
  return value && typeof value === 'object' ? Object.entries(value).map(([key, text]) => `${fieldLabels[key] ?? key}：${text}`).join('；') : String(value ?? '')
}
const editDraft = computed(() => selected.value?.draft_payload && Object.keys(selected.value.draft_payload).length
  ? selected.value.draft_payload as ReviewScoreInput : context.value?.current_payload)

async function load() {
  const own = ++generation
  loading.value = true
  error.value = ''
  try {
    if (props.mode === 'expert' && props.taskId) {
      const data = await getTaskCorrections(props.taskId)
      if (own !== generation) return
      context.value = data
      rows.value = data.requests
    } else if (props.mode !== 'expert') {
      const data = await listCorrections(props.mode)
      if (own !== generation) return
      rows.value = data
    }
    if (!visibleRows.value.some(row => row.id === selectedId.value)) selectedId.value = visibleRows.value[0]?.id ?? ''
  } catch (err) {
    if (own === generation) error.value = err instanceof Error ? err.message : '更正记录加载失败'
  } finally {
    if (own === generation) loading.value = false
  }
}
watch(() => [props.mode, props.taskId, props.thesisId, props.initialCorrectionId], () => {
  rows.value = []; context.value = null; reason.value = ''; confirmation.value = null
  selectedId.value = ''; notice.value = ''; retryCommand = null
  void load()
}, { immediate: true })
onBeforeUnmount(() => { generation++ })

async function act(action: CorrectionAction, target: string, body: unknown) {
  if (pending.value) return
  const own = generation
  const signature = JSON.stringify({ action, target, body })
  if (!retryCommand || retryCommand.signature !== signature) retryCommand = { signature, key: crypto.randomUUID() }
  pending.value = true; error.value = ''; notice.value = ''
  try {
    await correctionCommand(action, target, body, retryCommand.key)
    if (own !== generation) return
    retryCommand = null; confirmation.value = null; reason.value = ''
    notice.value = action === 'draft' ? '更正草稿已保存' : '操作已完成，记录已刷新'
    await load()
    emit('changed')
  } catch (err) {
    if (own !== generation) return
    const status = (err as { response?: { status?: number } }).response?.status
    if (status === 409) { retryCommand = null; confirmation.value = null; await load() }
    error.value = status === 409 ? '记录已变化，请核对刷新后的内容再操作。' : (err instanceof Error ? err.message : '操作失败，可重试')
  } finally { pending.value = false }
}
function requestCorrection() {
  if (!context.value || !props.taskId || !reason.value.trim()) return
  void act('request', props.taskId, { base_result_id: context.value.base_result_id,
    base_revision_id: context.value.base_revision_id, reason: reason.value.trim() })
}
function decide(action: 'decide' | 'activate' | 'reject', decision?: string) {
  if (!selected.value || !reason.value.trim()) return
  confirmation.value = { action, target: selected.value.id, body: { version: selected.value.version,
    reason: reason.value.trim(), ...(decision ? { decision } : {}) } }
}
function draftAction(payload: ReviewScoreInput, submit: boolean, ack?: CheckAck) {
  if (!selected.value) return
  const body = { version: selected.value.version, payload, ...(submit && ack ? { check_ack: ack } : {}) }
  if (submit) confirmation.value = { action: 'submit', target: selected.value.id, body }
  else void act('draft', selected.value.id, body)
}
</script>

<template>
  <section class="correction-panel" aria-label="正式结果更正">
    <h2>正式结果更正</h2>
    <p>学校确认前，已发布的旧结果继续有效。更正保留原记录，不恢复论文阅读权限。</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <p v-if="loading" role="status">正在加载更正记录…</p>
    <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="pending" @click="load">刷新记录</button></p>
    <template v-if="!loading && !error">
      <p v-if="!visibleRows.length">暂无更正申请。</p>
      <label v-if="visibleRows.length">更正记录
        <select v-model="selectedId" :disabled="pending || !!confirmation" @change="reason = ''">
          <option v-for="row in visibleRows" :key="row.id" :value="row.id">{{ row.task_id.slice(0, 8) }} · {{ labels[row.status] }}</option>
        </select>
      </label>
      <div v-if="selected">
        <p>{{ labels[selected.status] }}</p>
        <p v-for="(note, index) in selected.notes" :key="index">{{ note.reason }}</p>
        <div v-if="mode === 'school' && selected.before && selected.revision" class="comparison">
          <section><h3>原生效版本 · {{ selected.before.total }} 分</h3>
            <p v-for="(value, field) in selected.before.payload" :key="field">{{ fieldLabels[field] ?? field }}：{{ fieldValue(value) }}</p></section>
          <section><h3>待确认更正 · {{ selected.revision.total }} 分</h3>
            <p v-for="(value, field) in selected.revision.payload" :key="field">{{ fieldLabels[field] ?? field }}：{{ fieldValue(value) }}</p></section>
        </div>
        <ReviewCheckSummary v-if="selected.revision" :summary="selected.revision.check_summary" />
        <ReviewFormPane v-if="mode === 'expert' && selected.status === 'APPROVED'" :key="selected.id"
          :locked="pending || !!confirmation" :saving="pending" :hide-exit="true" :check-target="{ kind: 'correction', id: selected.id }" :draft="editDraft" :dimensions="dimensions"
          @save="draftAction($event, false)" @submit="(payload, ack) => draftAction(payload, true, ack)" />
        <button v-if="mode === 'expert' && ['REQUESTED','APPROVED'].includes(selected.status)" type="button" :disabled="pending"
          @click="act('cancel', selected.id, { version: selected.version })">取消申请</button>
      </div>
      <label v-if="(mode === 'expert' && !open) || (mode === 'platform' && selected?.status === 'REQUESTED') || (mode === 'school' && selected?.status === 'AWAITING_SCHOOL')">
        {{ mode === 'expert' ? '申请理由（仅本人和平台可见）' : mode === 'school' ? '确认或驳回理由（仅本校和平台可见）' : '审批理由' }}
        <textarea v-model="reason" data-correction-reason maxlength="2000" :disabled="pending || !!confirmation" />
      </label>
      <button v-if="mode === 'expert' && !open" type="button" data-action="request-real-correction" :disabled="pending || !reason.trim()" @click="requestCorrection">申请更正</button>
      <template v-if="mode === 'platform' && selected?.status === 'REQUESTED'">
        <button type="button" :disabled="pending || !reason.trim()" @click="decide('decide', 'APPROVE')">批准更正</button>
        <button type="button" :disabled="pending || !reason.trim()" @click="decide('decide', 'REJECT')">驳回申请</button>
      </template>
      <template v-if="mode === 'school' && selected?.status === 'AWAITING_SCHOOL'">
        <button type="button" :disabled="pending || !reason.trim()" @click="decide('activate')">确认更正（已发布结果将同步更新）</button>
        <button type="button" :disabled="pending || !reason.trim()" @click="decide('reject')">不予确认</button>
      </template>
    </template>
    <section v-if="confirmation" class="confirmation" aria-label="操作确认">
      <p>{{ confirmation.action === 'activate' ? '确认后新版本生效；已发布论文将追加新的发布记录。' : '请确认本次操作，提交后须按后续审批流程处理。' }}</p>
      <button type="button" :disabled="pending" @click="act(confirmation.action, confirmation.target, confirmation.body)">确认操作</button>
      <button type="button" :disabled="pending" @click="confirmation = null">返回核对</button>
    </section>
  </section>
</template>
<style scoped>
.correction-panel { display: grid; gap: .8rem; padding: 1rem; border: 1px solid #dce3e9; background: white; }
.correction-panel h2, .correction-panel h3, .correction-panel p { margin: 0; }
.correction-panel label { display: grid; gap: .5rem; }
.correction-panel textarea { min-height: 6rem; }
.correction-panel button { justify-self: start; padding: .5rem .75rem; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; overflow-wrap: anywhere; }
.confirmation { padding: 1rem; border: 1px solid #bb8b3b; }
@media (max-width: 700px) { .comparison { grid-template-columns: 1fr; } }
</style>
