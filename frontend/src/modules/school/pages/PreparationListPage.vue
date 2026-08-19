<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { BatchImportRow, DemoThesisSummary, SchoolSubmissionInput } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import AnonymizationCheckPanel from '../components/AnonymizationCheckPanel.vue'
import BatchImportPreview from '../components/BatchImportPreview.vue'
import SchoolSubmissionDrawer from '../components/SchoolSubmissionDrawer.vue'
import SchoolThesisTable from '../components/SchoolThesisTable.vue'

const service = useScenarioService()
const authStore = useAuthStore()
const rows = ref<DemoThesisSummary[]>([])
const batchRows = ref<BatchImportRow[]>([])
const drawerOpen = ref(false)
const batchOpen = ref(false)
const saving = ref(false)
const query = ref('')
const filteredRows = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return rows.value
  return rows.value.filter((row) => `${row.studentId}${row.studentName}${row.title}${row.discipline.code}${row.discipline.name}`.toLowerCase().includes(keyword))
})

onMounted(async () => {
  await service.loginAs('school_reviewer')
  rows.value = await service.listSchoolTheses()
})

async function submitForStudent(input: SchoolSubmissionInput) {
  saving.value = true
  try {
    await service.submitThesisAsSchool(input)
    rows.value = await service.listSchoolTheses()
    drawerOpen.value = false
  } finally { saving.value = false }
}

async function showBatchPreview() {
  batchRows.value = await service.previewBatchImport()
  batchOpen.value = true
}
</script>

<template>
  <PortalLayout :menu-items="menusByRole.school_reviewer ?? []" active-path="/school/preparation" context-label="学校端 · 海岳大学" :user-name="authStore.user?.displayName ?? '王老师'">
    <div class="preparation-page">
      <PageHeader eyebrow="PAGE-004 · REVIEW PREPARATION" title="送审准备" description="统一管理学生自提、学校单篇代传与批量导入论文，并在送出前完成材料与匿名化核验。">
        <template #actions>
          <button type="button" class="action secondary" data-action="open-school-submission" @click="drawerOpen = true">单篇代传</button>
          <button type="button" class="action primary" data-action="open-batch-preview" @click="showBatchPreview">批量导入</button>
          <button type="button" class="action quiet">下载导入模板</button>
        </template>
      </PageHeader>
      <BlindRail audience="本校学生身份、原始论文与匿名材料" hidden-from="专家身份与专家联系方式不在学校准备页展示" stage="材料准备与匿名核验" />
      <p class="submission-policy">学校可直接提交，无需学生再次确认；学生仍可在“我的论文”查看学校代传记录。</p>
      <AnonymizationCheckPanel :pass="18" :review-required="3" :failed="1" />
      <section class="workbench" aria-label="学校论文列表">
        <header><div><span>THESIS INTAKE</span><h2>本校论文</h2></div><label>搜索<input v-model="query" placeholder="学号、姓名、论文或专业" /></label></header>
        <SchoolThesisTable :rows="filteredRows" />
      </section>
      <BatchImportPreview v-if="batchOpen" :rows="batchRows" />
    </div>
    <SchoolSubmissionDrawer v-if="drawerOpen" :saving="saving" @close="drawerOpen = false" @submit="submitForStudent" />
  </PortalLayout>
</template>

<style scoped>
.preparation-page { display: grid; gap: 1rem; }
.submission-policy { margin: 0; padding: 0.7rem 0.85rem; border-left: 3px solid #1b4f8a; background: #edf3f9; color: #31526e; font-size: 0.75rem; }
.action { min-height: 2.5rem; padding: 0.45rem 0.75rem; border-radius: 0.35rem; font-weight: 650; cursor: pointer; }
.action.primary { border: 1px solid #1b4f8a; background: #1b4f8a; color: white; }
.action.secondary { border: 1px solid #7f99b1; background: #edf3f9; color: #174a79; }
.action.quiet { border: 1px solid #bbc6cf; background: white; color: #44535f; }
.workbench > header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; margin-bottom: 0.6rem; }
.workbench header span { color: #6b7883; font-family: var(--font-data); font-size: 0.65rem; letter-spacing: 0.12em; }
.workbench h2 { margin: 0.15rem 0 0; color: #263744; font-family: var(--font-display); font-size: 1rem; }
.workbench label { display: grid; gap: 0.25rem; color: #677580; font-size: 0.68rem; }
.workbench input { width: min(22rem, 48vw); height: 2.35rem; padding: 0 0.65rem; border: 1px solid #cbd4dc; border-radius: 0.35rem; background: white; }
</style>
