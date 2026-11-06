<script setup lang="ts">
/**
 * 学校评审进度（R3-1，U4 计划 §19.2）：真实模式页面；demo 模式仍用旧 ReviewProgressPage。
 * data 模板：顶栏标题＋时间范围；指标是列表的工作视图（点了即下钻，写 status_filter），指标失败时视图不显示数字并给出“重试指标”；
 * 评分分布为右侧小节；列表为表格（论文、学生、阶段、任务化名与状态），学校端不显示专家身份。
 * 数据逻辑沿用 useOperationsDashboard 与 schoolProgressList：代际防晚到、下钻计数变化提示、已选再点刷新。
 */
import { RefreshCw } from '@lucide/vue'
import { useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { StatusFilter } from '@/api/dashboard'
import { schoolProgressList, type SchoolProgressList, type SchoolProgressRow } from '@/api/dispatch'
import { deadlineLabel } from '@/api/taskTiming'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import ViewTabs, { type ViewOption } from '@/components/app/data/ViewTabs.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useOperationsDashboard } from '@/composables/useOperationsDashboard'
import { useTimeScope } from '@/composables/useTimeScope'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'

import { stageLabel } from '../preparation/checkReport'

const auth = useAuthStore()
const signOut = useSignOut()
const timeScope = useTimeScope()
const dashboard = useOperationsDashboard(false, timeScope)

const CARDS = [
  { key: 'waiting_theses', label: '待派论文', status: 'WAITING' },
  { key: 'invited_tasks', label: '邀请中任务', status: 'INVITED' },
  { key: 'in_review_tasks', label: '评阅中任务', status: 'IN_REVIEW' },
  { key: 'submitted_tasks', label: '已提交任务', status: 'SUBMITTED' },
] as const
/** 计数只在指标已取得时显示；加载中与失败不显示 0，也不挂下钻钩子（测试据此区分） */
const views = computed<ViewOption[]>(() => [
  { value: 'ALL', label: '全部送出论文' },
  ...CARDS.map((card) => {
    const data = dashboard.data.value
    return data ? { value: card.status, label: card.label, count: data.cards[card.key], attrs: { 'data-dashboard-card': card.key } } : { value: card.status, label: card.label }
  }),
])
const paperUnit = computed(() => (['ALL', 'WAITING'].includes(dashboard.status.value) ? '篇论文' : '个任务'))
const beijing = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const fromDate = computed(() => {
  const from = timeScope.meta.value?.from
  return from ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(from)) : ''
})

function taskLabel(status: string) {
  return ({ IN_REVIEW: '评阅中', SUBMITTED: '已提交', REJECTED: '已拒绝', INVITED: '待接受' } as Record<string, string>)[status] ?? status
}
const rowTitle = (row: SchoolProgressRow) => row.title || row.thesis_id.slice(0, 8)

const live = ref<SchoolProgressList | null>(null)
const listError = ref('')
let listGeneration = 0
async function loadProgress() {
  const request = ++listGeneration
  live.value = null
  listError.value = ''
  dashboard.resetList()
  try {
    const data = await schoolProgressList(...timeScope.request(), dashboard.status.value)
    if (request !== listGeneration) return
    live.value = data
    dashboard.receiveList(data.filtered_count ?? data.items.length, data.as_of ?? timeScope.meta.value?.asOf ?? '')
  } catch (err) {
    if (request === listGeneration) listError.value = err instanceof Error ? err.message : '进度加载失败，请重试'
  }
}
function refresh() {
  void dashboard.load()
  void loadProgress()
}
function showStatus(value: string) {
  const status = value as StatusFilter
  if (status === dashboard.status.value) void loadProgress()
  else void dashboard.drill(status)
}

onMounted(refresh)
watch([timeScope.scope, timeScope.identity], () => {
  if (auth.user) refresh()
})
watch(dashboard.status, () => void loadProgress())
onBeforeUnmount(() => {
  listGeneration++
})

