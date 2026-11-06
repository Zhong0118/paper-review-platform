import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ThesisDetail } from '@/api/theses'
import StudentPage from '../StudentFeedbackPage.vue'
import SupervisorPage from '../SupervisorFeedbackPage.vue'
import { published } from './fixtures'

const api = vi.hoisted(() => ({ listTheses: vi.fn(), getPublishedResult: vi.fn(), listSupervisedPublishedTheses: vi.fn(), listMyObjections: vi.fn(), createObjection: vi.fn() }))
vi.mock('@/api/theses', () => api)
vi.mock('@/api/results', () => api)
vi.mock('@/api/objections', () => api)
enableAutoUnmount(afterEach)

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })
const thesis = (id: string, stage: string, actions: string[] = []) => ({ id, stage, allowed_actions: actions, current_version: { title: `论文${id}` }, review_batch: { id: 'b', name: '2026 春季批次', end_at: null } }) as unknown as ThesisDetail

beforeEach(() => {
  vi.resetAllMocks()
  api.listTheses.mockResolvedValue([thesis('draft', 'UNDER_REVIEW'), thesis('done', 'COMPLETED', ['SUBMIT_OBJECTION'])])
  api.getPublishedResult.mockResolvedValue(published())
  api.listMyObjections.mockResolvedValue([])
  api.createObjection.mockResolvedValue({})
  api.listSupervisedPublishedTheses.mockResolvedValue([{ id: 's1', title: '论文s1', student_name: '学生甲' }, { id: 's2', title: '论文s2', student_name: '学生乙' }])
})

