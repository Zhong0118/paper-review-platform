<script setup lang="ts">
import { onMounted, ref } from 'vue'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import StatusTag from '@/components/app/StatusTag.vue'
import ScenarioStageRibbon from '@/components/app/ScenarioStageRibbon.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { DemoScenarioSnapshot } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

import TaskProgressSummary from '../components/TaskProgressSummary.vue'

type GateStatus = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL'
interface GateRow { id: string; title: string; anonymousId: string; status: GateStatus; finding: string }

const service = useScenarioService()
const authStore = useAuthStore()
const sendingId = ref('')
const notice = ref('')
const snapshot = ref<DemoScenarioSnapshot | null>(null)
const gateRows: GateRow[] = [
  { id: 'thesis-0042', title: '面向复杂场景的多模态知识推理研究', anonymousId: 'HY-2026-0042', status: 'PASS', finding: '未检测到姓名、导师、致谢等身份信息' },
  { id: 'thesis-0048', title: '复杂系统中的知识发现与风险识别', anonymousId: 'HY-2026-0048', status: 'REVIEW_REQUIRED', finding: '页眉疑似包含学院简称，需人工确认' },
  { id: 'thesis-0053', title: '区域数字治理能力评价研究', anonymousId: 'HY-2026-0053', status: 'FAIL', finding: '致谢页包含导师姓名，必须替换匿名版' },
]
const gateLabels: Record<GateStatus, string> = { PASS: '检测通过', REVIEW_REQUIRED: '待人工复核', FAIL: '检测失败' }

onMounted(async()=>{snapshot.value=await service.loginAs('school_reviewer')})

async function dispatch(row: GateRow) {
  if (row.status !== 'PASS') return
  sendingId.value = row.id
  try {
    await service.confirmAnonymization()
    snapshot.value = await service.confirmDispatch()
    notice.value = `${row.anonymousId} 已确认送出，等待平台派单。`
  } finally { sendingId.value = '' }
}
</script>

<template>
  <PortalLayout :menu-items="menusByRole.school_reviewer ?? []" active-path="/school/progress" context-label="学校端 · 海岳大学" :user-name="authStore.user?.displayName ?? '王老师'">
    <div class="progress-page">
      <PageHeader eyebrow="PAGE-005 · REVIEW PROGRESS" title="评审进度" description="先完成匿名化门禁并确认送出，再查看任务状态、截止时间与异常处理；学校侧仅展示任务化名。" />
      <BlindRail audience="本校论文、任务化名与进度数量" hidden-from="不展示专家姓名、手机号、邮箱和专家库详情" stage="学校确认送出" />
      <ScenarioStageRibbon v-if="snapshot" :stage="snapshot.thesis.stage" :task-status="snapshot.thesis.taskStatus" :bill-status="snapshot.thesis.billStatus" />
      <TaskProgressSummary :waiting="6" :reviewing="12" :completed="28" :overdue="2" />
      <p v-if="notice" class="dispatch-notice" role="status">{{ notice }}</p>
      <section class="gate-list" aria-labelledby="gate-title">
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
        <div><code>任务 A-042-01</code><span>评阅中 · 剩余 8 天</span><button type="button">发送催审提醒</button></div>
        <div><code>任务 A-031-02</code><span>已完成 · 等待结果汇总</span><button type="button">查看进度</button></div>
      </section>
    </div>
  </PortalLayout>
</template>

<style scoped>
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
.task-aliases > div { display: grid; grid-template-columns: 12rem 1fr auto; gap: 1rem; align-items: center; padding: 0.75rem 1rem; border-bottom: 1px solid #e7ebee; }
.task-aliases > div:last-child { border-bottom: 0; }
.task-aliases code { color: #1b4f8a; font-family: var(--font-data); font-size: 0.72rem; }
.task-aliases span { color: #65737f; font-size: 0.72rem; }
.task-aliases button { border: 1px solid #b9c5ce; background: white; color: #3f505d; }
@media (max-width: 900px) { .gate-list article { grid-template-columns: 1fr; } .task-aliases > div { grid-template-columns: 1fr; } }
</style>
