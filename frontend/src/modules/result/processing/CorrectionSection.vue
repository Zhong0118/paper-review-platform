<script setup lang="ts">
/**
 * U4-1 更正待确认（对象区内分区）：申请理由、平台意见、原生效版本与待确认更正逐项对照。
 * 确认与不予确认各自一个确认框，原因必填。学校看不到专家身份，这里也不显示或猜别名。
 */
import { computed, ref } from 'vue'

import type { Correction } from '@/api/corrections'
import { beijingDate } from '@/api/taskTiming'
import type { ReviewRuleDimension } from '@/api/review'
import ReviewCheckSummary from '@/components/app/ReviewCheckSummary.vue'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'

import { compareRows, noteOf } from './resultView'
import { useSchoolCorrection, type SchoolDecision } from './useSchoolCorrection'

const props = defineProps<{ correction: Correction; dimensions: ReviewRuleDimension[] }>()
const emit = defineEmits<{ decided: [action: SchoolDecision]; conflict: [] }>()

const command = useSchoolCorrection()
const rows = computed(() => compareRows(props.correction, props.dimensions))
const requestReason = computed(() => noteOf(props.correction, 'EXPERT_REQUEST'))
const platformReason = computed(() => noteOf(props.correction, 'PLATFORM_DECISION'))
const requestedAt = computed(() => beijingDate(props.correction.created_at))

const open = ref<SchoolDecision | null>(null)
const reason = ref('')
const tried = ref(false)
const missing = computed(() => tried.value && !reason.value.trim())

function start(action: SchoolDecision) {
  open.value = action
  reason.value = ''
  tried.value = false
  command.clear()
}
function close() {
  if (!command.pending.value) open.value = null
}
async function submit() {
  tried.value = true
  const action = open.value
  if (!action || !reason.value.trim()) return
  const outcome = await command.decide(action, props.correction, reason.value)
  if (!outcome) return
  if (outcome.ok) {
    open.value = null
    emit('decided', action)
  } else if (outcome.conflict) {
    open.value = null
    emit('conflict')
  }
}
</script>

<template>
  <section class="wsd-sec wsd-sec--attention" aria-labelledby="corr-h" data-correction>
    <div class="wsd-sec__head">
      <h3 id="corr-h">更正待确认</h3>
      <p>专家于 {{ requestedAt }} 申请，平台已批准</p>
    </div>
    <p v-if="requestReason" class="wsd-plain">申请理由：{{ requestReason }}</p>
    <p v-if="platformReason" class="wsd-plain muted">平台意见：{{ platformReason }}</p>

    <div v-if="rows.length" class="wsd-twrap">
      <table class="wsd-dtable compare">
        <thead><tr><th scope="col">项目</th><th scope="col">原生效版本</th><th scope="col">待确认更正</th></tr></thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-changed="row.changed || undefined">
            <th scope="row" class="wsd-shrink">{{ row.label }}</th>
            <td class="wsd-plain" data-label="原生效版本">{{ row.before || '未填写' }}</td>
            <td class="wsd-plain" data-label="待确认更正" :class="{ changed: row.changed }">{{ row.after || '未填写' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else class="wsd-banner wsd-banner--warn" role="status">没有取得两个版本的对照内容，暂不能确认这次更正；可以刷新后再看，或不予确认。</p>
    <ReviewCheckSummary v-if="correction.revision" :summary="correction.revision.check_summary" />

    <p class="wsd-hint">确认后，系统自动追加一条发布记录，学生与导师会看到更正后的结果和“已更正”说明，不需要再次发布。</p>
    <div class="wsd-acts wsd-acts--end">
      <button type="button" class="btn" data-action="reject-correction" @click="start('reject')">不予确认…</button>
      <button type="button" class="btn btn--primary" data-action="activate-correction" :disabled="!rows.length" @click="start('activate')">确认更正…</button>
    </div>

    <ConfirmDialog :open="open !== null" :title="open === 'activate' ? '确认这次更正' : '不予确认这次更正'" :busy="command.pending.value" @close="close">
      <template v-if="open === 'activate'">
        <p>确认后，总分由 {{ correction.before?.total }} 变为 {{ correction.revision?.total }}，系统自动追加一条发布记录。</p>
        <p class="muted">学生与导师会看到更正后的结果，并看到“结果已更正”的说明。</p>
      </template>
      <p v-else>原生效版本保持不变，学生与导师看到的内容不变。</p>
      <label class="field">
        <span>{{ open === 'activate' ? '确认说明' : '不予确认的原因' }}（平台与专家可见）</span>
        <textarea v-model="reason" class="textarea" rows="3" maxlength="2000" data-correction-reason :disabled="command.pending.value" :aria-invalid="missing" aria-describedby="corr-reason-err" />
        <small v-if="missing" id="corr-reason-err" class="field-error">请填写{{ open === 'activate' ? '确认说明' : '原因' }}。</small>
      </label>
      <p v-if="command.error.value" class="field-error" role="alert">{{ command.error.value }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="command.pending.value" @click="close">取消</button>
        <button type="button" class="btn" :class="open === 'activate' ? 'btn--primary' : 'btn--danger'" data-action="confirm-decision" :disabled="command.pending.value" @click="submit">
          {{ command.pending.value ? '正在提交…' : open === 'activate' ? '确认更正' : '不予确认' }}
        </button>
      </template>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.compare th[scope='row'] {
  color: var(--ws-muted);
  font-weight: 400;
  vertical-align: top;
}
.compare td {
  width: 45%;
  vertical-align: top;
  line-height: 1.65;
}
.changed {
  background: var(--ws-warning-soft);
}
@media (max-width: 899px) {
  .compare thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .compare tr {
    display: grid;
    gap: 4px;
    padding: 8px 0;
    border-bottom: 1px solid var(--ws-border);
  }
  .compare th,
  .compare td {
    display: block;
    width: auto;
    padding: 2px 8px;
    border: 0;
  }
  .compare td::before {
    content: attr(data-label) '：';
    color: var(--ws-muted);
    font-size: 12px;
  }
}
</style>
