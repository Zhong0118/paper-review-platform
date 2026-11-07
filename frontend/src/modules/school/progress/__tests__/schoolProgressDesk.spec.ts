/**
 * R3-1 学校评审进度（U4 计划 §19.2）：真实模式新页。断言沿用 dashboardMetrics / realProgress.wiring 的真实模式用例：
 * 指标单位、分布、下钻、失败分开重试、晚到丢弃、已选再点刷新、不含专家身份。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'

import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({ schoolProgressList: vi.fn() }))
const metrics = vi.hoisted(() => ({ schoolDashboard: vi.fn(), platformDashboard: vi.fn() }))
vi.mock('@/api/dispatch', () => api)
vi.mock('@/api/dashboard', () => metrics)
enableAutoUnmount(afterEach)

const summary = () => ({ as_of: '2026-10-26T04:00:00Z', time_scope: 'all', time_from: null, cards: { waiting_theses: 2, invited_tasks: 1, in_review_tasks: 1, submitted_tasks: 4, overdue_tasks: null }, overdue_status: 'NOT_CONFIGURED', published_count: 4, published_score_bands: [{ code: '0-59', count: 1 }, { code: '60-79', count: 2 }, { code: '80-100', count: 1 }] })
const row = (name: string, status = 'IN_REVIEW') => ({ thesis_id: name, title: name, student_name: '学生甲', stage: 'UNDER_REVIEW', round_status: 'ACTIVE', invited_count: 0, in_review_count: 1, submitted_count: 0, rejected_count: 0, tasks: [{ alias: 'T-001', status }] })
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'false'); localStorage.clear(); sessionStorage.clear()
  metrics.schoolDashboard.mockResolvedValue(summary())
  api.schoolProgressList.mockImplementation(async (_scope, _report, status = 'ALL') => ({ as_of: '2026-10-26T04:01:00Z', filtered_count: status === 'IN_REVIEW' ? 1 : 2, totals: { waiting: 2, reviewing: 2, completed: 4, overdue: null }, items: status === 'IN_REVIEW' ? [row('在评论文')] : [row('在评论文'), row('邀请论文', 'INVITED')] }))
})
afterEach(() => vi.unstubAllEnvs())

async function page(tenantCode = 'school-a') {
  const { default: Page } = await import('../SchoolProgressDesk.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'reviewer', role: 'school_reviewer', displayName: '验收人员', tenantId: 'school-a', tenantCode })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/school/progress'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router] } })
  await flushPromises(); return { wrapper, router }
}

it('renders units, real score bands, denominator and unconfigured overdue', async () => {
  const { wrapper } = await page()
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).toContain('2')
  expect(wrapper.get('[data-dashboard-card="invited_tasks"]').text()).toContain('邀请中任务')
  expect(wrapper.text()).toContain('当前范围无已配置截止的活动任务，暂不统计')
  expect(wrapper.get('[data-score-distribution]').text()).toContain('已发布论文 4 篇')
  expect(wrapper.findAll('[data-score-band]').map((x) => x.attributes('data-score-band'))).toEqual(['0-59', '60-79', '80-100'])
  expect(wrapper.text()).toContain('2026')
  expect(wrapper.text()).toContain('当前 2 篇论文')
})

it('lists theses with task aliases and no expert identity', async () => {
  const { wrapper } = await page()
  const rows = wrapper.findAll('[data-progress-row]')
  expect(rows).toHaveLength(2)
  expect(rows[0]!.text()).toContain('在评论文')
  expect(rows[0]!.text()).toContain('学生甲')
  expect(rows[0]!.text()).toContain('送审中')
  expect(rows[0]!.text()).toContain('T-001')
  expect(rows[0]!.text()).toContain('评阅中')
  expect(rows[1]!.text()).toContain('待接受')
  expect(wrapper.text()).not.toMatch(/专家姓名|expert_id/)
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
  expect(wrapper.text()).toContain('当前 0 个任务')
  expect(wrapper.get('[data-dashboard-card="in_review_tasks"]').attributes('aria-pressed')).toBe('true')
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
  metrics.schoolDashboard.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  metrics.schoolDashboard.mockResolvedValueOnce({ ...summary(), cards: { ...summary().cards, waiting_theses: 7 } })
  await wrapper.get('[data-time-scope]').setValue('all'); await flushPromises()
  finish({ ...summary(), cards: { ...summary().cards, waiting_theses: 99 } }); await flushPromises()
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).toContain('7')
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).not.toContain('99')
})

it('refreshes an already selected card after tasks have changed', async () => {
  const { wrapper } = await page()
  await wrapper.get('[data-dashboard-card="in_review_tasks"]').trigger('click'); await flushPromises()
  api.schoolProgressList.mockResolvedValueOnce({ as_of: '2026-10-26T04:03:00Z', filtered_count: 0, totals: {}, items: [] })
  await wrapper.get('[data-dashboard-card="in_review_tasks"]').trigger('click'); await flushPromises()
  expect(wrapper.findAll('[data-progress-row]')).toHaveLength(0)
  expect(wrapper.text()).toContain('数据已更新')
})

it('shows a list failure in place with a reload, separate from the metrics', async () => {
  api.schoolProgressList.mockRejectedValueOnce(new Error('列表网络故障'))
  const { wrapper } = await page()
  expect(wrapper.get('[role="alert"]').text()).toContain('列表网络故障')
  expect(wrapper.get('[data-dashboard-card="waiting_theses"]').text()).toContain('2')
  await wrapper.get('[data-action="reload-list"]').trigger('click'); await flushPromises()
  expect(wrapper.findAll('[data-progress-row]')).toHaveLength(2)
})

it('shows the current tenant code, never the demo school', async () => {
  const { wrapper } = await page('HYU')
  expect(wrapper.get('[data-workspace]').text()).toContain('HYU')
  expect(wrapper.text()).not.toContain('海岳大学')
})
