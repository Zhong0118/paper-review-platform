import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ listExperts: vi.fn(), expertOptions: vi.fn(), createExpert: vi.fn(), updateExpert: vi.fn(), reviewQualification: vi.fn(), setServiceStatus: vi.fn(), replaceConflicts: vi.fn(), previewExpertImport: vi.fn(), applyExpertImport: vi.fn(), downloadExpertTemplate: vi.fn() }))
vi.mock('@/api/expertOperations', () => api)
import RealExpertLibraryPage from '../pages/RealExpertLibraryPage.vue'
const record = { id: 'expert-1', username: 'expert.one', display_name: '虚构专家', unit: '原大学', title: '教授', discipline_codes: ['0812'], province_name: null, doctoral_supervisor: null, masters_supervisor: false, keywords: [], research_directions: [], source_url: null, source_note: null, source_checked_at: null, account_status: 'ACTIVE', qualification_status: 'APPROVED', service_status: 'AVAILABLE', conflicts: [], version: 1 }
const pending = { preview_id: 'preview-1', expires_at: '2099-01-01T00:00:00Z', errors: [], changes: [{ expert_id: 'expert-1', username: 'expert.one', version: 1, diff: { province_name: { before: '北京市', after: null }, doctoral_supervisor: { before: null, after: false } } }] }
async function page() {
  const w = mount(RealExpertLibraryPage, { global: { plugins: [createPinia()], stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } } } })
  await flushPromises(); return w
}
beforeEach(() => {
  vi.resetAllMocks(); api.listExperts.mockResolvedValue([record])
  api.expertOptions.mockResolvedValue({ schools: [], disciplines: [{ code: '0812', name: '计算机' }], provinces: ['北京市'], titles: ['教授'] })
  api.previewExpertImport.mockResolvedValue(structuredClone(pending)); api.applyExpertImport.mockResolvedValue({ preview_id: 'preview-1', updated_count: 1 })
})
it('offers controlled import and distinguishes unknown from false', async () => {
  const w = await page()
  expect(w.text()).toContain('人工维护'); expect(w.text()).toContain('博导：未知'); expect(w.text()).toContain('硕导：否')
  await w.get('[data-action="import-experts"]').trigger('click'); expect(w.get('[role="dialog"]').text()).toContain('仅更新已有专家')
})
async function upload(w: Awaited<ReturnType<typeof page>>) {
  await w.get('[data-action="import-experts"]').trigger('click')
  const input = w.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { value: [new File(['synthetic'], 'experts.csv', { type: 'text/csv' })], configurable: true })
  await input.trigger('change'); await w.get('[data-action="preview-import"]').trigger('click'); await flushPromises()
}
it('shows exact diff and explicit clearing, applies then refreshes', async () => {
  const w = await page(); await upload(w)
  expect(w.get('[role="dialog"]').text()).toContain('清空'); expect(w.get('[role="dialog"]').text()).toContain('未知 → 否')
  await w.get('[data-action="apply-import"]').trigger('click'); await flushPromises()
  expect(api.applyExpertImport).toHaveBeenCalledWith('preview-1', expect.any(String)); expect(api.listExperts).toHaveBeenCalledTimes(2)
  expect(w.find('[role="dialog"]').exists()).toBe(false)
})
it('blocks a preview with row errors', async () => {
  api.previewExpertImport.mockResolvedValue({ ...pending, errors: [{ row: 3, message: '用户名重复' }] })
  const w = await page(); await upload(w)
  expect(w.text()).toContain('第 3 行'); expect(w.get('[data-action="apply-import"]').attributes('disabled')).toBeDefined(); expect(api.applyExpertImport).not.toHaveBeenCalled()
})
it('retains the idempotency key after timeout and invalidates preview on 409', async () => {
  api.applyExpertImport.mockRejectedValueOnce(new Error('网络超时')).mockRejectedValueOnce({ response: { status: 409 } })
  const w = await page(); await upload(w)
  await w.get('[data-action="apply-import"]').trigger('click'); await flushPromises()
  await w.get('[data-action="apply-import"]').trigger('click'); await flushPromises()
  expect(api.applyExpertImport.mock.calls[0]).toEqual(api.applyExpertImport.mock.calls[1]); expect(w.text()).toContain('重新预览'); expect(w.find('[data-action="apply-import"]').exists()).toBe(false)
})
it('sends exact three-state filters and retains null in manual editing', async () => {
  const w = await page(); await w.get('[data-filter="doctoral_supervisor"]').setValue('unknown')
  await w.get('form').trigger('submit'); await flushPromises()
  expect(api.listExperts).toHaveBeenLastCalledWith(expect.objectContaining({ doctoral_supervisor: 'unknown' }))
  await w.findAll('button').find(b => b.text() === '编辑资料')!.trigger('click')
  await w.get('[data-action="save-expert"]').trigger('click'); await flushPromises()
  expect(api.updateExpert).toHaveBeenCalledWith('expert-1', expect.objectContaining({ doctoral_supervisor: null, masters_supervisor: false, version: 1 }))
})

it('hides expired diffs and requires a fresh preview', async () => {
  api.previewExpertImport.mockResolvedValue({ ...pending, expires_at: '2000-01-01T00:00:00Z' })
  const w = await page(); await upload(w)
  expect(w.text()).toContain('已过期'); expect(w.text()).not.toContain('北京市 → 清空')
  expect(w.get('[data-action="apply-import"]').attributes('disabled')).toBeDefined()
})
it('does not apply a late preview after the dialog closes', async () => {
  let resolve!: (value: typeof pending) => void
  api.previewExpertImport.mockReturnValue(new Promise(r => { resolve = r }))
  const w = await page(); await upload(w); w.unmount(); resolve(pending); await flushPromises()
  expect(api.applyExpertImport).not.toHaveBeenCalled()
})
