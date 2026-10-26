import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { useAuthStore } from '@/stores/auth'
const api = vi.hoisted(() => ({ listExpertTasks: vi.fn(), acceptTask: vi.fn() }))
vi.mock('@/api/expertTasks', () => api)
enableAutoUnmount(afterEach)
const row = (title: string) => ({ id: title, status: 'IN_REVIEW', anonymous_title: title, allowed_actions: ['CONTINUE_REVIEW'] })
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('VITE_DEMO_MODE', 'false'); localStorage.clear(); sessionStorage.clear(); api.listExpertTasks.mockResolvedValue([row('原任务')]) })
async function page() {
  const { default: Page } = await import('@/modules/review/pages/ExpertTasksPage.vue')
  const pinia = createPinia(); setActivePinia(pinia)
  useAuthStore().setSession('synthetic', { id: 'expert-a', role: 'expert', displayName: '测试专家' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { render: () => null } }] })
  await router.push('/expert/tasks'); await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [pinia, router] } }); await flushPromises()
  return wrapper
}
it('sends the selected range from the actual expert task page', async () => {
  const wrapper = await page()
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  expect(api.listExpertTasks.mock.calls.at(-1)?.[0]).toBe('past_year')
  expect(wrapper.text()).toContain('较早建立论文的未结任务可能未显示')
})
it('keeps the last list and its counts when an older response arrives late', async () => {
  const wrapper = await page()
  let finish!: (value: unknown) => void
  api.listExpertTasks.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce([row('最后全部任务')])
  await wrapper.get('[data-time-scope]').setValue('past_year'); await flushPromises()
  await wrapper.get('[data-time-scope]').setValue('all'); await flushPromises()
  finish([row('过期的一年内任务')]); await flushPromises()
  expect(wrapper.text()).toContain('最后全部任务')
  expect(wrapper.text()).not.toContain('过期的一年内任务')
})
it('reloads for a new account even when both accounts prefer all', async () => {
  const wrapper = await page()
  expect(wrapper.text()).toContain('原任务')
  api.listExpertTasks.mockResolvedValueOnce([row('新账号任务')])
  useAuthStore().setSession('other-synthetic', { id: 'expert-b', role: 'expert', displayName: '新专家' })
  await flushPromises()
  expect(wrapper.text()).toContain('新账号任务')
  expect(wrapper.text()).not.toContain('原任务')
})
