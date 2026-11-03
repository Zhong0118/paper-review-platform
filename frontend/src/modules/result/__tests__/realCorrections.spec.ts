import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReviewWorkspacePage from '@/modules/review/pages/ReviewWorkspacePage.vue'
import { portalMenus } from '@/router/menus'

const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), getReviewRules: vi.fn(), getReviewDraft: vi.fn(),
  getReviewResult: vi.fn(), saveReviewDraft: vi.fn(), submitFinalReview: vi.fn(),
  getTaskCorrections: vi.fn(), listCorrections: vi.fn(), correctionCommand: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
vi.mock('@/api/review', () => api)
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
  api.correctionCommand.mockResolvedValue({ id: 'c1', status: 'REQUESTED', version: 1 })
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
  const wrapper = mount(Panel, { props: { mode: 'school', thesisId: 'paper-a' } })
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
  const wrapper = mount(Panel, { props: { mode: 'platform' } })
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
  const wrapper = mount(Panel, { props: { mode: 'expert', taskId: 'task-a', dimensions: [] } })
  await flushPromises()
  expect(wrapper.find('[data-action="save-review-draft"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="exit-review"]').exists()).toBe(false)
})

it('opens the specific school correction linked by the closeout checklist even with another history row', async () => {
  const {default:Panel} = await import('../components/RealCorrectionPanel.vue')
  const row = {task_id:'task-a',thesis_id:'paper-a', status:'ACTIVATED', version:1, notes:[], revision:null}
  api.listCorrections.mockResolvedValue([{...row,id:'old'}, {...row,id:'current',status:'AWAITING_SCHOOL'}])
  const w = mount(Panel,{props:{mode:'school',thesisId:'paper-a',initialCorrectionId:'current'}})
  await flushPromises()
  expect((w.get('select').element as HTMLSelectElement).value).toBe('current')
})
