import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Correction } from '@/api/corrections'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Desk from '../CorrectionApprovalDesk.vue'

const api = vi.hoisted(() => ({ listCorrections: vi.fn(), correctionCommand: vi.fn() }))
vi.mock('@/api/corrections', () => api)
enableAutoUnmount(afterEach)

const SECRET = '更正后的总体评价原文'
const correction = (id: string, extra: Partial<Correction> = {}): Correction => ({
  id, task_id: `task-${id}-0000-1111`, thesis_id: `thesis-${id}`, status: 'REQUESTED', version: 2, base_result_id: 'r', base_revision_id: null,
  created_at: '2026-10-08T09:30:00Z', notes: [{ kind: 'EXPERT_REQUEST', reason: `申请理由 ${id}` }], revision: null, ...extra,
})
let rows: Correction[]
const replace = (id: string, extra: Partial<Correction>) => (rows = rows.map((row) => (row.id === id ? { ...row, ...extra } : row)))

beforeEach(() => {
  vi.resetAllMocks()
  rows = [
    correction('a'),
    correction('b', {
      status: 'AWAITING_SCHOOL', version: 4,
      notes: [{ kind: 'EXPERT_REQUEST', reason: '申请理由 b' }, { kind: 'PLATFORM_DECISION', reason: '同意' }],
      revision: { id: 'rv', total: 88, payload: { overallComment: SECRET } as never, check_summary: null },
    }),
    correction('c', { status: 'REQUESTED', version: 1 }),
  ]
  api.listCorrections.mockImplementation(async () => rows.map((row) => ({ ...row })))
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/platform/corrections', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Desk, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
const click = async (w: VueWrapper, selector: string) => {
  await w.get(selector).trigger('click')
  await flushPromises()
}
async function decideWith(w: VueWrapper, action: string, text: string) {
  await click(w, `[data-action="${action}"]`)
  await w.get('[data-field="decision-reason"]').setValue(text)
  await click(w, '[data-action="confirm-decision"]')
}

describe('correction approval desk', () => {
  it('lists pending requests with counts and opens the first one', async () => {
    const { wrapper, router } = await mountAt('/platform/corrections')
    expect(api.listCorrections).toHaveBeenCalledWith('platform', { quiet: true })
    expect(wrapper.findAll('.wsd-views__count').map((c) => c.text())).toEqual(['2', '1', '3'])
    expect(wrapper.findAll('.wsd-titem__title').map((t) => t.text())).toEqual(['任务 task-a-0', '任务 task-c-0'])
    expect(router.currentRoute.value.query.correction).toBe('a')
    expect(wrapper.get('[data-request]').text()).toContain('申请理由 a')
    expect(wrapper.find('[data-action="approve-correction"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('更正审批')
  })

  it('shows only request information for a submitted correction and never the revision', async () => {
    const { wrapper } = await mountAt('/platform/corrections?view=done&correction=b')
    expect(wrapper.get('[data-notes]').text()).toContain('平台审批')
    expect(wrapper.get('[data-progress] .now').text()).toContain('学校确认生效')
    expect(wrapper.text()).not.toContain(SECRET)
    expect(wrapper.text()).not.toContain('88')
    expect(wrapper.find('[data-action="approve-correction"]').exists()).toBe(false)
  })

  it('says when a linked request is not visible', async () => {
    const { wrapper } = await mountAt('/platform/corrections?correction=gone')
    expect(wrapper.text()).toContain('这条更正申请已不可见')
  })

  it('requires a reason and approves with the version and a key', async () => {
    api.correctionCommand.mockResolvedValueOnce({ ...rows[0], status: 'APPROVED' })
    const { wrapper } = await mountAt('/platform/corrections?correction=a')
    await click(wrapper, '[data-action="approve-correction"]')
    await click(wrapper, '[data-action="confirm-decision"]')
    expect(api.correctionCommand).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写批准说明。')
    replace('a', { status: 'APPROVED', version: 3 })
    await wrapper.get('[data-field="decision-reason"]').setValue(' 录入错误，同意更正 ')
    await click(wrapper, '[data-action="confirm-decision"]')
    expect(api.correctionCommand).toHaveBeenCalledWith('decide', 'a', { version: 2, decision: 'APPROVE', reason: '录入错误，同意更正' }, expect.any(String), { quiet: true })
    expect(wrapper.text()).toContain('已批准。专家现在可以起草更正稿')
    expect(wrapper.find('[data-action="approve-correction"]').exists()).toBe(false)
  })

  it('reuses the key for the same retry and changes it when the reason changes', async () => {
    api.correctionCommand.mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', '服务暂时不可用'))
    api.correctionCommand.mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', '服务暂时不可用'))
    api.correctionCommand.mockResolvedValueOnce({ ...rows[0], status: 'REJECTED' })
    const { wrapper } = await mountAt('/platform/corrections?correction=a')
    await decideWith(wrapper, 'reject-correction', '理由不足')
    expect(document.body.textContent).toContain('服务暂时不可用')
    await click(wrapper, '[data-action="confirm-decision"]')
    await wrapper.get('[data-field="decision-reason"]').setValue('理由不足，原分数无误')
    await click(wrapper, '[data-action="confirm-decision"]')
    const keys = api.correctionCommand.mock.calls.map((call) => call[3])
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[1])
    expect(api.correctionCommand.mock.calls[2]![2]).toEqual({ version: 2, decision: 'REJECT', reason: '理由不足，原分数无误' })
    expect(wrapper.text()).toContain('已驳回。专家会看到驳回原因')
  })

  it('on 409 rereads and says the request was already handled', async () => {
    api.correctionCommand.mockRejectedValueOnce(httpError(409, 'RESOURCE_CONFLICT', '状态已变化'))
    const { wrapper } = await mountAt('/platform/corrections?correction=a')
    replace('a', { status: 'APPROVED', version: 3, notes: [...rows[0]!.notes, { kind: 'PLATFORM_DECISION', reason: '另一位运营已同意' }] })
    await decideWith(wrapper, 'approve-correction', '同意')
    expect(wrapper.get('[data-notice]').text()).toContain('这条申请已被处理')
    expect(wrapper.get('[data-notice]').text()).toContain('当前状态：已批准，待专家提交')
    expect(wrapper.get('[data-notes]').text()).toContain('另一位运营已同意')
  })

  it('on 409 with the request still pending asks to check and keeps the reason', async () => {
    api.correctionCommand.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '版本已变化，请刷新后重试'))
    const { wrapper } = await mountAt('/platform/corrections?correction=a')
    replace('a', { version: 5 })
    await decideWith(wrapper, 'reject-correction', '不同意')
    expect(wrapper.get('[data-notice]').text()).toContain('版本已变化，请刷新后重试')
    api.correctionCommand.mockResolvedValueOnce({ ...rows[0], status: 'REJECTED' })
    await click(wrapper, '[data-action="reject-correction"]')
    expect((wrapper.get('[data-field="decision-reason"]').element as HTMLTextAreaElement).value).toBe('不同意')
    await click(wrapper, '[data-action="confirm-decision"]')
    expect(api.correctionCommand.mock.calls[1]![2]).toMatchObject({ version: 5 })
  })

  it('retries after a load failure', async () => {
    api.listCorrections.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务暂时不可用'))
    const { wrapper } = await mountAt('/platform/corrections')
    expect(wrapper.text()).toContain('更正申请没有加载出来')
    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.wsd-titem')).toHaveLength(2)
  })

  it('starts on the list when narrow', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { wrapper, router } = await mountAt('/platform/corrections')
    expect(router.currentRoute.value.query.correction).toBeUndefined()
    await click(wrapper, '.wsd-titem')
    expect(router.currentRoute.value.query.correction).toBe('a')
    await wrapper.findAll('button').find((b) => b.text().startsWith('‹'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.correction).toBeUndefined()
  })
})
