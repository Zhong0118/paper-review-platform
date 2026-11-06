<script setup lang="ts">
/**
 * P05 学校核验台（R2：AppShell focus 模板，U4 计划 §18）。发现｜匿名稿/原稿｜判断，判断栏底部固定提交条。
 * ≥1280 三栏可拖动；1024–1279 发现收进左侧抽屉；<1024 发现 / 材料 / 判断标签页。
 * - 检测维度分开读（checkReport.ts）；可做的动作只看 allowed_actions。
 * - 409 先重读详情，再分“已被处理”“已更新”“已不可用”，已写说明一律保留。
 * - 同一次提交尝试重试时沿用同一个幂等键。
 * - 只有服务器确认后才出现“下一篇”。
 * - U2-4：确认送出与“通过核验”分开，单独确认；永久终止放在“更多操作”，填原因后独立确认。
 *   两者都只按 allowed_actions 出现，重试沿用同一幂等键，409 与核验一样先重读再分类。
 */
import { AlertTriangle, ChevronDown, ChevronLeft, ListChecks, RefreshCw } from '@lucide/vue'
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { confirmDispatch } from '@/api/dispatch'
import { getFileContent } from '@/api/files'
import { confirmAnonymization, getSchoolThesis, terminateThesis } from '@/api/schoolReview'
import { checkSensitiveThesis, type SensitiveFinding } from '@/api/sensitiveChecks'
import type { ThesisDetail } from '@/api/theses'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import type { NavGroup, WorkspaceAccount } from '@/components/workspace/types'
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import { anonymousFile, apiFailure, autoText, autoTone, isNotFound, originalFile, readReport, stageLabel, type Tone } from './checkReport'
import FindingsList from './verify/FindingsList.vue'
import { findingSource } from './verify/findingSource'

const props = defineProps<{ thesisId: string; rows: ThesisDetail[]; rowsReady: boolean; account: WorkspaceAccount; nav: NavGroup[] }>()
const emit = defineEmits<{ changed: [] }>()
const route = useRoute()
const router = useRouter()
const signOut = useSignOut()

const detail = ref<ThesisDetail | null>(null)
const loadState = ref<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
const loadError = ref('')

/** silent：操作后刷新时不闪回加载态 */
async function fetchDetail(silent = false) {
  if (!silent) loadState.value = 'loading'
  try {
    detail.value = await getSchoolThesis(props.thesisId)
    loadState.value = 'ready'
  } catch (error) {
    if (isNotFound(error)) loadState.value = 'unavailable'
    else {
      loadState.value = 'error'
      loadError.value = apiFailure(error).message
    }
  }
}

const report = computed(() => (detail.value ? readReport(detail.value) : null))
const actions = computed(() => new Set(detail.value?.allowed_actions ?? []))
const canPass = computed(() => actions.value.has('CONFIRM_ANONYMIZATION'))
const canReturn = computed(() => actions.value.has('REJECT_ANONYMIZATION'))
const deciding = computed(() => detail.value?.stage === 'PREPARING' && (canPass.value || canReturn.value))
const passOffText = computed(() => report.value?.passBlocked || '当前不能通过核验，以服务端给出的可用操作为准')

// ── 位置与下一篇：清单只用来排序，当前论文永远排除 ──
const order = ref<string[]>([])
watch(
  () => props.rowsReady,
  (ready) => {
    if (ready && !order.value.length) order.value = props.rows.filter((row) => row.stage === 'PREPARING').map((row) => row.id)
  },
  { immediate: true },
)
const position = computed(() => order.value.indexOf(props.thesisId) + 1)
const nextId = computed(() => {
  const index = order.value.indexOf(props.thesisId)
  const pending = new Set(props.rows.filter((row) => row.stage === 'PREPARING').map((row) => row.id))
  const candidates = index < 0 ? order.value : [...order.value.slice(index + 1), ...order.value.slice(0, index)]
  return candidates.find((id) => id !== props.thesisId && pending.has(id)) ?? null
})
function queueQuery() {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) if (typeof value === 'string' && value && key !== 'thesis') query[key] = value
  return query
}
const backTo = computed(() => ({ path: '/school/preparation', query: { ...queueQuery(), sel: props.thesisId } }))
function goNext() {
  if (nextId.value) void router.replace({ query: { ...queueQuery(), thesis: nextId.value } })
}

