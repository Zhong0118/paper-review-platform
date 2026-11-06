<script setup lang="ts">
/**
 * 评审邀请（R3-3，U4 计划 §19.6）：真实模式页面；demo 模式仍用旧 InvitationPage。
 * form 模板：取本人第一个“待接受”任务，读取邀请详情；接受前不开放论文正文，不显示费用。
 * 接受需二次确认，进入 /expert/review?task_id=；拒绝须选原因，“其他”须写说明（提交“其他：说明”）。
 */
import { ChevronLeft, ShieldCheck } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { acceptTask, getInvitation, listExpertTasks, rejectTask } from '@/api/expertTasks'
import { beijingTime } from '@/api/taskTiming'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'

interface Invitation {
  id: string
  anonymousId: string
  title: string
  discipline: string
  acceptBy: string
  overdue: boolean
}

const router = useRouter()
const auth = useAuthStore()
const signOut = useSignOut()

const invitation = ref<Invitation | null>(null)
const loading = ref(true)
const error = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    const invited = (await listExpertTasks()).find((row) => row.status === 'INVITED')
    if (!invited) {
      invitation.value = null
      return
    }
    const detail = await getInvitation(invited.id)
    invitation.value = {
      id: invited.id,
      anonymousId: detail.anonymous_id || invited.id.slice(0, 8),
      title: detail.anonymous_title || '匿名论文',
      discipline: detail.discipline_name || detail.discipline_code || '',
      acceptBy: beijingTime(detail.deadline?.accept_due_at),
      overdue: detail.deadline?.overdue ?? false,
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '邀请信息加载失败。'
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ---- 接受 ----
const acceptOpen = ref(false)
const acceptPending = ref(false)
const acceptError = ref('')
function onAcceptOpen(open: boolean) {
  if (!acceptPending.value) acceptOpen.value = open
  if (open) acceptError.value = ''
}
async function confirmAccept() {
  const target = invitation.value
  if (!target || acceptPending.value) return
  acceptPending.value = true
  acceptError.value = ''
  try {
    await acceptTask(target.id)
    acceptOpen.value = false
    await router.push({ path: '/expert/review', query: { task_id: target.id } })
  } catch (reason) {
    acceptError.value = reason instanceof Error ? reason.message : '接受任务失败，请稍后重试。'
  } finally {
    acceptPending.value = false
  }
}

// ---- 拒绝 ----
const REASONS = ['方向不符', '时间不足', '利益冲突', '其他']
const rejectOpen = ref(false)
const rejectReason = ref('')
const rejectDetail = ref('')
const rejectPending = ref(false)
const rejectError = ref('')
const submittedReason = computed(() => (rejectReason.value === '其他' ? `其他：${rejectDetail.value.trim()}` : rejectReason.value))
const canReject = computed(() => !rejectPending.value && rejectReason.value !== '' && (rejectReason.value !== '其他' || rejectDetail.value.trim() !== ''))
function openReject() {
  rejectReason.value = ''
  rejectDetail.value = ''
  rejectError.value = ''
  rejectOpen.value = true
}
function onRejectOpen(open: boolean) {
  if (!rejectPending.value) rejectOpen.value = open
}
async function confirmReject() {
  const target = invitation.value
  if (!target || !canReject.value) return
  rejectPending.value = true
  rejectError.value = ''
  try {
    await rejectTask(target.id, submittedReason.value)
    rejectOpen.value = false
    invitation.value = null
  } catch (reason) {
    rejectError.value = reason instanceof Error ? reason.message : '拒绝任务失败，请稍后重试。'
  } finally {
    rejectPending.value = false
  }
}

const nav = computed(() => workspaceNav('expert', '/expert/tasks'))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '评阅专家', org: '' }))
</script>

