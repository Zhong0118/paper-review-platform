<script setup lang="ts">
/**
 * R1 样板一：专家库（data 模板，v3 §9.2）。满宽比较表＋工作视图＋搜索与筛选＋已选条件＋显示设置＋档案预览。
 * 数据为虚构 fixtures；筛选逻辑在本页完成，与真实专家库“一次读取全部、本地过滤”的做法一致。
 */
import { Columns3, Plus, Upload } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { ExpertRecord } from '@/api/expertOperations'
import ComboFilter from '@/components/app/data/ComboFilter.vue'
import FilterBar, { type FilterChip } from '@/components/app/data/FilterBar.vue'
import SearchField from '@/components/app/data/SearchField.vue'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import StatePanel from '@/components/app/state/StatePanel.vue'
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
import ExpertPreview from '@/modules/expert-management/library/ExpertPreview.vue'
import ExpertTable from '@/modules/expert-management/library/ExpertTable.vue'
import { bucket } from '@/modules/expert-management/library/expertView'

import { experts as allExperts, options, sampleAccounts } from './fixtures'
import { protoNav } from './protoNav'
import SampleControls from './SampleControls.vue'

const router = useRouter()
const sample = ref('normal')
const rows = computed<ExpertRecord[]>(() => (sample.value === 'empty' ? [] : allExperts))

const view = ref('all')
const q = ref('')
const discipline = ref<string | null>(null)
const province = ref<string | null>(null)
const title = ref('all')

const viewCounts = computed(() => {
  const counts = { all: rows.value.length, ready: 0, pending: 0, blocked: 0 }
  for (const row of rows.value) counts[bucket(row)]++
  return counts
})
const views = computed(() => [
  { value: 'all', label: '全部', count: viewCounts.value.all },
  { value: 'ready', label: '可指派', count: viewCounts.value.ready },
  { value: 'pending', label: '待审核', count: viewCounts.value.pending },
  { value: 'blocked', label: '暂不可派', count: viewCounts.value.blocked },
])

const needle = computed(() => q.value.trim().toLowerCase())
const filtered = computed(() =>
  rows.value.filter((row) => {
    if (view.value !== 'all' && bucket(row) !== view.value) return false
    if (discipline.value && !row.discipline_codes.includes(discipline.value)) return false
    if (province.value && row.province_name !== province.value) return false
    if (title.value !== 'all' && row.title !== title.value) return false
    if (!needle.value) return true
    return [row.display_name, row.username, row.unit, ...row.research_directions, ...row.keywords].some((text) => text.toLowerCase().includes(needle.value))
  }),
)

const disciplineOptions = options.disciplines.map((d) => ({ value: d.code, label: d.name, hint: d.code }))
const provinceOptions = options.provinces.map((p) => ({ value: p, label: p }))
const chips = computed<FilterChip[]>(() =>
  [
    discipline.value && { key: 'discipline', label: `学科：${options.disciplines.find((d) => d.code === discipline.value)?.name}` },
    province.value && { key: 'province', label: `省份：${province.value}` },
    title.value !== 'all' && { key: 'title', label: `职称：${title.value}` },
  ].filter(Boolean) as FilterChip[],
)
function removeChip(key: string) {
  if (key === 'discipline') discipline.value = null
  if (key === 'province') province.value = null
  if (key === 'title') title.value = 'all'
}
function clearAll() {
  discipline.value = null
  province.value = null
  title.value = 'all'
  q.value = ''
}

const COLUMNS = [
  { id: 'unit', label: '单位' },
  { id: 'title', label: '职称' },
  { id: 'disciplines', label: '学科' },
  { id: 'province', label: '省份' },
  { id: 'supervisor', label: '导师资格' },
  { id: 'status', label: '状态' },
  { id: 'conflicts', label: '回避数' },
]
const visibility = ref<Record<string, boolean>>({ province: true, supervisor: true })
const shown = (id: string) => visibility.value[id] !== false

