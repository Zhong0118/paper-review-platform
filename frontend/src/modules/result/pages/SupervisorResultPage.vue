<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { getPublishedResult } from '@/api/results'
import { listTheses } from '@/api/theses'
import type { DemoPublishedResult } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import AnonymousResultTable from '../components/AnonymousResultTable.vue'
import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const rows = ref<DemoPublishedResult[]>([])
const score = computed(() => rows.value[0]?.score ?? 0)

onMounted(async () => {
  if (demoEnabled && service) {
    await service.loginAs('supervisor')
    rows.value = await service.listPublishedResults()
    return
  }
  const theses = await listTheses().catch(() => [])
  const current = theses[0]
  if (!current) return
  try {
    const published = await getPublishedResult(current.id)
    rows.value = published.items.map((item) => ({
      expertAlias: item.alias,
      score: item.total,
      recommendation: item.recommendation,
      comment: item.overall_comment,
      submittedAt: '',
    }))
  } catch {
    rows.value = []
  }
})
</script>
<template>
  <PortalLayout :menu-items="portalMenus('supervisor', demoEnabled)" active-path="/supervisor/results" context-label="导师端 · 海岳大学" :user-name="useAuthStore().user?.displayName ?? '赵文博教授'">
    <div class="result-page">
      <PageHeader eyebrow="PAGE-013 · SUPERVISOR RESULT" title="学生评审结果" description="查看学校已发布的匿名评阅结论，用于指导学生后续修改。" />
      <BlindRail audience="所指导学生的已发布匿名评阅结果" hidden-from="专家姓名、联系方式和其他学生信息" stage="结果查看" />
      <template v-if="rows.length">
        <ResultSummaryPanel :average="score" conclusion="建议通过" published />
        <AnonymousResultTable :rows="rows" />
      </template>
      <section v-else class="empty">
        <h2>结果尚未发布</h2>
        <p>学校发布后将在此展示。</p>
      </section>
    </div>
  </PortalLayout>
</template>
<style scoped>
.result-page { display: grid; gap: 1rem; }
.empty { padding: 3rem; border: 1px dashed #cbd4dc; background: white; text-align: center; }
.empty h2 { font-family: var(--font-display); }
.empty p { color: #6c7983; font-size: .75rem; }
</style>
