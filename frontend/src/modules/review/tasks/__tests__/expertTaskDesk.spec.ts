/**
 * R3-3 专家任务（U4 计划 §19.6）：真实模式新页。断言移自 realWorkspace.spec（任务列表部分）与 timeScopePages.spec。
 */
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), acceptTask: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
enableAutoUnmount(afterEach)

const rows = [
  { id: 'a', status: 'SUBMITTED', anonymous_id: 'A-001', anonymous_title: '旧论文 A', allowed_actions: ['VIEW_SUBMITTED'] },
  { id: 'b', status: 'IN_REVIEW', anonymous_id: 'B-002', anonymous_title: '论文 B', discipline_name: '计算机科学与技术', allowed_actions: ['CONTINUE_REVIEW'], deadline: { review_due_at: '2026-11-20T15:59:00Z', overdue: false } },
]
const invited = { id: 'b', status: 'INVITED', anonymous_id: 'B-002', anonymous_title: '论文 B', allowed_actions: ['ACCEPT_TASK'], deadline: { accept_due_at: '2026-11-08T15:59:00Z' } }
const inBody = (selector: string) => document.body.querySelector<HTMLElement>(selector)

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'false'); localStorage.clear(); sessionStorage.clear()
  api.listExpertTasks.mockResolvedValue(rows)
})
afterEach(() => vi.unstubAllEnvs())

async function page() {
  const { default: Page } = await import('../ExpertTaskDesk.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'expert-a', role: 'expert', displayName: '测试专家' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/expert/tasks'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

it('opens on the first non-empty view and puts the task id on row links', async () => {
  const { wrapper } = await page()
  expect(wrapper.get('[data-tab="IN_REVIEW"]').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('[data-tab="IN_REVIEW"]').text()).toContain('1')
  expect(wrapper.get('[data-action="continue-review"]').attributes('href')).toBe('/expert/review?task_id=b')
  expect(wrapper.get('[data-expert-task="b"]').text()).toContain('计算机科学与技术')
})

it('switches views, including an empty one, with the pressed state and an empty note', async () => {
  const { wrapper } = await page()
  await wrapper.get('[data-tab="SUBMITTED"]').trigger('click')
  expect(wrapper.get('[data-tab="SUBMITTED"]').attributes('aria-pressed')).toBe('true')
  expect(wrapper.get('[data-expert-task]').text()).toContain('旧论文 A')
  expect(wrapper.get('[data-action="view-submitted"]').attributes('href')).toBe('/expert/review?task_id=a')
  await wrapper.get('[data-tab="CORRECTION_PENDING"]').trigger('click')
  expect(wrapper.get('[data-expert-task-table]').text()).toContain('当前分组暂无任务')
})

it('does not show an invented fee and accepts the exact invited task', async () => {
  api.listExpertTasks.mockResolvedValue([invited])
  const { wrapper, router } = await page()
  expect(wrapper.text()).not.toContain('费用')
  expect(wrapper.text()).not.toContain('¥')
  await wrapper.get('[data-action="accept-task"]').trigger('click'); await flushPromises()
  const dialog = inBody('[role="alertdialog"]')!
  expect(dialog.textContent).toContain('B-002')
  expect(dialog.textContent).not.toContain('¥')
  inBody('[data-action="confirm-accept-task"]')!.click(); await flushPromises()
  expect(api.acceptTask).toHaveBeenCalledWith('b')
  expect(router.currentRoute.value.path).toBe('/expert/review')
  expect(router.currentRoute.value.query.task_id).toBe('b')
})

it('keeps the accept dialog open with the error when accepting fails', async () => {
  api.listExpertTasks.mockResolvedValue([invited])
  api.acceptTask.mockRejectedValueOnce(new Error('任务已被改派'))
  const { wrapper, router } = await page()
  await wrapper.get('[data-action="accept-task"]').trigger('click'); await flushPromises()
  inBody('[data-action="confirm-accept-task"]')!.click(); await flushPromises()
  expect(inBody('[role="alertdialog"]')?.textContent).toContain('任务已被改派')
  expect(router.currentRoute.value.path).toBe('/expert/tasks')
})

it('shows a load failure in place and retries', async () => {
  api.listExpertTasks.mockRejectedValueOnce(new Error('网络不可用'))
  const { wrapper } = await page()
  expect(wrapper.get('[role="alert"]').text()).toContain('网络不可用')
  await wrapper.get('[data-action="retry-tasks"]').trigger('click'); await flushPromises()
  expect(wrapper.find('[data-expert-task="b"]').exists()).toBe(true)
})

it('sends the selected range and explains what past year leaves out', async () => {
  const { wrapper } = await page()
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  expect(api.listExpertTasks.mock.calls.at(-1)?.[0]).toBe('past_year')
  expect(wrapper.text()).toContain('较早建立论文的未结任务可能未显示')
})

it('keeps the last list when an older response arrives late', async () => {
  const { wrapper } = await page()
  let finish!: (value: unknown) => void
  api.listExpertTasks.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve })).mockResolvedValueOnce([{ ...rows[1], anonymous_title: '最后全部任务' }])
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  await wrapper.get('[data-time-scope]').setValue('all'); await flushPromises()
  finish([{ ...rows[1], anonymous_title: '过期的一年内任务' }]); await flushPromises()
  expect(wrapper.text()).toContain('最后全部任务')
  expect(wrapper.text()).not.toContain('过期的一年内任务')
})

it('reloads for a new account', async () => {
  const { wrapper } = await page()
  api.listExpertTasks.mockResolvedValueOnce([{ ...rows[1], anonymous_title: '新账号任务' }])
  useAuthStore().setSession('other-synthetic', { id: 'expert-b', role: 'expert', displayName: '新专家' })
  await flushPromises()
  expect(wrapper.text()).toContain('新账号任务')
  expect(wrapper.text()).not.toContain('论文 B')
})
