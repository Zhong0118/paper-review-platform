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
async function page(platform = false) {
  const Page = platform ? (await import('@/modules/dispatch/pages/DispatchWorkbenchPage.vue')).default : (await import('../pages/ReviewProgressPage.vue')).default
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'reviewer', role: platform ? 'platform_reviewer' : 'school_reviewer', displayName: '验收人员', tenantId: platform ? null : 'school-a' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push(platform ? '/platform/dispatch' : '/school/progress'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router], stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } } } })
  await flushPromises(); return { wrapper, router }
}
it('renders units, real score bands, denominator and unconfigured overdue', async () => {
  const { wrapper } = await page()
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).toContain('2')
  expect(wrapper.get('[data-dashboard-card="invited_tasks"]').text()).toContain('邀请中任务')
  expect(wrapper.text()).toContain('当前范围无已配置截止的活动任务，暂不统计')
  expect(wrapper.get('[data-score-distribution]').text()).toContain('已发布论文 4 篇')
  expect(wrapper.findAll('[data-score-band]').map(x => x.attributes('data-score-band'))).toEqual(['0-59', '60-79', '80-100'])
  expect(wrapper.text()).toContain('2026')
})
it('drills into the same range and explicit status with changed-count feedback', async () => {
  const { wrapper, router } = await page()
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  api.schoolProgressList.mockResolvedValueOnce({ as_of: '2026-10-26T04:02:00Z', filtered_count: 0, totals: {}, items: [] })
  await wrapper.get('[data-dashboard-card="in_review_tasks"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ time_scope: 'past_year', status_filter: 'IN_REVIEW' })
  expect(api.schoolProgressList.mock.calls.at(-1)?.[0]).toBe('past_year')
  expect(api.schoolProgressList.mock.calls.at(-1)?.[2]).toBe('IN_REVIEW')
  expect(wrapper.findAll('[data-progress-row]')).toHaveLength(0)
  expect(wrapper.text()).toContain('数据已更新')
  expect(wrapper.text()).toContain('0')
})
it('separates failed metrics from the available list and permits retry', async () => {
  metrics.schoolDashboard.mockRejectedValueOnce(new Error('指标网络故障'))
  const { wrapper } = await page()
  expect(wrapper.text()).toContain('指标网络故障')
  expect(wrapper.text()).toContain('在评论文')
  expect(wrapper.find('[data-dashboard-card]').exists()).toBe(false)
  await wrapper.get('[data-retry-dashboard]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-dashboard-card]').exists()).toBe(true)
})
it('discards a late previous-scope dashboard response', async () => {
  const { wrapper } = await page()
  let finish!: (data: unknown) => void
  metrics.schoolDashboard.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  metrics.schoolDashboard.mockResolvedValueOnce({ ...summary(), cards: { ...summary().cards, waiting_theses: 7 } })
  await wrapper.get('[data-time-scope]').setValue('all'); await flushPromises()
  finish({ ...summary(), cards: { ...summary().cards, waiting_theses: 99 } }); await flushPromises()
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).toContain('7')
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).not.toContain('99')
})
it('platform uses operations only and can drill submitted tasks without querying school scores', async () => {
  const { wrapper, router } = await page(true)
  expect(metrics.schoolDashboard).not.toHaveBeenCalled()
  expect(wrapper.find('[data-score-distribution]').exists()).toBe(false)
  await wrapper.get('[data-dashboard-card="submitted_tasks"]').trigger('click'); await flushPromises()
  expect(router.currentRoute.value.query.status_filter).toBe('SUBMITTED')
  expect(api.dispatchQueue.mock.calls.at(-1)?.[2]).toBe('SUBMITTED')
})
it('refreshes an already selected card after tasks have changed', async () => {
  const { wrapper } = await page()
  await wrapper.get('[data-dashboard-card="in_review_tasks"]').trigger('click'); await flushPromises()
  api.schoolProgressList.mockResolvedValueOnce({ as_of: '2026-10-26T04:03:00Z', filtered_count: 0, totals: {}, items: [] })
  await wrapper.get('[data-dashboard-card="in_review_tasks"]').trigger('click'); await flushPromises()
  expect(wrapper.findAll('[data-progress-row]')).toHaveLength(0)
  expect(wrapper.text()).toContain('数据已更新')
})
