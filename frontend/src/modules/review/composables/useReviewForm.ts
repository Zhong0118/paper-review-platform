/**
 * 评阅表单状态：评分、分项评价、评语、完整性检查、载荷与输入后自动保存。
 * U2-2 从 ReviewFormPane 原样搬出，旧表单（含更正面板里的表单）与新专注评阅表单共用。
 * 规则不变：0 是合法分数，不提供留空、不发送 null（UX-01 未决）；分项评价为空不进入载荷。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { REVIEW_SCORE_TEMPLATE } from '@/demo/types'
import type { ReviewScoreInput } from '@/demo/types'
import type { ReviewRuleDimension } from '@/api/review'

export interface ReviewFormProps {
  locked: boolean
  draft?: ReviewScoreInput | null
  dimensions?: ReviewRuleDimension[]
}

export interface ReviewFormEvents {
  edited: (input: ReviewScoreInput) => void
  autosave: (input: ReviewScoreInput) => void
}

export function useReviewForm(props: ReviewFormProps, events: ReviewFormEvents) {
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

  let applyingDraft = false
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null

  /** 回填已保存草稿（页面刷新后恢复表单内容）。 */
  function applyDraft(draft: ReviewScoreInput | null | undefined) {
    if (!draft) return
    applyingDraft = true
    if (autosaveTimer !== null) clearTimeout(autosaveTimer)
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
    applyingDraft = false
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

  // 自动保存：输入停止 800ms 后发出 autosave，页面收到即落盘；锁定时不自动保存。
  function scheduleAutosave() {
    if (props.locked) return
    if (autosaveTimer !== null) clearTimeout(autosaveTimer)
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      events.autosave(payload())
    }, 800)
  }

  watch(
    [scores, evaluations, recommendation, strengths, issues, revisionAdvice, overallComment],
    () => { if (!props.locked && !applyingDraft) { events.edited(payload()); scheduleAutosave() } },
    { deep: true, flush: 'sync' },
  )

  onBeforeUnmount(() => {
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer)
      autosaveTimer = null
    }
  })

  return {
    dimensions, scores, evaluations, recommendation, strengths, issues, revisionAdvice, overallComment,
    total, maxTotal, fieldErrors, complete, payload,
  }
}
