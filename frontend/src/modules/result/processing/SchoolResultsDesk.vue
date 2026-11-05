<script setup lang="ts">
/**
 * U4-1 学校结果处理（真实模式，P09）：清单｜对象。
 * 清单 = listSchoolTheses(时间范围) 经 selectSchoolResultQueue；“更正待确认”另取 listCorrections('school') 按 thesis_id 合成。
 * 计数只数已加载集合并写明口径。视图、选中论文与深链更正放在地址里：?view= &thesis= &correction=。
 * demo 模式仍走旧页 ResultProcessingPage（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { listCorrections, type Correction } from '@/api/corrections'
import { apiFailure } from '@/api/failure'
import { selectSchoolResultQueue } from '@/api/adapters'
import { getSchoolThesis, listSchoolTheses } from '@/api/schoolReview'
import type { ThesisDetail } from '@/api/theses'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { useTimeScope } from '@/composables/useTimeScope'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import ResultObject from './ResultObject.vue'
import { awaitingByThesis, viewOf, type ResultView } from './resultView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const timeScope = useTimeScope()
const narrow = useNarrow()

type ViewKey = ResultView | 'all'
const views: { key: ViewKey; label: string }[] = [
  { key: 'publish', label: '待发布' },
  { key: 'correction', label: '更正待确认' },
  { key: 'published', label: '已发布' },
  { key: 'all', label: '全部' },
]
const query = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const view = computed<ViewKey>(() => views.find((item) => item.key === route.query.view)?.key ?? 'publish')
const thesisId = computed(() => query('thesis'))
const correctionId = computed(() => query('correction'))
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}

// ---- 数据 ----
const rows = ref<ThesisDetail[]>([])
const corrections = ref<Correction[]>([])
const loading = ref(true)
const error = ref('')
const correctionsFailed = ref(false)
/** 不在当前时间范围、从链接单独读到的论文 */
const extra = ref<ThesisDetail | null>(null)
const extraLoading = ref(false)
let generation = 0
onBeforeUnmount(() => generation++)

async function load() {
  const request = ++generation
  loading.value = true
  error.value = ''
  const [theses, correctionList] = await Promise.allSettled([
    listSchoolTheses(...timeScope.request()),
    listCorrections('school', { quiet: true }),
  ])
  if (request !== generation) return
  if (theses.status === 'fulfilled') rows.value = selectSchoolResultQueue(theses.value)
  else {
    rows.value = []
    error.value = apiFailure(theses.reason).message
  }
  correctionsFailed.value = correctionList.status === 'rejected'
  corrections.value = correctionList.status === 'fulfilled' ? correctionList.value : []
  await loadExtra(request)
  if (request === generation) loading.value = false
}

async function loadExtra(request: number) {
  const id = thesisId.value
  if (!id || error.value || rows.value.some((row) => row.id === id)) {
    extra.value = null
    return
  }
  extraLoading.value = true
  try {
    const detail = await getSchoolThesis(id, { quiet: true })
    if (request !== generation || id !== thesisId.value) return
    extra.value = selectSchoolResultQueue([detail])[0] ?? null
  } catch {
    if (request !== generation || id !== thesisId.value) return
    extra.value = null
  } finally {
    if (request === generation) extraLoading.value = false
  }
}
watch([timeScope.scope, timeScope.identity], () => void load(), { immediate: true })
watch(thesisId, () => {
  if (!loading.value && thesisId.value && !rows.value.some((row) => row.id === thesisId.value) && extra.value?.id !== thesisId.value) void loadExtra(generation)
})

const awaiting = computed(() => awaitingByThesis(corrections.value))
const all = computed(() => (extra.value ? [extra.value, ...rows.value] : rows.value))
const ready = computed(() => !loading.value && !error.value)
const countOf = (key: ViewKey) => (key === 'all' ? rows.value.length : rows.value.filter((row) => viewOf(row, awaiting.value) === key).length)
const countShown = (key: ViewKey) => ready.value && !(key === 'correction' && correctionsFailed.value)
const list = computed(() => all.value.filter((row) => view.value === 'all' || viewOf(row, awaiting.value) === view.value || row.id === thesisId.value))

const selected = computed(() => all.value.find((row) => row.id === thesisId.value) ?? null)
const selectedCorrection = computed(() => {
  const row = selected.value && awaiting.value.get(selected.value.id)
  if (!row) return null
  return !correctionId.value || row.id === correctionId.value ? row : null
})
const linkedCorrection = computed(() => {
  if (!correctionId.value || !selected.value || selectedCorrection.value) return null
  return corrections.value.find((row) => row.id === correctionId.value && row.thesis_id === selected.value!.id) ?? null
})

/** 宽屏进入时默认选中当前视图第一篇；窄屏先停在清单 */
watch([ready, list, narrow], () => {
  if (!ready.value || narrow.value || thesisId.value || !list.value.length) return
  setQuery({ thesis: list.value[0]!.id })
})

