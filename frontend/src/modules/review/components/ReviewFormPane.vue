<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { REVIEW_SCORE_TEMPLATE } from '@/demo/types'
import type { ReviewScoreInput } from '@/demo/types'
import type { ReviewRuleDimension } from '@/api/review'
import ScoreDimensionInput from './ScoreDimensionInput.vue'
import ReviewCheckPanel from '@/components/app/ReviewCheckPanel.vue'
import type { CheckAck, CheckFinding, CheckTarget } from '@/api/reviewChecks'

const props = defineProps<{
  locked: boolean
  saving?: boolean
  hideExit?: boolean
  checkTarget?: CheckTarget
  /** 已保存草稿（刷新后回填表单；缺省/空则保持空表单）。 */
  draft?: ReviewScoreInput | null
  dimensions?: ReviewRuleDimension[]
}>()
const emit = defineEmits<{
  save: [input: ReviewScoreInput]
  /** 输入变化自动保存（表单内防抖 800ms 后发出，页面收到即落盘）。 */
  autosave: [input: ReviewScoreInput]
  submit: [input: ReviewScoreInput, ack?: CheckAck]
  edited: []
  exit: []
}>()

const checkAck = ref<CheckAck | null>(null)
const formElement = ref<HTMLElement | null>(null)

const dimensions = computed<ReviewRuleDimension[]>(() => props.dimensions ?? REVIEW_SCORE_TEMPLATE.map(
  ({ key, label, maxScore }) => ({ key, label, max_score: maxScore }),
))
// 六维评分按当前任务的规则快照渲染；演示模式传入旧模板投影。
const scores = reactive<Record<string, number>>(
  Object.fromEntries(REVIEW_SCORE_TEMPLATE.map((dimension) => [dimension.key, 0])),
)
// 每维「可选评价」（缺省的维度不进入提交载荷）。
const evaluations = reactive<Record<string, string>>({})

const recommendation = ref('建议通过')
const strengths = ref('')
const issues = ref('')
const revisionAdvice = ref('')
const overallComment = ref('')

/** 回填已保存草稿（页面刷新后恢复表单内容）。 */
function applyDraft(draft: ReviewScoreInput | null | undefined) {
  if (!draft) return
  for (const dimension of dimensions.value) {
    const value = draft[dimension.key]
    if (Number.isFinite(value)) scores[dimension.key] = value
  }
  recommendation.value = draft.recommendation ?? '建议通过'
  strengths.value = draft.strengths ?? ''
  issues.value = draft.issues ?? ''
  revisionAdvice.value = draft.revisionAdvice ?? ''
  overallComment.value = draft.overallComment ?? ''
  for (const dimension of dimensions.value) {
    evaluations[dimension.key] = draft.evaluations?.[dimension.key] ?? ''
  }
}
// 草稿以属性传入（页面刷新后由服务读回）；页面再次装载时也会触发回填。
watch(
  () => props.draft,
  (draft) => applyDraft(draft),
  { immediate: true },
)

const total = computed(() =>
  dimensions.value.reduce((sum, dimension) => sum + (scores[dimension.key] ?? 0), 0),
)
const maxTotal = computed(() =>
  dimensions.value.reduce((sum, dimension) => sum + dimension.max_score, 0),
)

// 提交前完整性检查：按模板逐维校验越界/缺项，并校验必填文本，全部字段级报错。
const fieldErrors = computed<Array<{ field: string; message: string }>>(() => {
  const errors: Array<{ field: string; message: string }> = []
  for (const dimension of dimensions.value) {
    const value = scores[dimension.key] ?? 0
    if (!Number.isFinite(value) || value < 0 || value > dimension.max_score) {
      errors.push({
        field: dimension.key,
        // 与 ScoreDimensionInput 单维错误、服务端校验保持同一文案（评审修复：统一越界文案）。
        message: `${dimension.label}分值应在 0–${dimension.max_score} 之间（满分 ${dimension.max_score}）。`,
      })
    }
  }
  if (!overallComment.value.trim()) {
    errors.push({ field: 'overallComment', message: '总体评价为必填项。' })
  }
  if (!issues.value.trim()) {
    errors.push({ field: 'issues', message: '主要问题为必填项。' })
  }
  if (!revisionAdvice.value.trim()) {
    errors.push({ field: 'revisionAdvice', message: '修改建议为必填项。' })
  }
  return errors
})

const complete = computed(() => fieldErrors.value.length === 0)

const payload = (): ReviewScoreInput => {
  const evaluationsPayload = Object.fromEntries(
    Object.entries(evaluations).filter(([, value]) => value.trim().length > 0),
  )
  return {
    topicValue: scores.topicValue ?? 0,
    literatureTheory: scores.literatureTheory ?? 0,
    methodology: scores.methodology ?? 0,
    innovation: scores.innovation ?? 0,
    resultsWorkload: scores.resultsWorkload ?? 0,
    writingStandards: scores.writingStandards ?? 0,
    ...(Object.keys(evaluationsPayload).length > 0 ? { evaluations: evaluationsPayload } : {}),
    recommendation: recommendation.value,
    strengths: strengths.value,
    issues: issues.value,
    revisionAdvice: revisionAdvice.value,
    overallComment: overallComment.value,
  }
}

// 自动保存：输入变化即触发防抖保存（评审修复：把「保存草稿」按钮扩展为真实自动保存）。
// 锁定时（提交后只读）不自动保存；输入停止 800ms 后发出 autosave 事件，页面收到即落盘。
// 空表单输入也会触发，由服务端强制完整性校验并报字段级错误。
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutosave() {
  if (props.locked) return
  if (autosaveTimer !== null) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    emit('autosave', payload())
  }, 800)
}

