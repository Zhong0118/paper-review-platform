/**
 * U2-2 专注评阅：布局换了，保存语义必须与修复代码一致（D1/D2/D3/D6/D8）。
 */
import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ExpertReviewDesk from '../ExpertReviewDesk.vue'

const api = vi.hoisted(() => ({
  listExpertTasks: vi.fn(), getMaterials: vi.fn(), getFileContent: vi.fn(),
  getReviewRules: vi.fn(), getReviewDraft: vi.fn(), getReviewResult: vi.fn(), saveReviewDraft: vi.fn(), submitFinalReview: vi.fn(),
  getReviewChecks: vi.fn(), getTaskCorrections: vi.fn(), listCorrections: vi.fn(), correctionCommand: vi.fn(),
}))
vi.mock('@/api/expertTasks', () => api)
vi.mock('@/api/review', () => api)
vi.mock('@/api/files', () => api)
vi.mock('@/api/reviewChecks', () => api)
vi.mock('@/api/corrections', () => api)

enableAutoUnmount(afterEach)

const dims = [
  { key: 'topicValue', label: '选题价值', max_score: 15 },
  { key: 'literatureTheory', label: '文献与理论基础', max_score: 15 },
  { key: 'methodology', label: '研究方法', max_score: 20 },
  { key: 'innovation', label: '创新性', max_score: 25 },
  { key: 'writingStandards', label: '写作与学术规范', max_score: 10 },
  { key: 'resultsWorkload', label: '研究成果与工作量', max_score: 15 },
]
const rule = { version: 'pilot-single-v1', required_experts: 1, mode: 'sum_dimensions', dimensions: dims,
  bands: [{ min: 0, max: 59, code: 'FAIL', label: '不合格' }, { min: 60, max: 100, code: 'PASS', label: '合格' }] }
const filled = {
  topicValue: 12, literatureTheory: 12, methodology: 16, innovation: 20, writingStandards: 8, resultsWorkload: 12,
  recommendation: '建议修改', strengths: '结构清楚', issues: '第三章估计偏差未讨论', revisionAdvice: '补充稀疏日志实验', overallComment: '选题有现实意义',
}
const inReview = { id: 't1', status: 'IN_REVIEW', anonymous_id: 'T-0417', anonymous_title: '面向边缘计算的容错调度',
  deadline: { review_due_at: '2026-11-20T10:00:00Z', overdue: false }, allowed_actions: ['CONTINUE_REVIEW'] }
const httpError = (status: number, code?: string) => Object.assign(new Error(code ?? `HTTP ${status}`), { response: { status, data: { code } } })

beforeEach(() => {
  vi.clearAllMocks()
  api.listExpertTasks.mockResolvedValue([inReview])
  api.getReviewRules.mockResolvedValue(rule)
  api.getReviewDraft.mockResolvedValue({ ...filled, revision: 4 })
  api.saveReviewDraft.mockImplementation(async (_id: string, _input: unknown, expected: number) => ({ revision: expected + 1 }))
  api.getMaterials.mockResolvedValue({ task_id: 't1', files: [{ file_id: 'f1', filename: 'a.pdf', purpose: 'anonymous' }] })
  api.getFileContent.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  api.getReviewChecks.mockResolvedValue({ payload_hash: 'h1', rule_version: 'c1', findings: [], checked_at: '', status: 'COMPLETE',
    coverage: { dictionary_version: 'd1', dictionary_entries: 3, description: '' } })
  api.getTaskCorrections.mockResolvedValue({ base_result_id: 'r1', base_revision_id: null, current_payload: filled, requests: [] })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
})
afterEach(() => vi.useRealTimers())

