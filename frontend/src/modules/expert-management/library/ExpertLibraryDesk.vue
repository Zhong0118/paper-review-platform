<script setup lang="ts">
/**
 * 专家库（真实模式，P13；R3-2 起按 R1 样板一，U4 计划 §19.4）。
 * - 清单页（data）：满宽比较表＋工作视图＋搜索与筛选＋已选条件＋显示设置；点姓名打开只读预览。
 * - 完整页（?expert= / ?new=1 / ?import=1）：专家档案、新建专家、导入档案；返回时保留视图与筛选。
 * 一次取全部专家，在已加载范围内搜索与筛选（列表接口的筛选是整标签精确匹配）。
 * 地址：?view= &q= &discipline= &title= &province= &expert= &new=1 &import=1。demo 模式仍是旧 ExpertLibraryPage（见 router/routes.ts）。
 */
import { ChevronLeft, Columns3, Plus, Upload } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { expertOptions, listExperts, type ExpertOptions, type ExpertRecord } from '@/api/expertOperations'
import { apiFailure } from '@/api/failure'
import ComboFilter from '@/components/app/data/ComboFilter.vue'
import FilterBar, { type FilterChip } from '@/components/app/data/FilterBar.vue'
import SearchField from '@/components/app/data/SearchField.vue'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import ExpertCreate from './ExpertCreate.vue'
import ExpertImportPane from './ExpertImportPane.vue'
import ExpertObject from './ExpertObject.vue'
import ExpertPreview from './ExpertPreview.vue'
import ExpertTable from './ExpertTable.vue'
import { bucket, type ExpertView } from './expertView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const signOut = useSignOut()

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

// ---- 地址状态 ----
type ViewKey = ExpertView | 'all'
const VIEW_LABELS: Record<ViewKey, string> = { all: '全部', ready: '可指派', pending: '待审核', blocked: '暂不可派' }
const VIEW_KEYS = Object.keys(VIEW_LABELS) as ViewKey[]
const text = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const view = computed<ViewKey>(() => VIEW_KEYS.find((key) => key === route.query.view) ?? 'all')
const keyword = computed(() => text('q'))
const discipline = computed(() => text('discipline'))
const title = computed(() => text('title'))
const province = computed(() => text('province'))
const expertId = computed(() => text('expert'))
const creating = computed(() => route.query.new === '1')
const importing = computed(() => route.query.import === '1')
const fullPage = computed(() => Boolean(expertId.value) || creating.value || importing.value)

function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}
const openPane = (patch: Record<string, string | undefined>) => setQuery({ expert: undefined, new: undefined, import: undefined, ...patch })
/** 返回清单：只去掉完整页参数，视图与筛选保留 */
const listQuery = computed(() => {
  const { expert: _e, new: _n, import: _i, ...rest } = route.query
  return rest
})

// ---- 清单 ----
const ready = computed(() => !loading.value && !error.value)
const countOf = (key: ViewKey) => (key === 'all' ? experts.value.length : experts.value.filter((row) => bucket(row) === key).length)
const views = computed(() => VIEW_KEYS.map((key) => ({ value: key, label: VIEW_LABELS[key], count: ready.value ? countOf(key) : undefined })))
const filtersActive = computed(() => Boolean(keyword.value.trim() || discipline.value || title.value || province.value))
const list = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return experts.value.filter(
    (row) =>
      (view.value === 'all' || bucket(row) === view.value) &&
      (!discipline.value || row.discipline_codes.includes(discipline.value)) &&
      (!title.value || row.title === title.value) &&
      (!province.value || row.province_name === province.value) &&
      (!needle || [row.display_name, row.username, row.unit, ...row.research_directions, ...row.keywords].join(' ').toLowerCase().includes(needle)),
  )
})
const disciplineName = (code: string) => options.value.disciplines.find((item) => item.code === code)?.name ?? code
/** 学科只列库里出现过的；职称、省份同理，避免选出必然为空的条件 */
const disciplineOptions = computed(() => [...new Set(experts.value.flatMap((row) => row.discipline_codes))].sort().map((code) => ({ value: code, label: disciplineName(code), hint: code })))
const titleOptions = computed(() => [...new Set(experts.value.map((row) => row.title).filter(Boolean))].sort())
const provinceOptions = computed(() => [...new Set(experts.value.map((row) => row.province_name ?? '').filter(Boolean))].sort().map((value) => ({ value, label: value })))
const chips = computed<FilterChip[]>(() =>
  [
    discipline.value && { key: 'discipline', label: `学科：${disciplineName(discipline.value)}` },
    title.value && { key: 'title', label: `职称：${title.value}` },
    province.value && { key: 'province', label: `省份：${province.value}` },
  ].filter(Boolean) as FilterChip[],
)
const clearFilters = () => setQuery({ q: undefined, discipline: undefined, title: undefined, province: undefined })

