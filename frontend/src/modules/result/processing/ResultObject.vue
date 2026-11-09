<script setup lang="ts">
/**
 * U4-1 结果对象区：先列“将公开的内容”，再列“不会公开”；发布是唯一主动作，发布后读回发布快照。
 * 发布按钮只看服务端 allowed_actions 的 PUBLISH_RESULT，不加前端门禁。
 * 更正待确认在对象内分区处理；确认后系统自动追加发布记录，不需要再次发布。
 * G1-3：浅灰画布上一张白色纸面；纸面上方一条说明栏（内容标题＋导出）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { Correction } from '@/api/corrections'
import { apiFailure } from '@/api/failure'
import { downloadPublishedReview, getSchoolResults, publishThesis, type SchoolResults } from '@/api/results'
import type { ThesisDetail } from '@/api/theses'
import ReviewCheckSummary from '@/components/app/ReviewCheckSummary.vue'
import ReviewOpinion, { type OpinionSection } from '@/components/app/review/ReviewOpinion.vue'
import ReviewVerdict from '@/components/app/review/ReviewVerdict.vue'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill, { type PillTone } from '@/components/workspace/StatusPill.vue'
import { useAuthStore } from '@/stores/auth'

import type { FeedbackItem } from '../feedback/publishedFeedback'

import CorrectionSection from './CorrectionSection.vue'
import { correctionStatus, readSchoolResult, type ResultView } from './resultView'
import type { SchoolDecision } from './useSchoolCorrection'

const props = defineProps<{
  thesis: ThesisDetail
  view: ResultView
  /** 待学校确认的更正 */
  correction: Correction | null
  /** 深链指向、但已不需要学校处理的更正 */
  linked: Correction | null
  outside: boolean
}>()
const emit = defineEmits<{ changed: []; published: [] }>()
const auth = useAuthStore()

const results = ref<SchoolResults | null>(null)
const loading = ref(true)
const error = ref('')
const flash = ref('')
const conflict = ref('')
let generation = 0
let alive = true
onBeforeUnmount(() => {
  alive = false
  generation++
})

const view = computed(() => (results.value?.items.length ? readSchoolResult(results.value, Boolean(props.correction)) : null))
const notReady = computed(() => Boolean(results.value) && !results.value!.items.length)
const unreadable = computed(() => Boolean(results.value?.items.length) && !view.value)
const published = computed(() => results.value?.published === true)
const canPublish = computed(() => !published.value && props.thesis.allowed_actions.includes('PUBLISH_RESULT') && Boolean(view.value))
const title = computed(() => props.thesis.current_version?.title || '未命名论文')
const program = computed(() => props.thesis.current_version?.school_program?.name || props.thesis.current_version?.discipline_name || '')

async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const data = await getSchoolResults(props.thesis.id, { quiet: true })
    if (request !== generation) return
    results.value = data
  } catch (reason) {
    if (request !== generation) return
    results.value = null
    error.value = apiFailure(reason).message
  } finally {
    if (request === generation) loading.value = false
  }
}
watch(() => props.thesis.id, () => {
  flash.value = ''
  conflict.value = ''
  void load()
}, { immediate: true })

const pill = computed<{ tone: PillTone; text: string }>(() => {
  if (props.view === 'correction') return { tone: 'warning', text: '更正待确认' }
  if (published.value || props.view === 'published') return { tone: 'success', text: '已发布' }
  return { tone: 'action', text: '待发布' }
})
/** P1-1：与学生反馈同一套段落与缺省文案 */
const sections = (item: FeedbackItem): OpinionSection[] => [
  { key: 'overall', heading: '总体评价', text: item.overall, missing: '未填写总体评价。' },
  { key: 'issues', heading: '主要问题', text: item.issues, missing: '未填写主要问题。' },
  item.advice.kind === 'v1'
    ? { key: 'advice', heading: '修改建议', text: '', missing: '此历史发布版本未收录修改建议。' }
    : { key: 'advice', heading: '修改建议', text: item.advice.text, missing: '未填写修改建议。' },
]
const contentTitle = computed(() => (!published.value ? '将公开的内容' : props.correction ? '当前生效的发布内容' : '已发布的内容'))

