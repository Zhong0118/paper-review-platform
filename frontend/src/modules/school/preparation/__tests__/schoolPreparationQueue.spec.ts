import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { mountAt, thesis } from './fixtures'

const api = vi.hoisted(() => ({ listSchoolTheses: vi.fn(), getSchoolThesis: vi.fn(), confirmAnonymization: vi.fn(), terminateThesis: vi.fn(), checkSensitiveThesis: vi.fn(), getFileContent: vi.fn(), confirmDispatch: vi.fn() }))
vi.mock('@/api/schoolReview', () => api)
vi.mock('@/api/sensitiveChecks', () => api)
vi.mock('@/api/files', () => api)
vi.mock('@/api/dispatch', () => api)
enableAutoUnmount(afterEach)

const loaded = [thesis('a'), thesis('b', { report: { auto_conclusion: 'REVIEW_REQUIRED' } }), thesis('c', { stage: 'READY_FOR_DISPATCH', allowed_actions: ['CONFIRM_DISPATCH'] }), thesis('d', { stage: 'DRAFT', allowed_actions: [] })]
beforeEach(() => {
  vi.resetAllMocks()
  api.listSchoolTheses.mockResolvedValue(loaded)
  api.getSchoolThesis.mockImplementation(async (id: string) => loaded.find((row) => row.id === id))
})
const tab = (w: Awaited<ReturnType<typeof mountAt>>['wrapper'], label: string) => w.findAll('[role="tab"]').find((t) => t.text().startsWith(label))!
const titles = (w: Awaited<ReturnType<typeof mountAt>>['wrapper']) => w.findAll('tbody .row-title').map((t) => t.text())

it('opens on the verify view and counts only the loaded set, saying so', async () => {
  const { wrapper } = await mountAt('/school/preparation')
  expect(api.listSchoolTheses).toHaveBeenCalledWith('all', expect.any(Function))
  expect(tab(wrapper, '待核验').attributes('aria-selected')).toBe('true')
  expect(tab(wrapper, '待核验').text()).toContain('2')
  expect(tab(wrapper, '全部').text()).toContain('4')
  expect(wrapper.text()).toContain('已加载的 4 篇')
  expect(titles(wrapper)).toEqual(['论文a', '论文b'])
  await tab(wrapper, '全部').trigger('click')
  await flushPromises()
  expect(titles(wrapper)).toEqual(['论文a', '论文b', '论文c', '论文d'])
})

it('searches inside the loaded set, keeps the search in the address and offers to clear a no-match', async () => {
  const { wrapper, router } = await mountAt('/school/preparation')
  await wrapper.get('input[type="search"]').setValue('不存在的题目')
  await flushPromises()
  expect(router.currentRoute.value.query.q).toBe('不存在的题目')
  expect(wrapper.text()).toContain('当前筛选没有匹配的论文')
  expect(tab(wrapper, '待核验').text()).toContain('2')
  await wrapper.findAll('button').find((b) => b.text() === '清除筛选')!.trigger('click')
  await flushPromises()
  expect(titles(wrapper)).toEqual(['论文a', '论文b'])
})

it('shows a failure without zero counts and reloads on retry', async () => {
  api.listSchoolTheses.mockRejectedValueOnce(new Error('Network Error'))
  const { wrapper } = await mountAt('/school/preparation')
  expect(wrapper.get('[role="alert"]').text()).toContain('没有加载出来')
  expect(tab(wrapper, '待核验').text()).toBe('待核验')
  await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
  await flushPromises()
  expect(titles(wrapper)).toEqual(['论文a', '论文b'])
})

it('tells an empty school apart from an empty view', async () => {
  api.listSchoolTheses.mockResolvedValueOnce([])
  const { wrapper } = await mountAt('/school/preparation')
  expect(wrapper.text()).toContain('还没有本校论文')
})

it('opens the verify desk with the queue state and restores filters and the selected row on return', async () => {
  const { wrapper, router } = await mountAt('/school/preparation?view=all&q=论文')
  const row = wrapper.findAll('tbody tr').find((r) => r.text().includes('论文b'))!
  await row.findAll('button').find((b) => b.text() === '开始核验')!.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query).toMatchObject({ view: 'all', q: '论文', thesis: 'b' })
  expect(wrapper.find('[aria-label="核验判断"]').exists()).toBe(true)
  await wrapper.findAll('a, button').find((b) => b.text().includes('返回清单'))!.trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.thesis).toBeUndefined()
  expect(router.currentRoute.value.query).toMatchObject({ view: 'all', q: '论文', sel: 'b' })
  expect((wrapper.get('input[type="search"]').element as HTMLInputElement).value).toBe('论文')
  expect(wrapper.get('tr.row--selected').text()).toContain('论文b')
  expect(wrapper.get('[aria-label="论文预览"]').text()).toContain('论文b')
})

it('closes the preview rather than switching to another row when the selection is filtered out', async () => {
  const { wrapper } = await mountAt('/school/preparation?sel=c')
  expect(wrapper.find('[aria-label="论文预览"]').exists()).toBe(false)
  expect(wrapper.find('tr.row--selected').exists()).toBe(false)
})

it('adds the ready-to-send and returned views (U2-4), counted from the loaded set', async () => {
  api.listSchoolTheses.mockResolvedValue([...loaded, thesis('e', { stage: 'DRAFT', return_reason: '匿名稿第 3 页含导师姓名', allowed_actions: ['TERMINATE'] })])
  const { wrapper, router } = await mountAt('/school/preparation')
  expect(tab(wrapper, '可送出').text()).toContain('1')
  expect(tab(wrapper, '已退回').text()).toContain('1')
  await tab(wrapper, '已退回').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.view).toBe('returned')
  expect(titles(wrapper)).toEqual(['论文e'])
  expect(wrapper.get('.row-reason').text()).toContain('匿名稿第 3 页含导师姓名')
})

it('confirms dispatch from the ready-to-send view in its own dialog and reloads the list', async () => {
  api.confirmDispatch.mockResolvedValue({})
  const { wrapper } = await mountAt('/school/preparation?view=dispatch')
  expect(titles(wrapper)).toEqual(['论文c'])
  await wrapper.get('[data-action="row-dispatch"]').trigger('click')
  expect(api.confirmDispatch).not.toHaveBeenCalled()
  api.listSchoolTheses.mockResolvedValue(loaded.filter((row) => row.id !== 'c'))
  await wrapper.get('[data-action="confirm-row-dispatch"]').trigger('click')
  await flushPromises()
  expect(api.confirmDispatch).toHaveBeenCalledWith('c', 3, { idempotencyKey: expect.any(String), quiet: true })
  expect(wrapper.get('.notice').text()).toContain('已确认送出《论文c》')
  expect(api.listSchoolTheses).toHaveBeenCalledTimes(2)
  expect(wrapper.text()).toContain('没有等待送出的论文')
})
