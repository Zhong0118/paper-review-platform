<script setup lang="ts">
/**
 * R1 样板二：学校单篇匿名核验（focus 模板，v3 §9.1）。左“检测发现”、中“材料”、右“你的判断”。
 * - ≥1280：三栏可拖动（像素最小宽度）；1024–1279：发现收进左侧抽屉；<1024：发现 / 材料 / 判断三个标签页。
 * - “通过核验”与“确认送出”是两条命令；永久终止放在“更多操作”，写原因后单独确认。
 * - 措辞与规则取自真实核验台（VerifyDesk / checkReport）：自动不通过或报告过期时不能通过；有学校词表提示时通过必须写说明。
 * 虚构数据，不调用接口。
 */
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ListChecks, RefreshCw } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'

import type { SensitiveFinding } from '@/api/sensitiveChecks'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
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
import FindingsList from '@/modules/school/preparation/verify/FindingsList.vue'

import { sampleAccounts, verifyFindings, verifyThesis } from './fixtures'
import MockPaper, { type PaperMark } from './MockPaper.vue'
import { protoNav } from './protoNav'
import SampleControls from './SampleControls.vue'

/* ── 样板状态 ── */
const sample = ref('warn')
const SAMPLE_STATES = [
  { value: 'warn', label: '只有提示' },
  { value: 'block', label: '自动不通过' },
  { value: 'stale', label: '报告过期' },
  { value: 'conflict', label: '版本冲突' },
  { value: 'passed', label: '已通过' },
]
const findings = computed<SensitiveFinding[]>(() => (sample.value === 'block' ? verifyFindings : verifyFindings.filter((f) => f.severity !== 'BLOCK')))
const stale = computed(() => sample.value === 'stale')
const auto = computed(() => (sample.value === 'block' ? 'FAIL' : 'PASS'))
const blockCount = computed(() => findings.value.filter((f) => f.severity === 'BLOCK').length)
const warnCount = computed(() => findings.value.length - blockCount.value)
const passBlocked = computed(() => (auto.value === 'FAIL' ? '自动检测不通过，不能通过核验' : stale.value ? '检测报告已过期，不能依据它通过核验' : ''))
const passNeedsReason = computed(() => !stale.value && findings.value.some((f) => f.kind === 'SCHOOL_TERM'))

/* ── 布局断点 ── */
const wide = useMediaQuery('(min-width: 1280px)')
const medium = useMediaQuery('(min-width: 1024px)')
const findingsSheet = ref(false)
const tab = ref('doc')

/* ── 发现与文档联动 ── */
const openKey = ref<string | null>(null)
const viewed = reactive(new Set<string>())
const docMode = ref<'anonymous' | 'original' | 'compare'>('anonymous')
const paper = ref<InstanceType<typeof MockPaper> | null>(null)
const setPaper = (el: unknown) => (paper.value = (el as InstanceType<typeof MockPaper> | null) ?? null)
const metaNote = ref('')
const marks = computed<PaperMark[]>(() =>
  stale.value ? [] : findings.value.flatMap((f, i) => (f.page_number ? [{ key: `${f.field}-${f.page_number}-${i}`, page: f.page_number, text: f.matched_text, severity: f.severity === 'BLOCK' ? ('BLOCK' as const) : ('WARN' as const) }] : [])),
)
function locate(finding: SensitiveFinding, key: string) {
  openKey.value = openKey.value === key ? null : key
  viewed.add(key)
  metaNote.value = finding.page_number ? '' : '这一项在 PDF 文档属性中，页面上看不到；请在匿名稿的文件属性里核对。'
  if (finding.page_number) {
    if (docMode.value === 'original') docMode.value = 'anonymous'
    if (!medium.value) tab.value = 'doc'
    // 从抽屉里点的：等抽屉关闭、焦点归还后再滚动，否则平滑滚动会被打断
    const fromSheet = findingsSheet.value
    findingsSheet.value = false
    const page = finding.page_number
    if (fromSheet) window.setTimeout(() => paper.value?.scrollToPage(page), 320)
    else requestAnimationFrame(() => paper.value?.scrollToPage(page))
  }
}

