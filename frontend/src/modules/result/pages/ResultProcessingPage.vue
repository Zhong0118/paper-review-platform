<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { getSchoolResults, publishThesis } from '@/api/results'
import { listSchoolTheses } from '@/api/schoolReview'
import { selectSchoolResultQueue } from '@/api/adapters'
import type { ThesisDetail } from '@/api/theses'
import type { DemoPublishedResult } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import AnonymousResultTable from '../components/AnonymousResultTable.vue'
import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const queue = ref<ThesisDetail[]>([])
const rows = ref<DemoPublishedResult[]>([])
const published = ref(false)
const thesisId = ref('')
const version = ref(1)
const saving = ref(false)
const canPublish = computed(
  () =>
    !demoEnabled &&
    Boolean(thesisId.value) &&
    queue.value.find((item) => item.id === thesisId.value)?.allowed_actions.includes('PUBLISH_RESULT'),
)
const score = computed(() => rows.value[0]?.score ?? 0)
const selectedTitle = computed(
  () => queue.value.find((item) => item.id === thesisId.value)?.current_version?.title ?? '',
)

function mapItems(items: Array<{ alias: string; total: number; recommendation: string; overall_comment: string }>): DemoPublishedResult[] {
  return items.map((item) => ({
    expertAlias: item.alias,
    score: item.total,
    recommendation: item.recommendation,
    comment: item.overall_comment,
    submittedAt: '',
  }))
}

async function loadThesis(id: string) {
  const results = await getSchoolResults(id)
  thesisId.value = id
  version.value = results.version
  rows.value = mapItems(results.items)
  published.value = results.published
}

onMounted(async () => {
  if (demoEnabled && service) {
    const snapshot = await service.loginAs('school_reviewer')
    rows.value = await service.listReviewResults()
    published.value = snapshot.thesis.stage === 'COMPLETED'
    return
  }
  queue.value = selectSchoolResultQueue(await listSchoolTheses())
  const current = queue.value.find((item) => item.stage === 'RESULT_PROCESSING') ?? queue.value[0]
  if (!current) return
  await loadThesis(current.id)
})

async function publish() {
  if (demoEnabled && service) {
    await service.publishResult()
    rows.value = await service.listPublishedResults()
    published.value = true
    return
  }
  if (!thesisId.value || !canPublish.value) return
  saving.value = true
  try {
    await publishThesis(thesisId.value, version.value, { idempotencyKey: crypto.randomUUID() })
    queue.value = selectSchoolResultQueue(await listSchoolTheses())
    await loadThesis(thesisId.value)
  } finally {
    saving.value = false
  }
}
</script>
<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/results" context-label="学校端 · 海岳大学" :user-name="useAuthStore().user?.displayName ?? '王老师'">
    <div class="result-page">
      <PageHeader eyebrow="PAGE-011 · RESULT PROCESSING" title="结果处理" description="核对匿名评阅意见和汇总结论后统一发布；学校侧只显示任务化名，不显示专家身份。">
        <template #actions>
          <button data-action="publish-results" type="button" :disabled="demoEnabled ? published || !rows.length : !canPublish || saving" @click="publish">
            {{ published ? '结果已发布' : '确认并发布结果' }}
          </button>
        </template>
      </PageHeader>
      <BlindRail audience="本校论文、匿名任务序号与评阅汇总" hidden-from="专家姓名、联系方式和专家库档案" stage="单专家结果核对与发布" />
      <label v-if="!demoEnabled && queue.length" class="result-queue">
        待处理论文
        <select :value="thesisId" @change="loadThesis(($event.target as HTMLSelectElement).value)">
          <option v-for="item in queue" :key="item.id" :value="item.id">
            {{ item.current_version?.title || item.id.slice(0, 8) }} · {{ item.stage === 'COMPLETED' ? '已发布' : '待发布' }}
          </option>
        </select>
      </label>
      <p v-else-if="!demoEnabled" class="empty">暂无待发布或已发布结果。</p>
      <p v-if="selectedTitle" class="selected">当前：{{ selectedTitle }}</p>
      <ResultSummaryPanel :average="score" conclusion="建议通过" :published="published" />
      <AnonymousResultTable v-if="rows.length" :rows="rows" />
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
