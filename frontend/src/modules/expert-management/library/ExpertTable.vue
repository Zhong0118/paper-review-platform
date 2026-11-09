<script setup lang="ts">
/**
 * R1 专家库比较表（v3 §9.2）：横向比较单位、职称、学科、导师资格、状态与回避。
 * 只展示接口给出的字段；整行或姓名打开预览，“档案”进入完整档案。排序与列显示由表格自己持有。
 * 展示组件：不调接口，供 R1 样板与 R3 真实专家库共用。
 */
import { createColumnHelper, useTable } from '@tanstack/vue-table'
import { computed, h } from 'vue'

import type { ExpertOptions, ExpertRecord } from '@/api/expertOperations'
import DataTableShell from '@/components/app/data/DataTableShell.vue'
import StatusBadge from '@/components/app/data/StatusBadge.vue'
import { appTableFeatures, type AppTableFeatures } from '@/components/app/data/tableFeatures'
import { Button } from '@/components/ui/button'

import { rowPill } from './expertView'

const props = defineProps<{ rows: ExpertRecord[]; options: ExpertOptions; selectedId?: string | null; visibility: Record<string, boolean> }>()
const emit = defineEmits<{ preview: [row: ExpertRecord]; open: [row: ExpertRecord] }>()

const disciplineName = computed(() => new Map(props.options.disciplines.map((d) => [d.code, d.name])))
/** P1-2：表格里所有空值都写成浅色“—”；博导 / 硕导两项都未知时只写一个“—” */
const dash = () => h('span', { class: 'text-faint' }, '—')
const yesNo = (value: boolean | null) => (value === null ? '—' : value ? '是' : '否')
const TONE = { action: 'brand', neutral: 'neutral', warning: 'warning' } as const

const col = createColumnHelper<AppTableFeatures, ExpertRecord>()
const columns = col.columns([
  col.accessor('display_name', {
    header: '姓名',
    sortFn: 'text',
    enableHiding: false,
    meta: { width: '15%' },
    cell: ({ row }) =>
      h('div', { class: 'grid min-w-0' }, [
        h('button', { type: 'button', class: 'truncate text-left font-medium hover:underline focus-visible:underline', 'data-preview': row.original.id, onClick: () => emit('preview', row.original) }, row.original.display_name),
        h('span', { class: 'tabular truncate text-xs text-muted-foreground' }, row.original.username),
      ]),
  }),
  col.accessor('unit', {
    header: '单位',
    sortFn: 'text',
    meta: { width: '24%', label: '单位' },
    cell: ({ row }) => h('span', { class: 'line-clamp-2 whitespace-normal', title: row.original.unit }, row.original.unit || dash()),
  }),
  col.accessor('title', { header: '职称', sortFn: 'text', meta: { width: '9%', label: '职称' }, cell: ({ row }) => row.original.title || dash() }),
  col.accessor((row) => row.discipline_codes.map((code) => disciplineName.value.get(code) ?? code).join('、'), {
    id: 'disciplines',
    header: '学科',
    enableSorting: false,
    meta: { width: '20%', label: '学科' },
    cell: ({ getValue }) => h('span', { class: 'line-clamp-2 whitespace-normal', title: getValue() }, getValue() || dash()),
  }),
  col.accessor((row) => row.province_name ?? '', { id: 'province', header: '省份', sortFn: 'text', meta: { width: '8%', label: '省份' }, cell: ({ getValue }) => getValue() || dash() }),
  col.display({
    id: 'supervisor',
    header: '博导 / 硕导',
    meta: { width: '9%', label: '导师资格' },
    cell: ({ row }) => {
      const { doctoral_supervisor: doctoral, masters_supervisor: masters } = row.original
      return doctoral === null && masters === null ? dash() : h('span', { class: 'text-sm' }, `${yesNo(doctoral)} / ${yesNo(masters)}`)
    },
  }),
  col.display({
    id: 'status',
    header: '状态',
    meta: { width: '9%', label: '状态' },
    cell: ({ row }) => {
      const pill = rowPill(row.original)
      return pill ? h(StatusBadge, { tone: TONE[pill.tone] }, () => pill.text) : h('span', { class: 'text-sm text-muted-foreground' }, '可指派')
    },
  }),
  col.accessor((row) => row.conflicts.length, {
    id: 'conflicts',
    header: '回避',
    sortFn: 'basic',
    meta: { width: '6%', align: 'right', label: '回避数' },
    cell: ({ getValue }) => h('span', { class: 'tabular' }, getValue() ? String(getValue()) : dash()),
  }),
  col.display({
    id: 'actions',
    header: () => h('span', { class: 'sr-only' }, '操作'),
    enableHiding: false,
    meta: { width: '72px', align: 'right' },
    cell: ({ row }) => h(Button, { variant: 'ghost', size: 'sm', class: 'text-primary', 'data-open': row.original.id, onClick: () => emit('open', row.original) }, () => '档案'),
  }),
])

const table = useTable({
  features: appTableFeatures,
  columns,
  get data() {
    return props.rows
  },
  state: {
    get columnVisibility() {
      return props.visibility
    },
  },
  getRowId: (row: ExpertRecord) => row.id,
})
defineExpose({ table })
</script>

<template>
  <DataTableShell :table="table" :selected-id="selectedId" :row-id="(row: ExpertRecord) => row.id" caption="专家列表" @preview="emit('preview', $event)">
    <template #empty><slot name="empty" /></template>
  </DataTableShell>
</template>
