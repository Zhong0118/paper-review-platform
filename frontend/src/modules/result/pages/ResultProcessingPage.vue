<script setup lang="ts">
import {useRoute} from 'vue-router'
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { downloadPublishedReview, getSchoolResults, publishThesis, type ReviewOutcome } from '@/api/results'
import { getSchoolThesis,listSchoolTheses } from '@/api/schoolReview'
import { selectSchoolResultQueue, toAnonymousResult } from '@/api/adapters'
import type { ThesisDetail } from '@/api/theses'
import type { DemoPublishedResult } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import AnonymousResultTable from '../components/AnonymousResultTable.vue'
import ReviewCheckSummary from '@/components/app/ReviewCheckSummary.vue'
import type { CheckSummary } from '@/api/reviewChecks'
import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'
import RealCorrectionPanel from '../components/RealCorrectionPanel.vue'
import ReviewOutcomeNotice from '../components/ReviewOutcomeNotice.vue'

const route = useRoute()
const target = computed(() => typeof route?.query.thesis === 'string' ? route.query.thesis : '')
const timeScope = useTimeScope()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const queue = ref<ThesisDetail[]>([])
const rows = ref<DemoPublishedResult[]>([])
const published = ref(false)
const thesisId = ref('')
const version = ref<number | null>(null)
const summaryTotal = ref<number | null>(null)
const checkSummaries = ref<Array<{ alias: string; summary?: CheckSummary | null }>>([])
const outcome = ref<ReviewOutcome | null>(null)
const ruleVersion = ref('')
const loading = ref(true)
const error = ref('')
let generation = 0
const saving = ref(false)
const canPublish = computed(
  () =>
    !demoEnabled && !loading.value && !error.value && !published.value &&
    rows.value.length > 0 && version.value !== null && summaryTotal.value !== null &&
    Boolean(thesisId.value) &&
    queue.value.find((item) => item.id === thesisId.value)?.allowed_actions.includes('PUBLISH_RESULT'),
)
const score = computed(() => demoEnabled ? rows.value[0]?.score ?? null : summaryTotal.value)
const conclusion = computed(() => rows.value[0]?.recommendation?.trim() || '未填写评审建议')
const selectedTitle = computed(
  () => queue.value.find((item) => item.id === thesisId.value)?.current_version?.title ?? '',
)

