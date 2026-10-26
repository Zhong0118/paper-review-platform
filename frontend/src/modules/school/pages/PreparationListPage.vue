<script setup lang="ts">
import SensitiveFindingPanel from '@/components/app/SensitiveFindingPanel.vue'
import { checkSensitiveThesis } from '@/api/sensitiveChecks'
import type { ThesisDetail } from '@/api/theses'
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { computed, onMounted, ref, watch, onBeforeUnmount } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { confirmAnonymization, listSchoolTheses, terminateThesis } from '@/api/schoolReview'
import { confirmDispatch } from '@/api/dispatch'
import { toSchoolRow } from '@/api/adapters'
import type { BatchImportRow, DemoThesisSummary, SchoolSubmissionInput } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import AnonymizationCheckPanel from '../components/AnonymizationCheckPanel.vue'
import BatchImportPreview from '../components/BatchImportPreview.vue'
import SchoolSubmissionDrawer from '../components/SchoolSubmissionDrawer.vue'
import SchoolThesisTable from '../components/SchoolThesisTable.vue'

const timeScope = useTimeScope()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const selectedId = ref<string | null>(null)
const decisionReason = ref('')
const notice = ref('')
const authStore = useAuthStore()
const rows = ref<DemoThesisSummary[]>([])
const rawRows = ref<ThesisDetail[]>([])
const selectedDetail = computed(() => rawRows.value.find(item => item.id === selectedId.value))
const loading = ref(!demoEnabled)
const loadError = ref('')
const automaticCounts = ref({ pass: 0, reviewRequired: 0, failed: 0 })
const batchRows = ref<BatchImportRow[]>([])
const drawerOpen = ref(false)
const batchOpen = ref(false)
const saving = ref(false)
const query = ref('')
const selectedRow = computed(() => rows.value.find((item) => item.id === selectedId.value) ?? null)
const selectedActions = computed<string[]>(() => selectedRow.value?.allowedActions ?? [])
const filteredRows = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return rows.value
  return rows.value.filter((row) => `${row.studentId}${row.studentName}${row.title}${row.discipline.code}${row.discipline.name}`.toLowerCase().includes(keyword))
})

onMounted(async () => {
  if (demoEnabled && service) {
    await service.loginAs('school_reviewer')
    rows.value = await service.listSchoolTheses()
    return
  }
  await loadRealRows()
})

let listGeneration = 0
async function loadRealRows() {
  const request = ++listGeneration
  rows.value = []
  rawRows.value = []
  automaticCounts.value = { pass: 0, reviewRequired: 0, failed: 0 }
  loading.value = true
  loadError.value = ''
  try {
    const items = await listSchoolTheses(...timeScope.request())
    if (request !== listGeneration) return false
    const counts = { pass: 0, reviewRequired: 0, failed: 0 }
    for (const item of items) {
      const conclusion = item.anonymization?.auto_conclusion
      if (conclusion === 'PASS') counts.pass++
      else if (conclusion === 'REVIEW_REQUIRED') counts.reviewRequired++
      else if (conclusion === 'FAIL') counts.failed++
    }
    rawRows.value = items
    rows.value = items.map(toSchoolRow)
    automaticCounts.value = counts
    if (!rows.value.some(row => row.id === selectedId.value)) selectedId.value = null
    return true
  } catch (error) {
    if (request !== listGeneration) return false
    rows.value = []
    loadError.value = error instanceof Error ? error.message : '加载失败，请重试。'
    return false
  } finally {
    if (request === listGeneration) loading.value = false
  }
}

async function checkSelected() {
  const detail = selectedDetail.value
  const file = detail?.current_version?.files.find(f => f.purpose === 'anonymous')
  if (!detail || !file || saving.value) return
  saving.value = true; notice.value = ''
  const identity = timeScope.identity.value
  try {
    await checkSensitiveThesis(detail.id, {expected_version: detail.version, file_id:file.file_id}, true)
    if (identity !== timeScope.identity.value) return
    await loadRealRows()
  } catch(e) { if (identity === timeScope.identity.value) notice.value = e instanceof Error ? e.message : '检测失败，请重试' }
  finally { saving.value = false }
}

async function decide(decision: 'PASS' | 'REJECT') {
  if (!selectedId.value || saving.value) return
  const row = rows.value.find((item) => item.id === selectedId.value)
  saving.value = true
  notice.value = ''
  try {
    const result = await confirmAnonymization(
      selectedId.value,
      { decision, version: Number((row as { version?: number } | undefined)?.version ?? 1), reason: decisionReason.value },
      { idempotencyKey: crypto.randomUUID() },
    )
    if (!await loadRealRows()) return
    notice.value = result.stage
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '审核失败'
  } finally {
    saving.value = false
  }
}

async function sendOut() {
  if (!selectedId.value || saving.value) return
  const row = rows.value.find((item) => item.id === selectedId.value)
  saving.value = true
  notice.value = ''
  try {
    const result = await confirmDispatch(selectedId.value, Number((row as { version?: number } | undefined)?.version ?? 1), {
      idempotencyKey: crypto.randomUUID(),
    })
    if (!await loadRealRows()) return
    notice.value = `已确认送出 · ${(result as { stage?: string }).stage ?? ''}`
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '确认送出失败'
  } finally {
    saving.value = false
  }
}

