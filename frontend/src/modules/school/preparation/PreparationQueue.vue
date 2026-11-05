<script setup lang="ts">
/**
 * P04 学校送审准备清单（处理外壳）。
 * 视图计数 = 已加载集合（时间范围内）的条数，并写明口径；不冒充服务端全量待办。
 * 视图、搜索、专业与选中行放在查询参数里，进入核验台再返回时原样恢复。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'

import type { TimeScope } from '@/api/timeScope'
import type { ThesisDetail } from '@/api/theses'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import { confirmDispatch } from '@/api/dispatch'
import type { NavGroup, WorkspaceAccount } from '@/components/workspace/types'

import { apiFailure, findingCounts, isNotFound, readReport, reportPills, stageLabel } from './checkReport'

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
</script>

<template>
  <OperationsShell :nav="nav" :account="account" :org="account.org">
    <template #title><h1 class="title">送审准备</h1></template>
    <template #context>
      <label class="ctx-scope">
        <span class="sr-only">论文范围</span>
        <select class="select" :value="scope" data-time-scope @change="emit('setScope', ($event.target as HTMLSelectElement).value)">
          <option value="past_year">近一年（按论文创建日）</option>
          <option value="all">全部年份</option>
        </select>
      </label>
    </template>

    <div class="queue" :class="{ 'queue--with-preview': selected }">
      <section class="queue__list" aria-label="论文清单">
        <div class="toolbar">
          <div class="views" role="tablist" aria-label="视图">
            <button
              v-for="item in views"
              :key="item.key"
              type="button"
              role="tab"
              class="views__tab"
              :aria-selected="view === item.key"
              @click="setQuery({ view: item.key === 'verify' ? undefined : item.key })"
            >{{ item.label }}<span v-if="ready" class="views__count num">{{ countOf(item.key) }}</span></button>
          </div>
          <div class="filters">
            <label class="search">
              <span class="sr-only">搜索论文或学生</span>
              <input class="input" type="search" placeholder="搜索题目、学生或学号" :value="keyword" :disabled="!ready" @input="setQuery({ q: ($event.target as HTMLInputElement).value })" />
            </label>
            <label>
              <span class="sr-only">专业</span>
              <select class="select" :value="program" :disabled="!ready" @change="setQuery({ program: ($event.target as HTMLSelectElement).value })">
                <option value="">全部专业</option>
                <option v-for="item in programs" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <button type="button" class="btn" :aria-pressed="density === 'compact'" @click="setQuery({ density: density === 'compact' ? undefined : 'compact' })">
              {{ density === 'compact' ? '舒适' : '紧凑' }}
            </button>
          </div>
        </div>
        <p v-if="ready" class="scope-note muted">
          计数为本页已加载的 {{ rows.length }} 篇（{{ scope === 'past_year' ? '近一年，按论文创建日' : '全部年份' }}）；搜索与筛选只在已加载范围内进行。
        </p>

        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <StateBlock v-if="loading" kind="loading" title="正在读取本校论文…" />
        <StateBlock v-else-if="error" kind="error" title="论文清单没有加载出来">
          {{ error }}。筛选条件已保留。
          <template #actions><button type="button" class="btn btn--primary" @click="emit('retry')">重试</button></template>
        </StateBlock>
        <StateBlock v-else-if="!rows.length" kind="empty" title="这个范围内还没有本校论文">
          学生提交论文后会出现在这里。
          <template v-if="scope === 'past_year'">更早的记录可以切换到“全部年份”查看。</template>
          <template v-if="scope === 'past_year'" #actions><button type="button" class="btn" @click="emit('setScope', 'all')">查看全部年份</button></template>
        </StateBlock>
        <StateBlock v-else-if="!filtered.length && filtersActive" kind="nomatch" title="当前筛选没有匹配的论文">
          “{{ views.find((item) => item.key === view)?.label }}”视图中没有符合
          <template v-if="keyword">“{{ keyword }}”</template><template v-if="program">{{ keyword ? '、' : '' }}{{ program }}</template>的记录。
          <template #actions><button type="button" class="btn" @click="setQuery({ q: undefined, program: undefined })">清除筛选</button></template>
        </StateBlock>
        <StateBlock v-else-if="!filtered.length" kind="empty" title="这个视图里没有论文" compact>
          {{ { verify: '待核验的论文都已处理。', dispatch: '没有等待送出的论文。', returned: '没有退回后待学生修改的论文。', all: '暂无记录。' }[view] }}
        </StateBlock>

        <div v-else class="table-wrap">
          <table class="table" :class="{ 'table--compact': density === 'compact' }">
            <thead>
              <tr>
                <th scope="col">论文 / 学生</th>
                <th scope="col">专业</th>
                <th scope="col">材料</th>
                <th scope="col">匿名检测</th>
                <th scope="col" class="col-action"><span class="sr-only">下一步</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filtered" :key="row.id" :class="{ 'row--selected': row.id === selectedId }" @click="select(row)">
                <td class="col-title">
                  <button type="button" class="row-title" :aria-expanded="row.id === selectedId" @click.stop="select(row)">{{ row.current_version?.title || '未命名论文' }}</button>
                  <span class="muted row-sub">{{ row.student?.name }}　{{ row.student?.student_no }}<template v-if="view === 'all'">　{{ stageLabel(row.stage) }}</template></span>
                  <span v-if="view === 'returned' && row.return_reason" class="muted row-reason">退回原因：{{ row.return_reason }}</span>
                </td>
                <td class="col-program">{{ programOf(row) }}</td>
                <td class="col-material">{{ materials(row) }}</td>
                <td class="col-check">
                  <span class="pills"><StatusPill v-for="pill in reportPills(readReport(row))" :key="pill.text" :tone="pill.tone">{{ pill.text }}</StatusPill></span>
                  <span v-if="findingCounts(readReport(row))" class="muted counts">{{ findingCounts(readReport(row)) }}</span>
                </td>
                <td class="col-action">
                  <button
                    v-if="row.stage === 'READY_FOR_DISPATCH' && row.allowed_actions.includes('CONFIRM_DISPATCH')"
                    type="button"
                    class="btn btn--sm btn--outline"
                    data-action="row-dispatch"
                    @click.stop="askDispatch(row)"
                  >确认送出…</button>
                  <button v-else type="button" class="btn btn--sm" :class="{ 'btn--outline': row.stage === 'PREPARING' }" @click.stop="open(row)">
                    {{ row.stage === 'PREPARING' ? '开始核验' : '打开' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <aside v-if="selected && selectedReport" class="preview" aria-label="论文预览" @keydown.esc="setQuery({ sel: undefined })">
        <header class="preview__head">
          <StatusPill :tone="selected.stage === 'PREPARING' ? 'action' : 'neutral'">{{ stageLabel(selected.stage) }}</StatusPill>
          <button type="button" class="btn btn--sm btn--quiet" aria-label="关闭预览" @click="setQuery({ sel: undefined })">✕</button>
        </header>
        <h2 class="preview__title">{{ selected.current_version?.title || '未命名论文' }}</h2>
        <dl class="preview__meta">
          <dt>学生</dt><dd>{{ selected.student?.name }}（{{ selected.student?.student_no }}）</dd>
          <dt>专业</dt><dd>{{ programOf(selected) }}</dd>
          <dt>材料</dt><dd>{{ materials(selected) }}</dd>
          <dt>匿名检测</dt>
          <dd class="pills">
            <StatusPill v-for="pill in reportPills(selectedReport)" :key="pill.text" :tone="pill.tone">{{ pill.text }}</StatusPill>
            <span v-if="findingCounts(selectedReport)" class="muted counts">{{ findingCounts(selectedReport) }}</span>
          </dd>
          <dt>人工结论</dt><dd>{{ selectedReport.manual === 'PASS' ? '已通过核验' : selectedReport.manual === 'FAIL' ? '已退回' : '尚未作出' }}</dd>
        </dl>
        <p v-if="selected.stage === 'READY_FOR_DISPATCH'" class="preview__hint">
          已通过核验。确认送出后，论文交给百杰运营派单；这一步与核验分开，需要单独确认。
        </p>
        <div class="preview__actions">
          <button type="button" class="btn btn--primary" @click="open(selected)">{{ selected.stage === 'PREPARING' ? '开始核验' : '打开' }}</button>
        </div>
      </aside>
    </div>
  </OperationsShell>

  <ConfirmDialog :open="Boolean(dispatchRow)" title="确认送出这篇论文？" :busy="dispatchBusy" @close="dispatchRow = null">
    <p>《{{ dispatchRow?.current_version?.title || '未命名论文' }}》（{{ dispatchRow?.student?.name }}）将交给百杰运营派单。送出后学生不能再自行撤回；如需中止，只能永久终止。</p>
    <p v-if="dispatchError" class="field-error" role="alert">没有送出：{{ dispatchError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="dispatchBusy" @click="dispatchRow = null">暂不送出</button>
      <button type="button" class="btn btn--primary" data-action="confirm-row-dispatch" :disabled="dispatchBusy" @click="sendOut">{{ dispatchBusy ? '正在送出…' : '确认送出' }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.notice {
  margin: 0 0 8px;
  padding: 8px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-success-soft);
  font-size: 13px;
}
.row-reason {
  display: block;
  overflow: hidden;
  max-width: 48ch;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.title {
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
}
.ctx-scope {
  min-width: 0;
}
.ctx-scope .select {
  width: auto;
  max-width: 100%;
  min-height: 32px;
  font-size: 13px;
}
.queue {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: calc(100vh - var(--ws-bar));
}
.queue--with-preview {
  grid-template-columns: minmax(0, 1fr) 360px;
}
.queue__list {
  min-width: 0;
  background: var(--ws-surface);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 52px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--ws-border);
}
.views {
  display: flex;
  gap: 2px;
}
.views__tab {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.views__tab:hover {
  background: var(--ws-sunken);
}
.views__tab[aria-selected='true'] {
  background: var(--ws-action-soft);
  color: var(--ws-action);
  font-weight: 600;
}
.views__count {
  color: inherit;
  font-size: 12px;
  opacity: 0.85;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.search .input {
  width: 220px;
}
.filters .select {
  width: 190px;
}
.scope-note {
  padding: 6px 16px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-page);
  font-size: 12px;
}
.table-wrap {
  overflow-x: auto;
}
.table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}
.table th {
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ws-border);
  color: var(--ws-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
.table td {
  height: var(--ws-row);
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-border);
  vertical-align: middle;
}
.table--compact td {
  height: 36px;
  padding-block: 4px;
}
.table tbody tr {
  cursor: pointer;
}
.table tbody tr:hover {
  background: var(--ws-page);
}
.row--selected,
.table tbody tr.row--selected:hover {
  background: var(--ws-action-soft);
}
.col-title {
  width: 46%;
}
.row-title {
  display: -webkit-box;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  font-weight: 500;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.row-sub {
  display: block;
  margin-top: 2px;
  font-size: 12px;
}
.col-program,
.col-material {
  color: var(--ws-muted);
  white-space: nowrap;
}
.col-check .pills,
.preview .pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.counts {
  display: block;
  margin-top: 2px;
  font-size: 12px;
}
.col-action {
  width: 1%;
  text-align: right;
  white-space: nowrap;
}
.preview {
  position: sticky;
  top: var(--ws-bar);
  display: grid;
  align-content: start;
  gap: 14px;
  height: calc(100vh - var(--ws-bar));
  padding: 16px;
  overflow-y: auto;
  border-left: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.preview__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.preview__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.5;
}
.preview__meta {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  margin: 0;
  font-size: 13px;
}
.preview__meta dt {
  color: var(--ws-muted);
}
.preview__meta dd {
  margin: 0;
}
.preview__hint {
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
  color: var(--ws-muted);
  font-size: 13px;
}
.preview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 1180px) {
  .queue--with-preview {
    grid-template-columns: minmax(0, 1fr);
  }
  .preview {
    position: fixed;
    z-index: 45;
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    height: auto;
    max-height: 62vh;
    border-top: 1px solid var(--ws-border);
    border-left: 0;
    border-radius: 12px 12px 0 0;
    box-shadow: var(--ws-shadow-float);
  }
}
@media (max-width: 720px) {
  .search,
  .search .input,
  .filters label,
  .filters .select {
    width: 100%;
  }
  .filters {
    width: 100%;
  }
  .views {
    overflow-x: auto;
    width: 100%;
  }
  /* 窄屏：行改为两段式条目，主动作留在可点范围内，不整页横移 */
  .table {
    min-width: 0;
  }
  .table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .table tbody tr {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ws-border);
  }
  .table td {
    display: block;
    height: auto;
    padding: 0;
    border: 0;
  }
  .col-title {
    grid-column: 1 / -1;
    width: auto;
  }
  .col-program {
    grid-column: 1 / -1;
    font-size: 12px;
  }
  .col-material {
    display: none !important;
  }
  .col-action {
    width: auto;
  }
}
</style>
