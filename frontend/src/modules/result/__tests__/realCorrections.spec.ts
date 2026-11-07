import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReviewWorkspacePage from '@/modules/review/pages/ReviewWorkspacePage.vue'
import { portalMenus } from '@/router/menus'

const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), getReviewRules: vi.fn(), getReviewDraft: vi.fn(),
  getReviewResult: vi.fn(), saveReviewDraft: vi.fn(), submitFinalReview: vi.fn(),
  getTaskCorrections: vi.fn(), listCorrections: vi.fn(), correctionCommand: vi.fn(), getReviewChecks: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
vi.mock('@/api/review', () => api)
vi.mock('@/api/reviewChecks', () => api)
vi.mock('@/api/corrections', () => api)
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  api.listExpertTasks.mockResolvedValue([{ id: 'task-a', status: 'SUBMITTED', anonymous_title: '匿名论文' }])
  api.getReviewRules.mockResolvedValue({ version: 'pilot-single-v1', dimensions: [], bands: [] })
  api.getReviewResult.mockResolvedValue({ overallComment: '原正式结果' })
  api.getTaskCorrections.mockResolvedValue({ base_result_id: 'base-a', base_revision_id: null,
    current_payload: { overallComment: '原正式结果' }, requests: [] })
  api.correctionCommand.mockResolvedValue({ id: 'c1', task_id:'task-a', status: 'REQUESTED', version: 1, notes:[], revision:null })
})
afterEach(() => vi.unstubAllEnvs())

it('exposes the real platform correction menu', () => {
  expect(portalMenus('platform_reviewer', false).some(item => item.path === '/platform/corrections')).toBe(true)
})

it('lets the submitted expert request correction without reopening the PDF', async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/expert/review', component: ReviewWorkspacePage }] })
  await router.push('/expert/review?task_id=task-a')
  const wrapper = mount(ReviewWorkspacePage, { global: {
    plugins: [createPinia(), router],
    stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } },
  } })
  await flushPromises()
  expect(wrapper.find('iframe').exists()).toBe(false)
  expect(wrapper.find('[data-action="request-real-correction"]').exists()).toBe(true)
  await wrapper.get('[data-correction-reason]').setValue('评分录入错误，请更正')
  await wrapper.get('[data-action="request-real-correction"]').trigger('click')
  await flushPromises()
  expect(api.correctionCommand).toHaveBeenCalledWith('request', 'task-a', {
    base_result_id: 'base-a', base_revision_id: null, reason: '评分录入错误，请更正',
  }, expect.any(String))
  expect(wrapper.text()).toContain('学校确认前，已发布的旧结果继续有效')
})

it('shows anonymous before/after content and requires confirmation before school activation', async () => {
  const { default: Panel } = await import('../components/RealCorrectionPanel.vue')
  api.listCorrections.mockResolvedValue([{ id: 'c1', task_id: 'task-a', thesis_id: 'paper-a', status: 'AWAITING_SCHOOL', version: 3,
    notes: [], before: { total: 70, payload: { issues: '原问题' } }, revision: { id: 'r1', total: 90, payload: { issues: '已核对问题' } } }])
  const wrapper = mount(Panel, { global: { plugins: [createPinia()] }, props: { mode: 'school', thesisId: 'paper-a' } })
  await flushPromises()
  expect(wrapper.text()).toContain('原生效版本 · 70 分')
  expect(wrapper.text()).toContain('待确认更正 · 90 分')
  await wrapper.get('[data-correction-reason]').setValue('核对完成')
  await wrapper.findAll('button').find(button => button.text().startsWith('确认更正'))!.trigger('click')
  expect(api.correctionCommand).not.toHaveBeenCalled()
  await wrapper.findAll('button').find(button => button.text() === '确认操作')!.trigger('click')
  await flushPromises()
  expect(api.correctionCommand).toHaveBeenCalledWith('activate', 'c1', { version: 3, reason: '核对完成' }, expect.any(String))
})