async function terminateSelected() {
  const row = selectedRow.value
  const reason = decisionReason.value.trim()
  if (!row || saving.value || !reason || !selectedActions.value.includes('TERMINATE')) return
  if (!window.confirm(`确认永久终止“${row.title}”？未完成专家任务将取消，历史记录保留。`)) return
  saving.value = true
  notice.value = ''
  try {
    await terminateThesis(row.id, { version: Number((row as { version?: number }).version), reason }, { idempotencyKey: crypto.randomUUID() })
    if (!await loadRealRows()) return
    decisionReason.value = ''
    notice.value = '已终止送审，未完成任务已取消。'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '终止失败'
  } finally {
    saving.value = false
  }
}

async function submitForStudent(input: SchoolSubmissionInput) {
  if (!demoEnabled || !service) return
  saving.value = true
  try {
    await service.submitThesisAsSchool(input)
    rows.value = await service.listSchoolTheses()
    drawerOpen.value = false
  } finally { saving.value = false }
}

async function showBatchPreview() {
  if (!demoEnabled || !service) return
  batchRows.value = await service.previewBatchImport()
  batchOpen.value = true
}
watch([timeScope.scope, timeScope.identity], () => {
  if (demoEnabled) return
  listGeneration++; rows.value = []; rawRows.value = []; selectedId.value = null; notice.value = ''
  if (authStore.user) void loadRealRows()
})
onBeforeUnmount(() => { listGeneration++ })
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/preparation" :context-label="demoEnabled ? '学校端 · 海岳大学' : '学校端 · ' + (authStore.user?.tenantCode ?? '本校')" :user-name="authStore.user?.displayName ?? '王老师'">
    <div class="preparation-page">
      <PageHeader eyebrow="PAGE-004 · REVIEW PREPARATION" title="送审准备" description="统一管理学生自提、学校单篇代传与批量导入论文，并在送出前完成材料与匿名化核验。">
        <template #actions>
          <button v-if="demoEnabled" type="button" class="action secondary" data-action="open-school-submission" @click="drawerOpen = true">单篇代传</button>
          <button v-if="demoEnabled" type="button" class="action primary" data-action="open-batch-preview" @click="showBatchPreview">批量导入</button>
          <button v-if="demoEnabled" type="button" class="action quiet">下载导入模板</button>
        </template>
      </PageHeader>
      <TimeScopeSelect v-if="!demoEnabled" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <BlindRail audience="本校学生身份、原始论文与匿名材料" hidden-from="专家身份与专家联系方式不在学校准备页展示" stage="材料准备与匿名核验" />
      <p class="submission-policy">学校可直接提交，无需学生再次确认；学生仍可在“我的论文”查看学校代传记录。</p>
      <p v-if="loading" role="status">正在加载本校论文与检测统计…</p>
      <div v-else-if="loadError" role="alert">
        <p>{{ loadError }}</p>
        <button type="button" data-action="reload-preparation" @click="loadRealRows">重新加载</button>
      </div>
      <template v-else>
      <p v-if="!demoEnabled" class="submission-policy">按本校每篇论文最近一次自动检测结论统计；记录可能来自退回前的旧版本，不代表当前版本已通过。无检测记录不计入，人工审核和列表搜索不改变分类。</p>
      <AnonymizationCheckPanel v-bind="demoEnabled ? { pass: 18, reviewRequired: 3, failed: 1 } : automaticCounts" />
      <section class="workbench" aria-label="学校论文列表">
        <header><div><span>THESIS INTAKE</span><h2>本校论文</h2></div><label>搜索<input v-model="query" placeholder="学号、姓名、论文或专业" /></label></header>
        <SchoolThesisTable :preference-identity="demoEnabled ? null : authStore.user" :rows="filteredRows" @select="selectedId = $event; decisionReason = ''; notice = ''" />
        <p v-if="!demoEnabled" class="submission-policy">
          当前为真实审核：按钮由服务端允许动作驱动。检测失败不能通过。
        </p>
        <SensitiveFindingPanel v-if="!demoEnabled && selectedDetail" :key="selectedDetail.id" :detail="selectedDetail" :busy="saving" school @check="checkSelected" />
        <div v-if="!demoEnabled && selectedId" class="review-actions">
          <textarea
            v-if="selectedActions.includes('REJECT_ANONYMIZATION') || selectedActions.includes('TERMINATE')"
            v-model="decisionReason"
            placeholder="人工核验、退回或终止理由（词表待核查项通过时需填写）"
          ></textarea>
          <button
            v-if="selectedActions.includes('CONFIRM_ANONYMIZATION')"
            type="button"
            class="action primary"
            :disabled="saving"
            @click="decide('PASS')"
          >
            通过匿名核验
          </button>
          <button
            v-if="selectedActions.includes('REJECT_ANONYMIZATION')"
            type="button"
            class="action secondary"
            :disabled="saving"
            @click="decide('REJECT')"
          >
            退回草稿
          </button>
          <button
            v-if="selectedActions.includes('CONFIRM_DISPATCH')"
            type="button"
            class="action primary"
            :disabled="saving"
            @click="sendOut"
          >
            确认送出
          </button>
          <button v-if="selectedActions.includes('TERMINATE')" type="button" class="action secondary"
            data-action="terminate-thesis" :disabled="saving || !decisionReason.trim()" @click="terminateSelected">终止送审</button>
          <p v-if="notice" role="status">{{ notice }}</p>
        </div>
      </section>
      <BatchImportPreview v-if="batchOpen" :rows="batchRows" />
      </template>
    </div>
    <SchoolSubmissionDrawer v-if="drawerOpen" :saving="saving" @close="drawerOpen = false" @submit="submitForStudent" />
  </PortalLayout>
</template>

<style scoped>
.preparation-page { display: grid; gap: 1rem; }
.workbench { min-width: 0; }
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
