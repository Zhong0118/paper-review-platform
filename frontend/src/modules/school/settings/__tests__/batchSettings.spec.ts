import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReviewBatch } from '@/api/schoolOperations'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Page from '../BatchSettingsPage.vue'

const api = vi.hoisted(() => ({
  listBatches: vi.fn(), getSchoolReviewRule: vi.fn(), createBatch: vi.fn(), updateBatch: vi.fn(), saveDeadlines: vi.fn(),
  openBatch: vi.fn(), closeBatch: vi.fn(), archiveBatch: vi.fn(), getBatchCloseout: vi.fn(), listProgramVersions: vi.fn(), pinPrograms: vi.fn(),
}))
vi.mock('@/api/schoolOperations', () => api)
vi.mock('@/api/schoolPrograms', () => api)
enableAutoUnmount(afterEach)

const batch = (id: string, extra: Partial<ReviewBatch> = {}): ReviewBatch => ({
  id, code: `CODE-${id}`, name: `批次${id}`, status: 'DRAFT', start_at: '2026-09-01T00:00:00.000Z', end_at: '2026-12-20T00:00:00.000Z',
  rule_version: 1, version: 3, allowed_actions: ['EDIT', 'OPEN'], accept_days: null, review_days: 14, program_catalog_id: null, ...extra,
})
const rule = { version: 'pilot-v3', required_experts: 1, mode: 'sum', dimensions: [{ key: 'topicValue', label: '选题价值', max_score: 40 }, { key: 'methodology', label: '研究方法', max_score: 60 }], bands: [{ min: 80, max: 100, code: 'PASS', label: '通过' }] }
const versions = [{ id: 'cat-1', year: 2026, revision: 2, count: 48, source: 'csv', source_version: '教务 2026', published_at: '2026-08-01T00:00:00Z' }]
const empty = { unpublished: [], objections: [], corrections: [] }
let rows: ReviewBatch[]

