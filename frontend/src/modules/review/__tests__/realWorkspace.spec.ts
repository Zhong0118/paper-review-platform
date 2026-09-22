import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewWorkspacePage from '../pages/ReviewWorkspacePage.vue'
import ExpertTasksPage from '../pages/ExpertTasksPage.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import { scenarioServiceKey } from '@/demo/serviceProvider'

const api = vi.hoisted(() => ({
  listExpertTasks: vi.fn(), getReviewDraft: vi.fn(), getReviewResult: vi.fn(),
  saveReviewDraft: vi.fn(), submitFinalReview: vi.fn(), getMaterials: vi.fn(),
  getFileContent: vi.fn(), acceptTask: vi.fn(),
}))
vi.mock('@/api/expertTasks', () => api)
vi.mock('@/api/review', () => api)
vi.mock('@/api/files', () => api)

enableAutoUnmount(afterEach)
const score = {
  topicValue: 12, literatureTheory: 12, methodology: 16, innovation: 20,
  writingStandards: 8, resultsWorkload: 12, recommendation: '建议修改后通过',
  strengths: '结构清楚', issues: '需要补充实验', revisionAdvice: '补实验', overallComment: '真实任务 B 的意见',
}
const rows = [
  { id: 'a', status: 'SUBMITTED', anonymous_title: '旧论文 A', allowed_actions: ['VIEW_SUBMITTED'] },
  { id: 'b', status: 'IN_REVIEW', anonymous_title: '论文 B', allowed_actions: ['CONTINUE_REVIEW'] },
]
const createUrl = vi.fn(() => 'blob:paper-b')
const revokeUrl = vi.fn()

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.clearAllMocks()
  api.listExpertTasks.mockResolvedValue(rows)
  api.getReviewDraft.mockResolvedValue(score)
  api.getReviewResult.mockResolvedValue({ ...score, overallComment: '正式意见 A' })
  api.getMaterials.mockResolvedValue({ task_id: 'b', files: [{ file_id: 'file-b', filename: '匿名论文.pdf', purpose: 'anonymous' }] })
  api.getFileContent.mockResolvedValue(new Blob(['%PDF-test'], { type: 'application/pdf' }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
})
afterEach(() => { vi.unstubAllEnvs() })

async function mountPage(path = '/expert/review?task_id=b', page = ReviewWorkspacePage) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/expert/review', component: ReviewWorkspacePage },
      { path: '/expert/tasks', component: ExpertTasksPage },
    ],
  })
  await router.push(path)
  const wrapper = mount(page, {
    global: {
      plugins: [createPinia(), router],
      // The old component unconditionally asks for this service even in real mode.
      provide: { [scenarioServiceKey as symbol]: { getExpertDemoFileValidation: async () => 'VALID' } },
      stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } },
    },
  })
  await flushPromises()
  return { wrapper, router }
}