const selected = ref<ExpertRecord | null>(null)
const previewOpen = ref(false)
function preview(row: ExpertRecord) {
  selected.value = row
  previewOpen.value = true
}
function openFull(row: ExpertRecord) {
  router.push(`/prototype/r1/experts/${row.id}`)
}

const shell = sampleAccounts.platform_reviewer!
const nav = protoNav('platform_reviewer', '/platform/experts')
</script>

<template>
  <AppShell :nav="nav" :account="shell.account" :workspace="shell.workspace" title="专家库" layout="data">
    <template #context>评审专家档案、资格与接单状态</template>
    <template #actions>
      <Button variant="outline" size="sm" data-action="import"><Upload />导入档案</Button>
      <Button size="sm" data-action="create"><Plus />新建专家</Button>
    </template>

    <div class="grid gap-4">
      <FilterBar :chips="chips" @remove="removeChip" @clear="clearAll">
        <template #views>
          <ViewTabs v-model="view" :views="sample === 'loading' || sample === 'error' ? views.map((v) => ({ ...v, count: undefined })) : views" label="专家视图" />
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
          <SearchField v-model="q" label="搜索专家" placeholder="姓名、账号、单位、方向" />
        </template>
        <template #filters>
          <ComboFilter v-model="discipline" label="学科" :options="disciplineOptions" search-placeholder="搜索学科名称或代码" />
          <Select v-model="title">
            <SelectTrigger class="w-[140px]" aria-label="职称"><SelectValue placeholder="职称" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部职称</SelectItem>
              <SelectItem v-for="t in options.titles" :key="t" :value="t">{{ t }}</SelectItem>
            </SelectContent>
          </Select>
          <ComboFilter v-model="province" label="省份" :options="provinceOptions" width="w-[140px]" search-placeholder="搜索省份" />
        </template>
      </FilterBar>

      <div v-if="sample === 'loading'" class="grid gap-px overflow-hidden rounded-lg border" aria-busy="true">
        <StatePanel kind="loading" title="正在读取专家库…" compact />
        <Skeleton v-for="n in 6" :key="n" class="h-11 rounded-none" />
      </div>
      <div v-else-if="sample === 'error'" class="rounded-lg border">
        <StatePanel kind="error" title="专家库没有加载出来">
          服务暂时不可用（样板）。这不是“没有专家”，重试后会重新读取。
          <template #actions><Button variant="outline" @click="sample = 'normal'">重试</Button></template>
        </StatePanel>
      </div>
      <template v-else>
        <ExpertTable :rows="filtered" :options="options" :selected-id="previewOpen ? selected?.id : null" :visibility="visibility" @preview="preview" @open="openFull">
          <template #empty>
            <StatePanel v-if="!rows.length" kind="empty" title="专家库还没有档案" compact>
              新建专家，或用 CSV 批量更新已有专家的档案。
              <template #actions><Button size="sm"><Plus />新建专家</Button></template>
            </StatePanel>
            <StatePanel v-else kind="noresult" title="没有符合条件的专家" compact>
              当前视图与筛选下没有专家。
              <template #actions><Button variant="outline" size="sm" @click="clearAll(); view = 'all'">清除筛选并显示全部</Button></template>
            </StatePanel>
          </template>
        </ExpertTable>
        <p v-if="rows.length" class="tabular text-sm text-muted-foreground" data-count>
          显示 {{ filtered.length }} / {{ rows.length }} 位专家。专家库一次读取全部档案，筛选在本页完成。
        </p>
      </template>
    </div>

    <ExpertPreview v-model:open="previewOpen" :expert="selected" :options="options" @open-full="openFull" />
    <SampleControls
      v-model="sample"
      :states="[{ value: 'normal', label: '正常' }, { value: 'loading', label: '加载中' }, { value: 'empty', label: '空库' }, { value: 'error', label: '加载失败' }]"
    />
  </AppShell>
</template>