// ── 判断 ──
const decision = ref<'pass' | 'return'>('pass')
const note = ref('')
const returnReason = ref('')
const touched = ref(false)
const submitting = ref(false)
const outcome = ref<null | 'passed' | 'returned'>(null)
const submitError = ref('')
const conflict = ref<null | { kind: 'taken' | 'updated' | 'gone'; latest: ThesisDetail | null }>(null)
watch(
  [canPass, canReturn],
  () => {
    if (!canPass.value && canReturn.value) decision.value = 'return'
  },
  { immediate: true },
)
const decisionText = computed(() => (decision.value === 'pass' ? note.value : returnReason.value))
const validation = computed(() => {
  if (decision.value === 'pass') {
    if (!canPass.value) return passOffText.value
    if (report.value?.passNeedsReason && !note.value.trim()) return '请说明你核对了哪些学校词表提示、为何不构成身份泄露'
    return ''
  }
  return returnReason.value.trim() ? '' : '请写明需要学生修改的内容'
})
const locked = computed(() => conflict.value?.kind === 'taken' || conflict.value?.kind === 'gone')

let attempt: { signature: string; key: string } | null = null
function idempotencyKey(signature: string) {
  if (attempt?.signature !== signature) attempt = { signature, key: crypto.randomUUID() }
  return attempt.key
}

async function submit() {
  touched.value = true
  const current = detail.value
  if (!current || validation.value || submitting.value || locked.value || conflict.value) return
  const body: { decision: 'PASS' | 'REJECT'; version: number; reason?: string } = { decision: decision.value === 'pass' ? 'PASS' : 'REJECT', version: current.version }
  const text = decisionText.value.trim()
  if (text) body.reason = text
  submitting.value = true
  submitError.value = ''
  try {
    await confirmAnonymization(current.id, body, { idempotencyKey: idempotencyKey(JSON.stringify(body)), quiet: true })
    attempt = null
    // 保留作出判断时的报告与材料；服务端新状态只用于刷新清单
    outcome.value = decision.value === 'pass' ? 'passed' : 'returned'
    emit('changed')
  } catch (error) {
    const failure = apiFailure(error)
    if (failure.status === 409) await classifyConflict()
    else if (isNotFound(error)) conflict.value = { kind: 'gone', latest: null }
    else submitError.value = failure.message
  } finally {
    submitting.value = false
  }
}

async function classifyConflict() {
  try {
    const latest = await getSchoolThesis(props.thesisId)
    conflict.value = { kind: latest.stage === 'PREPARING' ? 'updated' : 'taken', latest }
    emit('changed')
  } catch (error) {
    if (isNotFound(error)) conflict.value = { kind: 'gone', latest: null }
    else submitError.value = `提交没有生效，且未能读取最新状态：${apiFailure(error).message}`
  }
}
function loadLatest() {
  if (!conflict.value?.latest) return
  detail.value = conflict.value.latest
  conflict.value = null
  attempt = null
  touched.value = false
}
function quote(finding: SensitiveFinding) {
  const where = finding.page_number ? `第 ${finding.page_number} 页` : findingSource(finding)
  const line = `${where}出现“${finding.matched_text}”`
  decision.value = 'return'
  returnReason.value = returnReason.value ? `${returnReason.value}；${line}` : line
}

// ── 重新检测（旧页行为） ──
const rechecking = ref(false)
const recheckError = ref('')
async function recheck() {
  const current = detail.value
  const file = current ? anonymousFile(current) : null
  if (!current || !file || rechecking.value) return
  rechecking.value = true
  recheckError.value = ''
  try {
    await checkSensitiveThesis(current.id, { expected_version: current.version, file_id: file.file_id }, true)
    const latest = await getSchoolThesis(current.id)
    detail.value = latest
    emit('changed')
  } catch (error) {
    recheckError.value = apiFailure(error).message
  } finally {
    rechecking.value = false
  }
}

// ── 确认送出与永久终止（U2-4） ──
const done = ref<null | 'dispatched' | 'terminated'>(null)
const canDispatchNow = computed(() => !done.value && !conflict.value && (outcome.value === 'passed' || (!outcome.value && actions.value.has('CONFIRM_DISPATCH'))))
const canTerminate = computed(() => !outcome.value && !done.value && !locked.value && actions.value.has('TERMINATE'))