// ---- 发布 ----
const publishOpen = ref(false)
const publishing = ref(false)
const publishError = ref('')
let publishKey: { version: number; key: string } | null = null
function openPublish() {
  publishError.value = ''
  publishOpen.value = true
}
async function publish() {
  const data = results.value
  if (!data || !canPublish.value || publishing.value) return
  if (publishKey?.version !== data.version) publishKey = { version: data.version, key: crypto.randomUUID() }
  publishing.value = true
  publishError.value = ''
  try {
    await publishThesis(props.thesis.id, data.version, { idempotencyKey: publishKey.key, quiet: true })
    if (!alive) return
    publishKey = null
    publishOpen.value = false
    conflict.value = ''
    flash.value = '已发布。学生与导师现在可以阅读正式反馈；下方内容读回自发布快照。'
    emit('published')
    await load()
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) {
      publishKey = null
      publishOpen.value = false
      conflict.value = '没有发布：评阅结果在你打开之后有变化。已重新读取最新内容，请核对后再发布。'
      emit('changed')
      await load()
    } else {
      publishError.value = failure.message
    }
  } finally {
    if (alive) publishing.value = false
  }
}

// ---- 导出 ----
const exporting = ref(false)
const exportError = ref('')
async function exportPdf() {
  if (!published.value || exporting.value) return
  const identity = auth.user?.id
  const request = generation
  exporting.value = true
  exportError.value = ''
  try {
    const { file, filename } = await downloadPublishedReview(props.thesis.id, { quiet: true })
    if (!alive || request !== generation || identity !== auth.user?.id) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    if (alive && request === generation) exportError.value = '匿名评阅书没有下载成功，请重试。'
  } finally {
    if (alive) exporting.value = false
  }
}

// ---- 更正 ----
function decided(action: SchoolDecision) {
  conflict.value = ''
  flash.value = action === 'activate'
    ? '已确认更正，系统已自动追加一条发布记录。学生与导师现在看到更正后的结果。'
    : '已不予确认，原生效版本保持不变。原因已记录，平台与专家可以看到。'
  emit('changed')
  void load()
}
function correctionConflict() {
  flash.value = ''
  conflict.value = '这条更正在你打开之后有变化，已重新读取，请核对后再操作。'
  emit('changed')
  void load()
}
</script>

