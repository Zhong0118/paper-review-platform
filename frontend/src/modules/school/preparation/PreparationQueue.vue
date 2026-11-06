<script setup lang="ts">
/**
 * P04 学校送审准备清单（R2：AppShell queue 模板，U4 计划 §18）。
 * 视图计数 = 已加载集合（时间范围内）的条数，并写明口径；不冒充服务端全量待办。
 * 视图、搜索、专业与选中行放在查询参数里，进入核验台再返回时原样恢复。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'

import type { TimeScope } from '@/api/timeScope'
import type { ThesisDetail } from '@/api/theses'
import { confirmDispatch } from '@/api/dispatch'
import ComboFilter from '@/components/app/data/ComboFilter.vue'
import FilterBar, { type FilterChip } from '@/components/app/data/FilterBar.vue'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import SearchField from '@/components/app/data/SearchField.vue'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Columns3, X } from '@lucide/vue'
import { createReusableTemplate, useMediaQuery } from '@vueuse/core'

import { apiFailure, findingCounts, isNotFound, readReport, reportPills, stageLabel, type Tone } from './checkReport'

const props = defineProps<{
  rows: ThesisDetail[]
  loading: boolean
  error: string
  nav: NavGroup[]
  account: WorkspaceAccount
  scope: TimeScope
}>()
const emit = defineEmits<{ setScope: [value: string]; retry: []; changed: [] }>()
const route = useRoute()
const router = useRouter()
const signOut = useSignOut()

// U2-4：补齐“可送出”“已退回”视图；视图计数只数已加载集合
type View = 'verify' | 'dispatch' | 'returned' | 'all'
const views: { key: View; label: string }[] = [
  { key: 'verify', label: '待核验' },
  { key: 'dispatch', label: '可送出' },
  { key: 'returned', label: '已退回' },
  { key: 'all', label: '全部' },
]
const text = (value: LocationQuery[string]) => (typeof value === 'string' ? value : '')
const view = computed<View>(() => views.find((item) => item.key === route.query.view)?.key ?? 'verify')
const keyword = computed(() => text(route.query.q))
const program = computed(() => text(route.query.program))
const selectedId = computed(() => text(route.query.sel))
const density = computed(() => (route.query.density === 'compact' ? 'compact' : 'default'))

function setQuery(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) query[key] = value
  void router.replace({ query })
}

const programOf = (row: ThesisDetail) => row.current_version?.school_program?.name || row.current_version?.discipline_name || '未填写专业'
const programs = computed(() => [...new Set(props.rows.map(programOf))].sort())
function inView(row: ThesisDetail, key: View) {
  if (key === 'verify') return row.stage === 'PREPARING'
  if (key === 'dispatch') return row.stage === 'READY_FOR_DISPATCH'
  if (key === 'returned') return row.stage === 'DRAFT' && Boolean(row.return_reason)
  return true
}
const countOf = (key: View) => props.rows.filter((row) => inView(row, key)).length
const filtered = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return props.rows.filter(
    (row) =>
      inView(row, view.value) &&
      (!program.value || programOf(row) === program.value) &&
      (!needle || `${row.current_version?.title ?? ''}${row.student?.name ?? ''}${row.student?.student_no ?? ''}`.toLowerCase().includes(needle)),
  )
})
const ready = computed(() => !props.loading && !props.error)
const filtersActive = computed(() => Boolean(keyword.value.trim() || program.value))
/** 选中行被筛掉时只关闭预览，不暗换成别的行 */
const selected = computed(() => filtered.value.find((row) => row.id === selectedId.value) ?? null)
const selectedReport = computed(() => (selected.value ? readReport(selected.value) : null))

function materials(row: ThesisDetail) {
  const purposes = new Set(row.current_version?.files.map((file) => file.purpose) ?? [])
  if (purposes.has('original') && purposes.has('anonymous')) return '原稿、匿名稿'
  if (purposes.has('anonymous')) return '仅匿名稿'
  if (purposes.has('original')) return '缺匿名稿'
  return '未上传'
}
function open(row: ThesisDetail) {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) if (typeof value === 'string' && value && key !== 'sel') query[key] = value
  void router.push({ query: { ...query, thesis: row.id } })
}
function select(row: ThesisDetail) {
  setQuery({ sel: row.id })
}