const dispatchOpen = ref(false)
const dispatchBusy = ref(false)
const dispatchError = ref('')
/** 一次送出尝试固定目标版本与幂等键；回执丢失后重试原样重发 */
let dispatchAttempt: { id: string; version: number; key: string } | null = null
function openDispatch() {
  dispatchError.value = ''
  dispatchOpen.value = true
}
async function sendOut() {
  if (dispatchBusy.value) return
  dispatchBusy.value = true
  dispatchError.value = ''
  try {
    if (!dispatchAttempt) {
      // 通过核验后本页保留作出判断时的详情；送出要按服务端当前版本
      const base = outcome.value === 'passed' ? await getSchoolThesis(props.thesisId) : detail.value
      if (!base) return
      if (!base.allowed_actions.includes('CONFIRM_DISPATCH')) {
        dispatchOpen.value = false
        conflict.value = { kind: 'taken', latest: base }
        emit('changed')
        return
      }
      dispatchAttempt = { id: base.id, version: base.version, key: crypto.randomUUID() }
    }
    await confirmDispatch(dispatchAttempt.id, dispatchAttempt.version, { idempotencyKey: dispatchAttempt.key, quiet: true })
    dispatchAttempt = null
    dispatchOpen.value = false
    done.value = 'dispatched'
    emit('changed')
  } catch (error) {
    if (apiFailure(error).status === 409) {
      dispatchAttempt = null
      dispatchOpen.value = false
      await classifyConflict()
    } else if (isNotFound(error)) {
      dispatchOpen.value = false
      conflict.value = { kind: 'gone', latest: null }
    } else dispatchError.value = apiFailure(error).message
  } finally {
    dispatchBusy.value = false
  }
}

const terminateOpen = ref(false)
const terminateReason = ref('')
const terminateBusy = ref(false)
const terminateError = ref('')
let terminateAttempt: { signature: string; key: string } | null = null
function openTerminate() {
  terminateError.value = ''
  terminateOpen.value = true
}
async function terminate() {
  const current = detail.value
  const reason = terminateReason.value.trim()
  if (!current || terminateBusy.value || !reason || !actions.value.has('TERMINATE')) return
  const signature = JSON.stringify([current.id, current.version, reason])
  if (terminateAttempt?.signature !== signature) terminateAttempt = { signature, key: crypto.randomUUID() }
  terminateBusy.value = true
  terminateError.value = ''
  try {
    await terminateThesis(current.id, { version: current.version, reason }, { idempotencyKey: terminateAttempt.key, quiet: true })
    terminateAttempt = null
    terminateOpen.value = false
    done.value = 'terminated'
    emit('changed')
  } catch (error) {
    if (apiFailure(error).status === 409) {
      terminateOpen.value = false
      await classifyConflict()
    } else if (isNotFound(error)) {
      terminateOpen.value = false
      conflict.value = { kind: 'gone', latest: null }
    } else terminateError.value = apiFailure(error).message
  } finally {
    terminateBusy.value = false
  }
}

// ── 材料：Blob 仅存在于本页，离开即撤销 ──
const material = ref<'anonymous' | 'original'>('anonymous')
const compare = ref(false)
const focusPage = ref(1)
const urls = ref<Record<string, string>>({})
const fileBusy = ref<Record<string, boolean>>({})
const fileError = ref<Record<string, string>>({})
const anonymous = computed(() => (detail.value ? anonymousFile(detail.value) : null))
const original = computed(() => (detail.value ? originalFile(detail.value) : null))
async function ensureFile(fileId: string | undefined) {
  if (!fileId || urls.value[fileId] || fileBusy.value[fileId]) return
  fileBusy.value = { ...fileBusy.value, [fileId]: true }
  fileError.value = { ...fileError.value, [fileId]: '' }
  try {
    const blob = await getFileContent(fileId)
    urls.value = { ...urls.value, [fileId]: URL.createObjectURL(blob) }
  } catch (error) {
    fileError.value = { ...fileError.value, [fileId]: apiFailure(error).message || 'PDF 加载失败' }
  } finally {
    fileBusy.value = { ...fileBusy.value, [fileId]: false }
  }
}
watch(anonymous, (file) => void ensureFile(file?.file_id), { immediate: true })
watch([material, compare], () => {
  if (material.value === 'original' || compare.value) void ensureFile(original.value?.file_id)
})
function revokeAll() {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
  urls.value = {}
}
const viewed = ref<Set<string>>(new Set())
const openFinding = ref<string | null>(null)
function locate(finding: SensitiveFinding, key: string) {
  viewed.value = new Set([...viewed.value, key])
  openFinding.value = openFinding.value === key ? null : key
  if (finding.page_number) {
    material.value = 'anonymous'
    compare.value = false
    focusPage.value = finding.page_number
    mobileTab.value = 'doc'
    findingsSheet.value = false
  }
}

