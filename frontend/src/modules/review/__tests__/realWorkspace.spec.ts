import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewWorkspacePage from '../pages/ReviewWorkspacePage.vue'
import ExpertTasksPage from '../pages/ExpertTasksPage.vue'
import InvitationPage from '../pages/InvitationPage.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import { scenarioServiceKey } from '@/demo/serviceProvider'

const api = vi.hoisted(() => ({
  listExpertTasks: vi.fn(), getReviewRules: vi.fn(), getReviewDraft: vi.fn(), getReviewResult: vi.fn(),
  saveReviewDraft: vi.fn(), submitFinalReview: vi.fn(), getMaterials: vi.fn(),
  getFileContent: vi.fn(), acceptTask: vi.fn(), getInvitation: vi.fn(), rejectTask: vi.fn(),
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
  api.getReviewRules.mockResolvedValue({ version: 'pilot-single-v1', required_experts: 1, mode: 'sum_dimensions',
    dimensions: [
      { key: 'topicValue', label: '选题价值', max_score: 15 },
      { key: 'literatureTheory', label: '文献与理论基础', max_score: 15 },
      { key: 'methodology', label: '研究方法', max_score: 20 },
      { key: 'innovation', label: '创新性', max_score: 25 },
      { key: 'writingStandards', label: '写作与学术规范', max_score: 10 },
      { key: 'resultsWorkload', label: '研究成果与工作量', max_score: 15 },
    ], bands: [] })
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
      { path: '/expert/invitation', component: InvitationPage },
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
  it('renders a real invitation without invented fee or deadline and lets the expert reject it', async () => {
    api.listExpertTasks.mockResolvedValue([{ id: 'invite-1', status: 'INVITED' }])
    api.getInvitation.mockResolvedValue({ id: 'invite-1', status: 'INVITED', anonymous_id: 'A-001',
      anonymous_title: '匿名论文', discipline_code: '0812', discipline_name: '计算机科学与技术' })
    const { wrapper } = await mountPage('/expert/invitation', InvitationPage)
    expect(wrapper.text()).toContain('匿名论文')
    expect(wrapper.text()).not.toContain('正在加载邀请信息')
    expect(wrapper.text()).not.toContain('评阅费')
    expect(wrapper.text()).not.toContain('¥')
    await wrapper.get('[data-action="open-reject-dialog"]').trigger('click')
    expect(wrapper.text()).toContain('拒绝任务')
  })
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

  it('shows the selected task group in the header even when the group is empty', async () => {
    const { wrapper } = await mountPage('/expert/tasks', ExpertTasksPage)
    const stage = wrapper.get('.blind-rail__stage')
    expect(stage.text()).toBe('评阅中')

    await wrapper.get('[data-tab="SUBMITTED"]').trigger('click')
    expect(stage.text()).toBe('已完成')
    expect(wrapper.get('[data-expert-task]').text()).toContain('旧论文 A')

    await wrapper.get('[data-tab="CORRECTION_PENDING"]').trigger('click')
    expect(stage.text()).toBe('需要更正')
    expect(wrapper.get('[data-expert-task-table]').text()).toContain('当前分组暂无任务')
  })

  it('does not show an invented zero fee for real invitations', async () => {
    api.listExpertTasks.mockResolvedValue([{ ...rows[1], status: 'INVITED', allowed_actions: ['ACCEPT_TASK'] }])
    const { wrapper } = await mountPage('/expert/tasks', ExpertTasksPage)
    expect(wrapper.text()).not.toContain('费用')
    expect(wrapper.text()).not.toContain('¥ 0.00')
    await wrapper.get('[data-action="accept-task"]').trigger('click')
    expect(wrapper.text()).not.toContain('¥ 0.00')
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
    const ack = { payload_hash: 'a'.repeat(64), rule_version: 'v1', codes: ['SHORT_OVERALL'] }
    wrapper.getComponent(ReviewFormPane).vm.$emit('submit', score, ack)
    await flushPromises()
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    expect(api.submitFinalReview).toHaveBeenCalledWith('b', score, ack)
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

it('shows the effective deadline and lets the expert save an overdue review', async () => {
  api.listExpertTasks.mockResolvedValue([{ ...rows[1], deadline:{review_due_at:'2026-01-15T02:30:00Z',overdue:true} }])
  const { wrapper } = await mountPage()
  expect(wrapper.get('[data-overdue-warning]').text()).toContain('仍可保存')
  expect(wrapper.get('[data-review-deadline]').text()).toContain('10:30')
  wrapper.getComponent(ReviewFormPane).vm.$emit('save',score)
  await flushPromises()
  expect(api.saveReviewDraft).toHaveBeenCalledWith('b',score)
})
