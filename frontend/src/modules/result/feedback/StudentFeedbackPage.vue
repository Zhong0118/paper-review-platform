<script setup lang="ts">
/**
 * U2-6 学生正式反馈（真实模式，/student/results?thesisId=）：只读已发布快照 + 本人异议。
 * - 只有 COMPLETED 的论文有正式反馈；其余显示“还没有发布”，不提前透露分数或评语。
 * - 发布快照按 schema 版本解读（publishedFeedback.ts）；无法识别 → 整页按接口错误处理（D7）。
 * - 异议：服务端给 SUBMIT_OBJECTION 且没有未结异议时才可登记；理由与诉求都必填；一次尝试幂等键稳定。
 */
import { ChevronDown, MessageSquareWarning } from '@lucide/vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { createObjection, listMyObjections, type ObjectionRow } from '@/api/objections'
import { getPublishedResult } from '@/api/results'
import { listTheses, type ThesisDetail } from '@/api/theses'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import { useTimeScope } from '@/composables/useTimeScope'
import { studentAccount, studentNav } from '@/modules/thesis/workspace/studentShell'
import { failureText } from '@/api/failure'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import FeedbackDocument from './FeedbackDocument.vue'
import { readPublished, type FeedbackView } from './publishedFeedback'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const timeScope = useTimeScope()
const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status
const messageOf = (error: unknown, fallback: string) => failureText(error, fallback)

const theses = ref<ThesisDetail[]>([])
const listLoading = ref(true)
const listError = ref('')
const published = computed(() => theses.value.filter((thesis) => thesis.stage === 'COMPLETED'))
const queryId = computed(() => (typeof route.query.thesisId === 'string' ? route.query.thesisId : ''))
const thesis = computed(() => theses.value.find((row) => row.id === queryId.value) ?? null)
const title = computed(() => thesis.value?.current_version?.title || '本人论文')
const context = computed(() => [thesis.value?.review_batch?.name ?? thesis.value?.batch_name ?? ''].filter(Boolean))

type Load = { kind: 'idle' | 'loading' | 'unpublished' | 'error' | 'invalid' } | { kind: 'ready'; view: FeedbackView }
const state = ref<Load>({ kind: 'idle' })
const loadError = ref('')
let listGeneration = 0
let resultGeneration = 0

async function loadList() {
  const own = ++listGeneration
  listLoading.value = true
  listError.value = ''
  try {
    const rows = await listTheses(...timeScope.request())
    if (own !== listGeneration) return
    theses.value = rows
    if (!queryId.value && published.value[0]) await router.replace({ query: { ...route.query, thesisId: published.value[0].id } })
    // 地址里的选择可能刚被补上：两条路都在这里取结果，监听在清单加载期间不触发
    void loadResult()
  } catch (error) {
    if (own === listGeneration) listError.value = messageOf(error, '本人论文没有加载出来')
  } finally {
    if (own === listGeneration) listLoading.value = false
  }
}

async function loadResult() {
  const own = ++resultGeneration
  objections.value = []
  objectionError.value = ''
  objectionNotice.value = ''
  objectionFormOpen.value = false
  const id = queryId.value
  if (!id) {
    state.value = { kind: 'idle' }
    return
  }
  // 清单里能看到且尚未完成的论文：不请求结果，直接说明未发布
  if (thesis.value && thesis.value.stage !== 'COMPLETED') {
    state.value = { kind: 'unpublished' }
    return
  }
  state.value = { kind: 'loading' }
  try {
    const data = await getPublishedResult(id, { quiet: true })
    if (own !== resultGeneration) return
    const view = readPublished(data)
    state.value = view ? { kind: 'ready', view } : { kind: 'invalid' }
    if (view) void loadObjections(id)
  } catch (error) {
    if (own !== resultGeneration) return
    if (statusOf(error) === 404 || statusOf(error) === 403) state.value = { kind: 'unpublished' }
    else {
      loadError.value = messageOf(error, '评阅结果没有加载出来')
      state.value = { kind: 'error' }
    }
  }
}

watch([timeScope.scope, () => auth.user?.id], () => void loadList(), { immediate: true })
watch(queryId, (value, old) => { if (value !== old && !listLoading.value) void loadResult() })
onBeforeUnmount(() => { listGeneration++; resultGeneration++ })

function choose(id: string) {
  void router.replace({ query: { ...route.query, thesisId: id } })
}

