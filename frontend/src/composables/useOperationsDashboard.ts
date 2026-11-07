import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { schoolDashboard, platformDashboard, type Dashboard, type StatusFilter } from '@/api/dashboard'
import type { useTimeScope } from './useTimeScope'

export function useOperationsDashboard(platform: boolean, timeScope: ReturnType<typeof useTimeScope>) {
  const route = useRoute(), router = useRouter()
  const data = ref<Dashboard | null>(null), error = ref(''), loading = ref(false)
  const listCount = ref<number | null>(null), listAsOf = ref(''), expected = ref<number | null>(null)
  const status = computed<StatusFilter>(() => ['WAITING', 'INVITED', 'IN_REVIEW', 'SUBMITTED'].includes(String(route.query.status_filter)) ? route.query.status_filter as StatusFilter : 'ALL')
  const keys = { WAITING: 'waiting_theses', INVITED: 'invited_tasks', IN_REVIEW: 'in_review_tasks', SUBMITTED: 'submitted_tasks' } as const
  const changed = computed(() => listCount.value !== null && expected.value !== null && listCount.value !== expected.value)
  let generation = 0
  async function load() {
    const request = ++generation
    data.value = null; error.value = ''; loading.value = true; expected.value = null
    try {
      const result = await (platform ? platformDashboard : schoolDashboard)(timeScope.scope.value)
      if (request !== generation) return
      data.value = result
      if (status.value !== 'ALL') expected.value = result.cards[keys[status.value]]
    } catch (err) {
      if (request === generation) error.value = err instanceof Error ? err.message : '指标加载失败'
    } finally { if (request === generation) loading.value = false }
  }
  async function drill(value: StatusFilter) {
    expected.value = value === 'ALL' ? null : data.value?.cards[keys[value]] ?? null
    await router.push({ query: { ...route.query, time_scope: timeScope.scope.value, status_filter: value } })
  }
  function resetList() { listCount.value = null; listAsOf.value = '' }
  function receiveList(count: number, asOf: string) { listCount.value = count; listAsOf.value = asOf }
  onBeforeUnmount(() => generation++)
  return { data, error, loading, status, changed, listCount, listAsOf, load, drill, resetList, receiveList }
}
