<script setup lang="ts">
/**
 * P04 学校送审准备队列（处理工作空间）。
 * 视图名称旁计数 = 已加载集合（近一年/全部）内的条数，明确口径；不冒充服务端全量待办。
 * 点行打开非模态预览；主动作进入完整核验台。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import { accounts, schoolRows, type QueueView, type SchoolRow } from '../data/fixtures'
import { schoolNav } from '../data/nav'

const states = [
  { value: 'normal', label: '有待办' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '范围内无论文' },
  { value: 'error', label: '加载失败' },
] as const
const state = useProtoState(states, 'normal')
const router = useRouter()
const route = useRoute()

const scope = ref<'year' | 'all'>('year')
const view = ref<QueueView | 'all'>('verify')
const keyword = ref(typeof route.query.q === 'string' ? route.query.q : '')
const program = ref('')
const selectedId = ref<string | null>(null)
const density = ref<'default' | 'compact'>('default')

const loaded = computed(() => (state.value === 'empty' ? [] : schoolRows))
const programs = computed(() => [...new Set(schoolRows.map((row) => row.program))].sort())
const views: { key: QueueView | 'all'; label: string }[] = [
  { key: 'verify', label: '待核验' },
  { key: 'ready', label: '可送出' },
  { key: 'returned', label: '已退回' },
  { key: 'all', label: '全部' },
]
const countOf = (key: QueueView | 'all') => (key === 'all' ? loaded.value.length : loaded.value.filter((row) => row.view === key).length)
const filtered = computed(() =>
  loaded.value.filter(
    (row) =>
      (view.value === 'all' || row.view === view.value) &&
      (!program.value || row.program === program.value) &&
      (!keyword.value.trim() || `${row.title}${row.student}${row.studentNo}`.includes(keyword.value.trim())),
  ),
)
const filtersActive = computed(() => Boolean(keyword.value.trim() || program.value))
const selected = computed(() => filtered.value.find((row) => row.id === selectedId.value) ?? null)
watch(filtered, (rows) => {
  // 当前项被筛掉时关闭预览，不暗换为第一条
  if (selectedId.value && !rows.some((row) => row.id === selectedId.value)) selectedId.value = null
})

function clearFilters() {
  keyword.value = ''
  program.value = ''
}
function openVerify(row: SchoolRow) {
  void router.push({ path: '/prototype/school/verify', query: { thesis: row.id } })
}
/**
 * 检测状态按维度分别展示（v2.1 §3.5）：自动结论 PASS | REVIEW_REQUIRED | FAIL | null、
 * 单项严重程度计数、报告时效 stale、人工结论。不合成一个“WARN”枚举。
 */
type Pill = { tone: 'neutral' | 'warning' | 'danger' | 'success'; text: string }
function checkPills(row: SchoolRow): Pill[] {
  const check = row.check
  if (!check) return [{ tone: 'neutral', text: '无需核验' }]
  if (check.manual === 'PASS' && !check.stale) return [{ tone: 'success', text: '人工已确认通过' }]
  const pills: Pill[] = []
  if (check.auto === 'FAIL') pills.push({ tone: check.stale ? 'neutral' : 'danger', text: `${check.stale ? '上次自动结论' : '自动'}：不通过` })
  else if (check.auto === 'REVIEW_REQUIRED') pills.push({ tone: check.stale ? 'neutral' : 'warning', text: `${check.stale ? '上次自动结论' : '自动'}：需人工复核` })
  else if (check.auto === 'PASS') pills.push({ tone: 'neutral', text: `${check.stale ? '上次自动结论' : '自动'}：未发现线索` })
  else pills.push({ tone: 'neutral', text: '尚未检测' })
  if (check.stale) pills.push({ tone: 'warning', text: '报告已过期' })
  return pills
}
function findingCounts(row: SchoolRow) {
  const check = row.check
  if (!check || check.stale || (check.manual === 'PASS' && !check.stale)) return ''
  return [check.block && `阻断 ${check.block}`, check.warn && `警告 ${check.warn}`].filter(Boolean).join('，')
}
function nextAction(row: SchoolRow) {
  if (row.view === 'verify') return { label: '开始核验', primary: true }
  if (row.view === 'ready') return { label: '确认送出', primary: true }
  return { label: '查看', primary: false }
}
</script>