// ── 响应式分栏（jsdom 没有 matchMedia：两个查询都为假，走宽屏三栏） ──
const mobileTab = ref<'findings' | 'doc' | 'decide'>('doc')
const narrow = useMediaQuery('(max-width: 1023px)')
const mid = useMediaQuery('(min-width: 1024px) and (max-width: 1279px)')
const findingsSheet = ref(false)
const badgeTone = (tone: Tone) => (tone === 'action' ? 'brand' : tone)
const moreOpen = ref(false)
const findingCount = computed(() => (report.value && !report.value.stale ? report.value.findings.length : 0))
const [DefineFindings, ReuseFindings] = createReusableTemplate()
const [DefineDoc, ReuseDoc] = createReusableTemplate<{ withFindings?: boolean }>()
const [DefineDecision, ReuseDecision] = createReusableTemplate()

onMounted(() => void fetchDetail())
onBeforeUnmount(revokeAll)
</script>

<template>
  <AppShell :nav="nav" :account="account" :workspace="account.org" layout="focus" :title="detail?.current_version?.title || (loadState === 'loading' ? '' : '核验台')" @sign-out="signOut">
    <template #back>
      <Button variant="ghost" size="sm" as-child class="-ml-1 shrink-0 text-muted-foreground">
        <RouterLink :to="backTo" data-back><ChevronLeft />送审准备</RouterLink>
      </Button>
    </template>
    <template #context>
      <template v-if="detail">{{ detail.student?.name }}　{{ detail.current_version?.school_program?.name || detail.current_version?.discipline_name }}</template>
    </template>
    <template #actions>
      <span v-if="position > 0" class="tabular text-sm text-muted-foreground">待核验 {{ position }} / {{ order.length }}</span>
      <StatusBadge v-else-if="detail" tone="neutral">{{ stageLabel(detail.stage) }}</StatusBadge>
    </template>

    <!-- 发现列表：三种断点共用 -->
    <DefineFindings>
      <FindingsList
        v-if="report"
        :findings="report.stale ? [] : report.findings"
        :stale="report.stale"
        :has-report="report.auto !== null"
        :open-key="openFinding"
        :viewed="viewed"
        :can-quote="canReturn && !locked && !outcome"
        @locate="locate"
        @quote="quote"
      />
    </DefineFindings>

    <!-- 材料：受控 PDF，Blob 只在本页 -->
    <DefineDoc v-slot="{ withFindings }">
      <section class="flex h-full min-h-0 flex-col" aria-label="论文材料">
        <div class="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5">
          <Button v-if="withFindings" variant="outline" size="sm" data-action="open-findings" @click="findingsSheet = true">
            <ListChecks />检测发现<span class="tabular">{{ findingCount }}</span>
          </Button>
          <div class="flex rounded-md border p-0.5" role="group" aria-label="材料">
            <button type="button" :aria-pressed="material === 'anonymous' && !compare" class="seg" @click="material = 'anonymous'; compare = false">匿名稿</button>
            <button type="button" :aria-pressed="material === 'original' && !compare" class="seg" :disabled="!original" @click="material = 'original'; compare = false">原稿</button>
            <button v-if="!narrow" type="button" :aria-pressed="compare" class="seg" :disabled="!original" @click="compare = !compare">并排对照</button>
          </div>
          <p class="min-w-0 text-xs text-muted-foreground" data-visibility>
            <template v-if="compare">左：原稿（仅本校可见）｜右：匿名稿（这份材料将交给评阅专家）</template>
            <template v-else-if="material === 'anonymous'">你正在看匿名稿，这份材料将交给评阅专家<template v-if="focusPage > 1">；已定位到 PDF 物理第 {{ focusPage }} 页</template></template>
            <template v-else>你正在看原稿，仅本校可见，不会交给专家</template>
          </p>
        </div>
        <div class="grid min-h-0 flex-1 bg-muted/70" :class="compare ? 'grid-cols-2 divide-x' : 'grid-cols-1'">
          <template v-for="file in compare ? [original, anonymous] : [material === 'anonymous' ? anonymous : original]" :key="file?.file_id ?? 'none'">
            <StatePanel v-if="!file" kind="empty" title="没有这份材料" compact>学生尚未上传。</StatePanel>
            <StatePanel v-else-if="fileError[file.file_id]" kind="error" title="PDF 没有加载出来" compact>
              {{ fileError[file.file_id] }}
              <template #actions><Button variant="outline" size="sm" @click="ensureFile(file.file_id)">重试</Button></template>
            </StatePanel>
            <StatePanel v-else-if="!urls[file.file_id]" kind="loading" title="正在读取 PDF…" compact />
            <iframe
              v-else
              :key="`${file.file_id}-${file.purpose === 'anonymous' ? focusPage : 1}`"
              class="size-full border-0 bg-background"
              :src="`${urls[file.file_id]}#page=${file.purpose === 'anonymous' ? focusPage : 1}`"
              :title="file.purpose === 'anonymous' ? '匿名稿 PDF' : '原稿 PDF'"
            />
          </template>
        </div>
      </section>
    </DefineDoc>

    <!-- 判断：横幅 → 报告依据 → 当前状态 / 你的判断 → 确认送出 → 更多操作；底部固定提交条 -->
    <DefineDecision>
      <section v-if="report && detail" class="flex h-full min-h-0 flex-col bg-background" aria-label="核验判断">
        <header class="flex h-11 shrink-0 items-center border-b px-4"><h2 class="text-sm font-semibold">你的判断</h2></header>
        <div class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
          <div v-if="done" class="banner grid gap-1 rounded-md bg-success-soft px-3 py-2.5 text-sm" role="status" data-desk-done>
            <strong class="font-medium text-success">{{ done === 'dispatched' ? '已确认送出，论文交给百杰运营派单。' : '已永久终止送审，未完成的专家任务已取消。' }}</strong>
          </div>
          <div v-else-if="conflict?.kind === 'taken'" class="banner grid gap-1 rounded-md border bg-info-soft px-3 py-2.5 text-sm" role="status">
            <strong class="font-medium">这篇论文已被处理，当前为“{{ stageLabel(conflict.latest?.stage ?? '') }}”。</strong>
            <span>你的操作没有生效。下方输入保留在本页，可以复制后离开。</span>
          </div>
          <div v-else-if="conflict?.kind === 'gone'" class="banner grid gap-1 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm" role="alert">
            <strong class="font-medium text-destructive">这篇论文已不可用。</strong>
            <span>你的操作没有生效。下方输入保留在本页，可以复制后离开。</span>
          </div>
          <div v-else-if="conflict?.kind === 'updated'" class="banner grid gap-2 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm" role="alert">
            <strong class="font-medium text-destructive">提交没有生效：论文在你打开后已更新。</strong>
            <span>你的说明仍在下方。请载入最新材料，重新核对后再提交。</span>
            <Button variant="outline" size="sm" class="justify-self-start bg-background" @click="loadLatest"><RefreshCw />载入最新材料（保留说明）</Button>
          </div>
          <div v-if="submitError" class="banner grid gap-1 rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2.5 text-sm" role="alert">
            <strong class="font-medium text-destructive">提交没有生效。</strong>
            <span>{{ submitError }}</span>
          </div>

          <section class="grid gap-2" aria-label="当前报告依据">
            <h3 class="text-xs font-medium text-muted-foreground">当前报告依据</h3>
            <dl class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt class="text-muted-foreground">{{ report.stale ? '上次自动结论' : '自动结论' }}</dt>
              <dd>
                <StatusBadge v-if="report.auto" :tone="badgeTone(autoTone(report))">{{ autoText(report.auto) }}</StatusBadge>
                <span v-else class="text-muted-foreground">尚未检测</span>
              </dd>
              <dt class="text-muted-foreground">报告时效</dt>
              <dd>
                <StatusBadge v-if="report.stale" tone="warning">已过期</StatusBadge>
                <span v-else-if="report.auto">对应当前匿名稿</span>
                <span v-else class="text-muted-foreground">无报告</span>
              </dd>
              <dt class="text-muted-foreground">单项发现</dt>
              <dd class="tabular">
                <template v-if="report.stale">以过期报告为准，不展示</template>
                <template v-else-if="report.auto">阻断 {{ report.blockCount }}，警告 {{ report.warnCount }}</template>
                <template v-else>—</template>
              </dd>
              <dt class="text-muted-foreground">人工结论</dt>
              <dd>{{ report.manual === 'PASS' ? '已通过核验' : report.manual === 'FAIL' ? '已退回' : '尚未作出' }}</dd>
              <template v-if="report.pageCount"><dt class="text-muted-foreground">检测对象</dt><dd class="tabular">匿名稿，共 {{ report.pageCount }} 页</dd></template>
              <template v-if="report.termsVersion !== null"><dt class="text-muted-foreground">依据</dt><dd>本校检测词表第 {{ report.termsVersion }} 版</dd></template>
            </dl>
            <p v-if="report.stale" class="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />这份报告不再对应当前匿名稿（材料或登记信息在检测后有变化），不能作为通过依据。
            </p>
            <p v-if="report.uncertainPages.length" class="rounded-md bg-muted px-3 py-2 text-sm">第 {{ report.uncertainPages.join('、') }} 页无法可靠提取文字（可能是扫描图片），请人工查看。</p>
            <p v-if="report.titleStatus === 'TITLE_NOT_FOUND'" class="rounded-md bg-muted px-3 py-2 text-sm">前两页没有找到登记标题的文字，请人工核对；这不代表论文内容不一致。</p>
            <div v-if="!outcome && detail.stage === 'PREPARING' && anonymous" class="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" :disabled="rechecking || locked" @click="recheck"><RefreshCw />{{ rechecking ? '正在检测…' : '重新检测匿名稿' }}</Button>
              <span v-if="recheckError" class="text-sm text-destructive" role="alert">{{ recheckError }}</span>
            </div>
          </section>

          <section v-if="!deciding && !outcome && !done" class="grid gap-2" aria-label="当前状态">
            <h3 class="text-xs font-medium text-muted-foreground">当前状态</h3>
            <p>
              <StatusBadge :tone="detail.stage === 'TERMINATED' ? 'danger' : detail.stage === 'DRAFT' ? 'warning' : 'brand'">
                {{ detail.stage === 'DRAFT' && detail.return_reason ? '已退回修改' : stageLabel(detail.stage) }}
              </StatusBadge>
            </p>
            <template v-if="detail.stage === 'DRAFT'">
              <blockquote v-if="detail.return_reason" class="border-l-2 border-border-strong pl-3 text-sm whitespace-pre-line">{{ detail.return_reason }}</blockquote>
              <p class="text-sm text-muted-foreground">学生修改并重新提交后，论文会回到“待核验”。</p>
            </template>
          </section>

          <template v-if="deciding || outcome">
            <fieldset class="grid gap-2" :disabled="locked || Boolean(outcome)">
              <legend class="mb-2 text-xs font-medium text-muted-foreground">结论</legend>
              <label :class="['flex gap-3 rounded-md border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary-soft', canPass ? 'cursor-pointer' : 'cursor-not-allowed opacity-60']">
                <input v-model="decision" type="radio" name="decision" value="pass" :disabled="!canPass" class="mt-1 accent-(--primary)" />
                <span class="grid gap-0.5">
                  <span class="font-medium">通过核验</span>
                  <span class="text-sm text-muted-foreground">{{ canPass ? '匿名稿可以交给专家；之后仍需单独确认送出' : passOffText }}</span>
                </span>
              </label>
              <label :class="['flex gap-3 rounded-md border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary-soft', canReturn ? 'cursor-pointer' : 'cursor-not-allowed opacity-60']">
                <input v-model="decision" type="radio" name="decision" value="return" :disabled="!canReturn" class="mt-1 accent-(--primary)" />
                <span class="grid gap-0.5">
                  <span class="font-medium">退回修改</span>
                  <span class="text-sm text-muted-foreground">学生收到原因后修改，论文回到草稿</span>
                </span>
              </label>
            </fieldset>

            <div v-if="decision === 'pass'" class="grid gap-1.5">
              <Label for="decision-note">通过说明（校内留存）<span v-if="!report.passNeedsReason" class="font-normal text-muted-foreground">，选填</span></Label>
              <Textarea
                id="decision-note"
                v-model="note"
                rows="4"
                :disabled="locked || Boolean(outcome)"
                :aria-invalid="touched && Boolean(validation)"
                aria-describedby="decision-err"
                placeholder="例如：第 3 页的校区名称是公开地名，不指向个人。"
              />
              <p v-if="report.passNeedsReason" class="text-xs text-muted-foreground">存在学校词表提示，通过时必须写明核对结论。</p>
            </div>
            <div v-else class="grid gap-1.5">
              <Label for="decision-reason">退回原因（学生会看到）</Label>
              <Textarea
                id="decision-reason"
                v-model="returnReason"
                rows="5"
                :disabled="locked || Boolean(outcome)"
                :aria-invalid="touched && Boolean(validation)"
                aria-describedby="decision-err"
                placeholder="写明需要学生修改的位置与内容"
              />
              <p class="text-xs text-muted-foreground">可在检测发现中点“写入退回原因”引用页码。</p>
            </div>
            <p v-if="touched && validation && !outcome" id="decision-err" class="text-sm text-destructive">{{ validation }}</p>
          </template>

          <section v-if="canDispatchNow" class="grid gap-2 rounded-md border bg-muted/50 p-3" aria-label="确认送出">
            <h3 class="text-sm font-semibold">确认送出</h3>
            <p class="text-sm text-muted-foreground">{{ outcome === 'passed' ? '核验已通过。' : '这篇论文已通过核验。' }}送出后交给百杰运营派单，学生不能再自行撤回。</p>
            <Button class="justify-self-start" data-action="open-dispatch" @click="openDispatch">确认送出…</Button>
          </section>

          <Collapsible v-if="canTerminate" v-model:open="moreOpen" class="border-t pt-3" data-more-ops>
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="-ml-2 text-muted-foreground"><ChevronDown :class="['transition-transform', moreOpen && 'rotate-180']" />更多操作</Button>
            </CollapsibleTrigger>
            <CollapsibleContent class="grid gap-2 pt-2">
              <p class="text-sm text-muted-foreground">永久终止会结束这篇论文的送审，未完成的专家任务一并取消，历史记录保留，不能恢复。需要学生修改时，请用“退回修改”。</p>
              <Button variant="outline" size="sm" class="justify-self-start border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive" data-action="open-terminate" @click="openTerminate">永久终止送审…</Button>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <footer v-if="deciding || outcome || done" class="grid shrink-0 gap-2 border-t bg-background px-4 py-3">
          <div v-if="done" role="status">
            <StatusBadge :tone="done === 'dispatched' ? 'success' : 'danger'">{{ done === 'dispatched' ? '已确认送出' : '已终止送审' }}</StatusBadge>
          </div>
          <div v-else-if="outcome" class="grid gap-1 text-sm" role="status">
            <StatusBadge tone="success" class="justify-self-start">{{ outcome === 'passed' ? '已通过核验' : '已退回修改' }}</StatusBadge>
            <span class="text-muted-foreground">{{ outcome === 'passed' ? '论文进入“待送出”，可以在上方确认送出，也可以稍后在“可送出”视图处理。' : '学生会看到退回原因。' }}</span>
          </div>
          <p v-else-if="conflict" class="text-sm text-muted-foreground">{{ conflict.kind === 'updated' ? '论文已更新，请载入最新材料' : '这篇论文已不能在此处理' }}</p>
          <p v-else class="tabular text-sm text-muted-foreground">
            待核验<template v-if="findingCount">，已查看 {{ viewed.size }} / {{ findingCount }} 个发现项</template>
          </p>
          <div class="flex gap-2">
            <template v-if="outcome || done">
              <Button variant="outline" class="flex-1" as-child><RouterLink :to="backTo">返回清单</RouterLink></Button>
              <Button v-if="nextId" class="flex-1" @click="goNext">下一篇</Button>
            </template>
            <Button
              v-else
              class="w-full"
              data-action="submit-decision"
              :disabled="submitting || locked || Boolean(conflict) || (decision === 'pass' && !canPass)"
              @click="submit"
            >
              {{ submitting ? '正在提交…' : decision === 'pass' ? '通过核验' : '退回修改' }}
            </Button>
          </div>
        </footer>
      </section>
    </DefineDecision>

    <div v-if="loadState !== 'ready' || !detail || !report" class="grid h-full place-items-center overflow-y-auto bg-background p-6">
      <StatePanel v-if="loadState === 'loading'" kind="loading" title="正在读取论文与检测报告…" />
      <StatePanel v-else-if="loadState === 'unavailable'" kind="forbidden" title="这篇论文已不可用">
        它可能已被删除、不属于本校，或链接有误。
        <template #actions><Button as-child><RouterLink :to="backTo">返回清单</RouterLink></Button></template>
      </StatePanel>
      <StatePanel v-else-if="loadState === 'error'" kind="error" title="论文没有加载出来">
        {{ loadError }}
        <template #actions><Button @click="fetchDetail()">重试</Button></template>
      </StatePanel>
    </div>

    <!-- ≥1280：三栏（并排对照时收起发现栏，给两份 PDF 留宽度） -->
    <ResizablePanelGroup v-else-if="!narrow && !mid" direction="horizontal" class="bg-background">
      <template v-if="!compare">
        <ResizablePanel id="find" :order="1" :default-size="288" :min-size="240" :max-size="420" size-unit="px" class="min-w-0">
          <section class="flex h-full flex-col" aria-label="检测发现">
            <header class="flex h-11 shrink-0 items-center gap-2 border-b px-4">
              <h2 class="text-sm font-semibold">检测发现</h2>
              <span class="tabular text-xs text-muted-foreground">已查看 {{ viewed.size }} / {{ findingCount }}</span>
            </header>
            <div class="min-h-0 flex-1 overflow-y-auto p-3"><ReuseFindings /></div>
          </section>
        </ResizablePanel>
        <ResizableHandle />
      </template>
      <ResizablePanel id="doc" :order="2" :min-size="480" size-unit="px" class="min-w-0"><ReuseDoc /></ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id="decide" :order="3" :default-size="368" :min-size="320" :max-size="480" size-unit="px" class="min-w-0"><ReuseDecision /></ResizablePanel>
    </ResizablePanelGroup>

    <!-- 1024–1279：发现收进抽屉 -->
    <div v-else-if="mid" class="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] bg-background">
      <div class="min-w-0 border-r"><ReuseDoc :with-findings="true" /></div>
      <ReuseDecision />
    </div>

    <!-- <1024：标签页 -->
    <Tabs v-else v-model="mobileTab" class="flex h-full flex-col gap-0 bg-background">
      <TabsList class="m-2 flex w-auto shrink-0" aria-label="核验视图">
        <TabsTrigger value="findings">发现 {{ findingCount }}</TabsTrigger>
        <TabsTrigger value="doc">材料</TabsTrigger>
        <TabsTrigger value="decide">判断</TabsTrigger>
      </TabsList>
      <TabsContent value="findings" class="min-h-0 overflow-y-auto border-t p-3" aria-label="检测发现"><ReuseFindings /></TabsContent>
      <TabsContent value="doc" class="min-h-0 border-t"><ReuseDoc /></TabsContent>
      <TabsContent value="decide" class="min-h-0 border-t"><ReuseDecision /></TabsContent>
    </Tabs>

    <Sheet v-model:open="findingsSheet">
      <SheetContent side="left" class="w-[340px] gap-0 p-0 sm:max-w-[340px]">
        <SheetHeader class="border-b px-4 py-3">
          <SheetTitle class="text-sm">检测发现</SheetTitle>
          <SheetDescription class="text-xs">点一项，匿名稿跳到对应页。已查看 {{ viewed.size }} / {{ findingCount }}</SheetDescription>
        </SheetHeader>
        <div class="min-h-0 flex-1 overflow-y-auto p-3"><ReuseFindings /></div>
      </SheetContent>
    </Sheet>

    <AlertDialog :open="dispatchOpen" @update:open="(open) => !open && !dispatchBusy && (dispatchOpen = false)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认送出这篇论文？</AlertDialogTitle>
          <AlertDialogDescription>《{{ detail?.current_version?.title || '未命名论文' }}》将交给百杰运营派单。送出后学生不能再自行撤回；如需中止，只能永久终止。</AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="dispatchError" class="text-sm text-destructive" role="alert">没有送出：{{ dispatchError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="dispatchBusy">暂不送出</AlertDialogCancel>
          <Button data-action="confirm-dispatch" :disabled="dispatchBusy" @click="sendOut">{{ dispatchBusy ? '正在送出…' : '确认送出' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="terminateOpen" @update:open="(open) => !open && !terminateBusy && (terminateOpen = false)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>永久终止这篇论文的送审？</AlertDialogTitle>
          <AlertDialogDescription>《{{ detail?.current_version?.title || '未命名论文' }}》的送审将结束，未完成的专家任务一并取消。终止后不能恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <div class="grid gap-1.5">
          <Label for="terminate-reason">终止原因（必填，校内留存）</Label>
          <Textarea id="terminate-reason" v-model="terminateReason" rows="3" data-terminate-reason :disabled="terminateBusy" />
        </div>
        <p v-if="terminateError" class="text-sm text-destructive" role="alert">没有终止：{{ terminateError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="terminateBusy">不终止</AlertDialogCancel>
          <Button variant="destructive" data-action="terminate-thesis" :disabled="terminateBusy || !terminateReason.trim()" @click="terminate">{{ terminateBusy ? '正在终止…' : '永久终止' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
</template>

<style scoped>
.seg {
  height: 1.75rem;
  border-radius: calc(var(--radius) - 2px);
  padding-inline: 0.625rem;
  color: var(--muted-foreground);
  font-size: 13px;
}
.seg:hover:not(:disabled) {
  color: var(--foreground);
}
.seg[aria-pressed='true'] {
  background: var(--muted);
  color: var(--foreground);
  font-weight: 500;
}
.seg:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