function select(id: string) {
  setQuery({ thesis: id, correction: undefined })
}
function setView(key: ViewKey) {
  setQuery({ view: key === 'publish' ? undefined : key, thesis: undefined, correction: undefined })
}
function published() {
  setQuery({ view: 'published' })
  void load()
}

const line = (row: ThesisDetail) => {
  const key = viewOf(row, awaiting.value)
  if (key === 'correction') return '专家申请更正，等待学校确认'
  return key === 'published' ? '已发布' : '待发布'
}

const resultCount = computed(() => (ready.value && !correctionsFailed.value ? countOf('publish') + countOf('correction') : undefined))
const nav = computed(() => workspaceNav('school_reviewer', '/school/results', { '/school/results': resultCount.value }))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <div class="ws">
    <OperationsShell :nav="nav" :account="account" :org="account.org">
      <template #title><h1 class="wsd-title">结果处理</h1></template>
      <template #context>
        <label class="ctx-scope">
          <span class="sr-only">论文范围</span>
          <select class="select" :value="timeScope.scope.value" data-time-scope @change="timeScope.setScope(($event.target as HTMLSelectElement).value)">
            <option value="past_year">近一年（按论文创建日）</option>
            <option value="all">全部年份</option>
          </select>
        </label>
      </template>

      <MasterDetail :open="Boolean(thesisId)" :narrow="narrow" list-label="结果清单" detail-label="当前论文结果" back-label="结果清单" @back="setQuery({ thesis: undefined, correction: undefined })">
        <template #list>
          <div class="wsd-lhead">
            <div class="wsd-views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="wsd-views__tab" :aria-selected="view === v.key" @click="setView(v.key)">
                {{ v.label }}<span v-if="countShown(v.key)" class="wsd-views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <p v-if="ready" class="wsd-scope">计数为已加载的 {{ rows.length }} 篇（{{ timeScope.scope.value === 'past_year' ? '近一年，按论文创建日' : '全部年份' }}）。</p>
            <p v-if="ready && correctionsFailed" class="wsd-scope warn" role="status">
              更正记录没有加载出来，“更正待确认”暂不可用。<button type="button" class="btn btn--quiet btn--sm" @click="load">重试</button>
            </p>
          </div>
          <StateBlock v-if="loading" kind="loading" title="正在读取评阅结果…" compact />
          <StateBlock v-else-if="error" kind="error" title="结果清单没有加载出来" compact>
            {{ error }}
            <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!all.length" kind="empty" title="这个范围内还没有完成评阅的论文" compact>
            专家提交评阅后，论文会出现在“待发布”。
            <template v-if="timeScope.scope.value === 'past_year'" #actions><button type="button" class="btn" @click="timeScope.setScope('all')">查看全部年份</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'correction' ? '没有待确认的更正' : '这个视图里没有论文'" compact />
          <ul v-else class="wsd-tlist">
            <li v-for="row in list" :key="row.id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.id === thesisId }" :aria-current="row.id === thesisId || undefined" @click="select(row.id)">
                <span class="wsd-titem__title">{{ row.current_version?.title || '未命名论文' }}</span>
                <span v-if="row.student" class="wsd-titem__meta">{{ row.student.name }}　{{ row.student.student_no }}</span>
                <span class="wsd-titem__line" :class="{ 'wsd-titem__line--warn': viewOf(row, awaiting) === 'correction' }">
                  {{ line(row) }}<template v-if="row.id === extra?.id">（不在当前时间范围）</template>
                </span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="ready && all.length" kind="empty" title="从左侧选择一篇论文" compact>
            对象区会列出发布后学生与导师能看到的全部内容。
          </StateBlock>
        </template>

        <StateBlock v-if="(loading || extraLoading) && !selected" kind="loading" title="正在读取论文…" />
        <StateBlock v-else-if="error" kind="error" title="结果清单没有加载出来，暂时不能打开论文">
          <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
        </StateBlock>
        <StateBlock v-else-if="!selected" kind="forbidden" title="这篇论文不在本校可处理的结果中">
          它可能还没有进入结果处理，或不属于本校。
          <template #actions><button type="button" class="btn" @click="setQuery({ thesis: undefined, correction: undefined })">返回结果清单</button></template>
        </StateBlock>
        <ResultObject
          v-else
          :key="selected.id"
          :thesis="selected"
          :view="viewOf(selected, awaiting)"
          :correction="selectedCorrection"
          :linked="linkedCorrection"
          :outside="selected.id === extra?.id"
          @changed="load"
          @published="published"
        />
      </MasterDetail>
    </OperationsShell>
  </div>
</template>

<style scoped>
.ctx-scope {
  min-width: 0;
}
.ctx-scope .select {
  width: auto;
  max-width: 100%;
  min-height: 32px;
  font-size: 13px;
}
.warn {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  color: var(--ws-warning);
}
</style>
