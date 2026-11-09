<script setup lang="ts">
/**
 * 专家任务（R3-3，U4 计划 §19.6）：真实模式页面；demo 模式仍用旧 ExpertTasksPage。
 * data 模板：工作视图＋任务表（窄屏卡片）；动作只按服务端 allowed_actions 决定；接受前只见匿名概要，不显示费用。
 * 时间范围与代际防晚到沿用旧页：每次读取带代际号，晚到的旧响应丢弃；换账号重新读取。
 */
import { useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { acceptTask, listExpertTasks, type ExpertTaskRow } from '@/api/expertTasks'
import { beijingTime } from '@/api/taskTiming'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import StatusBadge, { type StatusTone } from '@/components/app/data/StatusBadge.vue'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTimeScope } from '@/composables/useTimeScope'
import ExtensionPanel from '@/modules/dispatch/components/ExtensionPanel.vue'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'

interface TaskView {
  id: string
  status: string
  anonymousId: string
  anonymousTitle: string
  discipline: string
  acceptBy: string
  dueAt: string
  overdue: boolean
  correctionPending: boolean
  allowed: string[]
}

const router = useRouter()
const auth = useAuthStore()
const signOut = useSignOut()
const timeScope = useTimeScope()

const VIEWS = [
  { value: 'INVITED', label: '待接受', match: (t: TaskView) => t.status === 'INVITED' },
  { value: 'IN_REVIEW', label: '评阅中', match: (t: TaskView) => t.status === 'IN_REVIEW' },
  { value: 'SUBMITTED', label: '已完成', match: (t: TaskView) => t.status === 'SUBMITTED' },
  { value: 'REJECTED', label: '已拒绝', match: (t: TaskView) => t.status === 'REJECTED' },
  { value: 'CANCELLED', label: '已撤销', match: (t: TaskView) => t.status === 'CANCELLED' },
  { value: 'CORRECTION_PENDING', label: '需要更正', match: (t: TaskView) => t.correctionPending },
]
const STATUS: Record<string, { text: string; tone: StatusTone }> = {
  INVITED: { text: '待接受', tone: 'brand' },
  IN_REVIEW: { text: '评阅中', tone: 'brand' },
  SUBMITTED: { text: '已完成', tone: 'success' },
  REJECTED: { text: '已拒绝', tone: 'neutral' },
  ACCEPT_TIMEOUT: { text: '已超时', tone: 'neutral' },
  CANCELLED: { text: '已撤销', tone: 'neutral' },
}

const toView = (row: ExpertTaskRow): TaskView => ({
  id: row.id,
  status: row.status,
  anonymousId: row.anonymous_id ?? row.id.slice(0, 8),
  anonymousTitle: row.anonymous_title ?? '匿名论文',
  discipline: row.discipline_name ?? '',
  acceptBy: beijingTime(row.deadline?.accept_due_at),
  dueAt: beijingTime(row.deadline?.review_due_at),
  overdue: row.deadline?.overdue ?? false,
  correctionPending: false,
  allowed: row.allowed_actions ?? (row.status === 'INVITED' ? ['ACCEPT_TASK'] : []),
})

const tasks = ref<TaskView[]>([])
const loading = ref(true)
const error = ref('')
const view = ref('INVITED')
let generation = 0
async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  tasks.value = []
  try {
    const rows = (await listExpertTasks(...timeScope.request())).map(toView)
    if (request !== generation) return
    tasks.value = rows
    view.value = VIEWS.find((v) => rows.some(v.match))?.value ?? 'INVITED'
  } catch (reason) {
    if (request === generation) error.value = reason instanceof Error ? reason.message : '任务列表加载失败。'
  } finally {
    if (request === generation) loading.value = false
  }
}
onMounted(load)
watch([timeScope.scope, timeScope.identity], () => {
  if (auth.user) void load()
})
onBeforeUnmount(() => generation++)

const current = computed(() => VIEWS.find((v) => v.value === view.value) ?? VIEWS[0]!)
const visible = computed(() => tasks.value.filter(current.value.match))
const views = computed(() =>
  VIEWS.map((v) => ({ value: v.value, label: v.label, count: loading.value || error.value ? undefined : tasks.value.filter(v.match).length, attrs: { 'data-tab': v.value } })),
)