beforeEach(() => {
  vi.resetAllMocks()
  rows = [batch('d'), batch('o', { status: 'OPEN', allowed_actions: ['CLOSE_SUBMISSIONS'], accept_days: 7, program_catalog_id: 'cat-1' }), batch('c', { status: 'SUBMISSION_CLOSED', allowed_actions: [] })]
  api.listBatches.mockImplementation(async () => rows.map((row) => ({ ...row })))
  api.getSchoolReviewRule.mockResolvedValue(rule)
  api.listProgramVersions.mockResolvedValue(versions)
  api.getBatchCloseout.mockResolvedValue(empty)
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/batch-rules', component: Page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
const click = async (w: VueWrapper, selector: string) => {
  await w.get(selector).trigger('click')
  await flushPromises()
}
const replace = (id: string, extra: Partial<ReviewBatch>) => (rows = rows.map((row) => (row.id === id ? { ...row, ...extra } : row)))

describe('batch settings', () => {
  it('lists open batches first, selects the first one and shows the read-only rule', async () => {
    const { wrapper, router } = await mountAt('/school/batch-rules')
    expect(api.listBatches).toHaveBeenCalledWith({ quiet: true })
    expect(wrapper.findAll('.wsd-titem__title').map((t) => t.text())).toEqual(['批次o', '批次d', '批次c'])
    expect(router.currentRoute.value.query.batch).toBe('o')
    expect(wrapper.get('[data-review-rule]').text()).toContain('pilot-v3，每篇 1 位专家，满分 100')
    expect(wrapper.get('[data-program-catalog]').text()).toContain('已绑定：2026 年第 2 版（48 项）')
  })

  it('offers lifecycle buttons only from allowed_actions and keeps an open batch name read-only', async () => {
    const { wrapper } = await mountAt('/school/batch-rules?batch=o')
    expect(wrapper.find('[data-action="close-batch"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="open-batch"]').exists()).toBe(false)
    expect(wrapper.get('[data-field="batch-name"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-field="review-days"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('只有草稿批次可以修改')
    wrapper.unmount()
    const closed = await mountAt('/school/batch-rules?batch=c')
    expect(closed.wrapper.find('.wsd-commit').exists()).toBe(false)
    expect(closed.wrapper.text()).toContain('全部发布或终止后才能归档')
  })

  it('saves basic info then deadlines with the version returned by the first step', async () => {
    api.updateBatch.mockResolvedValueOnce(batch('d', { version: 4, name: '批次d 新名' }))
    api.saveDeadlines.mockResolvedValueOnce(batch('d', { version: 5 }))
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    expect(wrapper.get('[data-action="open-batch"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[data-field="batch-name"]').setValue('批次d 新名')
    await wrapper.get('[data-field="accept-days"]').setValue('5')
    expect(wrapper.get('[data-action="open-batch"]').attributes('disabled')).toBeDefined()
    replace('d', { version: 5, name: '批次d 新名', accept_days: 5 })
    await click(wrapper, '[data-action="save-batch"]')
    expect(api.updateBatch).toHaveBeenCalledWith('d', { name: '批次d 新名', start_at: '2026-09-01T00:00:00.000Z', end_at: '2026-12-20T00:00:00.000Z', expected_version: 3 }, { quiet: true })
    expect(api.saveDeadlines).toHaveBeenCalledWith('d', 4, 5, 14, { quiet: true })
    expect(wrapper.text()).toContain('已保存。')
    expect(wrapper.get('[data-action="save-batch"]').attributes('disabled')).toBeDefined()
  })

  it('validates days before saving', async () => {
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    await wrapper.get('[data-field="accept-days"]').setValue('0')
    await click(wrapper, '[data-action="save-batch"]')
    expect(wrapper.text()).toContain('请填写 1–32767 的整数')
    expect(api.saveDeadlines).not.toHaveBeenCalled()
  })

  it('keeps the edit on a conflict, compares it with the server and can overwrite', async () => {
    api.saveDeadlines.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT')).mockResolvedValueOnce(batch('o', { version: 5 }))
    const { wrapper } = await mountAt('/school/batch-rules?batch=o')
    await wrapper.get('[data-field="review-days"]').setValue('10')
    replace('o', { version: 4, review_days: 20 })
    await click(wrapper, '[data-action="save-batch"]')
    const conflict = wrapper.get('[data-conflict]')
    expect(conflict.text()).toContain('没有保存')
    expect(conflict.findAll('tbody tr').map((tr) => tr.text())).toEqual(['评阅期限（天）1020'])
    expect((wrapper.get('[data-field="review-days"]').element as HTMLInputElement).value).toBe('10')
    await click(wrapper, '[data-action="keep-mine"]')
    expect(api.saveDeadlines).toHaveBeenLastCalledWith('o', 4, 7, 10, { quiet: true })
  })

  it('can drop the edit after a conflict and take the server value', async () => {
    api.saveDeadlines.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountAt('/school/batch-rules?batch=o')
    await wrapper.get('[data-field="review-days"]').setValue('10')
    replace('o', { version: 4, review_days: 20 })
    await click(wrapper, '[data-action="save-batch"]')
    await click(wrapper, '[data-action="take-theirs"]')
    expect((wrapper.get('[data-field="review-days"]').element as HTMLInputElement).value).toBe('20')
    expect(wrapper.find('[data-conflict]').exists()).toBe(false)
  })

  it('says which part was saved when the second step fails', async () => {
    api.updateBatch.mockResolvedValueOnce(batch('d', { version: 4, name: '新名' }))
    api.saveDeadlines.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务异常'))
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    await wrapper.get('[data-field="batch-name"]').setValue('新名')
    await wrapper.get('[data-field="accept-days"]').setValue('5')
    replace('d', { version: 4, name: '新名' })
    await click(wrapper, '[data-action="save-batch"]')
    expect(wrapper.get('.wsd-commit').text()).toContain('基本信息已保存；期限没有保存：服务异常')
    expect((wrapper.get('[data-field="accept-days"]').element as HTMLInputElement).value).toBe('5')
  })

  it('confirms a lifecycle change with a reused key and rereads on conflict', async () => {
    api.openBatch.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务异常')).mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    await click(wrapper, '[data-action="open-batch"]')
    expect(wrapper.get('.dlg').text()).toContain('期限尚未全部配置')
    await click(wrapper, '[data-action="confirm-lifecycle"]')
    expect(wrapper.get('.dlg [role="alert"]').text()).toBe('服务异常')
    await click(wrapper, '[data-action="confirm-lifecycle"]')
    const [first, second] = api.openBatch.mock.calls
    expect(first!.slice(0, 2)).toEqual(['d', 3])
    expect(second![2]).toEqual({ idempotencyKey: first![2].idempotencyKey, quiet: true })
    expect(wrapper.text()).toContain('批次在你打开之后有变化')
  })

  it('opens a draft batch and follows the new state', async () => {
    api.openBatch.mockResolvedValueOnce(batch('d', { status: 'OPEN' }))
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    replace('d', { status: 'OPEN', version: 4, allowed_actions: ['CLOSE_SUBMISSIONS'] })
    await click(wrapper, '[data-action="open-batch"]')
    await click(wrapper, '[data-action="confirm-lifecycle"]')
    expect(wrapper.text()).toContain('批次已开放')
    expect(wrapper.find('[data-action="close-batch"]').exists()).toBe(true)
    expect(api.getBatchCloseout).toHaveBeenCalledWith('d', { quiet: true })
  })

  it('pins a catalog version once after confirmation', async () => {
    api.pinPrograms.mockResolvedValueOnce({})
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    expect(wrapper.get('[data-action="pin-catalog"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-field="program-version"]').setValue('cat-1')
    await click(wrapper, '[data-action="pin-catalog"]')
    expect(wrapper.get('.dlg[aria-label="绑定本批校内专业目录"]').text()).toContain('绑定后本批不再更换或解绑')
    replace('d', { version: 4, program_catalog_id: 'cat-1' })
    await click(wrapper, '[data-action="confirm-pin"]')
    expect(api.pinPrograms).toHaveBeenCalledWith('d', 'cat-1', 3, { quiet: true })
    expect(wrapper.get('[data-program-catalog]').text()).toContain('已绑定：2026 年第 2 版')
  })

  it('links closeout items to the pages that finish them', async () => {
    api.getBatchCloseout.mockResolvedValue({
      unpublished: [{ id: 't1', thesis_id: 't1', title: '待发布论文', status: 'RESULT_PROCESSING' }, { id: 't2', thesis_id: 't2', title: '核验中论文', status: 'PREPARING' }],
      objections: [{ id: 'ob1', thesis_id: 't3', title: '有异议论文', status: 'SUBMITTED' }],
      corrections: [{ id: 'cr1', thesis_id: 't4', title: '有更正论文', status: 'AWAITING_SCHOOL' }],
    })
    const { wrapper } = await mountAt('/school/batch-rules?batch=c')
    const hrefs = wrapper.findAll('[data-closeout] a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/school/results?thesis=t1', '/school/preparation?thesis=t2', '/school/objections?objection=ob1', '/school/results?thesis=t4&correction=cr1'])
    expect(wrapper.get('[data-closeout]').text()).toContain('还有 4 项未完成')
  })

  it('creates a draft batch and marks a duplicate code on its field', async () => {
    api.createBatch.mockRejectedValueOnce(httpError(409, 'RESOURCE_CONFLICT', '批次代码已存在')).mockResolvedValueOnce(batch('n', { name: '新批次' }))
    const { wrapper, router } = await mountAt('/school/batch-rules')
    await click(wrapper, '[data-action="new-batch"]')
    await click(wrapper, '[data-action="submit-batch"]')
    expect(wrapper.text()).toContain('请填写批次代码')
    expect(api.createBatch).not.toHaveBeenCalled()
    await wrapper.get('[data-field="batch-code"]').setValue('CODE-d')
    await wrapper.get('[data-field="batch-name"]').setValue('新批次')
    await click(wrapper, '[data-action="submit-batch"]')
    expect(wrapper.text()).toContain('批次代码已存在')
    await wrapper.get('[data-field="batch-code"]').setValue('2027-AUT')
    rows = [...rows, batch('n', { name: '新批次' })]
    await click(wrapper, '[data-action="submit-batch"]')
    expect(api.createBatch).toHaveBeenLastCalledWith({ code: '2027-AUT', name: '新批次', start_at: null, end_at: null }, { idempotencyKey: expect.any(String), quiet: true })
    expect(router.currentRoute.value.query).toEqual({ batch: 'n' })
  })

  it('keeps sections working when the rule or versions fail', async () => {
    api.getSchoolReviewRule.mockRejectedValueOnce(httpError(500, 'INTERNAL', '规则服务异常'))
    api.listProgramVersions.mockRejectedValueOnce(httpError(500, 'INTERNAL', '目录服务异常'))
    const { wrapper } = await mountAt('/school/batch-rules?batch=d')
    expect(wrapper.get('[data-review-rule]').text()).toContain('规则服务异常')
    expect(wrapper.get('[data-program-catalog]').text()).toContain('目录服务异常')
    expect(wrapper.find('[data-field="batch-name"]').exists()).toBe(true)
  })

  it('starts on the list when narrow', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { wrapper, router } = await mountAt('/school/batch-rules')
    expect(router.currentRoute.value.query.batch).toBeUndefined()
    await click(wrapper, '.wsd-titem')
    expect(router.currentRoute.value.query.batch).toBe('o')
    await wrapper.findAll('button').find((b) => b.text().startsWith('‹'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.batch).toBeUndefined()
  })
})
