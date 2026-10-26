import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useAuthStore } from '@/stores/auth'

export interface ColumnSpec {
  id: string
  label: string
  required: boolean
  defaultVisible: boolean
}
export interface ColumnIdentity { id: string; role: string; tenantId?: string | null }

export function normalizeColumns(savedOrder: string[], columns: ColumnSpec[]): { order: string[] } {
  const allowed = new Set(columns.map(column => column.id))
  const order = [...new Set([...savedOrder, ...allowed])].filter(id => allowed.has(id) && id !== 'actions')
  if (allowed.has('actions')) order.push('actions')
  return { order }
}

export function useColumnPreferences(
  tableId: string,
  schemaVersion: number,
  allowedColumns: MaybeRefOrGetter<ColumnSpec[]>,
  identity?: MaybeRefOrGetter<ColumnIdentity | null>,
) {
  const user = identity ?? (() => useAuthStore().user)
  const columns = computed(() => toValue(allowedColumns))
  const storageKey = computed(() => {
    const current = toValue(user)
    return current ? `columns:v1:${current.id}:${current.role}:${current.tenantId || 'platform'}:${tableId}` : null
  })
  const order = ref<string[]>([])
  const visibleIds = ref<string[]>([])
  const storageError = ref(false)
  function defaults() {
    order.value = normalizeColumns([], columns.value).order
    visibleIds.value = columns.value.filter(c => c.required || c.defaultVisible || c.id === 'actions').map(c => c.id)
    ensureBusinessColumn()
  }
  function ensureBusinessColumn() {
    if (!columns.value.some(c => c.id !== 'actions' && visibleIds.value.includes(c.id))) {
      const first = columns.value.find(c => c.id !== 'actions')
      if (first) visibleIds.value.push(first.id)
    }
  }
  watch([storageKey, columns], () => {
    defaults()
    storageError.value = false
    if (!storageKey.value) return
    try {
      const raw = localStorage.getItem(storageKey.value)
      if (!raw) return
      const saved = JSON.parse(raw)
      if (!saved || !Number.isInteger(saved.schemaVersion) || !Array.isArray(saved.order) || !Array.isArray(saved.visibleIds)
        || !saved.order.every((id: unknown) => typeof id === 'string') || !saved.visibleIds.every((id: unknown) => typeof id === 'string')) return
      order.value = normalizeColumns(saved.order, columns.value).order
      visibleIds.value = columns.value.filter(c => c.required || c.id === 'actions' || saved.visibleIds.includes(c.id)
        || (!saved.order.includes(c.id) && c.defaultVisible)).map(c => c.id)
      ensureBusinessColumn()
    } catch { storageError.value = true }
  }, { immediate: true, flush: 'sync' })
  const orderedColumns = computed(() => order.value.map(id => columns.value.find(c => c.id === id)!).filter(Boolean))
  const visibleColumns = computed(() => orderedColumns.value.filter(c => visibleIds.value.includes(c.id)))
  function persist() {
    if (!storageKey.value) return
    try {
      localStorage.setItem(storageKey.value, JSON.stringify({ schemaVersion, order: order.value, visibleIds: visibleIds.value }))
      storageError.value = false
    } catch { storageError.value = true }
  }
  function setVisible(id: string, visible: boolean) {
    const column = columns.value.find(c => c.id === id)
    if (!column || column.required || id === 'actions') return
    if (!visible && id !== 'actions' && visibleColumns.value.filter(c => c.id !== 'actions').length <= 1) return
    visibleIds.value = visible ? [...new Set([...visibleIds.value, id])] : visibleIds.value.filter(value => value !== id)
    persist()
  }
  function move(id: string, target: number) {
    const from = order.value.indexOf(id)
    if (from < 0 || id === 'actions' || !Number.isFinite(target)) return
    const next = [...order.value]
    next.splice(from, 1)
    next.splice(Math.max(0, Math.min(Math.trunc(target), next.filter(value => value !== 'actions').length)), 0, id)
    order.value = next
    persist()
  }
  function reset() {
    defaults()
    storageError.value = false
    try { if (storageKey.value) localStorage.removeItem(storageKey.value) } catch { storageError.value = true }
  }
  return { orderedColumns, visibleColumns, storageError, setVisible, move, reset }
}