async function mountDesk(url = '/expert/review?task_id=t1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/expert/review', component: ExpertReviewDesk },
      { path: '/expert/tasks', component: { template: '<p data-tasks>我的任务</p>' } },
      { path: '/login', component: { template: '<p />' } },
    ],
  })
  await router.push(url)
  const wrapper = mount({ template: '<RouterView />' }, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

async function typeIssues(wrapper: Awaited<ReturnType<typeof mountDesk>>['wrapper'], value: string) {
  await wrapper.get('textarea[name="mainIssues"]').setValue(value)
}

describe('U2-2 expert focus review desk', () => {
  it('shows the anonymous identity and deadline, reads the anonymous file, and fills the form from the draft', async () => {
    const { wrapper } = await mountDesk()
    expect(wrapper.get('.code').text()).toBe('任务 T-0417')
    expect(wrapper.get('.rv-title').text()).toBe('面向边缘计算的容错调度')
    expect(wrapper.get('[data-review-deadline]').text()).toContain('北京时间')
    expect(api.getMaterials).toHaveBeenCalledWith('t1')
    expect((wrapper.get('textarea[name="overallComment"]').element as HTMLTextAreaElement).value).toBe('选题有现实意义')
    expect(wrapper.text()).toContain('未修改')
  })

  it('autosaves with the server revision and only says saved after the receipt', async () => {
    vi.useFakeTimers()
    const { wrapper } = await mountDesk()
    await typeIssues(wrapper, '新的主要问题')
    expect(wrapper.text()).toContain('有修改，稍后自动保存')
    vi.advanceTimersByTime(800)
    await flushPromises()
    expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
    expect(api.saveReviewDraft.mock.calls[0][2]).toBe(4)
    expect(api.saveReviewDraft.mock.calls[0][1].issues).toBe('新的主要问题')
    expect(wrapper.text()).toContain('已保存')
  })

  it('replays the unconfirmed snapshot before newer input after a lost receipt (D3)', async () => {
    vi.useFakeTimers()
    api.saveReviewDraft.mockRejectedValueOnce(new Error('timeout'))
    const { wrapper } = await mountDesk()
    await typeIssues(wrapper, '第一次')
    vi.advanceTimersByTime(800)
    await flushPromises()
    expect(wrapper.get('[data-review-save-failed]').text()).toContain('保存没有确认')
    expect(wrapper.text()).toContain('保存失败，内容仍在本页')
    await typeIssues(wrapper, '第二次')
    vi.advanceTimersByTime(800)
    await flushPromises()
    const sent = api.saveReviewDraft.mock.calls.map((call) => [call[1].issues, call[2]])
    expect(sent).toEqual([['第一次', 4], ['第一次', 4], ['第二次', 5]])
    expect(wrapper.find('[data-review-save-failed]').exists()).toBe(false)
  })

  it('pauses on a version conflict, compares with the server copy, and can adopt it (D1/D2)', async () => {
    vi.useFakeTimers()
    api.saveReviewDraft.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountDesk()
    await typeIssues(wrapper, '本页的主要问题')
    vi.advanceTimersByTime(800)
    await flushPromises()
    const banner = wrapper.get('[data-review-conflict]')
    expect(banner.text()).toContain('自动保存已暂停')
    expect(wrapper.text()).toContain('内容冲突，未保存')
    api.getReviewDraft.mockResolvedValueOnce({ ...filled, issues: '另一页签的主要问题', revision: 6 })
    await wrapper.get('[data-action="compare-review-draft"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-review-conflict]').text()).toContain('另一页签的主要问题')
    expect(wrapper.get('[data-review-conflict]').text()).toContain('本页的主要问题')
    // 冲突期间不再自动保存
    await typeIssues(wrapper, '本页的主要问题（再改）')
    vi.advanceTimersByTime(800)
    await flushPromises()
    expect(api.saveReviewDraft).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-action="accept-server-review"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('textarea[name="mainIssues"]').element as HTMLTextAreaElement).value).toBe('另一页签的主要问题')
    expect(wrapper.find('[data-review-conflict]').exists()).toBe(false)
  })

  it('keeps local input and re-saves against the compared server revision (D2)', async () => {
    vi.useFakeTimers()
    api.saveReviewDraft.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountDesk()
    await typeIssues(wrapper, '保留我的版本')
    vi.advanceTimersByTime(800)
    await flushPromises()
    api.getReviewDraft.mockResolvedValueOnce({ ...filled, issues: '服务器的', revision: 6 })
    await wrapper.get('[data-action="compare-review-draft"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="save-compared-review"]').trigger('click')
    await flushPromises()
    const last = api.saveReviewDraft.mock.calls.at(-1)!
    expect([last[1].issues, last[2]]).toEqual(['保留我的版本', 6])
  })

  it('sends an incomplete submit to the check tab without opening the dialog', async () => {
    api.getReviewDraft.mockResolvedValueOnce({ ...filled, revisionAdvice: '', revision: 4 })
    const { wrapper } = await mountDesk()
    await wrapper.get('[data-action="submit-final-review"]').trigger('click')
    expect(wrapper.get('[data-tab="check"]').attributes('aria-selected')).toBe('true')
    expect(wrapper.text()).toContain('还差 2 项')
    expect(wrapper.find('.freeze').exists()).toBe(false)
    expect(api.submitFinalReview).not.toHaveBeenCalled()
  })

  it('submits with the check acknowledgement, the draft revision and one idempotency key per attempt (D8)', async () => {
    api.submitFinalReview.mockRejectedValueOnce(new Error('网络中断'))
    const { wrapper } = await mountDesk()
    await wrapper.get('[data-tab="check"]').trigger('click')
    await wrapper.get('[data-action="check-comments"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="submit-final-review"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.freeze').text()).toContain('80 / 100')
    expect(wrapper.get('.freeze').text()).toContain('合格')
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('网络中断')
    api.listExpertTasks.mockResolvedValue([{ ...inReview, status: 'SUBMITTED' }])
    api.getReviewResult.mockResolvedValue(filled)
    await wrapper.get('[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    const [first, second] = api.submitFinalReview.mock.calls
    expect(first[2]).toEqual({ payload_hash: 'h1', rule_version: 'c1', codes: [] })
    expect(first[3]).toBe(4)
    expect(second[4]).toBe(first[4])
    const final = wrapper.get('[aria-label="本人正式意见"]')
    expect(final.get('[data-total]').text()).toBe('80')
    expect(final.get('[data-outcome]').text()).toBe('合格')
    expect(wrapper.text()).toContain('已提交，匿名稿不再提供阅读')
  })

  it('stays on the page when leaving cannot save, and leaves once it can', async () => {
    vi.useFakeTimers()
    api.saveReviewDraft.mockRejectedValueOnce(new Error('timeout'))
    const { wrapper, router } = await mountDesk()
    await typeIssues(wrapper, '还没保存的输入')
    await wrapper.get('[data-action="back-to-tasks"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/expert/review')
    expect(wrapper.text()).toContain('没有保存成功，已留在本页')
    await wrapper.get('[data-action="exit-review"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/expert/tasks')
  })

  it('shows a submitted task read-only, without requesting the paper, with the correction panel', async () => {
    api.listExpertTasks.mockResolvedValue([{ ...inReview, status: 'SUBMITTED' }])
    api.getReviewResult.mockResolvedValue({ ...filled, evaluations: { methodology: '方法扎实' } })
    const { wrapper } = await mountDesk()
    expect(api.getMaterials).not.toHaveBeenCalled()
    expect(wrapper.find('textarea[name="overallComment"]').exists()).toBe(false)
    const final = wrapper.get('[aria-label="本人正式意见"]').text()
    expect(final).toContain('主要优点（不发布）')
    expect(final).toContain('方法扎实')
    expect(api.getTaskCorrections).toHaveBeenCalledWith('t1')
    expect(wrapper.text()).toContain('已提交，只读')
  })

  it('explains a task that is no longer reviewable and links back to the task list', async () => {
    api.listExpertTasks.mockResolvedValue([])
    const { wrapper } = await mountDesk()
    const block = wrapper.get('[data-review-load-error]')
    expect(block.text()).toContain('任务不存在或当前不可评阅')
    expect(block.find('a[href="/expert/tasks"]').exists()).toBe(true)
  })
})
