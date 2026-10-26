import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import DispatchPage from '@/modules/dispatch/pages/DispatchWorkbenchPage.vue'
import PreparationPage from '@/modules/school/pages/PreparationListPage.vue'
import SchoolTable from '@/modules/school/components/SchoolThesisTable.vue'
import Candidates from '@/modules/dispatch/components/CandidateExpertTable.vue'
import StudentPage from '../pages/StudentResultPage.vue'
import ObjectionPage from '@/modules/school/pages/ObjectionWorkbenchPage.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'

const api = vi.hoisted(() => ({ dispatchQueue: vi.fn(), dispatchCandidates: vi.fn(), assignExpert: vi.fn(), listTheses: vi.fn(), getPublishedResult: vi.fn(), listMyObjections: vi.fn(), listSchoolObjections: vi.fn(), createObjection: vi.fn(), reassignExpert: vi.fn(), listSchoolTheses: vi.fn(), terminateThesis: vi.fn() }))
vi.mock('@/api/dispatch', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/dispatch')>(), ...api }))
vi.mock('@/api/results', () => api)
vi.mock('@/api/theses', () => api)
vi.mock('@/api/objections', () => api)
vi.mock('@/api/schoolReview', () => api)
enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
const queue = ['a', 'b'].map(id => ({ thesis_id: id, title: `论文${id}`, stage: 'UNDER_REVIEW', allowed_actions: ['ASSIGN_EXPERT'], discipline_code: '0812' }))
const candidate = { expert_id: 'e', discipline_codes: ['0812'], direction_mismatch: false, avoided: false, service_status: 'AVAILABLE', qualification_status: 'APPROVED' }
const publishedRule = { version: 'pilot-single-v1', dimensions: [], required_experts: 1, mode: 'sum_dimensions', bands: [] }
const publishedOutcome = { code: 'PASS', label: '通过' }
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  api.dispatchQueue.mockResolvedValue(queue)
  api.dispatchCandidates.mockResolvedValue([candidate])
  api.listTheses.mockResolvedValue(queue.map(row => ({ id: row.thesis_id, stage: 'COMPLETED', allowed_actions: ['SUBMIT_OBJECTION'], recent_events: [], current_version: { title: row.title } })))
  api.getPublishedResult.mockImplementation(async (id) => ({ thesis_id: id, total: 80, items: [], rule_snapshot: publishedRule, outcome: publishedOutcome }))
  api.listMyObjections.mockResolvedValue([])
  api.listSchoolObjections.mockResolvedValue([])
})
async function page(component: typeof StudentPage | typeof DispatchPage | typeof PreparationPage | typeof ObjectionPage) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component }] })
  await router.push('/?thesisId=a')
  const wrapper = mount(component, { global: { plugins: [createPinia(), router], stubs: { PortalLayout: { props: ['contextLabel', 'userName'], template: '<div><slot/><slot name="modal"/></div>' } } } })
  await flushPromises()
  return { wrapper, router }
}
it('reopens rejected papers and allows assigning the next paper after refresh', async () => {
  const { wrapper } = await page(DispatchPage)
  expect(wrapper.find('[data-thesis-id="a"]').exists()).toBe(true)
  wrapper.getComponent(Candidates).vm.$emit('update:modelValue', ['e'])
  await flushPromises()
  expect(wrapper.get('[data-action="assign-experts"]').attributes('disabled')).toBeUndefined()
  api.dispatchQueue.mockResolvedValue([{ ...queue[0], allowed_actions: [] }, queue[1]])
  await wrapper.get('[data-action="assign-experts"]').trigger('click')
  await wrapper.get('[data-action="confirm-assign"]').trigger('click')
  await flushPromises()
  expect(api.assignExpert).toHaveBeenCalledWith('a', 'e', expect.anything())
  expect(wrapper.find('[data-thesis-id="a"]').exists()).toBe(false)
  wrapper.getComponent(Candidates).vm.$emit('update:modelValue', ['e'])
  await flushPromises()
  expect(wrapper.get('[data-action="assign-experts"]').attributes('disabled')).toBeUndefined()
})
it.each([{ direction_mismatch: true }, { service_status: 'UNAVAILABLE' }, { avoided: true }])('disables ineligible candidates %j', async (change) => {
  api.dispatchCandidates.mockResolvedValue([{ ...candidate, ...change }])
  const { wrapper } = await page(DispatchPage)
  expect(wrapper.getComponent(Candidates).props('rows')[0].rowType).toBe('conflicted')
})
it('does not present placeholder fees or completion statistics as real candidate data', async () => {
  const { wrapper } = await page(DispatchPage)
  const candidateTable = wrapper.getComponent(Candidates)
  expect(candidateTable.text()).not.toContain('费用标准')
  expect(candidateTable.text()).not.toContain('接单率')
  expect(candidateTable.text()).not.toContain('平均完成时间')
  expect(candidateTable.text()).not.toContain('¥ 0.00')
})
it('uses the current school context on the real objection page', async () => {
  const { wrapper } = await page(ObjectionPage)
  expect(wrapper.getComponent(PortalLayout).props('contextLabel')).toBe('学校端 · 本校')
})
it('shows current objection time', async () => {
  api.listMyObjections.mockResolvedValue([{ id: 'open', status: 'SUBMITTED', reason: '当前异议', created_at: '2026-09-21T12:00:00Z' }])
  const { wrapper } = await page(StudentPage)
  expect(wrapper.get('[data-objection-status]').text()).toContain('2026-09-21T12:00:00Z')
})
it('does not hide objection failures as unpublished results', async () => {
  api.listMyObjections.mockRejectedValue(new Error('异议加载失败'))
  const { wrapper } = await page(StudentPage)
  expect(wrapper.get('[role="alert"]').text()).toContain('异议加载失败')
  expect(wrapper.text()).not.toContain('结果尚未发布')
})
it('treats only result 404 as unpublished', async () => {
  api.getPublishedResult.mockRejectedValue({ isAxiosError: true, response: { status: 404 } })
  const { wrapper } = await page(StudentPage)
  expect(wrapper.text()).toContain('结果尚未发布')
  expect(api.listMyObjections).not.toHaveBeenCalled()
})
it('ignores late result responses after changing paper', async () => {
  const { wrapper, router } = await page(StudentPage)
  let resolveOld!: (value: unknown) => void
  api.getPublishedResult.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  await router.push('/?thesisId=b')
  await flushPromises()
  await router.push('/?thesisId=a')
  await flushPromises()
  resolveOld({ thesis_id: 'b', total: 1, items: [], rule_snapshot: publishedRule, outcome: publishedOutcome })
  await flushPromises()
  expect(wrapper.get('select:not([data-time-scope])').element.value).toBe('a')
  expect(wrapper.text()).toContain('80.0')
})
it('ignores late candidate responses from the previous paper', async () => {
  const { wrapper } = await page(DispatchPage)
  let resolveOld!: (value: unknown) => void
  api.dispatchCandidates.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  await wrapper.get('[data-thesis-id="b"]').trigger('click')
  api.dispatchCandidates.mockResolvedValueOnce([{ ...candidate, expert_id: 'current' }])
  await wrapper.get('[data-thesis-id="a"]').trigger('click')
  await flushPromises()
  resolveOld([{ ...candidate, expert_id: 'stale' }])
  await flushPromises()
  expect(wrapper.getComponent(Candidates).props('rows').map(row => row.id)).toEqual(['current'])
})
it('clears candidates and disables assignment when their request fails', async () => {
  const { wrapper } = await page(DispatchPage)
  wrapper.getComponent(Candidates).vm.$emit('update:modelValue', ['e'])
  api.dispatchCandidates.mockRejectedValueOnce(new Error('候选加载失败'))
  await wrapper.get('[data-thesis-id="b"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('候选加载失败')
  expect(wrapper.getComponent(Candidates).props('rows')).toEqual([])
  expect(wrapper.get('[data-action="assign-experts"]').attributes('disabled')).toBeDefined()
})

it('reassigns a selected active task to another expert after confirmation', async () => {
  api.dispatchQueue.mockResolvedValue([{ ...queue[0], allowed_actions: ['REASSIGN_EXPERT'], reassignable_task: { id: 'old-task', expert_id: 'old-expert' } }])
  const { wrapper } = await page(DispatchPage)
  await wrapper.get('[data-thesis-id="a"]').trigger('click')
  await flushPromises()
  wrapper.getComponent(Candidates).vm.$emit('update:modelValue', ['e'])
  await flushPromises()
  await wrapper.get('[data-action="reassign-selected"]').trigger('click')
  expect(wrapper.text()).not.toContain('300.00')
  expect(api.reassignExpert).not.toHaveBeenCalled()
  await wrapper.get('[data-action="confirm-reassign"]').trigger('click')
  await flushPromises()
  expect(api.reassignExpert).toHaveBeenCalledWith('old-task', 'e', expect.anything())
})
it('requires a reason and explicit confirmation before terminating a school paper', async () => {
  api.listSchoolTheses.mockResolvedValue([{ id: 'a', stage: 'UNDER_REVIEW', version: 4, allowed_actions: ['TERMINATE'], recent_events: [], current_version: { title: '论文a' } }])
  api.terminateThesis.mockResolvedValue({ stage: 'TERMINATED' })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const { wrapper } = await page(PreparationPage)
  wrapper.getComponent(SchoolTable).vm.$emit('select', 'a')
  await flushPromises()
  expect(wrapper.get('[data-action="terminate-thesis"]').attributes('disabled')).toBeDefined()
  await wrapper.get('textarea').setValue('学校终止送审')
  await wrapper.get('[data-action="terminate-thesis"]').trigger('click')
  expect(api.terminateThesis).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await wrapper.get('[data-action="terminate-thesis"]').trigger('click')
  await flushPromises()
  expect(api.terminateThesis).toHaveBeenCalledWith('a', { version: 4, reason: '学校终止送审' }, expect.anything())
  confirm.mockRestore()
})