<template>
  <ProtoFrame v-model:state="state" name="学校送审准备队列" :states="states">
    <OperationsShell :nav="schoolNav('preparation', countOf('verify'))" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">送审准备</h1></template>
      <template #context>
        <span class="ctx-batch">2026 年秋季学位论文送审</span>
        <label class="ctx-scope">
          <span class="sr-only">时间范围</span>
          <select v-model="scope" class="select">
            <option value="year">近一年（按论文创建日）</option>
            <option value="all">全部</option>
          </select>
        </label>
      </template>

      <div class="queue" :class="{ 'queue--with-preview': selected }">
        <section class="queue__list" aria-label="论文队列">
          <div class="toolbar">
            <div class="views" role="tablist" aria-label="视图">
              <button
                v-for="item in views"
                :key="item.key"
                type="button"
                role="tab"
                class="views__tab"
                :aria-selected="view === item.key"
                @click="view = item.key"
              >
                {{ item.label }}
                <span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(item.key) }}</span>
              </button>
            </div>
            <div class="filters">
              <label class="search">
                <span class="sr-only">搜索论文或学生</span>
                <input v-model="keyword" class="input" type="search" placeholder="搜索题目、学生或学号" :disabled="state !== 'normal'" />
              </label>
              <label>
                <span class="sr-only">专业</span>
                <select v-model="program" class="select" :disabled="state !== 'normal'">
                  <option value="">全部专业</option>
                  <option v-for="item in programs" :key="item" :value="item">{{ item }}</option>
                </select>
              </label>
              <button type="button" class="btn" :aria-pressed="density === 'compact'" @click="density = density === 'compact' ? 'default' : 'compact'">
                {{ density === 'compact' ? '舒适' : '紧凑' }}
              </button>
              <button type="button" class="btn">列设置</button>
            </div>
          </div>
          <p v-if="state === 'normal'" class="scope-note muted">
            计数为本页已加载的 {{ loaded.length }} 篇（{{ scope === 'year' ? '近一年' : '全部' }}）；搜索只在已加载范围内进行。
          </p>

          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取本校论文…" />
          <StateBlock v-else-if="state === 'error'" kind="error" title="论文列表没有加载出来">
            网络或服务暂时不可用，筛选条件已保留。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="近一年没有本校提交的论文">
            学生提交论文后会出现在这里。往年的记录可以切换到“全部”查看。
            <template #actions><button type="button" class="btn" @click="scope = 'all'">查看全部年份</button></template>
          </StateBlock>
          <StateBlock v-else-if="!filtered.length && filtersActive" kind="nomatch" title="当前筛选没有匹配的论文">
            “{{ views.find((v) => v.key === view)?.label }}”视图中没有符合
            <template v-if="keyword">“{{ keyword }}”</template><template v-if="program">{{ keyword ? '、' : '' }}{{ program }}</template>的记录。
            <template #actions><button type="button" class="btn" @click="clearFilters">清除筛选</button></template>
          </StateBlock>
          <StateBlock v-else-if="!filtered.length" kind="empty" title="这个视图里没有论文" compact>
            {{ view === 'verify' ? '待核验的论文都已处理。' : '暂无记录。' }}
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
                <tr
                  v-for="row in filtered"
                  :key="row.id"
                  :class="{ 'row--selected': row.id === selectedId }"
                  @click="selectedId = row.id"
                >
                  <td class="col-title">
                    <button type="button" class="row-title" :aria-expanded="row.id === selectedId" @click.stop="selectedId = row.id">{{ row.title }}</button>
                    <span class="muted row-sub">{{ row.student }}　{{ row.studentNo }}</span>
                  </td>
                  <td class="col-program">{{ row.program }}</td>
                  <td class="col-material">原稿、匿名稿</td>
                  <td class="col-check">
                    <span class="pills"><StatusPill v-for="p in checkPills(row)" :key="p.text" :tone="p.tone">{{ p.text }}</StatusPill></span>
                    <span v-if="findingCounts(row)" class="muted counts">{{ findingCounts(row) }}</span>
                  </td>
                  <td class="col-action">
                    <button
                      type="button"
                      class="btn btn--sm"
                      :class="{ 'btn--outline': nextAction(row).primary }"
                      @click.stop="row.view === 'verify' ? openVerify(row) : (selectedId = row.id)"
                    >
                      {{ nextAction(row).label }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <aside v-if="selected" class="preview" aria-label="论文预览">
          <header class="preview__head">
            <StatusPill :tone="selected.view === 'verify' ? 'action' : 'neutral'">{{ selected.statusText }}</StatusPill>
            <button type="button" class="btn btn--sm btn--quiet" aria-label="关闭预览" @click="selectedId = null">✕</button>
          </header>
          <h2 class="preview__title">{{ selected.title }}</h2>
          <dl class="preview__meta">
            <dt>学生</dt><dd>{{ selected.student }}（{{ selected.studentNo }}）</dd>
            <dt>专业</dt><dd>{{ selected.program }}</dd>
            <dt>材料</dt><dd>原稿与匿名稿已上传</dd>
            <dt>匿名检测</dt>
            <dd class="pills">
              <StatusPill v-for="p in checkPills(selected)" :key="p.text" :tone="p.tone">{{ p.text }}</StatusPill>
              <span v-if="findingCounts(selected)" class="muted counts">{{ findingCounts(selected) }}</span>
            </dd>
            <dt>人工结论</dt><dd>{{ selected.check?.manual === 'PASS' ? '已通过核验' : selected.check?.manual === 'REJECT' ? '已退回' : '尚未作出' }}</dd>
            <dt>最近更新</dt><dd class="num">{{ selected.updated }}</dd>
          </dl>
          <p v-if="selected.view === 'ready'" class="preview__hint">
            已通过核验。确认送出后，论文交给百杰运营派单；这一步与核验分开，需要单独确认。
          </p>
          <div class="preview__actions">
            <button v-if="selected.view === 'verify'" type="button" class="btn btn--primary" @click="openVerify(selected)">开始核验</button>
            <button v-else-if="selected.view === 'ready'" type="button" class="btn btn--primary">确认送出</button>
            <button type="button" class="btn">查看处理记录</button>
          </div>
          <ProtoNote v-if="selected.view === 'ready'" contract="RISK-01">
            检测冻结点仍未决定：已通过核验后报告过期时的合法动作需另立业务决策。原型不做 READY 状态重检、强制通过或前端门禁，按钮是否出现以服务端 allowed_actions 为准。
          </ProtoNote>
        </aside>
      </div>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.title {
  font-size: 17px;
  font-weight: 600;
  white-space: nowrap;
}
.ctx-batch {
  overflow: hidden;
  color: var(--ws-muted);
  font-size: 13px;
  text-overflow: ellipsis;
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
  background: #fafbfc;
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
  .ctx-batch {
    display: none;
  }
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
@media (max-width: 640px) {
  .ctx-batch {
    display: none;
  }
}
</style>
