import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), getReviewRules: vi.fn(), getReviewDraft: vi.fn(), getReviewResult: vi.fn(), getMaterials: vi.fn(), getFileContent: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
vi.mock('@/api/review', () => api)
vi.mock('@/api/files', () => api)

import ReviewWorkspacePage from '../pages/ReviewWorkspacePage.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import ScoreDimensionInput from '../components/ScoreDimensionInput.vue'

const rule = {
  version: 'pilot-single-v1', required_experts: 1, mode: 'sum_dimensions',
  dimensions: [
    { key: 'topicValue', label: '选题价值', max_score: 15 },
    { key: 'literatureTheory', label: '文献与理论基础', max_score: 15 },
    { key: 'methodology', label: '研究方法', max_score: 20 },
    { key: 'innovation', label: '创新性', max_score: 25 },
    { key: 'writingStandards', label: '写作与学术规范', max_score: 10 },
    { key: 'resultsWorkload', label: '研究成果与工作量', max_score: 15 },
  ],
  bands: [],
}

async function page() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/expert/review', component: ReviewWorkspacePage }] })
  await router.push('/expert/review?task_id=a')
  const wrapper = mount(ReviewWorkspacePage, { global: {
    plugins: [createPinia(), router],
    stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' }, RealAnonymousDocumentPane: true },
  } })
  await flushPromises()
  return { wrapper, router }
}

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  api.listExpertTasks.mockResolvedValue([
    { id: 'a', status: 'IN_REVIEW', anonymous_title: '论文甲', allowed_actions: ['CONTINUE_REVIEW'] },
    { id: 'b', status: 'IN_REVIEW', anonymous_title: '论文乙', allowed_actions: ['CONTINUE_REVIEW'] },
  ])
  api.getReviewDraft.mockResolvedValue({ revision: 0 })
  api.getReviewResult.mockResolvedValue({})
  api.getReviewRules.mockResolvedValue(rule)
  api.getMaterials.mockResolvedValue({ task_id: 'a', files: [] })
})

it('renders the server rule version and dimensions, not the demo labels', async () => {
  const { wrapper } = await page()
  expect(api.getReviewRules).toHaveBeenCalledWith('a')
  expect(wrapper.text()).toContain('pilot-single-v1')
  expect(wrapper.text()).toContain('研究方法')
  expect(wrapper.findAllComponents(ScoreDimensionInput)).toHaveLength(6)
})

it('keeps the form unavailable when rules fail instead of showing demo scores', async () => {
  api.getReviewRules.mockRejectedValue(new Error('规则加载失败'))
  const { wrapper } = await page()
  expect(wrapper.get('[role="alert"]').text()).toContain('规则加载失败')
  expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(false)
})

it('retries the selected task rules after a load failure', async () => {
  api.getReviewRules.mockRejectedValueOnce(new Error('规则加载失败')).mockResolvedValueOnce(rule)
  const { wrapper } = await page()
  expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(false)
  await wrapper.get('[data-action="retry-review-rules"]').trigger('click')
  await flushPromises()
  expect(api.getReviewRules).toHaveBeenCalledTimes(2)
  expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(true)
})

it('discards a late rule response after switching tasks', async () => {
  let resolveOld!: (value: typeof rule) => void
  api.getReviewRules.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve })).mockResolvedValue(rule)
  const { wrapper, router } = await page()
  await router.push('/expert/review?task_id=b')
  await flushPromises()
  resolveOld({ ...rule, version: 'stale-v0' })
  await flushPromises()
  expect(wrapper.text()).toContain('论文乙')
  expect(wrapper.text()).not.toContain('stale-v0')
  expect(api.getReviewRules).toHaveBeenCalledWith('b')
})