async function mountAt(page: typeof StudentPage, url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/student/results', component: page }, { path: '/supervisor/results', component: page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(page, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

it('opens the first published thesis and reads the feedback in order without dates or strengths', async () => {
  const { wrapper, router } = await mountAt(StudentPage, '/student/results')
  expect(router.currentRoute.value.query.thesisId).toBe('done')
  expect(api.getPublishedResult).toHaveBeenCalledWith('done', { quiet: true })
  expect(wrapper.find('[data-thesis-picker]').exists()).toBe(false)
  const text = wrapper.text()
  expect(text).toContain('论文done')
  expect(text).toContain('2026 春季批次')
  expect(wrapper.get('[data-outcome]').text()).toBe('通过')
  expect(wrapper.get('[data-total]').text()).toContain('86')
  expect(text.indexOf('总体评价')).toBeLessThan(text.indexOf('主要问题'))
  expect(text.indexOf('主要问题')).toBeLessThan(text.indexOf('修改建议'))
  expect(text.indexOf('修改建议')).toBeLessThan(text.indexOf('分项评分'))
  expect(wrapper.get('[data-advice]').text()).toContain('补充对照实验。')
  expect(text).not.toContain('发布时间')
})

it('tells v1 history, an empty v2 advice and an unreadable snapshot apart', async () => {
  const legacy = published({ snapshot_schema_version: 1 })
  delete (legacy.items[0] as Record<string, unknown>).revision_advice
  api.getPublishedResult.mockResolvedValueOnce(legacy)
  let { wrapper } = await mountAt(StudentPage, '/student/results?thesisId=done')
  expect(wrapper.get('[data-advice]').text()).toContain('此历史发布版本未收录修改建议')
  wrapper.unmount()

  api.getPublishedResult.mockResolvedValueOnce(published({}, { revision_advice: '' }))
  ;({ wrapper } = await mountAt(StudentPage, '/student/results?thesisId=done'))
  expect(wrapper.get('[data-advice]').text()).toContain('未填写修改建议')
  wrapper.unmount()

  api.listMyObjections.mockClear()
  api.getPublishedResult.mockResolvedValueOnce(published({ snapshot_schema_version: 3 }))
  ;({ wrapper } = await mountAt(StudentPage, '/student/results?thesisId=done'))
  expect(wrapper.find('[data-feedback-invalid]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('86')
  expect(wrapper.text()).not.toContain('总体扎实')
  expect(api.listMyObjections).not.toHaveBeenCalled()
})

it('does not ask for a result before publication and maps a hidden result to unpublished', async () => {
  const { wrapper } = await mountAt(StudentPage, '/student/results?thesisId=draft')
  expect(api.getPublishedResult).not.toHaveBeenCalled()
  expect(wrapper.find('[data-unpublished]').exists()).toBe(true)
  wrapper.unmount()
  api.getPublishedResult.mockRejectedValueOnce(httpError(404))
  const second = await mountAt(StudentPage, '/student/results?thesisId=elsewhere')
  expect(second.wrapper.find('[data-unpublished]').exists()).toBe(true)
})

it('retries a failed result load', async () => {
  api.getPublishedResult.mockRejectedValueOnce(httpError(503))
  const { wrapper } = await mountAt(StudentPage, '/student/results')
  expect(wrapper.text()).toContain('评阅结果没有加载出来')
  await wrapper.get('[data-action="retry-feedback"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-outcome]').text()).toBe('通过')
})

it('shows correction notices', async () => {
  api.getPublishedResult.mockResolvedValueOnce(published({ correction_pending: true }))
  const { wrapper } = await mountAt(StudentPage, '/student/results')
  expect(wrapper.find('[data-correction-pending]').exists()).toBe(true)
  wrapper.unmount()
  api.getPublishedResult.mockResolvedValueOnce(published({ effective_revision_id: 'rev-1' }))
  const second = await mountAt(StudentPage, '/student/results')
  expect(second.wrapper.find('[data-corrected]').exists()).toBe(true)
})

it('registers an objection with both fields after confirmation and a stable key on retry', async () => {
  api.createObjection.mockRejectedValueOnce(httpError(503))
  const { wrapper } = await mountAt(StudentPage, '/student/results')
  await wrapper.get('[data-action="toggle-objection"]').trigger('click')
  await wrapper.get('[data-action="open-objection"]').trigger('click')
  expect(wrapper.get('[data-objection-error]').text()).toContain('异议理由')
  await wrapper.get('textarea[name="objectionReason"]').setValue('第三章评分与评语不一致')
  await wrapper.get('[data-action="open-objection"]').trigger('click')
  expect(wrapper.get('[data-objection-error]').text()).toContain('如何处理')
  await wrapper.get('textarea[name="objectionRequest"]').setValue('请学校复核')
  await wrapper.get('[data-action="open-objection"]').trigger('click')
  expect(api.createObjection).not.toHaveBeenCalled()
  await wrapper.get('[data-action="confirm-objection"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-objection-submit-error]').text()).toContain('异议没有登记')
  api.listMyObjections.mockResolvedValueOnce([{ id: 'o1', thesis_id: 'done', reason: '第三章评分与评语不一致', request: '请学校复核', created_at: '', status: 'SUBMITTED', channel: null, conclusion: null }])
  await wrapper.get('[data-action="confirm-objection"]').trigger('click')
  await flushPromises()
  const [first, second] = api.createObjection.mock.calls
  expect(first[1]).toEqual({ reason: '第三章评分与评语不一致', request: '请学校复核' })
  expect(second[2].idempotencyKey).toBe(first[2].idempotencyKey)
  expect(wrapper.get('[data-objection-notice]').text()).toContain('异议已登记')
  expect(wrapper.get('[data-objection-status]').text()).toContain('等待学校受理')
  expect(wrapper.find('[data-action="open-objection"]').exists()).toBe(false)
})

it('keeps the objection form folded until the student opens it (R3-4)', async () => {
  const { wrapper } = await mountAt(StudentPage, '/student/results')
  expect(wrapper.find('.objection').exists()).toBe(true)
  expect(wrapper.find('textarea[name="objectionReason"]').exists()).toBe(false)
  expect(wrapper.find('[data-action="open-objection"]').exists()).toBe(false)
  const toggle = wrapper.get('[data-action="toggle-objection"]')
  expect(toggle.attributes('aria-expanded')).toBe('false')
  await toggle.trigger('click')
  expect(toggle.attributes('aria-expanded')).toBe('true')
  expect(wrapper.find('textarea[name="objectionReason"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('登记异议不会自动改变分数')
})

it('shows a resolved objection with its conclusion and no form when the server disallows a new one', async () => {
  api.listTheses.mockResolvedValueOnce([thesis('done', 'COMPLETED')])
  api.listMyObjections.mockResolvedValueOnce([{ id: 'o1', thesis_id: 'done', reason: '理由', request: '诉求', created_at: '', status: 'RESOLVED', channel: 'OFFLINE', conclusion: '维持原结果' }])
  const { wrapper } = await mountAt(StudentPage, '/student/results')
  expect(wrapper.get('[data-objection-status]').text()).toContain('维持原结果')
  expect(wrapper.get('[data-objection-status]').text()).toContain('线下处理')
  expect(wrapper.find('[data-action="open-objection"]').exists()).toBe(false)
})

it('lets a supervisor pick a student and read the same feedback without any objection entry', async () => {
  const { wrapper, router } = await mountAt(SupervisorPage, '/supervisor/results')
  expect(router.currentRoute.value.query.thesisId).toBe('s1')
  expect(api.getPublishedResult).toHaveBeenCalledWith('s1', { quiet: true })
  expect(wrapper.text()).toContain('学生：学生甲')
  expect(wrapper.find('.objection').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('异议')
  await wrapper.get('[data-student-picker]').setValue('s2')
  await flushPromises()
  expect(router.currentRoute.value.query.thesisId).toBe('s2')
  expect(api.getPublishedResult).toHaveBeenLastCalledWith('s2', { quiet: true })
})

it('treats an unreadable snapshot as an interface error for supervisors too, and handles an empty list', async () => {
  api.getPublishedResult.mockResolvedValueOnce(published({ items: [{}] }))
  const { wrapper } = await mountAt(SupervisorPage, '/supervisor/results')
  expect(wrapper.find('[data-feedback-invalid]').exists()).toBe(true)
  wrapper.unmount()
  api.listSupervisedPublishedTheses.mockResolvedValueOnce([])
  const second = await mountAt(SupervisorPage, '/supervisor/results')
  expect(second.wrapper.text()).toContain('还没有已发布的学生评阅结果')
  expect(api.getPublishedResult).toHaveBeenCalledTimes(1)
})
