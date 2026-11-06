<script setup lang="ts" generic="T extends RowData">
/**
 * 比较表骨架（v3 §8.2）：@tanstack/vue-table 负责排序与列显示；数据、列与动作由业务表提供。
 * 统一表头、44px 行、数字右对齐、悬停、选中、空态与键盘可达；整行点击是“预览”，行内按钮各自处理并阻止冒泡。
 * 不做虚假分页：数据是全量加载后本地过滤的，底部如实说明。
 */
import type { RowData, Table as TanTable } from '@tanstack/vue-table'
import { FlexRender } from '@tanstack/vue-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from '@lucide/vue'

import type { AppTableFeatures } from './tableFeatures'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const props = defineProps<{ table: TanTable<AppTableFeatures, T>; selectedId?: string | null; rowId: (row: T) => string; caption: string }>()
const emit = defineEmits<{ preview: [row: T] }>()

function onRowClick(event: MouseEvent, row: T) {
  if ((event.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return
  emit('preview', row)
}
const align = (meta?: { align?: string }) => (meta?.align === 'right' ? 'text-right' : '')
const width = (meta?: { width?: string }) => meta?.width
</script>

<template>
  <div class="overflow-x-auto rounded-lg border bg-background" data-table-shell>
    <Table class="min-w-[880px] table-fixed">
      <caption class="sr-only">{{ caption }}</caption>
      <TableHeader class="bg-muted/50">
        <TableRow v-for="group in props.table.getHeaderGroups()" :key="group.id" class="hover:bg-transparent">
          <TableHead
            v-for="header in group.headers"
            :key="header.id"
            :class="align(header.column.columnDef.meta)"
            :style="{ width: width(header.column.columnDef.meta) }"
            :aria-sort="header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined"
          >
            <button
              v-if="header.column.getCanSort()"
              type="button"
              class="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-foreground"
              @click="header.column.toggleSorting()"
            >
              <FlexRender :header="header" />
              <ArrowUp v-if="header.column.getIsSorted() === 'asc'" class="size-3.5" />
              <ArrowDown v-else-if="header.column.getIsSorted() === 'desc'" class="size-3.5" />
              <ChevronsUpDown v-else class="size-3.5 opacity-40" />
            </button>
            <FlexRender v-else :header="header" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in props.table.getRowModel().rows"
          :key="row.id"
          :data-state="selectedId === rowId(row.original) ? 'selected' : undefined"
          class="cursor-pointer"
          :data-row="rowId(row.original)"
          @click="onRowClick($event, row.original)"
        >
          <TableCell v-for="cell in row.getVisibleCells()" :key="cell.id" :class="align(cell.column.columnDef.meta)">
            <FlexRender :cell="cell" />
          </TableCell>
        </TableRow>
        <TableRow v-if="!props.table.getRowModel().rows.length" class="hover:bg-transparent">
          <TableCell :colspan="props.table.getVisibleLeafColumns().length" class="h-auto py-0"><slot name="empty" /></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </div>
</template>