// ── 可送出视图：行内确认送出（与核验台同一规则：只看 allowed_actions，单独确认，重试沿用同一键） ──
const dispatchRow = ref<ThesisDetail | null>(null)
const dispatchBusy = ref(false)
const dispatchError = ref('')
const notice = ref('')
let dispatchAttempt: { id: string; version: number; key: string } | null = null
function askDispatch(row: ThesisDetail) {
  dispatchError.value = ''
  if (dispatchAttempt?.id !== row.id) dispatchAttempt = null
  dispatchRow.value = row
}
async function sendOut() {
  const row = dispatchRow.value
  if (!row || dispatchBusy.value) return
  dispatchAttempt ??= { id: row.id, version: row.version, key: crypto.randomUUID() }
  dispatchBusy.value = true
  dispatchError.value = ''
  try {
    await confirmDispatch(dispatchAttempt.id, dispatchAttempt.version, { idempotencyKey: dispatchAttempt.key, quiet: true })
    dispatchAttempt = null
    dispatchRow.value = null
    notice.value = `已确认送出《${row.current_version?.title || '未命名论文'}》，论文交给百杰运营派单。`
    emit('changed')
  } catch (error) {
    const failure = apiFailure(error)
    if (failure.status === 409 || isNotFound(error)) {
      dispatchAttempt = null
      dispatchRow.value = null
      notice.value = '这篇论文的状态已经变化，没有送出。清单已刷新。'
      emit('changed')
    } else dispatchError.value = failure.message
  } finally {
    dispatchBusy.value = false
  }
}

// ── R2 外观 ──
const badgeTone = (tone: Tone) => (tone === 'action' ? 'brand' : tone)
const viewOptions = computed(() => views.map((item) => ({ value: item.key, label: item.label, count: ready.value ? countOf(item.key) : undefined })))
function setView(key: string) {
  setQuery({ view: key === 'verify' ? undefined : key })
}
const programOptions = computed(() => programs.value.map((item) => ({ value: item, label: item })))
const chips = computed<FilterChip[]>(() => (program.value ? [{ key: 'program', label: `专业：${program.value}` }] : []))
/** jsdom 没有 matchMedia：默认按宽屏处理（右侧预览栏） */
const narrowPreview = useMediaQuery('(max-width: 1179px)')
const closePreview = () => setQuery({ sel: undefined })
const [DefinePreview, PreviewBody] = createReusableTemplate()
</script>

