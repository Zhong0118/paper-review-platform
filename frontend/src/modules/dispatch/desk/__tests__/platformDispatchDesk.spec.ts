import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { DispatchCandidate, DispatchQueueItem } from '@/api/dispatch'
import Desk from '../PlatformDispatchDesk.vue'

const api = vi.hoisted(() => ({ dispatchQueue: vi.fn(), dispatchCandidates: vi.fn(), assignExpert: vi.fn(), reassignExpert: vi.fn() }))
vi.mock('@/api/dispatch', async (original) => ({ ...(await original<typeof import('@/api/dispatch')>()), ...api }))
enableAutoUnmount(afterEach)

const deadline = (overdue = false) => ({ invited_at: null, accepted_at: null, accept_due_at: null, review_due_at: '2026-11-20T02:00:00Z', overdue })
const row = (id: string, extra: Partial<DispatchQueueItem> = {}): DispatchQueueItem => ({
  thesis_id: id, title: `论文${id}`, student_name: `学生${id}`, discipline_code: '0812', stage: 'READY_FOR_DISPATCH', tasks: [], reassignable_task: null, allowed_actions: ['ASSIGN_EXPERT'], ...extra,
})
const expert = (id: string, extra: Partial<DispatchCandidate> = {}): DispatchCandidate => ({
  expert_id: id, display_name: `专家${id}`, username: id, unit: '示例研究院', match_score: 10, candidate_version: 7, hard_allowed: true, qualification_status: 'APPROVED', service_status: 'AVAILABLE',
  allowed_actions: ['ASSIGN_EXPERT', 'REASSIGN_EXPERT'], workload: { invited: 0, in_review: 1, total: 1 }, match_reasons: [{ kind: 'research_direction', tag: '图神经网络', points: 6 }], ...extra,
} as DispatchCandidate)

const queue = [
  row('a'),
  row('b', { tasks: [{ status: 'REJECTED' }] }),
  row('c', { stage: 'UNDER_REVIEW', allowed_actions: ['REASSIGN_EXPERT'], tasks: [{ status: 'IN_REVIEW', deadline: deadline() }], reassignable_task: { id: 'task-c', expert_id: 'e1' } }),
  row('d', { stage: 'UNDER_REVIEW', allowed_actions: [], tasks: [{ status: 'IN_REVIEW', deadline: deadline(true) }] }),
]

beforeEach(() => {
  vi.resetAllMocks()
  api.dispatchQueue.mockResolvedValue(queue)
  api.dispatchCandidates.mockResolvedValue([expert('e1', { match_score: 4 }), expert('e2', { match_score: 12 }), expert('e3', { avoided: true })])
  api.assignExpert.mockResolvedValue({})
  api.reassignExpert.mockResolvedValue({})
})

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/platform/dispatch', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Desk, { global: { plugins: [createPinia(), router], stubs: { ExtensionPanel: { template: '<div data-extension-panel />' } } }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
type W = Awaited<ReturnType<typeof mountAt>>['wrapper']
const tab = (w: W, label: string) => w.findAll('[role="tab"]').find((t) => t.text().startsWith(label))!
const listTitles = (w: W) => w.findAll('[data-thesis-row] .titem__title').map((t) => t.text())
const candidateNames = (w: W) => w.findAll('.ctable tbody tr:not(.row--blocked):not(.divider) .who strong').map((t) => t.text())

it('splits the queue into pending, active and follow-up views and selects the first pending thesis', async () => {
  const { wrapper, router } = await mountAt('/platform/dispatch')
  expect(tab(wrapper, '待指派').text()).toContain('2')
  expect(tab(wrapper, '进行中').text()).toContain('1')
  expect(tab(wrapper, '需跟进').text()).toContain('1')
  expect(listTitles(wrapper)).toEqual(['论文a', '论文b'])
  expect(router.currentRoute.value.query.thesis).toBe('a')
  expect(wrapper.text()).toContain('上一位专家已拒绝，待重新指派')
  await tab(wrapper, '需跟进').trigger('click')
  await flushPromises()
  expect(listTitles(wrapper)).toEqual(['论文d'])
  expect(wrapper.text()).toContain('已逾期')
})

it('orders available candidates by score and keeps server-side blocks apart with their reason', async () => {
  const { wrapper } = await mountAt('/platform/dispatch')
  expect(api.dispatchCandidates).toHaveBeenCalledWith('a', { quiet: true })
  expect(candidateNames(wrapper)).toEqual(['专家e2', '专家e1'])
  const blocked = wrapper.get('.row--blocked')
  expect(blocked.text()).toContain('专家e3')
  expect(blocked.text()).toContain('回避')
  expect(blocked.get('input').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('研究方向：图神经网络 +6')
  expect((wrapper.get('[data-action="commit-dispatch"]').element as HTMLButtonElement).disabled).toBe(true)
})

it('assigns with the candidate version and a stable key on retry, then reports the invitation', async () => {
  api.assignExpert.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: { status: 503 } }))
  const { wrapper } = await mountAt('/platform/dispatch')
  await wrapper.get('input[value="e2"]').setValue(true)
  expect(wrapper.get('[data-action="commit-dispatch"]').text()).toBe('确认指派')
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-dispatch-result]').text()).toContain('没有指派，可以重试')
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  const [first, second] = api.assignExpert.mock.calls
  expect(first[0]).toBe('a')
  expect(first[1]).toBe('e2')
  expect(first[3]).toBe(7)
  expect(second[2].idempotencyKey).toBe(first[2].idempotencyKey)
  expect(wrapper.get('[data-dispatch-flash]').text()).toContain('已向专家e2发出《论文a》的评阅邀请')
})

