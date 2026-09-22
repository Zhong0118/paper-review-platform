import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Page from '../pages/PreparationListPage.vue'
import Panel from '../components/AnonymizationCheckPanel.vue'
import Table from '../components/SchoolThesisTable.vue'
const api = vi.hoisted(() => ({ listSchoolTheses: vi.fn(), confirmAnonymization: vi.fn(), terminateThesis: vi.fn() }))
vi.mock('@/api/schoolReview', () => api)
enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
const row = (id: string, conclusion: string | null) => ({ id, version: 3, stage: 'PREPARING', allowed_actions: ['CONFIRM_ANONYMIZATION'], current_version: { title: id }, anonymization: { auto_conclusion: conclusion, manual_conclusion: 'PASS' } })
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'false'); vi.resetAllMocks(); api.listSchoolTheses.mockResolvedValue([]) })
async function page() {
  const wrapper = mount(Page, { global: { plugins: [createPinia()], stubs: { PortalLayout: { template: '<div><slot/></div>' } } } })
  await flushPromises()
  return wrapper
}
it('counts latest recorded automatic outcomes, excluding unknowns and ignoring search/manual decisions', async () => {
  api.listSchoolTheses.mockResolvedValue([row('a', 'PASS'), row('b', 'PASS'), row('c', 'REVIEW_REQUIRED'), row('d', 'FAIL'), row('e', null), row('f', 'OTHER')])
  const wrapper = await page()
  expect(wrapper.text()).toContain('最近一次自动检测')
  expect(wrapper.text()).toContain('不代表当前版本已通过')
  expect(wrapper.getComponent(Panel).props()).toEqual({ pass: 2, reviewRequired: 1, failed: 1 })
  await wrapper.get('input').setValue('a')
  expect(wrapper.getComponent(Table).props('rows')).toHaveLength(1)
  expect(wrapper.getComponent(Panel).props('pass')).toBe(2)
})
it('shows zero only for a successfully loaded empty list', async () => {
  const wrapper = await page()
  expect(wrapper.getComponent(Panel).props()).toEqual({ pass: 0, reviewRequired: 0, failed: 0 })
})
it('hides misleading zero counts on failure and supports retry', async () => {
  api.listSchoolTheses.mockRejectedValueOnce(new Error('加载失败'))
  const wrapper = await page()
  expect(wrapper.findComponent(Panel).exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('加载失败')
  await wrapper.get('[data-action="reload-preparation"]').trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(Panel).props('pass')).toBe(0)
})
it('refreshes counts after a command and hides stale data if refresh fails', async () => {
  api.listSchoolTheses.mockResolvedValueOnce([row('a', 'PASS')]).mockResolvedValueOnce([row('a', 'REVIEW_REQUIRED')]).mockRejectedValueOnce(new Error('刷新失败'))
  api.confirmAnonymization.mockResolvedValue({ stage: 'READY_FOR_DISPATCH' })
  const wrapper = await page()
  wrapper.getComponent(Table).vm.$emit('select', 'a')
  await flushPromises()
  const approve = () => wrapper.findAll('button').find(button => button.text() === '通过匿名核验')!
  await approve().trigger('click')
  await flushPromises()
  expect(wrapper.getComponent(Panel).props('reviewRequired')).toBe(1)
  await approve().trigger('click')
  await flushPromises()
  expect(wrapper.findComponent(Panel).exists()).toBe(false)
  expect(wrapper.findComponent(Table).exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('刷新失败')
})
