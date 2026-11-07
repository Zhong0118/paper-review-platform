/**
 * 全站比较表的统一特性（TanStack Table v9，shadcn-vue data-table 指南同一写法）：排序＋列显示。
 * 没有服务端分页时不注册分页；没有批量命令时不注册选择列。
 */
import {
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
} from '@tanstack/vue-table'

export const appTableFeatures = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic },
  columnMeta: {} as { align?: 'left' | 'right'; width?: string; label?: string },
})
export type AppTableFeatures = typeof appTableFeatures