describe('real expert workspace', () => {
  it('loads the explicit task and its PDF, with no demo content', async () => {
    const { wrapper } = await mountPage()
    expect(api.getReviewDraft).toHaveBeenCalledWith('b')
    expect(api.getMaterials).toHaveBeenCalledWith('b')
    expect(api.getFileContent).toHaveBeenCalledWith('file-b')
    expect(wrapper.get('iframe[title="匿名论文 PDF"]').attributes('src')).toBe('blob:paper-b')
    expect(wrapper.text()).toContain('论文 B')
    expect(wrapper.text()).not.toContain('旧论文 A')
    expect(wrapper.text()).not.toContain('86 页')
    expect(wrapper.text()).not.toContain('多模态推理框架')
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', score.overallComment)
    wrapper.getComponent(ReviewFormPane).vm.$emit('save', score)
    await flushPromises()
    expect(api.saveReviewDraft).toHaveBeenCalledWith('b', score)
  })

  it.each(['/expert/review', '/expert/review?task_id=missing', '/expert/review?task_id=b&task_id=a'])(
    'does not fall back to another task for %s', async (path) => {
      const { wrapper } = await mountPage(path)
      expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(false)
      expect(api.getReviewDraft).not.toHaveBeenCalled()
      expect(api.getMaterials).not.toHaveBeenCalled()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    },
  )

  it.each(['INVITED', 'REJECTED', 'CANCELLED'])('does not edit a %s task', async (status) => {
    api.listExpertTasks.mockResolvedValue([{ ...rows[1], status }])
    const { wrapper } = await mountPage()
    expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(false)
    expect(api.getMaterials).not.toHaveBeenCalled()
  })

  it('shows formal submitted opinions read-only without requesting the paper', async () => {
    const { wrapper } = await mountPage('/expert/review?task_id=a')
    expect(api.getReviewResult).toHaveBeenCalledWith('a')
    expect(api.getReviewDraft).not.toHaveBeenCalled()
    expect(api.getMaterials).not.toHaveBeenCalled()
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', '正式意见 A')
    expect(wrapper.getComponent(ReviewFormPane).props('locked')).toBe(true)
    expect(wrapper.find('[data-action="open-correction-dialog"]').exists()).toBe(false)
  })

  it('removes the old PDF and ignores a stale draft when the route changes', async () => {
    let resolveDraft!: (value: typeof score) => void
    api.getReviewDraft.mockReturnValueOnce(new Promise(resolve => { resolveDraft = resolve }))
    const { wrapper, router } = await mountPage()
    await router.push('/expert/review?task_id=a')
    await flushPromises()
    resolveDraft(score)
    await flushPromises()
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', '正式意见 A')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('shows a retry on file denial and releases the PDF when leaving', async () => {
    api.getFileContent.mockRejectedValueOnce(new Error('资源不存在或不可见'))
    const { wrapper, router } = await mountPage()
    expect(wrapper.find('iframe').exists()).toBe(false)
    await wrapper.get('[data-action="retry-materials"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(true)
    await router.push('/expert/review?task_id=missing')
    await flushPromises()
    expect(revokeUrl).toHaveBeenCalledWith('blob:paper-b')
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('puts the selected task id on task-list links', async () => {
    const { wrapper } = await mountPage('/expert/tasks', ExpertTasksPage)
    expect(wrapper.get('[data-action="continue-review"]').attributes('href')).toBe('/expert/review?task_id=b')
  })
  it('accepts and opens the exact invited task', async () => {
    api.listExpertTasks.mockResolvedValue([{ ...rows[1], status: 'INVITED', allowed_actions: ['ACCEPT_TASK'] }])
    const { wrapper, router } = await mountPage('/expert/tasks', ExpertTasksPage)
    await wrapper.get('[data-action="accept-task"]').trigger('click')
    await wrapper.get('[data-action="confirm-accept-task"]').trigger('click')
    await flushPromises()
    expect(api.acceptTask).toHaveBeenCalledWith('b')
    expect(router.currentRoute.value.query.task_id).toBe('b')
  })

  it('submits only the selected task and reloads its formal result', async () => {
    const { wrapper } = await mountPage()
    api.listExpertTasks.mockResolvedValue([{ ...rows[1], status: 'SUBMITTED' }, rows[0]])
    api.getReviewResult.mockResolvedValue({ ...score, overallComment: '正式意见 B' })
    wrapper.getComponent(ReviewFormPane).vm.$emit('submit', score)
    await flushPromises()
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    expect(api.submitFinalReview).toHaveBeenCalledWith('b', score)
    expect(wrapper.getComponent(ReviewFormPane).props('locked')).toBe(true)
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', '正式意见 B')
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(revokeUrl).toHaveBeenCalledWith('blob:paper-b')
  })

  it('ignores a file response that arrives after changing tasks', async () => {
    let resolveFile!: (value: Blob) => void
    api.getFileContent.mockReturnValueOnce(new Promise(resolve => { resolveFile = resolve }))
    const { wrapper, router } = await mountPage()
    await router.push('/expert/review?task_id=a')
    await flushPromises()
    resolveFile(new Blob(['old'], { type: 'application/pdf' }))
    await flushPromises()
    expect(createUrl).not.toHaveBeenCalled()
    expect(wrapper.find('iframe').exists()).toBe(false)
  })

  it('does not autosave the old form into a new task with no saved draft', async () => {
    const { wrapper, router } = await mountPage()
    await wrapper.get('textarea[name="overallComment"]').setValue('旧任务未保存输入')
    api.getReviewDraft.mockResolvedValue({})
    api.listExpertTasks.mockResolvedValue([...rows, { ...rows[1], id: 'c' }])
    await router.push('/expert/review?task_id=c')
    await flushPromises()
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', '')
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(api.saveReviewDraft).not.toHaveBeenCalled()
  })

  it('does not let a late post-submit refresh dismiss another task confirmation', async () => {
    const { wrapper, router } = await mountPage()
    let resolveRefresh!: (value: typeof rows) => void
    api.listExpertTasks.mockReturnValueOnce(new Promise(resolve => { resolveRefresh = resolve }))
      .mockResolvedValue([...rows, { ...rows[1], id: 'c' }])
    wrapper.getComponent(ReviewFormPane).vm.$emit('submit', score)
    await flushPromises()
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    await router.push('/expert/review?task_id=c')
    await flushPromises()
    wrapper.getComponent(ReviewFormPane).vm.$emit('submit', score)
    await flushPromises()
    expect(wrapper.find('[data-action="confirm-submit-review"]').exists()).toBe(true)
    resolveRefresh([{ ...rows[1], status: 'SUBMITTED' }])
    await flushPromises()
    expect(wrapper.find('[data-action="confirm-submit-review"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('最终意见已提交并锁定。')
  })

})
