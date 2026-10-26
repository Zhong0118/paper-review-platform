<script setup lang="ts">
import TimeScopeSelect from '@/components/app/TimeScopeSelect.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { useOperationsDashboard } from '@/composables/useOperationsDashboard'
import type { StatusFilter } from '@/api/dashboard'
import { onMounted, ref, watch, onBeforeUnmount } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import StatusTag from '@/components/app/StatusTag.vue'
import ScenarioStageRibbon from '@/components/app/ScenarioStageRibbon.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { schoolProgressList, type SchoolProgressList, type SchoolProgressRow } from '@/api/dispatch'
import type { DemoScenarioSnapshot } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import TaskProgressSummary from '../components/TaskProgressSummary.vue'

type GateStatus = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL'
interface GateRow { id: string; title: string; anonymousId: string; status: GateStatus; finding: string }

const timeScope = useTimeScope()
const dashboard = useOperationsDashboard(false, timeScope)
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const authStore = useAuthStore()
const sendingId = ref('')
const notice = ref('')
const snapshot = ref<DemoScenarioSnapshot | null>(null)
const live = ref<SchoolProgressList | null>(null)
const gateRows: GateRow[] = [
  { id: 'thesis-0042', title: '面向复杂场景的多模态知识推理研究', anonymousId: 'HY-2026-0042', status: 'PASS', finding: '未检测到姓名、导师、致谢等身份信息' },
  { id: 'thesis-0048', title: '复杂系统中的知识发现与风险识别', anonymousId: 'HY-2026-0048', status: 'REVIEW_REQUIRED', finding: '页眉疑似包含学院简称，需人工确认' },
  { id: 'thesis-0053', title: '区域数字治理能力评价研究', anonymousId: 'HY-2026-0053', status: 'FAIL', finding: '致谢页包含导师姓名，必须替换匿名版' },
]
const gateLabels: Record<GateStatus, string> = { PASS: '检测通过', REVIEW_REQUIRED: '待人工复核', FAIL: '检测失败' }
const filterLabels = { ALL: '全部送出论文', WAITING: '待派论文', INVITED: '邀请中任务', IN_REVIEW: '评阅中任务', SUBMITTED: '已提交任务' }

function taskLabel(status: string) {
  if (status === 'IN_REVIEW') return '评阅中'
  if (status === 'SUBMITTED') return '已提交'
  if (status === 'REJECTED') return '已拒绝'
  if (status === 'INVITED') return '待接受'
  return status
}

onMounted(async () => {
  if (demoEnabled && service) {
    snapshot.value = await service.loginAs('school_reviewer')
    return
  }
  void dashboard.load()
  await loadProgress()
})

let listGeneration = 0
const listError = ref('')
async function loadProgress() {
  const request = ++listGeneration
  live.value = null; listError.value = ''; dashboard.resetList()
  try {
    const data = await schoolProgressList(...timeScope.request(), dashboard.status.value)
    if (request === listGeneration) {
      live.value = data
      dashboard.receiveList(data.filtered_count ?? data.items.length, data.as_of ?? timeScope.meta.value?.asOf ?? '')
    }
  } catch (err) {
    if (request === listGeneration) listError.value = err instanceof Error ? err.message : '进度加载失败，请重试'
  }
}

async function dispatch(row: GateRow) {
  if (!demoEnabled || !service || row.status !== 'PASS') return
  sendingId.value = row.id
  try {
    await service.confirmAnonymization()
    snapshot.value = await service.confirmDispatch()
    notice.value = `${row.anonymousId} 已确认送出，等待平台派单。`
  } finally { sendingId.value = '' }
}

