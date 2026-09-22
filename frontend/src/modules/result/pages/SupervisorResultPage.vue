<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { getPublishedResult, listSupervisedPublishedTheses, type SupervisedPublishedThesis } from '@/api/results'
import type { DemoPublishedResult } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import AnonymousResultTable from '../components/AnonymousResultTable.vue'
import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const theses = ref<SupervisedPublishedThesis[]>([])
const thesisId = ref('')
const rows = ref<DemoPublishedResult[]>([])
const score = ref<number | null>(null)
const conclusion = computed(() => rows.value[0]?.recommendation?.trim() || '未填写评审建议')
const loading = ref(true)
const error = ref('')
let generation = 0

async function loadSelected(id: string) {
  const request = ++generation
  thesisId.value = id
  rows.value = []
  score.value = null
  error.value = ''
  loading.value = true
  try {
    const published = await getPublishedResult(id)
    if (request !== generation) return
    score.value = published.total
    rows.value = published.items.map(item => ({
      expertAlias: item.alias, score: item.total, recommendation: item.recommendation,
      comment: item.overall_comment, submittedAt: '',
    }))
  } catch (err) {
    if (request === generation) error.value = err instanceof Error ? err.message : '结果加载失败，请重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}

async function load() {
  const request = ++generation
  theses.value = []
  thesisId.value = ''
  rows.value = []
  score.value = null
  loading.value = true
  error.value = ''
  try {
    if (demoEnabled && service) {
      await service.loginAs('supervisor')
      const results = await service.listPublishedResults()
      if (request !== generation) return
      rows.value = results
      score.value = results[0]?.score ?? null
      return
    }
    const choices = await listSupervisedPublishedTheses()
    if (request !== generation) return
    theses.value = choices
    if (choices[0]) await loadSelected(choices[0].id)
  } catch (err) {
    if (request === generation) error.value = err instanceof Error ? err.message : '结果列表加载失败，请重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}

function retry() {
  if (thesisId.value) void loadSelected(thesisId.value)
  else void load()
}
onMounted(load)
onBeforeUnmount(() => { generation++ })
</script>
<template>
  <PortalLayout :menu-items="portalMenus('supervisor', demoEnabled)" active-path="/supervisor/results" context-label="导师端 · 海岳大学" :user-name="useAuthStore().user?.displayName ?? '赵文博教授'">
    <div class="result-page">
      <PageHeader eyebrow="PAGE-013 · SUPERVISOR RESULT" title="学生评审结果" description="查看学校已发布的匿名评阅结论，用于指导学生后续修改。" />
      <BlindRail audience="所指导学生的已发布匿名评阅结果" hidden-from="专家姓名、联系方式和其他学生信息" stage="结果查看" />
      <label v-if="!demoEnabled && theses.length" class="result-selector">
        学生论文
        <select :value="thesisId" @change="loadSelected(($event.target as HTMLSelectElement).value)">
          <option v-for="thesis in theses" :key="thesis.id" :value="thesis.id">{{ thesis.student_name }} · {{ thesis.title }}</option>
        </select>
      </label>
      <p v-if="loading" role="status">正在加载结果…</p>
      <section v-else-if="error" role="alert">
        <p>{{ error }}</p>
        <button data-action="retry-results" type="button" @click="retry">重新加载</button>
      </section>
      <template v-else-if="rows.length">
        <ResultSummaryPanel :average="score" :conclusion="conclusion" published />
        <AnonymousResultTable :rows="rows" />
      </template>
      <section v-else class="empty">
        <h2>{{ demoEnabled ? '结果尚未发布' : '暂无已发布结果' }}</h2>
        <p>所指导学生的结果经学校发布后将在此展示。</p>
      </section>
    </div>
  </PortalLayout>
</template>
<style scoped>
.result-selector { display: grid; gap: .4rem; }
.result-selector select { padding: .6rem; }
.result-page { display: grid; gap: 1rem; }
.empty { padding: 3rem; border: 1px dashed #cbd4dc; background: white; text-align: center; }
.empty h2 { font-family: var(--font-display); }
.empty p { color: #6c7983; font-size: .75rem; }
</style>