// ---- 异议 ----
const objections = ref<ObjectionRow[]>([])
const objectionError = ref('')
const objectionNotice = ref('')
const objectionFormOpen = ref(false)
const latest = computed(() => objections.value[0] ?? null)
const open = computed(() => Boolean(latest.value && ['SUBMITTED', 'PROCESSING'].includes(latest.value.status)))
const canObject = computed(() => Boolean(thesis.value?.allowed_actions.includes('SUBMIT_OBJECTION')) && !open.value)
const OBJECTION_TEXT: Record<string, string> = { SUBMITTED: '已登记，等待学校受理', PROCESSING: '学校处理中', RESOLVED: '学校已办结' }
const CHANNEL_TEXT: Record<string, string> = { ONLINE: '线上处理', OFFLINE: '线下处理' }

async function loadObjections(id: string) {
  objectionError.value = ''
  try {
    const rows = await listMyObjections(id)
    if (id === queryId.value) objections.value = rows
  } catch (error) {
    if (id === queryId.value) objectionError.value = messageOf(error, '异议记录没有加载出来')
  }
}

const reason = ref('')
const request = ref('')
const formError = ref('')
const confirmOpen = ref(false)
const submitting = ref(false)
const submitError = ref('')
let attempt: { signature: string; key: string } | null = null

function openConfirm() {
  formError.value = !reason.value.trim() ? '请写明异议理由。' : !request.value.trim() ? '请写明希望学校如何处理。' : ''
  if (formError.value) return
  submitError.value = ''
  confirmOpen.value = true
}

async function submitObjection() {
  const id = queryId.value
  if (!id || submitting.value) return
  const body = { reason: reason.value.trim(), request: request.value.trim() }
  const signature = `${id}\n${body.reason}\n${body.request}`
  if (attempt?.signature !== signature) attempt = { signature, key: crypto.randomUUID() }
  submitting.value = true
  submitError.value = ''
  try {
    await createObjection(id, body, { idempotencyKey: attempt.key, quiet: true })
    attempt = null
    confirmOpen.value = false
    reason.value = ''
    request.value = ''
    objectionNotice.value = '异议已登记。学校受理后，这里会更新处理状态。'
    await loadObjections(id)
  } catch (error) {
    if (statusOf(error) === 409) {
      attempt = null
      confirmOpen.value = false
      await loadObjections(id)
      objectionNotice.value = '这篇论文已有未办结的异议，没有重复登记。'
    } else {
      submitError.value = `${messageOf(error, '请求失败')}。异议没有登记，可以重试。`
    }
  } finally {
    submitting.value = false
  }
}