/* ── 判断 ── */
const decision = ref<'pass' | 'return' | null>(null)
const note = ref('')
const reason = ref('')
const tried = ref(false)
const outcome = ref<'passed' | 'returned' | null>(null)
const sent = ref<'dispatched' | 'terminated' | null>(null)
watch(sample, (value) => {
  outcome.value = value === 'passed' ? 'passed' : null
  sent.value = null
  decision.value = value === 'passed' ? 'pass' : null
  tried.value = false
  openKey.value = null
  viewed.clear()
})
const validation = computed(() => {
  if (!decision.value) return '请选择通过核验或退回修改。'
  if (decision.value === 'pass' && passNeedsReason.value && !note.value.trim()) return '存在学校词表提示，通过时请写明核对结论。'
  if (decision.value === 'return' && !reason.value.trim()) return '请写明退回原因，学生会看到。'
  return ''
})
function quote(finding: SensitiveFinding) {
  decision.value = 'return'
  const where = finding.page_number ? `第 ${finding.page_number} 页` : '文档属性'
  reason.value = `${reason.value.trim() ? `${reason.value.trim()}\n` : ''}${where}“${finding.matched_text}”：`
  if (!medium.value) tab.value = 'decide'
}
function submit() {
  tried.value = true
  if (validation.value || sample.value === 'conflict') return
  outcome.value = decision.value === 'pass' ? 'passed' : 'returned'
}

const dispatchOpen = ref(false)
const terminateOpen = ref(false)
const terminateReason = ref('')
const moreOpen = ref(false)

/* 三种断点共用的片段：写一次，按断点摆放 */
const [DefineToolbar, ReuseToolbar] = createReusableTemplate<{ withFindings?: boolean }>()
const [DefineDoc, ReuseDoc] = createReusableTemplate()
const [DefineDecision, ReuseDecision] = createReusableTemplate()

const shell = sampleAccounts.school_reviewer!
const nav = protoNav('school_reviewer', '/school/preparation', { '/school/preparation': 9 })
const autoBadge = computed(() =>
  stale.value ? { tone: 'warning' as const, text: '检测报告已过期' } : auto.value === 'FAIL' ? { tone: 'danger' as const, text: `自动：不通过（阻断 ${blockCount.value}）` } : { tone: 'neutral' as const, text: `自动：通过（提示 ${warnCount.value}）` },
)
</script>

