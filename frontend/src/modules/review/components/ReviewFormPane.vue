<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { REVIEW_SCORE_TEMPLATE } from '@/demo/types'
import type { ReviewScoreInput } from '@/demo/types'
import ScoreDimensionInput from './ScoreDimensionInput.vue'

const props = defineProps<{ locked: boolean; saving?: boolean }>()
const emit = defineEmits<{
  save: [input: ReviewScoreInput]
  submit: [input: ReviewScoreInput]
  exit: []
}>()

// 六维评分按模板数据动态渲染（设计 §4.4：维度/满分/说明均来自模板快照，不写死）。
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

const total = computed(() =>
  REVIEW_SCORE_TEMPLATE.reduce((sum, dimension) => sum + (scores[dimension.key] ?? 0), 0),
)
const maxTotal = computed(() =>
  REVIEW_SCORE_TEMPLATE.reduce((sum, dimension) => sum + dimension.maxScore, 0),
)

// 提交前完整性检查：按模板逐维校验越界/缺项，并校验必填文本，全部字段级报错。
const fieldErrors = computed<Array<{ field: string; message: string }>>(() => {
  const errors: Array<{ field: string; message: string }> = []
  for (const dimension of REVIEW_SCORE_TEMPLATE) {
    const value = scores[dimension.key] ?? 0
    if (!Number.isFinite(value) || value < 0 || value > dimension.maxScore) {
      errors.push({
        field: dimension.key,
        message: `${dimension.label}分值应在 0–${dimension.maxScore} 之间。`,
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
</script>

<template>
  <section
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
        v-for="dimension in REVIEW_SCORE_TEMPLATE"
        :key="dimension.key"
        :label="dimension.label"
        :max="dimension.maxScore"
        :guide="dimension.guide"
        :model-value="scores[dimension.key] ?? 0"
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
      <span>主要问题</span>
      <textarea v-model="issues" name="mainIssues" rows="3" :disabled="locked" />
    </label>
    <label>
      <span>修改建议</span>
      <textarea v-model="revisionAdvice" name="revisionAdvice" rows="3" :disabled="locked" />
    </label>

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
      <button type="button" class="quiet" data-action="exit-review" :disabled="locked" @click="emit('exit')">
        暂存退出
      </button>
      <button
        type="button"
        class="primary"
        data-action="submit-final-review"
        :disabled="locked || !complete"
        @click="emit('submit', payload())"
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