async function loadThesis(id: string) {
  const request = ++generation
  exportError.value = ''
  thesisId.value = id
  rows.value = []
  summaryTotal.value = null
  checkSummaries.value = []
  outcome.value = null
  ruleVersion.value = ''
  version.value = null
  published.value = false
  loading.value = true
  error.value = ''
  try {
    const results = await getSchoolResults(id)
    if (request !== generation) return
    version.value = results.version
    summaryTotal.value = results.summary_total
    outcome.value = results.outcome
    ruleVersion.value = results.rule_snapshot?.version ?? ''
    rows.value = results.items.map(toAnonymousResult)
    checkSummaries.value = results.items.map(item => ({ alias: item.alias, summary: item.check_summary }))
    published.value = results.published
  } catch (err) {
    if (request === generation) error.value = err instanceof Error ? err.message : '结果加载失败，请重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}

async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  rows.value = []
  outcome.value = null
  ruleVersion.value = ''
  thesisId.value = ''
  queue.value = []
  try {
    if (demoEnabled && service) {
      const snapshot = await service.loginAs('school_reviewer')
      const results = await service.listReviewResults()
      if (request !== generation) return
      rows.value = results
      published.value = snapshot.thesis.stage === 'COMPLETED'
      return
    }
    const items = selectSchoolResultQueue(target.value ? [await getSchoolThesis(target.value)] : await listSchoolTheses(...timeScope.request()))
    if (request !== generation) return
    queue.value = items
    const current = items.find(item => item.stage === 'RESULT_PROCESSING') ?? items[0]
    if (current) await loadThesis(current.id)
  } catch (err) {
    if (request === generation) error.value = err instanceof Error ? err.message : '结果列表加载失败，请重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}

async function publish() {
  if (saving.value) return
  if (!demoEnabled && (!canPublish.value || version.value === null)) return
  const id = thesisId.value
  const expectedVersion = version.value
  const request = generation
  saving.value = true
  error.value = ''
  try {
    if (demoEnabled && service) {
      await service.publishResult()
      rows.value = await service.listPublishedResults()
      published.value = true
      return
    }
    await publishThesis(id, expectedVersion!, { idempotencyKey: crypto.randomUUID() })
    const items = selectSchoolResultQueue(target.value ? [await getSchoolThesis(target.value)] : await listSchoolTheses(...timeScope.request()))
    if (request !== generation) return
    queue.value = items
    await loadThesis(id)
  } catch (err) {
    if (request === generation) error.value = err instanceof Error ? err.message : '发布失败，请刷新后重试。'
  } finally {
    saving.value = false
  }
}

const downloading = ref(false)
const exportError = ref('')
async function exportPdf() {
  if (!published.value || downloading.value) return
  const request = generation, identity = useAuthStore().user?.id
  downloading.value = true
  exportError.value = ''
  try {
    const {file, filename} = await downloadPublishedReview(thesisId.value)
    if (request !== generation || identity !== useAuthStore().user?.id) return
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url; link.download = filename; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {
    if (request === generation) exportError.value = '匿名评阅书下载失败，请重试。'
  } finally { downloading.value = false }
}

function retry() {
  if (thesisId.value) void loadThesis(thesisId.value)
  else void load()
}
onMounted(load)
onBeforeUnmount(() => { generation++ })
watch([timeScope.scope, timeScope.identity, target], () => { if (!demoEnabled && useAuthStore().user) void load() })
</script>
<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/results" :context-label="demoEnabled ? '学校端 · 海岳大学' : '学校端 · ' + (useAuthStore().user?.tenantCode ?? '本校')" :user-name="useAuthStore().user?.displayName ?? '王老师'">
    <div class="result-page">
      <PageHeader eyebrow="PAGE-011 · RESULT PROCESSING" title="结果处理" description="核对匿名评阅意见和汇总结论后统一发布；学校侧只显示任务化名，不显示专家身份。">
        <template #actions>
          <button data-action="publish-results" type="button" :disabled="demoEnabled ? published || !rows.length || saving : !canPublish || saving" @click="publish">
            {{ published ? '结果已发布' : '确认并发布结果' }}
          </button>
        </template>
      </PageHeader>
      <p v-if="target">正在查看收尾清单中的论文 · <RouterLink to="/school/results">返回完整列表</RouterLink></p>
      <TimeScopeSelect v-if="!demoEnabled && !target" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <BlindRail audience="本校论文、匿名任务序号与评阅汇总" hidden-from="专家姓名、联系方式和专家库档案" stage="单专家结果核对与发布" />
      <label v-if="!demoEnabled && queue.length" class="result-queue">
        待处理论文
        <select :value="thesisId" :disabled="saving" @change="loadThesis(($event.target as HTMLSelectElement).value)">
          <option v-for="item in queue" :key="item.id" :value="item.id">
            {{ item.current_version?.title || item.id.slice(0, 8) }} · {{ item.stage === 'COMPLETED' ? '已发布' : '待发布' }}
          </option>
        </select>
      </label>
      <p v-else-if="!demoEnabled && !loading && !error" class="empty">暂无待发布或已发布结果。</p>
      <p v-if="selectedTitle" class="selected">当前：{{ selectedTitle }}</p>
      <p v-if="loading" role="status">正在加载结果…</p>
      <section v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button data-action="retry-results" type="button" @click="retry">重新加载</button>
      </section>
      <template v-else-if="rows.length">
        <button v-if="!demoEnabled && published" data-export-pdf type="button" :disabled="downloading" @click="exportPdf">下载已发布匿名评阅书</button>
        <p v-if="exportError" role="alert">{{exportError}}</p>
        <ReviewOutcomeNotice v-if="!demoEnabled && outcome" :outcome="outcome" :rule-version="ruleVersion" />
        <ResultSummaryPanel :average="score" :conclusion="conclusion" :published="published" />
        <AnonymousResultTable :rows="rows" />
        <section v-if="!demoEnabled" aria-label="匿名评语检查摘要"><div v-for="item in checkSummaries" :key="item.alias"><strong>{{ item.alias }}</strong><ReviewCheckSummary :summary="item.summary" /></div></section>
        <RealCorrectionPanel v-if="!demoEnabled && thesisId" :key="thesisId" mode="school" :thesis-id="thesisId" :initial-correction-id="target && typeof route.query.correction === 'string' ? route.query.correction : undefined" @changed="loadThesis(thesisId)" />
      </template>
      <p v-else-if="demoEnabled || thesisId">尚未收到有效评阅意见，暂不能发布结果。</p>
    </div>
  </PortalLayout>
</template>
<style scoped>
.result-page { display: grid; gap: 1rem; }
.result-page button { padding: .5rem .75rem; border: 1px solid #1b4f8a; border-radius: .3rem; background: #1b4f8a; color: white; font-weight: 650; }
.result-page button:disabled { opacity: .65; }
.result-page > p, .empty { margin: 0; padding: 2rem; border: 1px dashed #cbd4dc; background: white; color: #687682; text-align: center; }
.result-queue { display: grid; gap: .35rem; color: #53636f; font-size: .75rem; }
.result-queue select { height: 2.4rem; padding: 0 .65rem; }
.selected { padding: 0 !important; border: 0 !important; text-align: left !important; color: #33414d; font-size: .8rem; }
</style>