<template>
  <AppShell :nav="nav" :account="shell.account" :workspace="shell.workspace" layout="focus" :title="verifyThesis.title">
    <template #back>
      <Button variant="ghost" size="sm" as-child class="-ml-1 shrink-0 text-muted-foreground">
        <RouterLink to="/prototype/r1/nav?role=school_reviewer&at=%2Fschool%2Fpreparation"><ChevronLeft />送审准备</RouterLink>
      </Button>
    </template>
    <template #context>{{ verifyThesis.student }}　{{ verifyThesis.program }}</template>
    <!-- 文档工具条：匿名稿 / 原稿 / 并排对照，写明谁能看到 -->
    <DefineToolbar v-slot="{ withFindings }">
      <div class="flex min-h-11 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5">
        <Button v-if="withFindings" variant="outline" size="sm" data-action="open-findings" @click="findingsSheet = true">
          <ListChecks />检测发现<span v-if="!stale" class="tabular">{{ findings.length }}</span>
        </Button>
        <div class="flex rounded-md border p-0.5" role="group" aria-label="查看哪份材料">
          <button
            v-for="m in [{ v: 'anonymous', l: '匿名稿' }, { v: 'original', l: '原稿' }, { v: 'compare', l: '并排对照' }] as const"
            :key="m.v"
            type="button"
            :aria-pressed="docMode === m.v"
            :class="['h-7 rounded-sm px-2.5 text-sm text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground', m.v === 'compare' && 'hidden lg:inline']"
            @click="docMode = m.v"
          >
            {{ m.l }}
          </button>
        </div>
        <p class="min-w-0 text-xs text-muted-foreground" data-visibility>
          {{ docMode === 'original' ? '原稿只在本校核验时可见，不会交给专家。' : docMode === 'compare' ? '左为匿名稿（专家将看到），右为原稿（仅本校可见）。' : '匿名稿：通过核验后，专家看到的就是这份。' }}
        </p>
        <span class="tabular ml-auto text-xs text-faint">共 {{ verifyThesis.pages }} 页</span>
      </div>
    </DefineToolbar>

    <DefineDoc>
      <p v-if="metaNote" class="border-b bg-info-soft px-4 py-2 text-sm" role="status">{{ metaNote }}</p>
      <div v-if="docMode === 'compare'" class="grid min-h-0 flex-1 grid-cols-2 divide-x">
        <MockPaper :ref="setPaper" :pages="verifyThesis.pages" kind="anonymous" :marks="marks" :focus-key="openKey" label="匿名稿" />
        <MockPaper :pages="verifyThesis.pages" kind="original" :marks="[]" :focus-key="null" label="原稿" />
      </div>
      <MockPaper v-else :ref="setPaper" class="min-h-0 flex-1" :pages="verifyThesis.pages" :kind="docMode" :marks="docMode === 'anonymous' ? marks : []" :focus-key="openKey" :label="docMode === 'original' ? '原稿' : '匿名稿'" />
    </DefineDoc>

    <!-- 判断栏：报告依据 → 你的判断 → 提交（底部固定）；通过后出现“确认送出” -->
    <DefineDecision>
      <section class="flex h-full min-h-0 flex-col" aria-labelledby="pane-decide">
        <header class="flex h-11 shrink-0 items-center border-b px-4"><h2 id="pane-decide" class="text-sm font-semibold">你的判断</h2></header>
        <div class="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
          <div v-if="sample === 'conflict' && tried" class="grid gap-2 rounded-md border border-destructive/30 bg-destructive-soft p-3 text-sm" role="alert">
            <p class="font-medium text-destructive">提交没有生效：论文在你打开后已更新。</p>
            <p>你的说明仍在下方。请载入最新材料，重新核对后再提交。</p>
            <Button variant="outline" size="sm" class="justify-self-start bg-background" @click="sample = 'warn'"><RefreshCw />载入最新材料（保留说明）</Button>
          </div>

          <section class="grid gap-2" aria-labelledby="basis-h">
            <h3 id="basis-h" class="text-xs font-medium text-muted-foreground">当前报告依据</h3>
            <dl class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt class="text-muted-foreground">{{ stale ? '上次自动结论' : '自动结论' }}</dt>
              <dd><StatusBadge :tone="auto === 'FAIL' ? 'danger' : 'success'">{{ auto === 'FAIL' ? '不通过' : '通过' }}</StatusBadge></dd>
              <dt class="text-muted-foreground">报告时效</dt>
              <dd><StatusBadge v-if="stale" tone="warning">已过期</StatusBadge><span v-else>对应当前匿名稿</span></dd>
              <dt class="text-muted-foreground">单项发现</dt>
              <dd class="tabular">{{ stale ? '以过期报告为准，不展示' : `阻断 ${blockCount}，警告 ${warnCount}` }}</dd>
              <dt class="text-muted-foreground">检测对象</dt>
              <dd class="tabular">匿名稿，共 {{ verifyThesis.pages }} 页</dd>
              <dt class="text-muted-foreground">依据</dt>
              <dd>本校检测词表第 4 版</dd>
            </dl>
            <p v-if="stale" class="flex gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />这份报告不再对应当前匿名稿（材料或登记信息在检测后有变化），不能作为通过依据。
            </p>
            <Button v-if="stale && !outcome" variant="outline" size="sm" class="justify-self-start"><RefreshCw />重新检测匿名稿</Button>
          </section>

          <template v-if="!sent">
            <fieldset class="grid gap-2" :disabled="Boolean(outcome)">
              <legend class="mb-2 text-xs font-medium text-muted-foreground">结论</legend>
              <label
                v-for="opt in [
                  { v: 'pass', t: '通过核验', d: passBlocked || '匿名稿可以交给专家；之后仍需单独确认送出', off: Boolean(passBlocked) },
                  { v: 'return', t: '退回修改', d: '学生收到原因后修改，论文回到草稿', off: false },
                ] as const"
                :key="opt.v"
                :class="['flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary-soft', opt.off && 'cursor-not-allowed opacity-60']"
              >
                <input v-model="decision" type="radio" name="decision" :value="opt.v" :disabled="opt.off" class="mt-1 accent-(--primary)" />
                <span class="grid gap-0.5">
                  <span class="font-medium">{{ opt.t }}</span>
                  <span class="text-sm text-muted-foreground">{{ opt.d }}</span>
                </span>
              </label>
            </fieldset>

            <div v-if="decision === 'pass'" class="grid gap-1.5">
              <Label for="pass-note">通过说明（校内留存）<span v-if="!passNeedsReason" class="font-normal text-muted-foreground">，选填</span></Label>
              <Textarea id="pass-note" v-model="note" rows="4" :disabled="Boolean(outcome)" :aria-invalid="tried && Boolean(validation)" placeholder="例如：第 4 页的“东川理工”出现在公开平台名称中，不指向个人。" />
              <p v-if="passNeedsReason" class="text-xs text-muted-foreground">存在学校词表提示，通过时必须写明核对结论。</p>
            </div>
            <div v-if="decision === 'return'" class="grid gap-1.5">
              <Label for="return-reason">退回原因（学生会看到）</Label>
              <Textarea id="return-reason" v-model="reason" rows="5" :disabled="Boolean(outcome)" :aria-invalid="tried && Boolean(validation)" placeholder="写明需要修改的位置和原因" />
              <p class="text-xs text-muted-foreground">可在检测发现中点“写入退回原因”引用页码。</p>
            </div>
            <p v-if="tried && validation && sample !== 'conflict'" class="text-sm text-destructive" role="alert">{{ validation }}</p>

            <div v-if="outcome" class="grid gap-2 rounded-md bg-success-soft px-3 py-2.5 text-sm" role="status">
              <p class="font-medium text-success">{{ outcome === 'passed' ? '已通过核验' : '已退回修改' }}</p>
              <p>{{ outcome === 'passed' ? '论文进入“待送出”。可以现在确认送出，也可以稍后在“可送出”视图处理。' : '学生会看到退回原因。' }}</p>
            </div>
          </template>
          <div v-else class="grid gap-1 rounded-md px-3 py-2.5 text-sm" :class="sent === 'dispatched' ? 'bg-success-soft' : 'bg-destructive-soft'" role="status">
            <p class="font-medium" :class="sent === 'dispatched' ? 'text-success' : 'text-destructive'">{{ sent === 'dispatched' ? '已确认送出' : '已终止送审' }}</p>
            <p>{{ sent === 'dispatched' ? '论文交给百杰运营派单。' : '未完成的专家任务已取消，历史记录保留。' }}</p>
          </div>

          <Collapsible v-if="!sent" v-model:open="moreOpen" class="border-t pt-3">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" size="sm" class="-ml-2 text-muted-foreground"><ChevronDown :class="['transition-transform', moreOpen && 'rotate-180']" />更多操作</Button>
            </CollapsibleTrigger>
            <CollapsibleContent class="grid gap-2 pt-2">
              <p class="text-sm text-muted-foreground">永久终止会结束这篇论文的送审，未完成的专家任务一并取消，历史记录保留，不能恢复。需要学生修改时，请用“退回修改”。</p>
              <Button variant="outline" size="sm" class="justify-self-start border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive" data-action="open-terminate" @click="terminateOpen = true">永久终止送审…</Button>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <footer v-if="!sent" class="flex shrink-0 items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button v-if="outcome === 'passed'" class="w-full" data-action="open-dispatch" @click="dispatchOpen = true">确认送出…</Button>
          <Button v-else-if="!outcome" class="w-full" data-action="submit-decision" @click="submit">{{ decision === 'return' ? '退回修改' : decision === 'pass' ? '通过核验' : '提交判断' }}</Button>
        </footer>
      </section>
    </DefineDecision>

    <template #actions>
      <StatusBadge :tone="autoBadge.tone" class="hidden md:inline-flex">{{ autoBadge.text }}</StatusBadge>
      <span class="tabular hidden text-sm text-muted-foreground lg:inline">第 {{ verifyThesis.position.index }} / {{ verifyThesis.position.total }} 篇</span>
      <Button variant="outline" size="sm" aria-label="上一篇"><ChevronLeft /></Button>
      <Button variant="outline" size="sm" aria-label="下一篇"><ChevronRight /></Button>
    </template>

    <!-- ≥1280：三栏 -->
    <ResizablePanelGroup v-if="wide" direction="horizontal" class="bg-background">
      <ResizablePanel :default-size="288" :min-size="240" :max-size="420" size-unit="px" class="min-w-0">
        <section class="flex h-full flex-col" aria-labelledby="pane-findings">
          <header class="flex h-11 shrink-0 items-center gap-2 border-b px-4">
            <h2 id="pane-findings" class="text-sm font-semibold">检测发现</h2>
            <span class="tabular text-xs text-muted-foreground">已查看 {{ viewed.size }} / {{ stale ? 0 : findings.length }}</span>
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-3">
            <FindingsList :findings="findings" :stale="stale" has-report :open-key="openKey" :viewed="viewed" :can-quote="!outcome" @locate="locate" @quote="quote" />
          </div>
        </section>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :min-size="480" size-unit="px" class="min-w-0">
        <div class="flex h-full flex-col">
          <ReuseToolbar />
          <ReuseDoc />
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel :default-size="368" :min-size="320" :max-size="480" size-unit="px" class="min-w-0">
        <ReuseDecision />
      </ResizablePanel>
    </ResizablePanelGroup>

    <!-- 1024–1279：发现收进抽屉 -->
    <div v-else-if="medium" class="grid h-full grid-cols-[minmax(0,1fr)_340px] grid-rows-[minmax(0,1fr)] bg-background">
      <div class="flex min-w-0 flex-col border-r">
        <ReuseToolbar :with-findings="true" />
        <ReuseDoc />
      </div>
      <ReuseDecision />
    </div>

    <!-- <1024：三个标签页 -->
    <Tabs v-else v-model="tab" class="flex h-full flex-col gap-0 bg-background">
      <TabsList class="m-2 flex w-auto shrink-0">
        <TabsTrigger value="find">发现 {{ stale ? '' : findings.length }}</TabsTrigger>
        <TabsTrigger value="doc">材料</TabsTrigger>
        <TabsTrigger value="decide">判断</TabsTrigger>
      </TabsList>
      <TabsContent value="find" class="min-h-0 overflow-y-auto border-t p-3">
        <FindingsList :findings="findings" :stale="stale" has-report :open-key="openKey" :viewed="viewed" :can-quote="!outcome" @locate="locate" @quote="quote" />
      </TabsContent>
      <TabsContent value="doc" class="flex min-h-0 flex-col border-t">
        <ReuseToolbar />
        <ReuseDoc />
      </TabsContent>
      <TabsContent value="decide" class="min-h-0 border-t"><ReuseDecision /></TabsContent>
    </Tabs>

    <Sheet v-model:open="findingsSheet">
      <SheetContent side="left" class="w-[340px] gap-0 p-0 sm:max-w-[340px]">
        <SheetHeader class="border-b px-4 py-3">
          <SheetTitle class="text-sm">检测发现</SheetTitle>
          <SheetDescription class="text-xs">点一项，材料会跳到对应页。已查看 {{ viewed.size }} / {{ stale ? 0 : findings.length }}</SheetDescription>
        </SheetHeader>
        <div class="min-h-0 flex-1 overflow-y-auto p-3">
          <FindingsList :findings="findings" :stale="stale" has-report :open-key="openKey" :viewed="viewed" :can-quote="!outcome" @locate="locate" @quote="quote" />
        </div>
      </SheetContent>
    </Sheet>

    <!-- 确认送出：与通过核验分开的第二条命令 -->
    <AlertDialog v-model:open="dispatchOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认送出这篇论文？</AlertDialogTitle>
          <AlertDialogDescription>《{{ verifyThesis.title }}》将交给百杰运营派单。送出后学生不能再自行撤回；如需中止，只能永久终止。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>暂不送出</AlertDialogCancel>
          <Button data-action="confirm-dispatch" @click="sent = 'dispatched'; dispatchOpen = false">确认送出</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="terminateOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>永久终止这篇论文的送审？</AlertDialogTitle>
          <AlertDialogDescription>《{{ verifyThesis.title }}》的送审将结束，未完成的专家任务一并取消。终止后不能恢复。</AlertDialogDescription>
        </AlertDialogHeader>
        <div class="grid gap-1.5">
          <Label for="terminate-reason">终止原因（必填，校内留存）</Label>
          <Textarea id="terminate-reason" v-model="terminateReason" placeholder="例如：学生申请放弃本批次送审" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>不终止</AlertDialogCancel>
          <Button variant="destructive" data-action="terminate-thesis" :disabled="!terminateReason.trim()" @click="sent = 'terminated'; terminateOpen = false">永久终止</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <SampleControls v-model="sample" :states="SAMPLE_STATES" />
  </AppShell>
</template>
