/**
 * R3-3 评审邀请（U4 计划 §19.6）：真实模式新页。断言移自 realWorkspace.spec（邀请部分），另加拒绝原因规则。
 */
import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth'

const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), getInvitation: vi.fn(), acceptTask: vi.fn(), rejectTask: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
enableAutoUnmount(afterEach)
const inBody = (selector: string) => document.body.querySelector<HTMLElement>(selector)

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'false')
  api.listExpertTasks.mockResolvedValue([{ id: 'done', status: 'SUBMITTED' }, { id: 'invite-1', status: 'INVITED' }])
  api.getInvitation.mockResolvedValue({ id: 'invite-1', status: 'INVITED', anonymous_id: 'A-001', anonymous_title: '匿名论文', discipline_code: '0812', discipline_name: '计算机科学与技术', fee: '0', deadline: { accept_due_at: '2026-11-08T15:59:00Z', overdue: false } })
})
afterEach(() => vi.unstubAllEnvs())

async function page() {
  const { default: Page } = await import('../InvitationDesk.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'expert-a', role: 'expert', displayName: '测试专家' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/expert/invitation'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}

it('renders the first invitation without an invented fee', async () => {
  const { wrapper } = await page()
  expect(api.getInvitation).toHaveBeenCalledWith('invite-1')
  expect(wrapper.text()).toContain('A-001')
  expect(wrapper.text()).toContain('匿名论文')
  expect(wrapper.text()).toContain('计算机科学与技术')
  expect(wrapper.text()).not.toContain('正在加载邀请信息')
  expect(wrapper.text()).not.toContain('评阅费')
  expect(wrapper.text()).not.toContain('¥')
})

it('accepts with confirmation and opens the exact task', async () => {
  const { wrapper, router } = await page()
  await wrapper.get('[data-action="accept-task"]').trigger('click'); await flushPromises()
  expect(inBody('[role="alertdialog"]')?.textContent).toContain('确认接受评审任务')
  inBody('[data-action="confirm-accept-task"]')!.click(); await flushPromises()
  expect(api.acceptTask).toHaveBeenCalledWith('invite-1')
  expect(router.currentRoute.value.fullPath).toBe('/expert/review?task_id=invite-1')
})

it('requires a reason to reject, and an explanation for 其他', async () => {
  const { wrapper } = await page()
  await wrapper.get('[data-action="open-reject-dialog"]').trigger('click'); await flushPromises()
  const confirm = () => inBody('[data-action="confirm-reject-task"]') as HTMLButtonElement
  expect(confirm().disabled).toBe(true)
  const select = inBody('[data-reject-reason]') as HTMLSelectElement
  select.value = '其他'; select.dispatchEvent(new Event('change')); await flushPromises()
  expect(confirm().disabled).toBe(true)
  const detail = inBody('[data-reject-reason-detail]') as HTMLTextAreaElement
  detail.value = '研究方向不熟悉'; detail.dispatchEvent(new Event('input')); await flushPromises()
  expect(confirm().disabled).toBe(false)
  confirm().click(); await flushPromises()
  expect(api.rejectTask).toHaveBeenCalledWith('invite-1', '其他：研究方向不熟悉')
  expect(wrapper.text()).toContain('当前没有待处理的评审邀请')
})

it('says when there is no invitation and when loading fails', async () => {
  api.listExpertTasks.mockResolvedValueOnce([{ id: 'done', status: 'SUBMITTED' }])
  const none = await page()
  expect(none.wrapper.text()).toContain('当前没有待处理的评审邀请')
  expect(api.getInvitation).not.toHaveBeenCalled()
  none.wrapper.unmount()
  api.listExpertTasks.mockRejectedValueOnce(new Error('网络不可用'))
  const failed = await page()
  expect(failed.wrapper.get('[role="alert"]').text()).toContain('网络不可用')
})