<template>
  <div class="rdesk" data-result-desk>
    <div class="rbar" data-result-bar>
      <span v-if="view">{{ contentTitle }}　{{ published ? '读回自发布快照' : '发布后学生与导师按这个顺序阅读' }}</span>
      <span v-else />
      <button v-if="published" type="button" class="btn btn--sm" data-export-pdf :disabled="exporting" @click="exportPdf">
        {{ exporting ? '正在导出…' : '导出评阅书' }}
      </button>
    </div>

    <article class="sheet" data-result-sheet>
      <header class="sheet__head">
        <StatusPill :tone="pill.tone">{{ pill.text }}</StatusPill>
        <h2 class="sheet__title">{{ title }}</h2>
        <dl class="sheet__meta">
          <div v-if="thesis.student"><dt>学生</dt><dd>{{ thesis.student.name }}（<span class="tabular">{{ thesis.student.student_no }}</span>）</dd></div>
          <div v-if="program"><dt>专业</dt><dd>{{ program }}</dd></div>
          <div v-if="view"><dt>评审规则</dt><dd>{{ view.ruleVersion }}，满分 {{ view.maxTotal }}</dd></div>
        </dl>
        <p v-if="outside" class="wsd-hint">这篇论文不在当前时间范围内，是从链接单独打开的。</p>
      </header>

      <p v-if="exportError" class="wsd-banner wsd-banner--danger" role="alert">{{ exportError }}</p>
      <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
      <div v-if="conflict" class="wsd-banner wsd-banner--danger" role="alert">{{ conflict }}</div>
      <div v-if="linked" class="wsd-banner" role="status">链接中的这条更正状态为“{{ correctionStatus[linked.status] }}”，不需要学校再处理。</div>

      <StateBlock v-if="loading && !results" kind="loading" title="正在读取评阅结果…" />
      <StateBlock v-else-if="error" kind="error" title="评阅结果没有加载出来">
        {{ error }}
        <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
      </StateBlock>
      <StateBlock v-else-if="unreadable" kind="error" title="评阅结果的格式无法识别">
        为避免显示不完整的内容，这里不展示任何部分。请刷新后再看；仍然如此请联系平台。
        <template #actions><button type="button" class="btn btn--primary" @click="load">重新读取</button></template>
      </StateBlock>
      <StateBlock v-else-if="notReady" kind="unconfigured" title="尚未收到有效评阅意见">
        专家正式提交评阅后，这里会列出将公开的内容，届时才能发布。
      </StateBlock>

      <template v-else-if="view && results">
        <CorrectionSection
          v-if="correction"
          :key="correction.id"
          :correction="correction"
          :dimensions="results.rule_snapshot?.dimensions ?? []"
          @decided="decided"
          @conflict="correctionConflict"
        />

        <section class="sheet__body" :aria-label="contentTitle">
          <ReviewVerdict :outcome="view.outcome" :total="view.total" :max-total="view.maxTotal" :reviewer-count="view.items.length" />
          <article v-for="(item, index) in view.items" :key="item.alias" class="opinion">
            <header class="opinion__head">
              <h3>匿名专家 {{ item.alias }}</h3>
              <span class="tabular">{{ item.total }} 分，{{ item.recommendation || '未填写评审建议' }}</span>
            </header>
            <ReviewOpinion :sections="sections(item)" :scores="item.scores" scores-first />
            <div v-if="results.items[index]?.check_summary" class="checks">
              <span>提交时复核提示（专家已逐条确认，不改变分数与结论）</span>
              <ReviewCheckSummary :summary="results.items[index]!.check_summary" />
            </div>
          </article>
        </section>

        <section v-if="!published" class="hidden-part" aria-labelledby="hidden-h">
          <h3 id="hidden-h">不会公开</h3>
          <p class="wsd-hint">专家身份与单位、主要优点、分项评价、专家与平台之间的往来记录。学校这里也只看到匿名别名。</p>
        </section>
      </template>
    </article>
  </div>

  <footer v-if="results && !published && view" class="wsd-commit">
    <p class="wsd-commit__text">{{ canPublish ? '发布后学生与导师即可阅读，发布不能撤回；之后的修改只能走更正。' : '现在还不能发布这篇论文的结果。' }}</p>
    <button v-if="canPublish" type="button" class="btn btn--primary" data-action="publish-results" @click="openPublish">发布结果…</button>
  </footer>

  <ConfirmDialog :open="publishOpen" title="发布评阅结果" :busy="publishing" @close="publishing || (publishOpen = false)">
    <p>发布《{{ title }}》的评阅结果后，学生{{ thesis.student?.name ?? '' }}与其导师会看到：</p>
    <ul v-if="view" class="dlg-list">
      <li>评阅结论“{{ view.outcome.label }}”与总分 {{ view.total }}</li>
      <li>{{ view.items.map((i) => i.alias).join('、') }} 的评审建议、总体评价、主要问题、修改建议与分项评分</li>
    </ul>
    <p class="muted">不会看到专家身份、主要优点与分项评价。发布不能撤回。</p>
    <p v-if="publishError" class="field-error" role="alert">{{ publishError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="publishing" @click="publishOpen = false">取消</button>
      <button type="button" class="btn btn--primary" data-action="confirm-publish" :disabled="publishing" @click="publish">{{ publishing ? '正在发布…' : '确认发布' }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.rdesk {
  flex: 1 0 auto;
  padding: 16px 32px 40px;
  background: var(--canvas);
}
.rbar {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  max-width: 820px;
  min-height: 30px;
  margin: 0 auto 12px;
  color: var(--faint);
  font-size: 12px;
}
.sheet {
  display: grid;
  gap: 20px;
  max-width: 820px;
  margin: 0 auto;
  padding: 32px 48px 40px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg, 8px);
  background: var(--background);
}
.sheet__head {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
.sheet__title {
  font-family: var(--font-display);
  font-size: 26px;
  font-weight: 600;
  line-height: 1.35;
}
.sheet__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 28px;
  margin: 0;
  color: var(--muted-foreground);
  font-size: 13px;
}
.sheet__meta dt {
  display: inline;
}
.sheet__meta dd {
  display: inline;
  margin: 0 0 0 6px;
  color: var(--foreground);
}
.sheet__body {
  display: grid;
  gap: 8px;
}
.opinion {
  display: grid;
  gap: 16px;
  margin-top: 20px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}
.opinion__head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  align-items: baseline;
  justify-content: space-between;
}
.opinion__head h3 {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 600;
}
.opinion__head span {
  color: var(--muted-foreground);
  font-size: 13px;
}
.checks {
  display: grid;
  gap: 6px;
  padding-top: 14px;
  border-top: 1px dashed var(--border-strong);
  color: var(--faint);
  font-size: 12px;
}
.hidden-part {
  display: grid;
  gap: 6px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-strong);
}
.hidden-part h3 {
  font-size: 14px;
  font-weight: 600;
}
.dlg-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 1.2em;
}
@media (max-width: 899px) {
  .rdesk {
    padding: 12px 12px 24px;
  }
  .sheet {
    padding: 20px 18px 24px;
  }
  .sheet__title {
    font-size: 21px;
  }
}
</style>
