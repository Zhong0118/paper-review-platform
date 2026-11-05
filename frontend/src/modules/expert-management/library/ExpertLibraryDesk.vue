<script setup lang="ts">
/**
 * U4-6 专家库（真实模式，P13）：专家清单｜专家档案；对象区另有新建态与导入态。
 * 一次取全部专家，在已加载范围内搜索与按学科筛选（列表接口的筛选是整标签精确匹配）。
 * 地址：?view= &q= &discipline= &expert= &new=1 &import=1。demo 模式仍是旧 ExpertLibraryPage（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { expertOptions, listExperts, type ExpertOptions, type ExpertRecord } from '@/api/expertOperations'
import { apiFailure } from '@/api/failure'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import ExpertCreate from './ExpertCreate.vue'
import ExpertImportPane from './ExpertImportPane.vue'
import ExpertObject from './ExpertObject.vue'
import { bucket, rowPill, type ExpertView } from './expertView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const narrow = useNarrow()

const experts = ref<ExpertRecord[]>([])
const options = ref<ExpertOptions>({ provinces: [], titles: [], schools: [], disciplines: [] })
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => generation++)

async function load(): Promise<ExpertRecord[] | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const [rows, choices] = await Promise.all([listExperts({}, { quiet: true }), expertOptions({ quiet: true })])
    if (request !== generation) return null
    experts.value = rows
    options.value = choices
    return rows
  } catch (reason) {
    if (request !== generation) return null
    error.value = apiFailure(reason).message
    return null
  } finally {
    if (request === generation) loading.value = false
  }
}
void load()

type ViewKey = ExpertView | 'all'
const views: { key: ViewKey; label: string }[] = [
  { key: 'ready', label: '可指派' },
  { key: 'pending', label: '待审核' },
  { key: 'blocked', label: '不可派' },
  { key: 'all', label: '全部' },
]
const text = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const view = computed<ViewKey>(() => views.find((item) => item.key === route.query.view)?.key ?? 'ready')
const keyword = computed(() => text('q'))
const discipline = computed(() => text('discipline'))
const expertId = computed(() => text('expert'))
const creating = computed(() => route.query.new === '1')
const importing = computed(() => route.query.import === '1')
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}
const openPane = (patch: Record<string, string | undefined>) => setQuery({ expert: undefined, new: undefined, import: undefined, ...patch })

const ready = computed(() => !loading.value && !error.value)
const countOf = (key: ViewKey) => (key === 'all' ? experts.value.length : experts.value.filter((row) => bucket(row) === key).length)
const filtersActive = computed(() => Boolean(keyword.value.trim() || discipline.value))
const list = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return experts.value.filter((row) =>
    (view.value === 'all' || bucket(row) === view.value) &&
    (!discipline.value || row.discipline_codes.includes(discipline.value)) &&
    (!needle || [row.display_name, row.username, row.unit, ...row.research_directions, ...row.keywords].join(' ').toLowerCase().includes(needle)))
})
const usedDisciplines = computed(() => {
  const codes = new Set(experts.value.flatMap((row) => row.discipline_codes))
  return [...codes].sort().map((code) => ({ code, name: options.value.disciplines.find((item) => item.code === code)?.name ?? code }))
})
const selected = computed(() => experts.value.find((row) => row.id === expertId.value) ?? null)

watch([ready, list, narrow], () => {
  if (!ready.value || narrow.value || expertId.value || creating.value || importing.value || !list.value.length) return
  setQuery({ expert: list.value[0]!.id })
})
async function created(expert: ExpertRecord) {
  await load()
  setQuery({ new: undefined, view: 'pending', q: undefined, discipline: undefined, expert: expert.id })
}

const nav = computed(() => workspaceNav('platform_reviewer', '/platform/experts'))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '百杰审核',
  org: '百杰运营',
}))
</script>

<template>
  <div class="ws">
    <OperationsShell :nav="nav" :account="account" :org="account.org">
      <template #title><h1 class="wsd-title">专家库</h1></template>
      <template #context>
        <template v-if="ready">
          <button type="button" class="btn btn--sm" data-action="open-import" @click="openPane({ import: '1' })">导入档案</button>
          <button type="button" class="btn btn--sm" data-action="new-expert" @click="openPane({ new: '1' })">新建专家</button>
        </template>
      </template>

      <MasterDetail :open="Boolean(expertId) || creating || importing" :narrow="narrow" list-label="专家清单" detail-label="专家档案" back-label="专家清单" list-width="340px" @back="openPane({})">
        <template #list>
          <div class="wsd-lhead">
            <div class="wsd-views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="wsd-views__tab" :aria-selected="view === v.key" @click="setQuery({ view: v.key === 'ready' ? undefined : v.key, expert: undefined })">
                {{ v.label }}<span v-if="ready" class="wsd-views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <div class="filters">
              <label>
                <span class="sr-only">搜索专家</span>
                <input class="input" type="search" :value="keyword" placeholder="姓名、单位、研究方向或关键词" data-field="expert-search" :disabled="!ready || !experts.length" @input="setQuery({ q: ($event.target as HTMLInputElement).value || undefined, expert: undefined })" />
              </label>
              <label>
                <span class="sr-only">学科</span>
                <select class="select" :value="discipline" data-field="expert-discipline" :disabled="!ready || !experts.length" @change="setQuery({ discipline: ($event.target as HTMLSelectElement).value || undefined, expert: undefined })">
                  <option value="">全部学科</option>
                  <option v-for="item in usedDisciplines" :key="item.code" :value="item.code">{{ item.code }} {{ item.name }}</option>
                </select>
              </label>
            </div>
            <p v-if="ready && experts.length" class="wsd-scope">资料为人工维护、未核验；来源说明不代表实名认证</p>
          </div>
          <StateBlock v-if="loading && !experts.length" kind="loading" title="正在读取专家档案…" compact />
          <StateBlock v-else-if="error" kind="error" title="专家清单没有加载出来" compact>
            {{ error }}
            <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!experts.length" kind="empty" title="专家库还是空的" compact>
            先新建专家；之后可以按模板导入 CSV 批量更新档案。
            <template #actions><button type="button" class="btn btn--primary" @click="openPane({ new: '1' })">新建专家</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length && filtersActive" kind="nomatch" title="当前筛选没有匹配的专家" compact>
            <template #actions><button type="button" class="btn" @click="setQuery({ q: undefined, discipline: undefined })">清除筛选</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" title="这个视图里没有专家" compact />
          <ul v-else class="wsd-tlist">
            <li v-for="row in list" :key="row.id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.id === expertId }" :aria-current="row.id === expertId || undefined" @click="openPane({ expert: row.id })">
                <span class="wsd-titem__top">
                  <span class="wsd-titem__title">{{ row.display_name }}<span v-if="row.title" class="muted">　{{ row.title }}</span></span>
                  <StatusPill v-if="rowPill(row)" :tone="rowPill(row)!.tone">{{ rowPill(row)!.text }}</StatusPill>
                </span>
                <span class="wsd-titem__meta">{{ row.unit || '单位未填写' }}</span>
                <span class="wsd-titem__line muted">{{ row.research_directions.join('、') || '研究方向未填写' }}{{ row.conflicts.length ? `　回避 ${row.conflicts.length} 项` : '' }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="ready && experts.length" kind="empty" title="从左侧选择一位专家" compact />
        </template>

        <ExpertImportPane v-if="importing" @applied="load" />
        <ExpertCreate v-else-if="creating" :options="options" @created="created" @cancel="openPane({})" />
        <StateBlock v-else-if="loading && !selected" kind="loading" title="正在读取专家档案…" />
        <StateBlock v-else-if="error" kind="error" title="专家清单没有加载出来，暂时不能打开">
          <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
        </StateBlock>
        <StateBlock v-else-if="!selected" kind="forbidden" title="这位专家不在专家库中">
          链接可能已过期。专家清单已是最新。
          <template #actions><button type="button" class="btn" @click="openPane({})">回到专家清单</button></template>
        </StateBlock>
        <ExpertObject v-else :key="selected.id" :expert="selected" :options="options" :reload="load" />
      </MasterDetail>
    </OperationsShell>
  </div>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: 6px;
}
</style>