/** 行动作只来自服务端允许动作（与旧表 actionFor 相同） */
function actionOf(task: TaskView) {
  if (task.allowed.includes('ACCEPT_TASK')) return { kind: 'accept' as const, label: '接受' }
  if (task.allowed.includes('CONTINUE_REVIEW')) return { kind: 'continue-review' as const, label: '继续评阅' }
  if (task.allowed.includes('VIEW_SUBMITTED')) return { kind: 'view-submitted' as const, label: '查看' }
  return null
}
const deadlineOf = (task: TaskView) => (task.status === 'INVITED' ? (task.acceptBy ? `接单 ${task.acceptBy}` : '接单截止未配置') : task.dueAt ? `评阅 ${task.dueAt}` : '—')

// ---- 评阅延期 ----
const extensionId = ref('')
const extensionTask = computed(() => visible.value.find((t) => t.id === extensionId.value) ?? null)
const toggleExtension = (task: TaskView) => (extensionId.value = extensionId.value === task.id ? '' : task.id)

// ---- 接受确认 ----
const acceptTarget = ref<TaskView | null>(null)
const acceptPending = ref(false)
const acceptError = ref('')
function requestAccept(task: TaskView) {
  acceptTarget.value = task
  acceptError.value = ''
}
function onAcceptOpen(open: boolean) {
  if (!open && !acceptPending.value) acceptTarget.value = null
}
async function confirmAccept() {
  const target = acceptTarget.value
  if (!target || acceptPending.value) return
  acceptPending.value = true
  acceptError.value = ''
  try {
    await acceptTask(target.id)
    acceptTarget.value = null
    await router.push({ path: '/expert/review', query: { task_id: target.id } })
  } catch (reason) {
    acceptError.value = reason instanceof Error ? reason.message : '接受任务失败，请稍后重试。'
  } finally {
    acceptPending.value = false
  }
}

/** jsdom 没有 matchMedia：默认按宽屏渲染表格 */
const narrow = useMediaQuery('(max-width: 767px)')
const nav = computed(() => workspaceNav('expert', '/expert/tasks'))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '评阅专家', org: '' }))
</script>