/** jsdom 没有 matchMedia：默认按宽屏渲染表格 */
const narrow = useMediaQuery('(max-width: 767px)')
const nav = computed(() => workspaceNav('school_reviewer', '/school/progress', {}))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <AppShell :nav="nav" :account="account" :workspace="account.org" title="评审进度" layout="data" @sign-out="signOut">
    <template #context>已送出论文的任务化名与进度；学校端不显示专家身份</template>
    <template #actions>
      <ScopeSelect :model-value="timeScope.scope.value" @update:model-value="timeScope.setScope" />
      <Button variant="outline" size="icon" aria-label="刷新指标与列表" title="刷新" data-action="refresh" @click="refresh"><RefreshCw /></Button>
    </template>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_288px]">
      <section class="grid min-w-0 content-start gap-3" aria-label="已送出论文">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ViewTabs :model-value="dashboard.status.value" :views="views" label="进度视图" @select="showStatus" />
        </div>

        <div class="grid gap-1 text-sm text-muted-foreground" :aria-busy="dashboard.loading.value">
          <p v-if="dashboard.loading.value" role="status">正在读取指标…</p>
          <p v-else-if="dashboard.error.value" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground" role="alert">
            <span>指标没有加载出来：{{ dashboard.error.value }}。列表不受影响。</span>
            <Button variant="outline" size="sm" data-retry-dashboard @click="dashboard.load">重试指标</Button>
          </p>
          <template v-else-if="dashboard.data.value">
            <p>
              {{ dashboard.data.value.time_scope === 'all' ? '全部论文' : '近一年创建的论文' }}，指标更新于
              <span class="tabular">{{ beijing(dashboard.data.value.as_of) }}</span>（北京时间）
            </p>
            <p data-overdue>
              逾期任务：{{
                dashboard.data.value.cards.overdue_tasks == null
                  ? '当前范围无已配置截止的活动任务，暂不统计'
                  : `${dashboard.data.value.cards.overdue_tasks} 个（只统计设有当前截止的任务）`
              }}
            </p>
          </template>
          <p v-if="timeScope.scope.value === 'past_year'" role="note">
            按论文创建日（北京时间）<template v-if="fromDate">从 {{ fromDate }} 起</template>。较早建立论文的未结任务可能未显示，可切换全部年份。
          </p>
        </div>

        <div class="overflow-hidden rounded-lg border bg-background">
          <div class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-sm">
            <p v-if="dashboard.listCount.value !== null" role="status">
              <span v-if="dashboard.changed.value" class="font-medium text-foreground">数据已更新，</span>当前 <span class="tabular">{{ dashboard.listCount.value }}</span> {{ paperUnit }}<span v-if="dashboard.listAsOf.value" class="text-muted-foreground">，列表更新于 <span class="tabular">{{ beijing(dashboard.listAsOf.value) }}</span></span>
            </p>
            <Button v-if="dashboard.status.value !== 'ALL'" variant="ghost" size="sm" class="ml-auto" @click="showStatus('ALL')">查看全部状态</Button>
          </div>

          <StatePanel v-if="listError" kind="error" title="评审进度没有加载出来" compact>
            {{ listError }}
            <template #actions><Button data-action="reload-list" @click="loadProgress">重新加载</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!live" kind="loading" title="正在读取评审进度…" compact />
          <StatePanel v-else-if="!live.items.length" kind="empty" title="这个范围内没有符合条件的论文或任务" compact>
            <template v-if="dashboard.status.value !== 'ALL' || timeScope.scope.value === 'past_year'" #actions>
              <Button v-if="dashboard.status.value !== 'ALL'" variant="outline" @click="showStatus('ALL')">查看全部状态</Button>
              <Button v-if="timeScope.scope.value === 'past_year'" variant="outline" @click="timeScope.setScope('all')">查看全部年份</Button>
            </template>
          </StatePanel>

          <ul v-else-if="narrow" class="divide-y">
            <li v-for="row in live.items" :key="row.thesis_id" class="grid gap-1.5 px-4 py-3" data-progress-row>
              <p class="font-medium text-balance">{{ rowTitle(row) }}</p>
              <p class="text-sm text-muted-foreground">{{ row.student_name || '学生未登记' }}　{{ stageLabel(row.stage) }}</p>
              <ul v-if="row.tasks.length" class="grid gap-0.5 text-sm">
                <li v-for="task in row.tasks" :key="task.alias"><span class="tabular font-medium">{{ task.alias }}</span>　{{ taskLabel(task.status) }}　<span class="text-muted-foreground">{{ deadlineLabel(task.status, task.deadline) }}</span></li>
              </ul>
              <p v-else class="text-sm text-muted-foreground">待平台派单</p>
            </li>
          </ul>
          <Table v-else>
            <TableHeader>
              <TableRow>
                <TableHead class="w-[44%]">论文</TableHead>
                <TableHead>学生</TableHead>
                <TableHead>阶段</TableHead>
                <TableHead>评阅任务</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in live.items" :key="row.thesis_id" data-progress-row>
                <TableCell class="font-medium whitespace-normal">{{ rowTitle(row) }}</TableCell>
                <TableCell>{{ row.student_name || '—' }}</TableCell>
                <TableCell>{{ stageLabel(row.stage) }}</TableCell>
                <TableCell class="whitespace-normal">
                  <ul v-if="row.tasks.length" class="grid gap-0.5">
                    <li v-for="task in row.tasks" :key="task.alias">
                      <span class="tabular font-medium">{{ task.alias }}</span>　{{ taskLabel(task.status) }}
                      <span class="text-muted-foreground">{{ deadlineLabel(task.status, task.deadline) }}</span>
                    </li>
                  </ul>
                  <span v-else class="text-muted-foreground">待平台派单</span>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </section>

      <aside v-if="dashboard.data.value?.published_score_bands" class="grid content-start gap-3 xl:pt-12" data-score-distribution aria-labelledby="dist-h">
        <h2 id="dist-h" class="text-md font-semibold">已发布论文 <span class="tabular">{{ dashboard.data.value.published_count ?? 0 }}</span> 篇</h2>
        <p class="text-sm text-muted-foreground">只统计当前有效的发布；每篇论文计一次，更正后按新分值。</p>
        <ul v-if="dashboard.data.value.published_count" class="grid gap-2.5">
          <li v-for="band in dashboard.data.value.published_score_bands" :key="band.code" class="grid grid-cols-[64px_1fr_44px] items-center gap-3 text-sm" :data-score-band="band.code">
            <span>{{ band.code }} 分</span>
            <span class="block h-2 rounded-full bg-muted" aria-hidden="true">
              <span class="block h-full rounded-full bg-primary/70" :style="{ width: `${(band.count / Math.max(dashboard.data.value.published_count ?? 0, 1)) * 100}%` }" />
            </span>
            <span class="tabular text-right">{{ band.count }} 篇</span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted-foreground">这个范围内还没有已发布的论文。</p>
      </aside>
    </div>
  </AppShell>
</template>