it('refreshes a stale decision without replaying it', async () => {
  const { default: Panel } = await import('../components/RealCorrectionPanel.vue')
  api.listCorrections.mockResolvedValue([{ id: 'c1', task_id: 'task-a', status: 'REQUESTED', version: 1, notes: [], revision: null }])
  api.correctionCommand.mockRejectedValue({ response: { status: 409 } })
  const wrapper = mount(Panel, { global: { plugins: [createPinia()] }, props: { mode: 'platform' } })
  await flushPromises()
  await wrapper.get('[data-correction-reason]').setValue('可以更正')
  await wrapper.findAll('button').find(button => button.text() === '批准更正')!.trigger('click')
  await wrapper.findAll('button').find(button => button.text() === '确认操作')!.trigger('click')
  await flushPromises()
  expect(api.correctionCommand).toHaveBeenCalledOnce()
  expect(api.listCorrections).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('记录已变化')
})

it('offers explicit correction save and submit without an unwired exit action', async () => {
  const { default: Panel } = await import('../components/RealCorrectionPanel.vue')
  api.getTaskCorrections.mockResolvedValue({ base_result_id: 'base-a', base_revision_id: null,
    current_payload: { overallComment: '已批准的更正草稿' },
    requests: [{ id: 'c1', task_id: 'task-a', status: 'APPROVED', version: 2, notes: [], revision: null, draft_payload: {} }] })
  const wrapper = mount(Panel, { global: { plugins: [createPinia()] }, props: { mode: 'expert', taskId: 'task-a', dimensions: [] } })
  await flushPromises()
  expect(wrapper.find('[data-action="save-review-draft"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="exit-review"]').exists()).toBe(false)
})

it('opens the specific school correction linked by the closeout checklist even with another history row', async () => {
  const {default:Panel} = await import('../components/RealCorrectionPanel.vue')
  const row = {task_id:'task-a',thesis_id:'paper-a', status:'ACTIVATED', version:1, notes:[], revision:null}
  api.listCorrections.mockResolvedValue([{...row,id:'old'}, {...row,id:'current',status:'AWAITING_SCHOOL'}])
  const w = mount(Panel,{global:{plugins:[createPinia()]},props:{mode:'school',thesisId:'paper-a',initialCorrectionId:'current'}})
  await flushPromises()
  expect((w.get('select').element as HTMLSelectElement).value).toBe('current')
})

function correctionContext(version = 2, advice = '已保存建议', status = 'APPROVED', id = 'c1') {
  return { base_result_id: 'base-a', base_revision_id: null,
    current_payload: { topicValue: 10, overallComment: '原评价', issues: '原问题', revisionAdvice: advice },
    requests: [{ id, task_id: 'task-a', status, version, notes: [], revision: null,
      draft_payload: { topicValue: 10, overallComment: '原评价', issues: '原问题', revisionAdvice: advice } }] }
}

async function editing() {
  const { default: Panel } = await import('../components/RealCorrectionPanel.vue')
  const pinia = createPinia()
  api.getTaskCorrections.mockResolvedValue(correctionContext())
  const wrapper = mount(Panel, { props: { mode: 'expert', taskId: 'task-a' }, global: { plugins: [pinia] } })
  await flushPromises()
  for (const [name, value] of Object.entries({ topicValue: '13', 'evaluations.topicValue': '分项草稿',
    overallComment: '本地评价', mainIssues: '本地问题', revisionAdvice: '本地建议' })) {
    await wrapper.get(`[name="${name}"]`).setValue(value)
  }
  return { wrapper, pinia }
}

it.each([500, 'timeout', 409])('retains unsaved fields when saving fails (%s) and compares a newer draft before explicit retry', async failure => {
  const { wrapper } = await editing()
  api.correctionCommand.mockRejectedValueOnce(failure === 'timeout' ? new Error('请求超时') : { response: { status: failure } })
  if (failure === 409) api.getTaskCorrections.mockResolvedValue(correctionContext(3, '另一窗口的新建议'))
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[name="revisionAdvice"]').exists()).toBe(true)
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('本地建议')
  expect(wrapper.get<HTMLTextAreaElement>('[name="overallComment"]').element.value).toBe('本地评价')
  expect(wrapper.get<HTMLTextAreaElement>('[name="mainIssues"]').element.value).toBe('本地问题')
  expect(wrapper.get<HTMLInputElement>('[name="topicValue"]').element.value).toBe('13')
  expect(wrapper.get<HTMLTextAreaElement>('[name="evaluations.topicValue"]').element.value).toBe('分项草稿')
  expect(api.correctionCommand).toHaveBeenCalledTimes(1)
  if (failure === 409) {
    expect(wrapper.text()).toContain('另一窗口的新建议')
    expect(wrapper.text()).toContain('版本 3')
    await wrapper.get('[data-action="keep-local-correction"]').trigger('click')
  } else {
    api.getTaskCorrections.mockRejectedValueOnce(new Error('刷新超时'))
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('本地建议')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
  }
  expect(api.correctionCommand).toHaveBeenCalledTimes(1)
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  expect(api.correctionCommand.mock.calls[1]?.[2]).toMatchObject({ version: failure === 409 ? 3 : 2,
    payload: { topicValue: 13, evaluations: { topicValue: '分项草稿' }, revisionAdvice: '本地建议' } })
  const keys = api.correctionCommand.mock.calls.map(call => call[3])
  expect(keys[0] === keys[1]).toBe(failure !== 409)
})

