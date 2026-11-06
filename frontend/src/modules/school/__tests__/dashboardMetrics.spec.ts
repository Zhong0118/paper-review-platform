import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { useAuthStore } from '@/stores/auth'
const api = vi.hoisted(() => ({ schoolProgressList: vi.fn(), dispatchQueue: vi.fn(), dispatchCandidates: vi.fn(), assignExpert: vi.fn(), reassignExpert: vi.fn(), candidateUnavailableReason: vi.fn() }))
const metrics = vi.hoisted(() => ({ schoolDashboard: vi.fn(), platformDashboard: vi.fn() }))
vi.mock('@/api/dispatch', () => api)
vi.mock('@/api/dashboard', () => metrics)
enableAutoUnmount(afterEach)
const summary = () => ({ as_of: '2026-10-26T04:00:00Z', time_scope: 'all', time_from: null, cards: { waiting_theses: 2, invited_tasks: 1, in_review_tasks: 1, submitted_tasks: 4, overdue_tasks: null }, overdue_status: 'NOT_CONFIGURED', published_count: 4, published_score_bands: [{ code: '0-59', count: 1 }, { code: '60-79', count: 2 }, { code: '80-100', count: 1 }] })
const row = (name: string, status = 'IN_REVIEW') => ({ thesis_id: name, title: name, stage: 'UNDER_REVIEW', round_status: 'ACTIVE', waiting: false, invited_count: 0, in_review_count: 1, submitted_count: 0, rejected_count: 0, tasks: [{ alias: 'T-001', status }] })
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'false'); localStorage.clear(); sessionStorage.clear()
  metrics.schoolDashboard.mockResolvedValue(summary())
  metrics.platformDashboard.mockResolvedValue({ ...summary(), published_count: undefined, published_score_bands: undefined })
  api.schoolProgressList.mockImplementation(async (_scope, _report, status = 'ALL') => ({ as_of: '2026-10-26T04:01:00Z', filtered_count: status === 'IN_REVIEW' ? 1 : 2, totals: { waiting: 2, reviewing: 2, completed: 4, overdue: null }, items: status === 'IN_REVIEW' ? [row('在评论文')] : [row('在评论文'), row('邀请论文', 'INVITED')] }))
  api.dispatchQueue.mockResolvedValue([]); api.dispatchCandidates.mockResolvedValue([])
})
afterEach(() => vi.unstubAllEnvs())
// 学校端真实模式用例已随 R3-1 移到 progress/__tests__/schoolProgressDesk.spec.ts（U4 计划 §19.2）；这里只留平台派单台
async function page(platform = false) {
  const Page = platform ? (await import('@/modules/dispatch/pages/DispatchWorkbenchPage.vue')).default : (await import('../pages/ReviewProgressPage.vue')).default
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'reviewer', role: platform ? 'platform_reviewer' : 'school_reviewer', displayName: '验收人员', tenantId: platform ? null : 'school-a' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push(platform ? '/platform/dispatch' : '/school/progress'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router], stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } } } })
  await flushPromises(); return { wrapper, router }
}
it('platform uses operations only and can drill submitted tasks without querying school scores', async () => {
  const { wrapper, router } = await page(true)
  expect(metrics.schoolDashboard).not.toHaveBeenCalled()
  expect(wrapper.find('[data-score-distribution]').exists()).toBe(false)
  await wrapper.get('[data-dashboard-card="submitted_tasks"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.status_filter).toBe('SUBMITTED')
  expect(api.dispatchQueue.mock.calls.at(-1)?.[2]).toBe('SUBMITTED')
})