<template>
  <AppShell :nav="nav" :account="account" title="评审邀请" layout="form" @sign-out="signOut">
    <template #back>
      <Button variant="ghost" size="sm" as-child class="-ml-1 text-muted-foreground">
        <RouterLink to="/expert/tasks" data-back><ChevronLeft />我的任务</RouterLink>
      </Button>
    </template>
    <template #context>确认专业匹配与回避声明后决定是否接单</template>

    <div class="grid max-w-[720px] gap-4">
      <StatePanel v-if="loading" kind="loading" title="正在读取邀请…" />
      <StatePanel v-else-if="error" kind="error" title="邀请没有加载出来">
        {{ error }}
        <template #actions><Button variant="outline" @click="load">重试</Button></template>
      </StatePanel>
      <StatePanel v-else-if="!invitation" kind="empty" title="当前没有待处理的评审邀请">
        已接受、已完成和已拒绝的任务都在任务列表里。
        <template #actions><Button variant="outline" as-child><RouterLink to="/expert/tasks">查看我的任务</RouterLink></Button></template>
      </StatePanel>

      <section v-else class="rounded-lg border bg-background" aria-labelledby="inv-h" data-invitation>
        <header class="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <h2 id="inv-h" class="text-md font-semibold">匿名任务 <span class="tabular">{{ invitation.anonymousId }}</span></h2>
          <StatusBadge tone="brand">待接受</StatusBadge>
        </header>
        <dl class="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-[136px_1fr]">
          <dt class="text-muted-foreground">匿名题目</dt>
          <dd class="font-medium text-balance">{{ invitation.title }}</dd>
          <dt class="text-muted-foreground">送审方向</dt>
          <dd>{{ invitation.discipline || '未提供' }}</dd>
          <dt class="text-muted-foreground">接单截止（北京时间）</dt>
          <dd class="flex flex-wrap items-center gap-2">
            <span class="tabular">{{ invitation.acceptBy || '未配置' }}</span>
            <StatusBadge v-if="invitation.overdue" tone="danger">已逾期</StatusBadge>
          </dd>
        </dl>
        <div class="grid gap-2 border-t px-5 py-4 text-sm">
          <p class="flex gap-2"><ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />接受即确认：你与这篇论文不存在应回避的合作、亲属或利益关系，并遵守双盲评阅约定。</p>
          <p class="text-muted-foreground">接受前不开放论文正文；接受后进入在线评阅，只能看到匿名稿。</p>
        </div>
        <footer class="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" data-action="open-reject-dialog" @click="openReject">拒绝任务</Button>
          <Button data-action="accept-task" @click="acceptOpen = true">接受任务并开始评阅</Button>
        </footer>
      </section>
    </div>

    <AlertDialog :open="acceptOpen" @update:open="onAcceptOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认接受评审任务？</AlertDialogTitle>
          <AlertDialogDescription>
            接受后视同同意双盲评阅约定与回避声明：仅可见匿名版论文材料，不得向任何第三方披露评审内容，也不得联系论文作者。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="invitation" class="text-sm">任务 <span class="tabular font-medium">{{ invitation.anonymousId }}</span></p>
        <p v-if="acceptError" class="text-sm text-destructive" role="alert">{{ acceptError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="acceptPending" data-action="cancel-accept">取消</AlertDialogCancel>
          <Button :disabled="acceptPending" data-action="confirm-accept-task" @click="confirmAccept">{{ acceptPending ? '正在接受…' : '确认接受并进入评阅' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="rejectOpen" @update:open="onRejectOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>拒绝该评审邀请？</AlertDialogTitle>
          <AlertDialogDescription>拒绝后这项任务退回平台重新派单。请选择拒绝原因。</AlertDialogDescription>
        </AlertDialogHeader>
        <div class="grid gap-1.5">
          <Label for="reject-reason">拒绝原因</Label>
          <select
            id="reject-reason"
            v-model="rejectReason"
            class="h-(--control-h) rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            data-reject-reason
          >
            <option value="" disabled>请选择原因</option>
            <option v-for="reason in REASONS" :key="reason" :value="reason">{{ reason }}</option>
          </select>
        </div>
        <div v-if="rejectReason === '其他'" class="grid gap-1.5">
          <Label for="reject-detail">拒绝说明</Label>
          <Textarea id="reject-detail" v-model="rejectDetail" rows="3" placeholder="请说明具体原因" data-reject-reason-detail />
        </div>
        <p v-if="rejectError" class="text-sm text-destructive" role="alert">{{ rejectError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="rejectPending" data-action="cancel-reject">取消</AlertDialogCancel>
          <Button variant="destructive" :disabled="!canReject" data-action="confirm-reject-task" @click="confirmReject">{{ rejectPending ? '正在拒绝…' : '确认拒绝' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
</template>