it.each(['AWAITING_SCHOOL','ACTIVATED','CANCELLED','SCHOOL_REJECTED','forbidden'])('stops writes after stale or inaccessible request: %s', async status => {
  const { wrapper } = await editing()
  api.correctionCommand.mockRejectedValueOnce({ response: { status: status === 'forbidden' ? 403 : 409 } })
  api.getTaskCorrections.mockResolvedValue(correctionContext(4, '服务器版本', status))
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-action="save-review-draft"]').exists()).toBe(false)
  expect(wrapper.find('[name="revisionAdvice"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('本地建议')
  expect(api.correctionCommand).toHaveBeenCalledTimes(1)
})

it('drops private edits and ignores late save responses on task or user changes', async () => {
  const { wrapper, pinia } = await editing()
  const { useAuthStore } = await import('@/stores/auth')
  let finish!: () => void
  api.correctionCommand.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}) }))
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  api.getTaskCorrections.mockResolvedValue(correctionContext(2, '新任务建议', 'APPROVED', 'c2'))
  await wrapper.setProps({ taskId: 'task-b' })
  await flushPromises()
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('新任务建议')
  expect(wrapper.get('[data-action="save-review-draft"]').attributes('disabled')).toBeUndefined()
  await wrapper.get('[name="revisionAdvice"]').setValue('新任务私有草稿')
  api.getTaskCorrections.mockResolvedValue(correctionContext(2, '新身份建议', 'APPROVED', 'c2'))
  useAuthStore(pinia).setSession('test-session', { id:'another-expert',role:'expert',displayName:null })
  finish()
  await flushPromises()
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('新身份建议')
  expect(wrapper.text()).not.toContain('已保存')
  useAuthStore(pinia).clearSession()
})

it('keeps the full local copy after failed submit and requires a fresh ACK on edit', async () => {
  const { wrapper } = await editing()
  api.getReviewChecks.mockResolvedValue({ status: 'COMPLETE', payload_hash: 'hash', rule_version:'rule',
    coverage: { dictionary_version:'dict', dictionary_entries:0 }, findings:[] })
  await wrapper.get('[data-action="check-comments"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-action="submit-final-review"]').trigger('click')
  api.correctionCommand.mockRejectedValueOnce(new Error('提交超时'))
  await wrapper.get('.confirmation button').trigger('click')
  await flushPromises()
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('本地建议')
  await wrapper.get('[name="revisionAdvice"]').setValue('调整后建议')
  expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
  expect(api.correctionCommand).toHaveBeenCalledTimes(1)
})

it('blocks a retry while the conflict refresh fails, then lets the expert explicitly use the server draft', async () => {
  const { wrapper } = await editing()
  api.correctionCommand.mockRejectedValueOnce({ response:{status:409} })
  api.getTaskCorrections.mockRejectedValueOnce(new Error('刷新失败'))
  await wrapper.get('[data-action="save-review-draft"]').trigger('click')
  await flushPromises()
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('本地建议')
  expect(wrapper.get('[data-action="save-review-draft"]').attributes('disabled')).toBeDefined()
  api.getTaskCorrections.mockResolvedValue(correctionContext(3, '经核对的服务器版本'))
  await wrapper.get('[role="alert"] button').trigger('click')
  await flushPromises()
  await wrapper.get('[aria-label="更正草稿版本对照"]').findAll('button').find(b=>b.text()==='使用服务器草稿')!.trigger('click')
  expect(wrapper.get<HTMLTextAreaElement>('[name="revisionAdvice"]').element.value).toBe('经核对的服务器版本')
  expect(wrapper.get('[data-action="save-review-draft"]').attributes('disabled')).toBeUndefined()
  expect(api.correctionCommand).toHaveBeenCalledOnce()
})