watch(
  [scores, evaluations, recommendation, strengths, issues, revisionAdvice, overallComment],
  () => { emit('edited'); scheduleAutosave() },
  { deep: true },
)

function locate(finding: CheckFinding) {
  const name = finding.field === 'issues' ? 'mainIssues' : finding.field
  const element = Array.from(formElement.value?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? [])
    .find(field => field.name === name)
  if (!element) return
  element.focus()
  element.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  if (element instanceof HTMLTextAreaElement) {
    const points = Array.from(element.value)
    element.setSelectionRange(points.slice(0, finding.start).join('').length, points.slice(0, finding.end).join('').length)
  }
}

onBeforeUnmount(() => {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
})
</script>

<template>
  <section ref="formElement"
    class="review-form"
    :data-review-locked="locked ? 'true' : 'false'"
    aria-labelledby="review-form-title"
  >
    <header>
      <span>REVIEW FORM</span>
      <h2 id="review-form-title">评阅意见</h2>
    </header>
    <p v-if="locked" class="locked-note">最终意见已提交并锁定，只能查看，不能再次编辑。</p>

    <div class="score-sheet">
      <ScoreDimensionInput
        v-for="dimension in dimensions"
        :key="dimension.key"
        :dimension-key="dimension.key"
        :label="dimension.label"
        :max="dimension.max_score"
        :guide="props.dimensions ? '' : REVIEW_SCORE_TEMPLATE.find(item => item.key === dimension.key)?.guide ?? ''"
        :model-value="scores[dimension.key] ?? 0"
        :evaluation="evaluations[dimension.key] ?? ''"
        :locked="locked"
        @update:model-value="scores[dimension.key] = $event"
        @update:evaluation="evaluations[dimension.key] = $event"
      />
      <p class="total" data-total-score>
        总分 <strong>{{ total }} / {{ maxTotal }}</strong>
      </p>
    </div>

    <p
      v-if="!locked && fieldErrors.length > 0"
      class="completeness"
      data-completeness
      role="alert"
    >
      提交前完整性检查：{{ fieldErrors.map((item) => item.message).join('；') }}
    </p>

    <label>
      <span>评审结论</span>
      <select v-model="recommendation" name="recommendation" :disabled="locked">
        <option>建议通过</option>
        <option>建议修改</option>
        <option>不通过</option>
      </select>
    </label>
    <label>
      <span>总体评价（必填）</span>
      <textarea v-model="overallComment" name="overallComment" rows="5" :disabled="locked" />
    </label>
    <label>
      <span>主要优点（选填）</span>
      <textarea v-model="strengths" name="strengths" rows="3" :disabled="locked" />
    </label>
    <label>
      <span>主要问题</span>
      <textarea v-model="issues" name="mainIssues" rows="3" :disabled="locked" />
    </label>
    <label>
      <span>修改建议</span>
      <textarea v-model="revisionAdvice" name="revisionAdvice" rows="3" :disabled="locked" />
    </label>

    <ReviewCheckPanel v-if="checkTarget && !locked" :target="checkTarget" :payload="payload()"
      @ack="checkAck = $event" @locate="locate" />
    <footer class="actions">
      <button
        type="button"
        class="quiet"
        data-action="save-review-draft"
        :disabled="locked || saving"
        @click="emit('save', payload())"
      >
        保存草稿
      </button>
      <button v-if="!hideExit" type="button" class="quiet" data-action="exit-review" :disabled="locked" @click="emit('exit')">
        暂存退出
      </button>
      <button
        type="button"
        class="primary"
        data-action="submit-final-review"
        :disabled="locked || !complete || (!!checkTarget && !checkAck)"
        @click="checkTarget ? emit('submit', payload(), checkAck ?? undefined) : emit('submit', payload())"
      >
        最终提交
      </button>
    </footer>
  </section>
</template>

<style scoped>
.review-form {
  display: grid;
  gap: 0.85rem;
  padding: 1rem;
  border: 1px solid #d7dfe6;
  background: white;
}

.review-form header {
  padding-bottom: 0.65rem;
  border-bottom: 1px solid #e1e6ea;
}

.review-form header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
}

.review-form h2 {
  margin: 0.12rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.review-form label,
.review-form label span {
  display: grid;
  gap: 0.35rem;
}

.review-form label span {
  color: #4b5965;
  font-size: 0.72rem;
  font-weight: 650;
}

.review-form select,
.review-form textarea {
  width: 100%;
  padding: 0.65rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  background: #fbfcfe;
}

.review-form textarea {
  resize: vertical;
  line-height: 1.7;
}

.locked-note {
  margin: 0;
  padding: 0.65rem;
  background: #edf7ee;
  color: #27652c;
  font-size: 0.7rem;
}

.completeness {
  margin: 0;
  padding: 0.65rem 0.75rem;
  background: #fdf3e7;
  color: #8a5410;
  font-size: 0.7rem;
  line-height: 1.6;
}

.score-sheet {
  display: grid;
  gap: 0.6rem;
  border-top: 1px solid #e1e6ea;
  padding-top: 0.75rem;
}

.total {
  display: flex;
  justify-content: space-between;
  margin: 0;
  color: #53636f;
  font-size: 0.72rem;
}

.total strong {
  color: #1b4f8a;
  font-family: var(--font-data);
  font-size: 0.9rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.review-form button {
  min-height: 2.4rem;
  padding: 0.4rem 0.7rem;
  border-radius: 0.3rem;
  font-weight: 650;
}

.quiet {
  border: 1px solid #b8c4ce;
  background: white;
  color: #40515e;
}

.primary {
  border: 1px solid #1b4f8a;
  background: #1b4f8a;
  color: white;
}

.review-form button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