<template>
  <AppShell :nav="nav" :account="account" title="我的任务" layout="data" @sign-out="signOut">
    <template #context>只显示本人任务；接受前只能看到匿名概要</template>
    <template #actions>
      <ScopeSelect :model-value="timeScope.scope.value" @update:model-value="timeScope.setScope" />
    </template>

    <div class="grid gap-3">
      <ViewTabs v-model="view" :views="views" label="任务分组" />
      <p v-if="timeScope.scope.value === 'past_year'" class="text-sm text-muted-foreground" role="note">按论文创建日（北京时间）计算。较早建立论文的未结任务可能未显示，可切换全部年份。</p>

      <div class="overflow-hidden rounded-lg border bg-background" data-expert-task-table>
        <StatePanel v-if="loading" kind="loading" title="正在读取任务…" compact />
        <StatePanel v-else-if="error" kind="error" title="任务列表没有加载出来" compact>
          {{ error }}
          <template #actions><Button variant="outline" data-action="retry-tasks" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!visible.length" kind="empty" title="当前分组暂无任务。" compact />

        <ul v-else-if="narrow" class="divide-y">
          <li v-for="task in visible" :key="task.id" class="grid gap-2 px-4 py-3" :data-expert-task="task.id">
            <p class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-muted-foreground" data-task-code>任务编号 <span class="tabular">{{ task.anonymousId }}</span></span>
              <StatusBadge :tone="STATUS[task.status]?.tone ?? 'neutral'">{{ STATUS[task.status]?.text ?? task.status }}</StatusBadge>
              <StatusBadge v-if="task.overdue" tone="danger" data-overdue-tag>已逾期</StatusBadge>
            </p>
            <p class="font-medium text-balance">{{ task.anonymousTitle }}</p>
            <p class="text-sm text-muted-foreground">{{ task.discipline || '方向未提供' }}　<span class="tabular">{{ deadlineOf(task) }}</span></p>
            <div class="flex flex-wrap gap-2">
              <template v-if="actionOf(task)">
                <Button v-if="actionOf(task)!.kind === 'accept'" size="sm" data-action="accept-task" @click="requestAccept(task)">接受</Button>
                <Button v-else size="sm" as-child>
                  <RouterLink :to="{ path: '/expert/review', query: { task_id: task.id } }" :data-action="actionOf(task)!.kind">{{ actionOf(task)!.label }}</RouterLink>
                </Button>
              </template>
              <Button v-if="task.dueAt" variant="outline" size="sm" :aria-expanded="extensionId === task.id" @click="toggleExtension(task)">评阅延期</Button>
            </div>
          </li>
        </ul>
        <Table v-else>
          <TableHeader class="bg-muted/50">
            <TableRow class="hover:bg-transparent">
              <TableHead class="w-[40%]">匿名任务</TableHead>
              <TableHead>送审方向</TableHead>
              <TableHead>截止（北京时间）</TableHead>
              <TableHead>状态</TableHead>
              <TableHead class="text-right"><span class="sr-only">操作</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="task in visible" :key="task.id" :data-expert-task="task.id" :data-overdue="task.overdue ? 'true' : 'false'">
              <TableCell class="whitespace-normal">
                <span class="grid gap-0.5">
                  <span class="font-medium">{{ task.anonymousTitle }}</span>
                  <span class="text-xs text-muted-foreground" data-task-code>任务编号 <span class="tabular">{{ task.anonymousId }}</span></span>
                </span>
              </TableCell>
              <TableCell>{{ task.discipline || '—' }}</TableCell>
              <TableCell class="tabular">{{ deadlineOf(task) }}</TableCell>
              <TableCell>
                <span class="flex flex-wrap gap-1">
                  <StatusBadge :tone="STATUS[task.status]?.tone ?? 'neutral'">{{ STATUS[task.status]?.text ?? task.status }}</StatusBadge>
                  <StatusBadge v-if="task.overdue" tone="danger" data-overdue-tag>已逾期</StatusBadge>
                  <StatusBadge v-if="task.correctionPending" tone="warning" data-correction-tag>需要更正</StatusBadge>
                </span>
              </TableCell>
              <TableCell class="text-right">
                <span class="inline-flex items-center justify-end gap-1">
                  <Button v-if="task.dueAt" variant="ghost" size="sm" class="text-muted-foreground" :aria-expanded="extensionId === task.id" @click="toggleExtension(task)">评阅延期</Button>
                  <template v-if="actionOf(task)">
                    <Button v-if="actionOf(task)!.kind === 'accept'" size="sm" data-action="accept-task" @click="requestAccept(task)">接受</Button>
                    <Button v-else :variant="actionOf(task)!.kind === 'continue-review' ? 'default' : 'outline'" size="sm" as-child>
                      <RouterLink :to="{ path: '/expert/review', query: { task_id: task.id } }" :data-action="actionOf(task)!.kind">{{ actionOf(task)!.label }}</RouterLink>
                    </Button>
                  </template>
                  <span v-else-if="!task.dueAt" class="text-faint">—</span>
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <section v-if="extensionTask" class="rounded-lg border bg-background p-4" aria-label="评阅延期" data-extension>
        <ExtensionPanel :key="extensionTask.id" :task-id="extensionTask.id" :can-request="extensionTask.status === 'IN_REVIEW'" :due="extensionTask.dueAt" @changed="load" />
      </section>
    </div>

    <AlertDialog :open="Boolean(acceptTarget)" @update:open="onAcceptOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认接受评审任务？</AlertDialogTitle>
          <AlertDialogDescription>
            接受后视同同意双盲评阅约定与回避声明：仅可见匿名版论文材料，不得向任何第三方披露评审内容，也不得联系论文作者。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="acceptTarget" class="text-sm">
          任务 <span class="tabular font-medium">{{ acceptTarget.anonymousId }}</span>，接单截止（北京时间）<span class="tabular">{{ acceptTarget.acceptBy || '未配置' }}</span>
        </p>
        <p v-if="acceptError" class="text-sm text-destructive" role="alert">{{ acceptError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="acceptPending" data-action="cancel-accept">取消</AlertDialogCancel>
          <Button :disabled="acceptPending" data-action="confirm-accept-task" @click="confirmAccept">{{ acceptPending ? '正在接受…' : '确认接受并进入评阅' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
</template>