const signOut = useSignOut()
const nav = computed(() => [{ items: studentNav('/student/results') }])
const account = computed(() => studentAccount(auth.user))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="reading" title="评阅结果" @sign-out="signOut">
      <template #context>学校发布后的正式反馈</template>
      <template #actions><ScopeSelect :model-value="timeScope.scope.value" @update:model-value="timeScope.setScope" /></template>

      <label v-if="published.length > 1" class="mb-6 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span class="text-muted-foreground">论文</span>
        <select
          class="h-(--control-h) min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :value="queryId"
          data-thesis-picker
          @change="choose(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="row in published" :key="row.id" :value="row.id">{{ row.current_version?.title || '未命名论文' }}</option>
        </select>
      </label>

      <StatePanel v-if="listLoading || state.kind === 'loading'" kind="loading" title="正在载入正式反馈" />
      <StatePanel v-else-if="listError" kind="error" title="本人论文没有加载出来">
        {{ listError }}
        <template #actions><Button variant="outline" data-action="retry-feedback" @click="loadList">重试</Button></template>
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'idle'" kind="empty" title="还没有已发布的评阅结果">
        学校发布结果后，正式反馈会出现在这里。
        <template #actions><Button variant="outline" as-child><RouterLink to="/student/dashboard">回到我的送审</RouterLink></Button></template>
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'unpublished'" kind="empty" title="这篇论文的评阅结果还没有发布" data-unpublished>
        学校发布后会在这里显示正式反馈。发布前看不到分数或评语，这不代表评阅进度。
        <template #actions><Button variant="outline" as-child><RouterLink to="/student/dashboard">回到我的送审</RouterLink></Button></template>
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'invalid'" kind="error" title="这份评阅结果暂时无法显示" data-feedback-invalid>
        结果数据的格式无法识别，为避免显示错误内容，本页没有展示任何部分。请稍后再试；如果一直如此，请联系学校。
        <template #actions><Button variant="outline" as-child><RouterLink to="/student/dashboard">回到我的送审</RouterLink></Button></template>
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'error'" kind="error" title="评阅结果没有加载出来">
        {{ loadError }}
        <template #actions><Button variant="outline" data-action="retry-feedback" @click="loadResult">重试</Button></template>
      </StatePanel>

      <FeedbackDocument v-else-if="state.kind === 'ready'" :view="state.view" :title="title" :context="context">
        <section class="objection grid max-w-[42em] gap-3 border-t pt-6" aria-label="异议">
          <p v-if="objectionNotice" class="rounded-md border-l-[3px] border-success bg-success-soft px-4 py-2.5 text-sm" role="status" data-objection-notice>{{ objectionNotice }}</p>
          <p v-if="objectionError" class="flex flex-wrap items-center gap-3 rounded-md border-l-[3px] border-destructive bg-destructive-soft px-4 py-2.5 text-sm" role="alert">
            {{ objectionError }}
            <Button variant="outline" size="sm" @click="loadObjections(queryId)">重试</Button>
          </p>

          <div v-if="latest" class="grid gap-3 rounded-lg border bg-muted/40 px-4 py-3" data-objection-status>
            <p class="flex items-center gap-2 text-sm"><span class="text-muted-foreground">你登记的异议</span><StatusBadge :tone="latest.status === 'RESOLVED' ? 'success' : 'brand'">{{ OBJECTION_TEXT[latest.status] ?? latest.status }}</StatusBadge></p>
            <dl class="grid grid-cols-[5em_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt class="text-muted-foreground">你的理由</dt><dd class="pre">{{ latest.reason }}</dd>
              <template v-if="latest.request"><dt class="text-muted-foreground">处理诉求</dt><dd class="pre">{{ latest.request }}</dd></template>
              <template v-if="latest.status === 'RESOLVED'">
                <dt class="text-muted-foreground">学校结论</dt><dd class="pre">{{ latest.conclusion || '学校未填写结论' }}<span v-if="latest.channel" class="text-muted-foreground">（{{ CHANNEL_TEXT[latest.channel] ?? latest.channel }}）</span></dd>
              </template>
            </dl>
          </div>

          <Collapsible v-if="canObject && !objectionError" v-model:open="objectionFormOpen">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="-ml-3 text-muted-foreground" data-action="toggle-objection">
                <MessageSquareWarning />对这份结果有异议？<ChevronDown :class="['transition-transform', objectionFormOpen && 'rotate-180']" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent class="grid gap-4 pt-3">
              <p>异议由学校处理。登记异议不会自动改变分数，也不会让专家重新评阅。</p>
              <p class="text-sm text-muted-foreground">理由和处理诉求都要写；一篇论文同时只能有一份未办结的异议。</p>
              <div class="grid gap-1.5">
                <Label for="objection-reason">异议理由</Label>
                <Textarea id="objection-reason" v-model="reason" name="objectionReason" rows="3" placeholder="写明你对哪一部分有异议，以及理由" />
              </div>
              <div class="grid gap-1.5">
                <Label for="objection-request">处理诉求</Label>
                <Textarea id="objection-request" v-model="request" name="objectionRequest" rows="2" placeholder="例如：请学校复核第三章的评分" />
              </div>
              <p v-if="formError" class="text-sm text-destructive" role="alert" data-objection-error>{{ formError }}</p>
              <Button variant="outline" class="justify-self-start" data-action="open-objection" @click="openConfirm">登记异议…</Button>
            </CollapsibleContent>
          </Collapsible>
          <p v-else-if="!latest && !objectionError" class="text-sm text-muted-foreground" data-objection-closed>这篇论文当前不能登记异议。如有疑问，请联系学院研究生秘书。</p>
        </section>
      </FeedbackDocument>
    </AppShell>

    <ConfirmDialog :open="confirmOpen" title="登记这份异议？" :busy="submitting" @close="confirmOpen = false">
      <p>登记后不能撤回；同一篇论文同时只能有一份未办结的异议。学校处理完成后，你会在这里看到结论。</p>
      <p v-if="submitError" class="text-sm text-destructive" role="alert" data-objection-submit-error>{{ submitError }}</p>
      <template #actions>
        <Button variant="outline" :disabled="submitting" @click="confirmOpen = false">继续修改</Button>
        <Button data-action="confirm-objection" :disabled="submitting" @click="submitObjection">{{ submitting ? '正在登记…' : '确认登记' }}</Button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.pre {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
</style>
