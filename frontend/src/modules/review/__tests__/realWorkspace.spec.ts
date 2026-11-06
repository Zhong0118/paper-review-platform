import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewWorkspacePage from '../pages/ReviewWorkspacePage.vue'
import ExpertTasksPage from '../pages/ExpertTasksPage.vue'
import InvitationPage from '../pages/InvitationPage.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import { useAuthStore } from '@/stores/auth'
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
  api.getReviewDraft.mockResolvedValue({ ...score, revision: 4 })
  api.saveReviewDraft.mockResolvedValue({ revision: 5 })
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

async function mountPage(path = '/expert/review?task_id=b') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/expert/review', component: ReviewWorkspacePage },
      { path: '/expert/tasks', component: ExpertTasksPage },
      { path: '/expert/invitation', component: InvitationPage },
    ],
  })
  await router.push(path)
  const wrapper = mount(RouterView, {
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
  // 任务列表与邀请的真实模式用例已随 R3-3 移到 tasks/__tests__ 与 invitation/__tests__（U4 计划 §19.6）
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
    expect(api.saveReviewDraft).toHaveBeenCalledWith('b', score, 4)
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

  it('submits only the selected task and reloads its formal result', async () => {
    const { wrapper } = await mountPage()
    api.listExpertTasks.mockResolvedValue([{ ...rows[1], status: 'SUBMITTED' }, rows[0]])
    api.getReviewResult.mockResolvedValue({ ...score, overallComment: '正式意见 B' })
    const ack = { payload_hash: 'a'.repeat(64), rule_version: 'v1', codes: ['SHORT_OVERALL'] }
    wrapper.getComponent(ReviewFormPane).vm.$emit('submit', score, ack)
    await flushPromises()
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    expect(api.submitFinalReview).toHaveBeenCalledWith('b', score, ack, 4, expect.any(String))
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
    api.getReviewDraft.mockResolvedValue({revision: 0})
    api.listExpertTasks.mockResolvedValue([...rows, { ...rows[1], id: 'c' }])
    await router.push('/expert/review?task_id=c')
    await flushPromises()
    expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value', '')
    await new Promise(resolve => setTimeout(resolve, 900))
    expect(api.saveReviewDraft.mock.calls.map(c => c[0])).toEqual(['b'])
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
  expect(api.saveReviewDraft).toHaveBeenCalledWith('b',score,4)
})

it('flushes the last edit on immediate exit and waits for the server', async () => {
  let ack!: (value: { revision: number }) => void
  api.saveReviewDraft.mockReturnValueOnce(new Promise(resolve => { ack = resolve }))
  const { wrapper, router } = await mountPage()
  await wrapper.get('textarea[name="overallComment"]').setValue('最后一字')
  await wrapper.get('[data-action="exit-review"]').trigger('click')
  await flushPromises()
  expect(api.saveReviewDraft).toHaveBeenCalledWith('b', expect.objectContaining({overallComment:'最后一字'}), 4)
  expect(router.currentRoute.value.path).toBe('/expert/review')
  ack({revision: 5})
  await flushPromises()
  expect(router.currentRoute.value.path).toBe('/expert/tasks')
})

it('coalesces edits behind one pending save and guards browser back, route updates and hard reload', async () => {
  let ack!: (value: { revision: number }) => void
  api.saveReviewDraft.mockReturnValueOnce(new Promise(resolve => { ack = resolve }))
    .mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce({revision: 6})
  const { wrapper, router } = await mountPage('/expert/tasks')
  await router.push('/expert/review?task_id=b')
  await flushPromises()
  await wrapper.get('textarea[name="overallComment"]').setValue('最早')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await wrapper.get('textarea[name="overallComment"]').setValue('中间')
  await wrapper.get('textarea[name="overallComment"]').setValue('完整保留')
  await wrapper.get('textarea[name="strengths"]').setValue('还有优点')
  const before = new Event('beforeunload', {cancelable:true})
  window.dispatchEvent(before)
  expect(before.defaultPrevented).toBe(true)
  router.back()
  await flushPromises()
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
  ack({revision:5})
  await flushPromises()
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(2)
  expect(api.saveReviewDraft.mock.calls[1]).toEqual(['b',expect.objectContaining({overallComment:'完整保留', strengths:'还有优点'}),5])
  expect(router.currentRoute.value.query.task_id).toBe('b')
  expect(wrapper.get('textarea[name="overallComment"]').element).toHaveProperty('value','完整保留')
  expect(wrapper.text()).toContain('重试')
  await router.push('/expert/review?task_id=a')
  await flushPromises()
  expect(api.saveReviewDraft.mock.calls[2]).toEqual(api.saveReviewDraft.mock.calls[1])
  expect(router.currentRoute.value.query.task_id).toBe('a')
  const clean = new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(clean)
  expect(clean.defaultPrevented).toBe(false)
})

it('preserves every local field on conflict and only rebases after the expert compares the remote draft', async () => {
  api.saveReviewDraft.mockRejectedValueOnce({response:{status:409,data:{code:'VERSION_CONFLICT',data:{current_revision:7}}}})
    .mockResolvedValueOnce({revision:8})
  const { wrapper, router } = await mountPage()
  await wrapper.get('[name="evaluations.innovation"]').setValue('保留分项评价')
  await wrapper.get('[name="innovation"]').setValue(19)
  await wrapper.get('[name="overallComment"]').setValue('本地总体意见')
  await wrapper.get('[data-action="exit-review"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.task_id).toBe('b')
  expect(wrapper.get('[name="evaluations.innovation"]').element).toHaveProperty('value','保留分项评价')
  expect(wrapper.get('[name="innovation"]').element).toHaveProperty('value','19')
  api.getReviewDraft.mockResolvedValueOnce({...score, overallComment:'其他窗口的更新',revision:7})
  await wrapper.get('[data-action="compare-review-draft"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('其他窗口的更新')
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
  await wrapper.get('[data-action="save-compared-review"]').trigger('click')
  await flushPromises()
  expect(api.saveReviewDraft.mock.calls[1]).toEqual(['b',expect.objectContaining({
    overallComment:'本地总体意见', innovation:19, evaluations:{innovation:'保留分项评价'},
  }),7])
})

it('replays an unacknowledged write before sending newer edits and serializes final with its ACK', async () => {
  let confirm!: (value: {revision:number}) => void
  api.saveReviewDraft.mockRejectedValueOnce(new Error('响应中断')).mockResolvedValueOnce({revision:5})
    .mockReturnValueOnce(new Promise(resolve => {confirm = resolve}))
  const { wrapper } = await mountPage()
  await wrapper.get('[name="overallComment"]').setValue('未收到回执')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  await wrapper.get('[name="overallComment"]').setValue('最新意见')
  const updated = {...score, overallComment:'最新意见'}
  const ack = {payload_hash:'a'.repeat(64), rule_version:'v1', codes:[]}
  wrapper.getComponent(ReviewFormPane).vm.$emit('submit', updated, ack)
  await flushPromises()
  await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
  await flushPromises()
  expect(api.saveReviewDraft.mock.calls[1]).toEqual(api.saveReviewDraft.mock.calls[0])
  expect(api.saveReviewDraft.mock.calls[2]).toEqual(['b',expect.objectContaining({overallComment:'最新意见'}),5])
  expect(api.submitFinalReview).not.toHaveBeenCalled()
  api.submitFinalReview.mockRejectedValueOnce(new Error('提交响应中断')).mockResolvedValueOnce({})
  confirm({revision:6})
  await flushPromises()
  expect(api.submitFinalReview.mock.calls[0]).toEqual(['b',updated,ack,6,expect.any(String)])
  await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
  await flushPromises()
  expect(api.submitFinalReview.mock.calls[1]).toEqual(api.submitFinalReview.mock.calls[0])
})


it('does not send queued expert text or process an old receipt after an identity switch', async () => {
  const { wrapper } = await mountPage()
  let ack!: (receipt:{revision:number}) => void
  api.saveReviewDraft.mockReturnValueOnce(new Promise(resolve => { ack = resolve }))
  await wrapper.get('[name="overallComment"]').setValue('原专家的意见')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await wrapper.get('[name="strengths"]').setValue('仅留在原窗口')
  api.listExpertTasks.mockResolvedValue([])
  const auth = useAuthStore()
  auth.setSession('new', {id:'other', role:'expert', displayName:null})
  await flushPromises()
  ack({revision:5})
  await flushPromises()
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
  expect(wrapper.findComponent(ReviewFormPane).exists()).toBe(false)
  expect(wrapper.text()).not.toContain('原专家的意见')
  expect(wrapper.text()).not.toContain('草稿已保存')
  auth.clearSession()
})

it('can save a corrected field after the server explicitly rejected the previous input', async () => {
  api.saveReviewDraft.mockRejectedValueOnce({response:{status:422,data:{code:'VALIDATION_FAILED'}}})
    .mockResolvedValueOnce({revision:5})
  const {wrapper} = await mountPage()
  await wrapper.get('[name="innovation"]').setValue('3.5')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  await wrapper.get('[name="innovation"]').setValue('4')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  expect(api.saveReviewDraft.mock.calls[1]).toEqual(['b',expect.objectContaining({innovation:4}),4])
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(2)
})

it.each([799,801])('exiting %i ms after input sends exactly one confirmed snapshot',async elapsed=>{
  const {wrapper,router}=await mountPage()
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']})
  try {
    let ack!: (value:{revision:number})=>void
    api.saveReviewDraft.mockReturnValueOnce(new Promise(resolve=>{ack=resolve}))
    await wrapper.get('textarea[name="overallComment"]').setValue('防抖边界正文')
    await vi.advanceTimersByTimeAsync(elapsed)
    expect(api.saveReviewDraft).toHaveBeenCalledTimes(elapsed<800?0:1)
    await wrapper.get('[data-action=exit-review]').trigger('click')
    await flushPromises()
    expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/expert/review')
    ack({revision:5}); await flushPromises()
    expect(router.currentRoute.value.path).toBe('/expert/tasks')
  } finally { vi.useRealTimers() }
})

it('keeps newer local edits when a lost acknowledgement is retried after another tab saved', async () => {
  api.saveReviewDraft.mockRejectedValueOnce(new Error('响应中断'))
    .mockRejectedValueOnce({response:{status:409,data:{code:'VERSION_CONFLICT',data:{current_revision:6}}}})
  const {wrapper,router} = await mountPage()
  const field = wrapper.get('[name="overallComment"]')
  await field.setValue('已发但回执丢失')
  await wrapper.get('[data-action="save-review-draft"]').trigger('click'); await flushPromises()
  await field.setValue('本地后来又输入')
  await wrapper.get('[data-action="exit-review"]').trigger('click'); await flushPromises()
  expect(api.saveReviewDraft.mock.calls[1]).toEqual(api.saveReviewDraft.mock.calls[0])
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(2)
  expect(router.currentRoute.value.query.task_id).toBe('b')
  expect(field.element).toHaveProperty('value','本地后来又输入')
  expect(wrapper.text()).not.toContain('草稿已保存')
  api.getReviewDraft.mockResolvedValueOnce({...score,overallComment:'另一页签已提交的新版草稿',revision:6})
  await wrapper.get('[data-action="compare-review-draft"]').trigger('click'); await flushPromises()
  expect(wrapper.text()).toContain('另一页签已提交的新版草稿')
  expect(field.element).toHaveProperty('value','本地后来又输入')
  expect(api.saveReviewDraft).toHaveBeenCalledTimes(2)
})