it('names a re-assignment after a rejection differently from a reassign', async () => {
  const { wrapper } = await mountAt('/platform/dispatch?thesis=b')
  expect(wrapper.text()).toContain('这是一次新的指派，不是改派')
  await wrapper.get('input[value="e1"]').setValue(true)
  expect(wrapper.get('[data-action="commit-dispatch"]').text()).toBe('重新指派')
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  expect(api.assignExpert).toHaveBeenCalledWith('b', 'e1', expect.any(Object), 7)
  expect(api.reassignExpert).not.toHaveBeenCalled()
})

it('refreshes candidates on 409 and asks for a fresh choice', async () => {
  api.assignExpert.mockRejectedValueOnce(Object.assign(new Error('conflict'), { response: { status: 409 } }))
  const { wrapper } = await mountAt('/platform/dispatch')
  await wrapper.get('input[value="e2"]').setValue(true)
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  expect(api.dispatchCandidates).toHaveBeenCalledTimes(2)
  expect(wrapper.get('[data-dispatch-result]').text()).toContain('候选已刷新，请重新选择')
  expect((wrapper.get('input[value="e2"]').element as HTMLInputElement).checked).toBe(false)
})

it('reassigns only through its own confirmation, excluding the current expert', async () => {
  const { wrapper } = await mountAt('/platform/dispatch?view=active&thesis=c')
  expect(wrapper.find('.ctable').exists()).toBe(false)
  await wrapper.get('[data-action="start-reassign"]').trigger('click')
  await flushPromises()
  expect(candidateNames(wrapper)).toEqual(['专家e2'])
  expect(wrapper.get('.row--blocked').text()).toContain('当前任务专家')
  await wrapper.get('input[value="e2"]').setValue(true)
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  expect(api.reassignExpert).not.toHaveBeenCalled()
  expect(wrapper.get('.swap').text()).toContain('专家e1')
  await wrapper.get('[data-action="confirm-reassign"]').trigger('click')
  await flushPromises()
  expect(api.reassignExpert).toHaveBeenCalledWith('task-c', 'e2', expect.any(Object), 7)
  expect(api.assignExpert).not.toHaveBeenCalled()
  expect(wrapper.get('[data-dispatch-flash]').text()).toContain('《论文c》已改派给专家e2')
})

it('tells an empty expert pool apart from all-blocked candidates and from a load error', async () => {
  api.dispatchCandidates.mockResolvedValueOnce([])
  const { wrapper } = await mountAt('/platform/dispatch')
  expect(wrapper.text()).toContain('专家库里没有 0812 方向的专家')
  expect(wrapper.text()).toContain('这不是推荐失败')

  api.dispatchCandidates.mockResolvedValueOnce([expert('x', { service_status: 'PAUSED' }), expert('y', { service_status: 'PAUSED' })])
  await wrapper.findAll('[data-thesis-row]')[1].trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('有 2 位候选，但当前都不可指派')
  expect(wrapper.text()).toContain('暂停服务 2 位')

  api.dispatchCandidates.mockRejectedValueOnce(new Error('Network Error'))
  await wrapper.findAll('[data-thesis-row]')[0].trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('候选专家没有加载出来')
  await wrapper.findAll('button').find((b) => b.text() === '重试' && b.element.closest('.cands'))!.trigger('click')
  await flushPromises()
  expect(candidateNames(wrapper)).toEqual(['专家e2', '专家e1'])
})

it('shows a queue failure without counts and retries', async () => {
  api.dispatchQueue.mockRejectedValueOnce(new Error('Network Error'))
  const { wrapper } = await mountAt('/platform/dispatch')
  expect(wrapper.text()).toContain('派单清单没有加载出来')
  expect(tab(wrapper, '待指派').text()).toBe('待指派')
  await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
  await flushPromises()
  expect(listTitles(wrapper)).toEqual(['论文a', '论文b'])
})

it('opens the extension approvals on demand', async () => {
  const { wrapper } = await mountAt('/platform/dispatch')
  expect(wrapper.find('[data-extension-panel]').exists()).toBe(false)
  await wrapper.get('[data-action="toggle-extensions"]').trigger('click')
  expect(wrapper.find('[data-extension-panel]').exists()).toBe(true)
})

it('keeps the success notice after the thesis leaves the pending view', async () => {
  const { wrapper, router } = await mountAt('/platform/dispatch')
  api.dispatchQueue.mockResolvedValue([row('a', { stage: 'UNDER_REVIEW', allowed_actions: [], tasks: [{ status: 'INVITED', deadline: deadline() }] }), ...queue.slice(1)])
  await wrapper.get('input[value="e2"]').setValue(true)
  await wrapper.get('[data-action="commit-dispatch"]').trigger('click')
  await flushPromises()
  expect(listTitles(wrapper)).toEqual(['论文b'])
  expect(router.currentRoute.value.query.thesis).toBe('b')
  expect(wrapper.get('[data-dispatch-flash]').text()).toContain('《论文a》')
})

it('on a narrow screen shows the list first, then the detail with a way back', async () => {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia
  try {
    const { wrapper, router } = await mountAt('/platform/dispatch')
    expect(router.currentRoute.value.query.thesis).toBeUndefined()
    expect(wrapper.find('[aria-label="当前论文"]').exists()).toBe(false)
    await wrapper.findAll('[data-thesis-row]')[0].trigger('click')
    await flushPromises()
    expect(wrapper.get('[aria-label="论文清单"]').isVisible()).toBe(false)
    expect(wrapper.get('[aria-label="当前论文"]').text()).toContain('论文a')
    await wrapper.findAll('button').find((b) => b.text() === '‹ 论文清单')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.thesis).toBeUndefined()
    expect(wrapper.get('[aria-label="论文清单"]').isVisible()).toBe(true)
  } finally {
    window.matchMedia = original
  }
})
