import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ listBatches: vi.fn(), getSchoolReviewRule: vi.fn(), createBatch: vi.fn(), updateBatch: vi.fn(), openBatch: vi.fn(), closeBatch: vi.fn(), archiveBatch: vi.fn() }))
vi.mock('@/api/schoolOperations', () => api)
import Page from '../pages/BatchRulesPage.vue'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => { vi.stubEnv('VITE_DEMO_MODE', 'false'); vi.resetAllMocks(); api.listBatches.mockResolvedValue([]); api.getSchoolReviewRule.mockResolvedValue({ version: 'pilot-single-v1', required_experts: 1, mode: 'sum_dimensions', dimensions: [{ key: 'topicValue', label: '选题价值', max_score: 15 }], bands: [] }) })

const draft = { id: 'batch-1', code: '2027-spring', name: '2027 春季', status: 'DRAFT', start_at: null, end_at: null, rule_version: 1, version: 3, allowed_actions: ['EDIT', 'OPEN'] }
async function page() {
  const wrapper = mount(Page, { global: { plugins: [createPinia()], stubs: { PortalLayout: { template: '<div><slot/></div>' } } } })
  await flushPromises()
  return wrapper
}

it('shows live empty and error states without demo fees or versions', async () => {
  api.listBatches.mockResolvedValueOnce([draft]).mockRejectedValueOnce(new Error('加载失败')).mockResolvedValueOnce([])
  const wrapper = await page()
  expect(wrapper.text()).toContain('2027 春季')
  expect(wrapper.text()).toContain('pilot-single-v1')
  expect(wrapper.text()).not.toContain('¥300')
  expect(wrapper.text()).not.toContain('DEMO-2026')
  await wrapper.get('[data-action="reload-batches"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('加载失败')
  expect(wrapper.text()).not.toContain('2027 春季')
  await wrapper.get('[data-action="reload-batches"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('尚无送审批次')
})

it('shows the server rule read-only and never offers a rule editor', async () => {
  const wrapper = await page()
  expect(api.getSchoolReviewRule).toHaveBeenCalledOnce()
  expect(wrapper.text()).toContain('选题价值')
  expect(wrapper.find('[data-action="edit-rule"]').exists()).toBe(false)
})

it('uses allowed actions and current version, refreshing the server state on conflict', async () => {
  api.listBatches.mockResolvedValueOnce([draft]).mockResolvedValueOnce([{ ...draft, status: 'OPEN', version: 4, allowed_actions: ['CLOSE_SUBMISSIONS'] }])
  api.openBatch.mockRejectedValueOnce({ response: { status: 409 } })
  const wrapper = await page()
  expect(wrapper.find('[data-action="open-batch"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="archive-batch"]').exists()).toBe(false)
  await wrapper.get('[data-action="open-batch"]').trigger('click')
  await flushPromises()
  expect(api.openBatch).toHaveBeenCalledWith('batch-1', 3, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect(api.listBatches).toHaveBeenCalledTimes(2)
  expect(wrapper.find('[data-action="open-batch"]').exists()).toBe(false)
  expect(wrapper.find('[data-action="close-batch"]').exists()).toBe(true)
})

it('creates a batch with ISO times and edits only the draft version', async () => {
  api.listBatches.mockResolvedValue([draft])
  api.createBatch.mockResolvedValue(draft)
  api.updateBatch.mockResolvedValue({ ...draft, version: 4 })
  const wrapper = await page()
  await wrapper.get('[data-action="new-batch"]').trigger('click')
  await wrapper.get('[data-field="batch-code"]').setValue('2028-spring')
  await wrapper.get('[data-field="batch-name"]').setValue('2028 春季')
  await wrapper.get('[data-field="start-at"]').setValue('2028-03-01T09:00')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()
  expect(api.createBatch).toHaveBeenCalledWith(expect.objectContaining({
    code: '2028-spring', name: '2028 春季', start_at: expect.stringMatching(/^2028-03-01T/), end_at: null,
  }), expect.objectContaining({ idempotencyKey: expect.any(String) }))
  await wrapper.get('[data-action="edit-batch"]').trigger('click')
  await wrapper.get('[data-field="batch-name"]').setValue('2027 春季修订')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()
  expect(api.updateBatch).toHaveBeenCalledWith('batch-1', expect.objectContaining({ name: '2027 春季修订', expected_version: 3 }))
})

it('discards the old edit form when a conflict finds the batch already open', async () => {
  api.listBatches.mockResolvedValueOnce([draft]).mockResolvedValueOnce([{
    ...draft, name: '已开放批次', status: 'OPEN', version: 4, allowed_actions: ['CLOSE_SUBMISSIONS'],
  }])
  api.updateBatch.mockRejectedValueOnce({ response: { status: 409 } })
  const wrapper = await page()
  await wrapper.get('[data-action="edit-batch"]').trigger('click')
  await wrapper.get('[data-field="batch-name"]').setValue('过期编辑')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()

  expect(api.updateBatch).toHaveBeenCalledWith('batch-1', expect.objectContaining({ name: '过期编辑', expected_version: 3 }))
  expect(api.listBatches).toHaveBeenCalledTimes(2)
  expect(wrapper.find('.batch-form').exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('数据已变更')
  expect(wrapper.text()).toContain('已开放批次')
  expect(wrapper.find('[data-action="edit-batch"]').exists()).toBe(false)
})

it('requires reopening a refreshed draft after an edit conflict', async () => {
  api.listBatches.mockResolvedValueOnce([draft]).mockResolvedValueOnce([{
    ...draft, name: '服务端修订', version: 4,
  }]).mockResolvedValueOnce([{ ...draft, name: '再次修订', version: 5 }])
  api.updateBatch.mockRejectedValueOnce({ response: { status: 409 } }).mockResolvedValueOnce({ ...draft, version: 5 })
  const wrapper = await page()
  await wrapper.get('[data-action="edit-batch"]').trigger('click')
  await wrapper.get('[data-field="batch-name"]').setValue('过期编辑')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()

  expect(wrapper.find('.batch-form').exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('数据已变更')
  await wrapper.get('[data-action="edit-batch"]').trigger('click')
  expect((wrapper.get('[data-field="batch-name"]').element as HTMLInputElement).value).toBe('服务端修订')
  await wrapper.get('[data-field="batch-name"]').setValue('再次修订')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()

  expect(api.updateBatch).toHaveBeenCalledTimes(2)
  expect(api.updateBatch).toHaveBeenLastCalledWith('batch-1', expect.objectContaining({ name: '再次修订', expected_version: 4 }))
})

it('clears a stale conflict warning after an explicit successful refresh', async () => {
  api.listBatches.mockResolvedValue([draft])
  api.updateBatch.mockRejectedValueOnce({ response: { status: 409 } })
  const wrapper = await page()
  await wrapper.get('[data-action="edit-batch"]').trigger('click')
  await wrapper.get('[data-field="batch-name"]').setValue('过期编辑')
  await wrapper.get('[data-action="submit-batch"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('数据已变更')
  await wrapper.get('[data-action="reload-batches"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})
