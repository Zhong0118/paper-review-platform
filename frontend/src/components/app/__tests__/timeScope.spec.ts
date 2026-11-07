import { afterEach, beforeEach, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
enableAutoUnmount(afterEach)
beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
async function setup(url = '/student/dashboard') {
  const { useTimeScope } = await import('@/composables/useTimeScope')
  const { default: Select } = await import('@/components/app/TimeScopeSelect.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setSession('synthetic-token', { id: 'student-a', role: 'student', displayName: '测试学生', tenantId: 'school-a' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push(url); await router.isReady()
  let scope!: ReturnType<typeof useTimeScope>
  const Harness = defineComponent({ setup() { scope = useTimeScope(); return () => h(Select, { modelValue: scope.scope.value, meta: scope.meta.value, 'onUpdate:modelValue': scope.setScope }) } })
  const wrapper = mount(Harness, { global: { plugins: [pinia, router] } })
  await flushPromises()
  return { wrapper, scope, auth, router, pinia, Harness }
}
it('keeps URL priority, persists personal choice and restores on refresh', async () => {
  localStorage.setItem('time-scope:v1:student-a:student:school-a', 'past_year')
  const { wrapper, scope, router, pinia, Harness } = await setup('/student/dashboard?time_scope=all&filter=ready')
  expect(scope.scope.value).toBe('all')
  await wrapper.get('select').setValue('past_year'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ time_scope: 'past_year', filter: 'ready' })
  expect(localStorage.getItem('time-scope:v1:student-a:student:school-a')).toBe('past_year')
  expect(wrapper.text()).toContain('较早建立论文的未结任务可能未显示')
  wrapper.unmount()
  const refreshed = mount(Harness, { global: { plugins: [pinia, router] } }); await flushPromises()
  expect(refreshed.get('select').element.value).toBe('past_year')
})
it('uses each identity preference and clears in-memory state on logout', async () => {
  const { scope, auth, router } = await setup()
  scope.setScope('past_year'); await flushPromises()
  auth.setSession('other-synthetic', { id: 'expert-b', role: 'expert', displayName: '测试专家', tenantId: null }); await flushPromises()
  expect(scope.scope.value).toBe('all')
  expect(router.currentRoute.value.query.time_scope).toBe('all')
  scope.setScope('past_year'); await flushPromises()
  expect(localStorage.getItem('time-scope:v1:expert-b:expert:platform')).toBe('past_year')
  auth.clearSession(); await flushPromises()
  expect(scope.scope.value).toBe('all'); expect(scope.meta.value).toBeNull()
})
it('falls back from an unknown URL value and ignores stale response metadata', async () => {
  const { scope, wrapper } = await setup('/student/dashboard?time_scope=unknown')
  expect(scope.scope.value).toBe('all')
  const [,old] = scope.request()
  scope.setScope('past_year'); await flushPromises()
  const [,fresh] = scope.request()
  fresh({ scope: 'past_year', from: '2025-10-12T16:00:00+00:00', asOf: '2026-10-13T04:00:00+00:00' })
  old({ scope: 'all', from: '', asOf: '2026-10-13T03:00:00+00:00' })
  await flushPromises()
  expect(scope.meta.value?.scope).toBe('past_year')
  expect(wrapper.text()).toContain('2025-10-13')
  expect(wrapper.text()).toContain('论文创建日')
})
