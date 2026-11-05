<script setup lang="ts">
import { ref } from 'vue'
import { REVIEW_SCORE_TEMPLATE } from '@/demo/types'
import type { ReviewScoreInput } from '@/demo/types'
import type { ReviewRuleDimension } from '@/api/review'
import ScoreDimensionInput from './ScoreDimensionInput.vue'
import { useReviewForm } from '../composables/useReviewForm'
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
  edited: [input: ReviewScoreInput]
  exit: []
}>()

const checkAck = ref<CheckAck | null>(null)
const formElement = ref<HTMLElement | null>(null)

// U2-2：表单状态与自动保存搬到 useReviewForm（原样搬家，旧 spec 不改）
const {
  dimensions, scores, evaluations, recommendation, strengths, issues, revisionAdvice, overallComment,
  total, maxTotal, fieldErrors, complete, payload,
} = useReviewForm(props, {
  edited: (input) => emit('edited', input),
  autosave: (input) => emit('autosave', input),
})

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
