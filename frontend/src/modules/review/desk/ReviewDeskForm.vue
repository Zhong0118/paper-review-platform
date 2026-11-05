<script setup lang="ts">
/**
 * U2-2 专注评阅的表单：评语 / 评分 / 提交检查 三个分页。
 * 状态、载荷与自动保存来自 useReviewForm（与旧 ReviewFormPane 同一份实现）；
 * 提交前检查沿用 ReviewCheckPanel，确认（ack）与旧页一样是提交的前提。
 * 不另加字数门槛：必填规则与后端一致（总体评价、主要问题、修改建议、各项分数在 0–满分）。
 */
import { computed, nextTick, ref, watch } from 'vue'

import type { ReviewRule } from '@/api/review'
import type { CheckAck, CheckFinding, CheckTarget } from '@/api/reviewChecks'
import ReviewCheckPanel from '@/components/app/ReviewCheckPanel.vue'
import type { ReviewScoreInput } from '@/demo/types'

import { useReviewForm } from '../composables/useReviewForm'

const props = defineProps<{
  locked: boolean
  saving: boolean
  leaving: boolean
  draft: ReviewScoreInput | null
  rule: ReviewRule
  checkTarget: CheckTarget
}>()
const emit = defineEmits<{
  autosave: [input: ReviewScoreInput]
  edited: [input: ReviewScoreInput]
  submit: [input: ReviewScoreInput, ack: CheckAck]
  exit: []
}>()

const form = useReviewForm(
  { get locked() { return props.locked }, get draft() { return props.draft }, get dimensions() { return props.rule.dimensions } },
  { edited: (input) => emit('edited', input), autosave: (input) => emit('autosave', input) },
)
const { dimensions, scores, evaluations, recommendation, strengths, issues, revisionAdvice, overallComment, total, maxTotal, fieldErrors, complete, payload } = form

type Tab = 'comments' | 'scores' | 'check'
const tab = ref<Tab>('comments')
const root = ref<HTMLElement | null>(null)
// 三个页签共用一个滚动区：切换时回到顶部，不沿用上一页签的滚动位置
watch(tab, () => root.value?.querySelector('.dform__scroll')?.scrollTo?.({ top: 0 }))
const checkAck = ref<CheckAck | null>(null)

const band = computed(() => props.rule.bands.find((item) => total.value >= item.min && total.value <= item.max) ?? null)
const scoreInvalid = (key: string, max: number) => {
  const value = scores[key] ?? 0
  return !Number.isFinite(value) || value < 0 || value > max
}
const scoresOk = computed(() => dimensions.value.every((item) => !scoreInvalid(item.key, item.max_score)))
const missing = (field: string) => fieldErrors.value.some((item) => item.field === field)
/** 必填评语的红框只在尝试提交后出现；提交检查清单始终如实计数 */
const attempted = ref(false)
const flagged = (field: string) => attempted.value && missing(field)
const checklist = computed(() => [
  { label: '总体评价', ok: !missing('overallComment'), tab: 'comments' as Tab },
  { label: '主要问题', ok: !missing('issues'), tab: 'comments' as Tab },
  { label: '修改建议', ok: !missing('revisionAdvice'), tab: 'comments' as Tab },
  { label: `${dimensions.value.length} 项评分在 0 到满分之间`, ok: scoresOk.value, tab: 'scores' as Tab },
  { label: '评语检查已确认', ok: Boolean(checkAck.value), tab: 'check' as Tab },
])
const doneCount = computed(() => checklist.value.filter((item) => item.ok).length)
const ready = computed(() => complete.value && Boolean(checkAck.value))
const len = (value: string) => Array.from(value.trim()).length

function setScore(key: string, event: Event) {
  // 与旧表单一致：输入框清空时按 0 记，不发送 null（UX-01 未决）
  scores[key] = Number((event.target as HTMLInputElement).value)
}

async function focusField(name: string) {
  await nextTick()
  const field = Array.from(root.value?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? [])
    .find((item) => item.name === name)
  field?.focus()
  field?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  return field
}

async function locate(finding: CheckFinding) {
  const name = finding.field === 'issues' ? 'mainIssues' : finding.field
  tab.value = name.startsWith('evaluations.') ? 'scores' : 'comments'
  const field = await focusField(name)
  if (field instanceof HTMLTextAreaElement) {
    const points = Array.from(field.value)
    field.setSelectionRange(points.slice(0, finding.start).join('').length, points.slice(0, finding.end).join('').length)
  }
}

