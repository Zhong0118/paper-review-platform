import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { TimeScope, TimeScopeMeta, TimeScopeReporter } from '@/api/timeScope'
const valid = (value: unknown): TimeScope => value === 'past_year' ? 'past_year' : 'all'
export function useTimeScope() {
  const route = useRoute(), router = useRouter(), auth = useAuthStore()
  const key = computed(() => auth.user ? `time-scope:v1:${auth.user.id}:${auth.user.role}:${auth.user.tenantId || 'platform'}` : null)
  const scope = ref<TimeScope>('all'), meta = ref<TimeScopeMeta | null>(null)
  let epoch = 0, initialized = false
  function preference(): TimeScope {
    try { return valid(key.value ? localStorage.getItem(key.value) : null) } catch { return 'all' }
  }
  function remember(value: TimeScope) {
    try { if (key.value) localStorage.setItem(key.value, value) } catch { /* choice still works without storage */ }
  }
  function syncUrl(value: TimeScope) {
    if (route.query.time_scope !== value) void router.replace({ query: { ...route.query, time_scope: value } })
  }
  watch(key, () => {
    epoch++; meta.value = null
    scope.value = key.value ? (!initialized && route.query.time_scope !== undefined ? valid(route.query.time_scope) : preference()) : 'all'
    if (initialized && key.value) syncUrl(scope.value)
    initialized = true
  }, { immediate: true, flush: 'sync' })
  watch(() => route.query.time_scope, value => {
    if (!key.value) return
    scope.value = value === undefined ? preference() : valid(value)
    remember(scope.value)
  })
  watch(scope, () => { epoch++; meta.value = null }, { flush: 'sync' })
  function setScope(value: string) {
    scope.value = valid(value); remember(scope.value); syncUrl(scope.value)
  }
  function request(): [TimeScope, TimeScopeReporter] {
    const own = ++epoch, identity = key.value, selected = scope.value
    meta.value = null
    return [selected, result => {
      if (own === epoch && identity === key.value && selected === scope.value && result.scope === selected) meta.value = result
    }]
  }
  return { scope, meta, identity: key, setScope, request }
}