<template>
  <AppShell :nav="nav" :account="account" :workspace="account.org" title="送审准备" layout="queue" @sign-out="signOut">
    <template #context>学生提交的论文在这里核验匿名稿、确认送出</template>
    <template #actions>
      <ScopeSelect :model-value="scope" @update:model-value="(value) => emit('setScope', value)" />
    </template>

    <DefinePreview>
      <template v-if="selected && selectedReport">
        <h2 class="text-md font-semibold text-balance">{{ selected.current_version?.title || '未命名论文' }}</h2>
        <dl class="mt-3 grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-muted-foreground">学生</dt><dd>{{ selected.student?.name }}（{{ selected.student?.student_no }}）</dd>
          <dt class="text-muted-foreground">专业</dt><dd>{{ programOf(selected) }}</dd>
          <dt class="text-muted-foreground">材料</dt><dd>{{ materials(selected) }}</dd>
          <dt class="text-muted-foreground">匿名检测</dt>
          <dd class="flex flex-wrap items-center gap-1">
            <StatusBadge v-for="pill in reportPills(selectedReport)" :key="pill.text" :tone="badgeTone(pill.tone)">{{ pill.text }}</StatusBadge>
            <span v-if="findingCounts(selectedReport)" class="text-xs text-muted-foreground">{{ findingCounts(selectedReport) }}</span>
          </dd>
          <dt class="text-muted-foreground">人工结论</dt><dd>{{ selectedReport.manual === 'PASS' ? '已通过核验' : selectedReport.manual === 'FAIL' ? '已退回' : '尚未作出' }}</dd>
        </dl>
        <p v-if="selected.stage === 'READY_FOR_DISPATCH'" class="mt-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          已通过核验。确认送出后，论文交给百杰运营派单；这一步与核验分开，需要单独确认。
        </p>
        <Button class="mt-4" @click="open(selected)">{{ selected.stage === 'PREPARING' ? '开始核验' : '打开' }}</Button>
      </template>
    </DefinePreview>

    <div class="grid h-full min-h-0" :class="selected && !narrowPreview ? 'grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'">
      <section class="min-h-0 overflow-y-auto px-(--page-x) pt-4 pb-8" aria-label="论文清单">
        <div class="grid gap-3">
          <FilterBar :chips="chips" @remove="setQuery({ program: undefined })" @clear="setQuery({ q: undefined, program: undefined })">
            <template #views>
              <ViewTabs :model-value="view" :views="viewOptions" label="视图" @update:model-value="setView" />
            </template>
            <template #display>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button variant="ghost" size="sm" class="text-muted-foreground"><Columns3 />显示</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-44">
                  <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">行距</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem :model-value="density === 'compact'" @update:model-value="(on: boolean) => setQuery({ density: on ? 'compact' : undefined })">
                    紧凑行距
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
            <template #search>
              <SearchField :model-value="keyword" label="搜索论文或学生" placeholder="搜索题目、学生或学号" @update:model-value="(value) => setQuery({ q: value })" />
            </template>
            <template #filters>
              <ComboFilter
                :model-value="program || null"
                label="专业"
                placeholder="全部专业"
                search-placeholder="搜索专业"
                :options="programOptions"
                :disabled="!ready"
                width="w-[200px]"
                @update:model-value="(value) => setQuery({ program: value ?? undefined })"
              />
            </template>
          </FilterBar>
          <p v-if="ready" class="tabular text-sm text-muted-foreground" data-scope-note>
            计数为本页已加载的 {{ rows.length }} 篇（{{ scope === 'past_year' ? '近一年，按论文创建日' : '全部年份' }}）；搜索与筛选只在已加载范围内进行。
          </p>

          <p v-if="notice" class="notice rounded-md bg-success-soft px-3 py-2 text-sm" role="status">{{ notice }}</p>

          <div v-if="loading || error || !rows.length || !filtered.length" class="rounded-lg border bg-background">
            <StatePanel v-if="loading" kind="loading" title="正在读取本校论文…" />
            <StatePanel v-else-if="error" kind="error" title="论文清单没有加载出来">
              {{ error }}。筛选条件已保留。
              <template #actions><Button @click="emit('retry')">重试</Button></template>
            </StatePanel>
            <StatePanel v-else-if="!rows.length" kind="empty" title="这个范围内还没有本校论文">
              学生提交论文后会出现在这里。<template v-if="scope === 'past_year'">更早的记录可以切换到“全部年份”查看。</template>
              <template v-if="scope === 'past_year'" #actions><Button variant="outline" @click="emit('setScope', 'all')">查看全部年份</Button></template>
            </StatePanel>
            <StatePanel v-else-if="filtersActive" kind="noresult" title="当前筛选没有匹配的论文">
              “{{ views.find((item) => item.key === view)?.label }}”视图中没有符合
              <template v-if="keyword">“{{ keyword }}”</template><template v-if="program">{{ keyword ? '、' : '' }}{{ program }}</template>的记录。
              <template #actions><Button variant="outline" @click="setQuery({ q: undefined, program: undefined })">清除筛选</Button></template>
            </StatePanel>
            <StatePanel v-else kind="empty" title="这个视图里没有论文" compact>
              {{ { verify: '待核验的论文都已处理。', dispatch: '没有等待送出的论文。', returned: '没有退回后待学生修改的论文。', all: '暂无记录。' }[view] }}
            </StatePanel>
          </div>

          <div v-else class="overflow-hidden rounded-lg border bg-background">
            <Table class="md:min-w-[760px]">
              <TableHeader class="max-md:sr-only">
                <TableRow class="hover:bg-transparent">
                  <TableHead class="w-[46%]">论文 / 学生</TableHead>
                  <TableHead>专业</TableHead>
                  <TableHead>材料</TableHead>
                  <TableHead>匿名检测</TableHead>
                  <TableHead class="w-px"><span class="sr-only">下一步</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow
                  v-for="row in filtered"
                  :key="row.id"
                  :class="['cursor-pointer max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-3 max-md:gap-y-1.5 max-md:px-1 max-md:py-3', { 'row--selected': row.id === selectedId }]"
                  :data-state="row.id === selectedId ? 'selected' : undefined"
                  @click="select(row)"
                >
                  <TableCell :class="['max-md:col-span-2 max-md:h-auto max-md:py-0', density === 'compact' && 'h-9 py-1']">
                    <button type="button" class="row-title line-clamp-2 text-left font-medium hover:text-primary" :aria-expanded="row.id === selectedId" @click.stop="select(row)">
                      {{ row.current_version?.title || '未命名论文' }}
                    </button>
                    <span class="tabular mt-0.5 block text-xs text-muted-foreground">{{ row.student?.name }}　{{ row.student?.student_no }}<template v-if="view === 'all'">　{{ stageLabel(row.stage) }}</template></span>
                    <span v-if="view === 'returned' && row.return_reason" class="row-reason mt-0.5 block max-w-[48ch] truncate text-xs text-muted-foreground">退回原因：{{ row.return_reason }}</span>
                  </TableCell>
                  <TableCell :class="['text-muted-foreground max-md:col-span-2 max-md:h-auto max-md:py-0 max-md:text-xs', density === 'compact' && 'h-9 py-1']">{{ programOf(row) }}</TableCell>
                  <TableCell :class="['whitespace-nowrap text-muted-foreground max-md:hidden', density === 'compact' && 'h-9 py-1']">{{ materials(row) }}</TableCell>
                  <TableCell :class="['max-md:h-auto max-md:py-0', density === 'compact' && 'h-9 py-1']">
                    <span class="flex flex-wrap gap-1"><StatusBadge v-for="pill in reportPills(readReport(row))" :key="pill.text" :tone="badgeTone(pill.tone)">{{ pill.text }}</StatusBadge></span>
                    <span v-if="findingCounts(readReport(row))" class="mt-0.5 block text-xs text-muted-foreground">{{ findingCounts(readReport(row)) }}</span>
                  </TableCell>
                  <TableCell :class="['text-right max-md:h-auto max-md:py-0', density === 'compact' && 'h-9 py-1']">
                    <Button
                      v-if="row.stage === 'READY_FOR_DISPATCH' && row.allowed_actions.includes('CONFIRM_DISPATCH')"
                      size="sm"
                      data-action="row-dispatch"
                      @click.stop="askDispatch(row)"
                    >确认送出…</Button>
                    <Button v-else size="sm" :variant="row.stage === 'PREPARING' ? 'outline' : 'ghost'" @click.stop="open(row)">
                      {{ row.stage === 'PREPARING' ? '开始核验' : '打开' }}
                    </Button>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      <!-- 预览：宽屏右侧 360px；窄屏抽屉。内容同一份 -->
      <aside v-if="selected && selectedReport && !narrowPreview" class="min-h-0 overflow-y-auto border-l bg-background p-4" aria-label="论文预览" @keydown.esc="closePreview">
        <div class="mb-3 flex items-center justify-between">
          <StatusBadge :tone="selected.stage === 'PREPARING' ? 'brand' : 'neutral'">{{ stageLabel(selected.stage) }}</StatusBadge>
          <Button variant="ghost" size="icon-sm" aria-label="关闭预览" @click="closePreview"><X /></Button>
        </div>
        <PreviewBody />
      </aside>
      <Sheet v-if="narrowPreview" :open="Boolean(selected && selectedReport)" @update:open="(open) => !open && closePreview()">
        <SheetContent class="w-full gap-0 sm:max-w-[400px]" aria-label="论文预览">
          <SheetHeader class="border-b">
            <SheetTitle class="text-sm">论文预览</SheetTitle>
            <SheetDescription class="sr-only">选中论文的材料与检测情况</SheetDescription>
          </SheetHeader>
          <div class="overflow-y-auto p-4"><PreviewBody /></div>
        </SheetContent>
      </Sheet>
    </div>

    <AlertDialog :open="Boolean(dispatchRow)" @update:open="(open) => !open && !dispatchBusy && (dispatchRow = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认送出这篇论文？</AlertDialogTitle>
          <AlertDialogDescription>
            《{{ dispatchRow?.current_version?.title || '未命名论文' }}》（{{ dispatchRow?.student?.name }}）将交给百杰运营派单。送出后学生不能再自行撤回；如需中止，只能永久终止。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="dispatchError" class="text-sm text-destructive" role="alert">没有送出：{{ dispatchError }}</p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="dispatchBusy">暂不送出</AlertDialogCancel>
          <Button data-action="confirm-row-dispatch" :disabled="dispatchBusy" @click="sendOut">{{ dispatchBusy ? '正在送出…' : '确认送出' }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>
</template>