function rowTitle(row: SchoolProgressRow) {
  return row.title || row.thesis_id.slice(0, 8)
}
watch([timeScope.scope, timeScope.identity], () => { if (!demoEnabled && authStore.user) { void dashboard.load(); void loadProgress() } })
function showStatus(status: StatusFilter) {
  if (status === dashboard.status.value) void loadProgress()
  else void dashboard.drill(status)
}
watch(dashboard.status, () => { if (!demoEnabled) void loadProgress() })
onBeforeUnmount(() => { listGeneration++ })
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', demoEnabled)" active-path="/school/progress" :context-label="demoEnabled ? '学校端 · 海岳大学' : '学校端 · ' + (authStore.user?.tenantCode ?? '本校')" :user-name="authStore.user?.displayName ?? '王老师'">
    <div class="progress-page">
      <PageHeader eyebrow="PAGE-005 · REVIEW PROGRESS" title="评审进度" description="查看已送出论文的任务化名与状态计数；学校侧不展示专家身份。" />
      <TimeScopeSelect v-if="!demoEnabled" :model-value="timeScope.scope.value" :meta="timeScope.meta.value" @update:model-value="timeScope.setScope" />
      <p v-if="listError" role="alert">{{ listError }} <button type="button" @click="loadProgress">重新加载</button></p>
      <BlindRail audience="本校论文、任务化名与进度数量" hidden-from="不展示专家姓名、手机号、邮箱和专家库详情" stage="学校确认送出" />
      <ScenarioStageRibbon v-if="demoEnabled && snapshot" :stage="snapshot.thesis.stage" :task-status="snapshot.thesis.taskStatus" :bill-status="snapshot.thesis.billStatus" />
      <TaskProgressSummary v-if="demoEnabled" :waiting="6" :reviewing="12" :completed="28" :overdue="2" />
      <TaskProgressSummary v-else live :data="dashboard.data.value" :loading="dashboard.loading.value" :error="dashboard.error.value" @filter="showStatus" @retry="dashboard.load" />
      <p v-if="notice" class="dispatch-notice" role="status">{{ notice }}</p>
      <section v-if="demoEnabled" class="gate-list" aria-labelledby="gate-title">
        <header><div><span>ANONYMIZATION GATE</span><h2 id="gate-title">匿名化门禁</h2></div><small>通过也需学校最终确认后送出</small></header>
        <article v-for="row in gateRows" :key="row.id" :data-anonymization="row.status">
          <div class="gate-list__paper"><strong>{{ row.title }}</strong><code>{{ row.anonymousId }}</code></div>
          <StatusTag :status="row.status === 'FAIL' ? 'FAILED' : row.status" :label="gateLabels[row.status]" />
          <p>{{ row.finding }}</p>
          <button v-if="row.status === 'REVIEW_REQUIRED'" type="button" class="quiet">人工复核后处理</button>
          <button v-else type="button" class="primary" :disabled="row.status === 'FAIL' || sendingId === row.id" @click="dispatch(row)">
            {{ row.status === 'FAIL' ? '替换材料后再送出' : sendingId === row.id ? '正在送出…' : '确认送出' }}
          </button>
        </article>
      </section>
      <section class="task-aliases" aria-labelledby="task-title">
        <header><span>TASK VIEW</span><h2 id="task-title">已送出任务</h2></header>
        <template v-if="demoEnabled">
          <div><code>任务 A-042-01</code><span>评阅中 · 剩余 8 天</span><button type="button">发送催审提醒</button></div>
          <div><code>任务 A-031-02</code><span>已完成 · 等待结果汇总</span><button type="button">查看进度</button></div>
        </template>
        <template v-else>
          <div class="list-filter"><strong>{{ filterLabels[dashboard.status.value] }}</strong> <button type="button" @click="showStatus('ALL')">查看全部状态</button> <button type="button" @click="dashboard.load(); loadProgress()">刷新</button></div>
          <p v-if="dashboard.listCount.value !== null" role="status">{{ dashboard.changed.value ? '数据已更新 · ' : '' }}当前 {{ dashboard.listCount.value }} {{ ['ALL', 'WAITING'].includes(dashboard.status.value) ? '篇论文' : '个任务' }} <small v-if="dashboard.listAsOf.value">· 列表更新于 {{ new Date(dashboard.listAsOf.value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }} 北京时间</small></p>
          <p v-if="!live && !listError" role="status">正在加载任务列表…</p>
          <p v-else-if="live && !live.items.length" class="empty">当前范围暂无符合条件的论文或任务</p>
          <article v-for="row in live?.items ?? []" :key="row.thesis_id" data-progress-row>
            <div class="gate-list__paper">
              <strong>{{ rowTitle(row) }}</strong>
              <code>{{ row.student_name }} · {{ row.stage }}</code>
            </div>
            <div v-if="row.tasks.length" class="task-list">
              <span v-for="task in row.tasks" :key="task.alias">{{ task.alias }} · {{ taskLabel(task.status) }}</span>
            </div>
            <span v-else>待平台派单</span>
          </article>
        </template>
      </section>
    </div>
  </PortalLayout>
</template>

<style scoped>
.task-aliases > .list-filter { display: flex; flex-wrap: wrap; gap: .65rem; padding: .8rem 1rem; }
.list-filter > strong { margin-right: auto; }
.list-filter button { flex: none; padding: .4rem .7rem; transition: transform .15s, background .15s; }
.list-filter button:hover { background: #edf4fb; transform: translateY(-1px); }
.list-filter button:active { transform: scale(.98); }
.task-aliases > p[role="status"] { padding: 0 1rem; color: #687682; font-size: .8rem; }
[data-progress-row] { animation: row-appear .18s ease; }
@keyframes row-appear { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { [data-progress-row] { animation: none; } .list-filter button { transition: none; } }

.progress-page { display: grid; gap: 1rem; }
.dispatch-notice { margin: 0; padding: 0.7rem 0.85rem; border-left: 3px solid #2e7d32; background: #edf7ee; color: #26612b; font-size: 0.75rem; }
.gate-list, .task-aliases { border: 1px solid #dce3e9; background: white; }
.gate-list > header, .task-aliases > header { display: flex; align-items: center; justify-content: space-between; padding: 0.8rem 1rem; border-bottom: 1px solid #e3e8ec; }
.gate-list header span, .task-aliases header span { color: #687682; font-family: var(--font-data); font-size: 0.65rem; letter-spacing: 0.12em; }
.gate-list h2, .task-aliases h2 { margin: 0.15rem 0 0; color: #263744; font-family: var(--font-display); font-size: 1rem; }
.gate-list header small { color: #75818b; font-size: 0.7rem; }
.gate-list article { display: grid; grid-template-columns: minmax(18rem, 1.4fr) 8rem minmax(15rem, 1fr) auto; gap: 1rem; align-items: center; padding: 0.8rem 1rem; border-bottom: 1px solid #e7ebee; }
.gate-list article:last-child { border-bottom: 0; }
.gate-list__paper strong, .gate-list__paper code { display: block; }
.gate-list__paper strong { color: #2f3e4a; font-size: 0.78rem; }
.gate-list__paper code { margin-top: 0.2rem; color: #71808c; font-family: var(--font-data); font-size: 0.68rem; }
.gate-list article p { margin: 0; color: #65737f; font-size: 0.72rem; line-height: 1.5; }
.gate-list button, .task-aliases button { min-height: 2.25rem; padding: 0.35rem 0.65rem; border-radius: 0.3rem; font-size: 0.72rem; font-weight: 650; cursor: pointer; }
.primary { border: 1px solid #1b4f8a; background: #1b4f8a; color: white; }
.primary:disabled { border-color: #c7d0d8; background: #e0e5e9; color: #7c8892; cursor: not-allowed; }
.quiet { border: 1px solid #c49b74; background: #fff5eb; color: #8b4815; }
.task-aliases > div, .task-aliases article { display: grid; grid-template-columns: minmax(14rem, 1.2fr) 1fr auto; gap: 1rem; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #e7ebee; }
.task-aliases > div:last-child, .task-aliases article:last-child { border-bottom: 0; }
.task-aliases code { color: #1b4f8a; font-family: var(--font-data); font-size: 0.72rem; }
.task-aliases span { color: #65737f; font-size: 0.72rem; }
.task-aliases button { border: 1px solid #b9c5ce; background: white; color: #3f505d; }
.task-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.empty { margin: 0; padding: 1.5rem 1rem; color: #687682; text-align: center; }
@media (max-width: 900px) { .gate-list article, .task-aliases > div, .task-aliases article { grid-template-columns: 1fr; } }
</style>