const COLUMNS = [
  { id: 'unit', label: '单位' },
  { id: 'title', label: '职称' },
  { id: 'disciplines', label: '学科' },
  { id: 'province', label: '省份' },
  { id: 'supervisor', label: '导师资格' },
  { id: 'status', label: '状态' },
  { id: 'conflicts', label: '回避数' },
]
const visibility = ref<Record<string, boolean>>({})
const shown = (id: string) => visibility.value[id] !== false

const previewing = ref<ExpertRecord | null>(null)
const previewOpen = ref(false)
function preview(row: ExpertRecord) {
  previewing.value = row
  previewOpen.value = true
}
function openFull(row: ExpertRecord) {
  previewOpen.value = false
  openPane({ expert: row.id })
}

// ---- 完整页 ----
const selected = computed(() => experts.value.find((row) => row.id === expertId.value) ?? null)
const pageTitle = computed(() => (creating.value ? '新建专家' : importing.value ? '导入档案' : fullPage.value ? '专家档案' : '专家库'))
async function created(expert: ExpertRecord) {
  await load()
  setQuery({ new: undefined, view: 'pending', q: undefined, discipline: undefined, title: undefined, province: undefined, expert: expert.id })
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
    <AppShell :nav="nav" :account="account" :workspace="account.org" :title="pageTitle" :layout="fullPage ? 'bare' : 'data'" @sign-out="signOut">
      <template v-if="fullPage" #back>
        <Button variant="ghost" size="sm" as-child class="-ml-1 text-muted-foreground">
          <RouterLink :to="{ query: listQuery }" data-back><ChevronLeft />专家库</RouterLink>
        </Button>
      </template>
      <template v-else #context>评审专家档案、资格与接单状态</template>
      <template v-if="!fullPage && ready" #actions>
        <Button variant="outline" size="sm" data-action="open-import" @click="openPane({ import: '1' })"><Upload />导入档案</Button>
        <Button size="sm" data-action="new-expert" @click="openPane({ new: '1' })"><Plus />新建专家</Button>
      </template>

      <!-- 完整页：档案 / 新建 / 导入 -->
      <div v-if="fullPage" class="mx-auto w-full max-w-[960px]">
        <ExpertImportPane v-if="importing" @applied="load" />
        <ExpertCreate v-else-if="creating" :options="options" @created="created" @cancel="openPane({})" />
        <StatePanel v-else-if="loading && !selected" kind="loading" title="正在读取专家档案…" />
        <StatePanel v-else-if="error" kind="error" title="专家清单没有加载出来，暂时不能打开">
          {{ error }}
          <template #actions><Button @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!selected" kind="forbidden" title="这位专家不在专家库中">
          链接可能已过期。专家清单已是最新。
          <template #actions><Button variant="outline" as-child><RouterLink :to="{ query: listQuery }">返回专家库</RouterLink></Button></template>
        </StatePanel>
        <ExpertObject v-else :key="selected.id" :expert="selected" :options="options" :reload="load" />
      </div>

      <!-- 清单页 -->
      <div v-else class="grid gap-4">
        <FilterBar :chips="chips" @remove="(key) => setQuery({ [key]: undefined })" @clear="clearFilters">
          <template #views>
            <ViewTabs :model-value="view" :views="views" label="专家视图" @update:model-value="(value) => setQuery({ view: value === 'all' ? undefined : value })" />
          </template>
          <template #display>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="sm" class="text-muted-foreground" data-action="display"><Columns3 />显示</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuLabel class="text-xs font-normal text-muted-foreground">显示的列</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  v-for="c in COLUMNS"
                  :key="c.id"
                  :model-value="shown(c.id)"
                  @update:model-value="(on: boolean) => (visibility = { ...visibility, [c.id]: on })"
                  @select.prevent
                >
                  {{ c.label }}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
          <template #search>
            <SearchField :model-value="keyword" label="搜索专家" placeholder="姓名、账号、单位、方向" @update:model-value="(value) => setQuery({ q: value || undefined })" />
          </template>
          <template #filters>
            <ComboFilter :model-value="discipline || null" label="学科" placeholder="全部学科" :options="disciplineOptions" :disabled="!ready" search-placeholder="搜索学科名称或代码" @update:model-value="(value) => setQuery({ discipline: value ?? undefined })" />
            <Select :model-value="title || 'all'" :disabled="!ready" @update:model-value="(value) => setQuery({ title: value === 'all' ? undefined : String(value) })">
              <SelectTrigger class="w-[140px]" aria-label="职称" data-filter="title"><SelectValue placeholder="职称" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部职称</SelectItem>
                <SelectItem v-for="t in titleOptions" :key="t" :value="t">{{ t }}</SelectItem>
              </SelectContent>
            </Select>
            <ComboFilter :model-value="province || null" label="省份" placeholder="全部省份" :options="provinceOptions" :disabled="!ready" width="w-[140px]" search-placeholder="搜索省份" @update:model-value="(value) => setQuery({ province: value ?? undefined })" />
          </template>
        </FilterBar>

        <div v-if="loading && !experts.length" class="grid gap-px overflow-hidden rounded-lg border" aria-busy="true">
          <StatePanel kind="loading" title="正在读取专家档案…" compact />
          <Skeleton v-for="n in 6" :key="n" class="h-11 rounded-none" />
        </div>
        <div v-else-if="error" class="rounded-lg border bg-background">
          <StatePanel kind="error" title="专家清单没有加载出来">
            {{ error }}。这不是“没有专家”，重试后会重新读取。
            <template #actions><Button variant="outline" @click="load">重试</Button></template>
          </StatePanel>
        </div>
        <div v-else-if="!experts.length" class="rounded-lg border bg-background">
          <StatePanel kind="empty" title="专家库还是空的">
            先新建专家；之后可以按模板导入 CSV 批量更新档案。
            <template #actions><Button @click="openPane({ new: '1' })"><Plus />新建专家</Button></template>
          </StatePanel>
        </div>
        <template v-else>
          <ExpertTable :rows="list" :options="options" :selected-id="previewOpen ? previewing?.id : null" :visibility="visibility" @preview="preview" @open="openFull">
            <template #empty>
              <StatePanel v-if="filtersActive" kind="noresult" title="当前筛选没有匹配的专家" compact>
                <template #actions><Button variant="outline" size="sm" data-action="clear-filters" @click="clearFilters">清除筛选</Button></template>
              </StatePanel>
              <StatePanel v-else kind="empty" title="这个视图里没有专家" compact />
            </template>
          </ExpertTable>
          <p class="text-sm text-muted-foreground" data-count>
            显示 <span class="tabular">{{ list.length }}</span> / <span class="tabular">{{ experts.length }}</span> 位专家。资料为人工维护、未核验；来源说明不代表实名认证。
          </p>
        </template>
      </div>

      <ExpertPreview v-model:open="previewOpen" :expert="previewing" :options="options" @open-full="openFull" />
    </AppShell>
  </div>
</template>