function goTo(item: { tab: Tab }) {
  tab.value = item.tab
}

function requestSubmit() {
  if (props.locked) return
  attempted.value = true
  if (!ready.value || !checkAck.value) {
    tab.value = 'check'
    return
  }
  emit('submit', payload(), checkAck.value)
}

defineExpose({ payload, total, maxTotal, band, doneCount, checklistSize: computed(() => checklist.value.length) })
</script>

<template>
  <div ref="root" class="dform">
    <div class="tabs" role="tablist" aria-label="评阅内容">
      <button type="button" role="tab" :aria-selected="tab === 'comments'" data-tab="comments" @click="tab = 'comments'">评语</button>
      <button type="button" role="tab" :aria-selected="tab === 'scores'" data-tab="scores" @click="tab = 'scores'">
        评分 <span class="num muted">{{ total }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'check'" data-tab="check" @click="tab = 'check'">
        提交检查 <span class="num muted">{{ doneCount }}/{{ checklist.length }}</span>
      </button>
    </div>

    <div class="dform__scroll">
      <section v-show="tab === 'comments'" class="fields" role="tabpanel" aria-label="评语">
        <p class="hint muted">学校发布后，学生与导师会看到总体评价、主要问题和修改建议。请不要写入能识别你身份或单位的信息。</p>
        <label class="field">
          <span>总体评价 <small class="num">{{ len(overallComment) }} 字</small></span>
          <textarea v-model="overallComment" name="overallComment" class="textarea t-lg" :disabled="locked" :aria-invalid="flagged('overallComment')" />
        </label>
        <label class="field">
          <span>主要问题 <small class="num">{{ len(issues) }} 字</small></span>
          <textarea v-model="issues" name="mainIssues" class="textarea t-lg" :disabled="locked" :aria-invalid="flagged('issues')" />
        </label>
        <label class="field">
          <span>修改建议 <small class="num">{{ len(revisionAdvice) }} 字</small></span>
          <textarea v-model="revisionAdvice" name="revisionAdvice" class="textarea t-lg" placeholder="写给学生的具体修改方向" :disabled="locked" :aria-invalid="flagged('revisionAdvice')" />
        </label>
        <label class="field">
          <span>主要优点 <small>选填</small></span>
          <textarea v-model="strengths" name="strengths" class="textarea" :disabled="locked" />
          <small>这一项不进入学生和导师看到的正式反馈。</small>
        </label>
        <label class="field">
          <span>评阅建议</span>
          <select v-model="recommendation" name="recommendation" class="select" :disabled="locked">
            <option>建议通过</option>
            <option>建议修改</option>
            <option>不通过</option>
          </select>
          <small>这是你的建议，与评分按规则算出的结论分开记录，系统不会替你改写。</small>
        </label>
      </section>

      <section v-show="tab === 'scores'" class="fields" role="tabpanel" aria-label="评分">
        <p class="hint muted">评分项与满分来自本任务的规则快照（{{ rule.version }}）。0 是有效分数。</p>
        <div v-for="item in dimensions" :key="item.key" class="dim" :data-dimension-key="item.key">
          <div class="dim__row">
            <label :for="`score-${item.key}`" class="dim__label">{{ item.label }}</label>
            <input
              :id="`score-${item.key}`"
              class="input num dim__input"
              type="number"
              min="0"
              :max="item.max_score"
              step="1"
              :name="item.key"
              :value="scores[item.key] ?? 0"
              :disabled="locked"
              :aria-invalid="scoreInvalid(item.key, item.max_score)"
              :aria-describedby="scoreInvalid(item.key, item.max_score) ? `score-error-${item.key}` : undefined"
              @input="setScore(item.key, $event)"
            />
            <span class="muted num">/ {{ item.max_score }}</span>
          </div>
          <p v-if="scoreInvalid(item.key, item.max_score)" :id="`score-error-${item.key}`" class="field-error">
            {{ item.label }}分值应在 0–{{ item.max_score }} 之间（满分 {{ item.max_score }}）。
          </p>
          <label class="field dim__note">
            <span class="sr-only">{{ item.label }}的分项评价</span>
            <textarea v-model="evaluations[item.key]" :name="`evaluations.${item.key}`" class="textarea" rows="2" placeholder="分项评价（选填，不发布给学生和导师）" :disabled="locked" />
          </label>
        </div>
        <div class="sum">
          <span>合计</span><strong class="num">{{ total }}</strong><span class="muted num">/ {{ maxTotal }}</span>
        </div>
        <div class="bands">
          <p v-if="band">按规则，{{ total }} 分对应 <strong>{{ band.label }}</strong>（{{ band.min }}–{{ band.max }} 分）。</p>
          <p v-else-if="rule.bands.length">{{ total }} 分不在规则的任何分档内，请核对分数。</p>
          <p class="muted">你的评阅建议：{{ recommendation }}。两者不一致时分别记录。</p>
        </div>
      </section>

      <section v-show="tab === 'check'" class="fields" role="tabpanel" aria-label="提交检查">
        <h2 class="sec">完成情况</h2>
        <ul class="checks">
          <li v-for="item in checklist" :key="item.label" :class="{ ok: item.ok }">
            <span aria-hidden="true">{{ item.ok ? '✓' : '○' }}</span>
            <button v-if="!item.ok && item.tab !== 'check'" type="button" class="linkish" @click="goTo(item)">{{ item.label }}</button>
            <span v-else>{{ item.label }}</span>
            <span class="sr-only">{{ item.ok ? '已完成' : '未完成' }}</span>
          </li>
        </ul>
        <div v-if="!locked" class="checkpanel">
          <ReviewCheckPanel :target="checkTarget" :payload="payload()" @ack="checkAck = $event" @locate="locate" />
        </div>
      </section>
    </div>

    <footer class="dform__foot">
      <span class="muted foot-state">{{ ready ? '内容已完整，可以提交' : `还差 ${checklist.length - doneCount} 项` }}</span>
      <button type="button" class="btn" data-action="exit-review" :disabled="leaving || locked" @click="emit('exit')">
        {{ leaving ? '正在保存…' : '保存并退出' }}
      </button>
      <button type="button" class="btn btn--primary" data-action="submit-final-review" :disabled="locked" @click="requestSubmit">
        检查并提交
      </button>
    </footer>
  </div>
</template>

<style scoped>
.dform {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--ws-surface);
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ws-border);
}
.tabs button {
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.tabs button[aria-selected='true'] {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
.dform__scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.fields {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.field > span {
  display: flex;
  justify-content: space-between;
}
.field > span small {
  color: var(--ws-faint);
  font-weight: 400;
}
.t-lg {
  min-height: 132px;
}
.textarea {
  line-height: 1.7;
}
.hint {
  font-size: 12px;
}
.dim {
  display: grid;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ws-border);
}
.dim__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dim__label {
  flex: 1;
}
.dim__input {
  width: 76px;
  text-align: right;
}
.dim__note .textarea {
  min-height: 0;
  font-size: 13px;
}
.sum {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-weight: 600;
}
.sum span:first-child {
  flex: 1;
}
.sum strong {
  font-size: 18px;
}
.bands {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
.sec {
  font-size: 14px;
  font-weight: 600;
}
.checks {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.checks li {
  display: flex;
  gap: 8px;
  color: var(--ws-muted);
}
.checks li.ok {
  color: var(--ws-text);
}
.checks li.ok span:first-child {
  color: var(--ws-success);
}
.linkish {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ws-action);
  text-decoration: underline;
  cursor: pointer;
}
/* 沿用的评语检查组件：只在本页换成工作空间令牌 */
.checkpanel :deep(.review-checks) {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  font-size: 13px;
}
/* 规则与词表版本只供核对：收成一行灰字，长哈希不撑开面板 */
.checkpanel :deep([data-check-coverage]) {
  overflow: hidden;
  color: var(--ws-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.checkpanel :deep(.review-checks h3) {
  font-size: 14px;
  font-weight: 600;
}
.checkpanel :deep(.review-checks button) {
  justify-self: start;
  min-height: var(--ws-control);
  padding: 0 12px;
  border: 1px solid var(--ws-border-strong);
  border-radius: var(--ws-radius);
  background: var(--ws-surface);
  color: var(--ws-text);
  cursor: pointer;
}
.checkpanel :deep(.review-checks button[data-action='check-comments']) {
  border-color: var(--ws-action);
  color: var(--ws-action);
}
.dform__foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.foot-state {
  flex: 1;
  font-size: 13px;
}
@media (max-width: 899px) {
  .dform__foot {
    flex-wrap: wrap;
  }
  .foot-state {
    flex-basis: 100%;
  }
  .dform__foot .btn {
    flex: 1;
  }
}
</style>
