import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Correction } from '@/api/corrections'
import { httpError, thesis } from '@/modules/school/preparation/__tests__/fixtures'

import Desk from '../SchoolResultsDesk.vue'

const api = vi.hoisted(() => ({
  listSchoolTheses: vi.fn(), getSchoolThesis: vi.fn(), getSchoolResults: vi.fn(), publishThesis: vi.fn(),
  downloadPublishedReview: vi.fn(), listCorrections: vi.fn(), correctionCommand: vi.fn(),
}))
vi.mock('@/api/schoolReview', () => api)
vi.mock('@/api/results', () => api)
vi.mock('@/api/corrections', () => api)
enableAutoUnmount(afterEach)

const rule = { version: 'pilot-v3', required_experts: 1, mode: 'sum', dimensions: [{ key: 'topicValue', label: '选题价值', max_score: 40 }, { key: 'methodology', label: '研究方法', max_score: 60 }], bands: [] }
const item = { alias: 'E-001', total: 82, scores: { topicValue: 32, methodology: 50 }, recommendation: '通过', overall_comment: '结构完整', issues: '实验略少', revision_advice: '', check_summary: null }
const results = (id: string, extra: Record<string, unknown> = {}) => ({
  snapshot_schema_version: 2, thesis_id: id, stage: 'RESULT_PROCESSING', version: 4, base_result_id: 'r', effective_revision_id: null,
  summary_total: 82, items: [item], published: false, rule_snapshot: rule, outcome: { code: 'PASS', label: '通过' }, ...extra,
})
const correction = (extra: Partial<Correction> = {}): Correction => ({
  id: 'c1', task_id: 't1', thesis_id: 'c', status: 'AWAITING_SCHOOL', version: 2, base_result_id: 'r', base_revision_id: null, created_at: '2026-11-02T08:00:00Z',
  notes: [{ kind: 'EXPERT_REQUEST', reason: '研究方法分数录入错误' }, { kind: 'PLATFORM_DECISION', reason: '同意更正' }],
  before: { total: 82, payload: { topicValue: 32, methodology: 50, overallComment: '结构完整' } as never },
  revision: { id: 'v1', total: 85, payload: { topicValue: 32, methodology: 53, overallComment: '结构完整' } as never },
  ...extra,
})
const loaded = () => [
  thesis('a', { stage: 'RESULT_PROCESSING', version: 4, allowed_actions: ['PUBLISH_RESULT'] }),
  thesis('b', { stage: 'COMPLETED', allowed_actions: [] }),
  thesis('c', { stage: 'COMPLETED', allowed_actions: [] }),
  thesis('p', { stage: 'PREPARING' }),
]

beforeEach(() => {
  vi.resetAllMocks()
  api.listSchoolTheses.mockResolvedValue(loaded())
  api.listCorrections.mockResolvedValue([correction()])
  api.getSchoolResults.mockImplementation(async (id: string) => results(id, id === 'a' ? {} : { stage: 'COMPLETED', published: true }))
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/results', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Desk, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
const tab = (w: VueWrapper, label: string) => w.findAll('[data-view]').find((t) => t.text().startsWith(label))!
const titles = (w: VueWrapper) => w.findAll('.wsd-titem__title').map((t) => t.text())
const button = (w: VueWrapper, text: string) => w.findAll('button').find((b) => b.text().startsWith(text))!

describe('school results desk', () => {
  it('builds the views from theses and awaiting corrections and counts only the loaded set', async () => {
    const { wrapper, router } = await mountAt('/school/results')
    expect(api.listCorrections).toHaveBeenCalledWith('school', { quiet: true })
    expect(tab(wrapper, '待发布').text()).toBe('待发布 1')
    expect(tab(wrapper, '更正待确认').text()).toBe('更正待确认 1')
    expect(tab(wrapper, '已发布').text()).toBe('已发布 1')
    expect(tab(wrapper, '全部').text()).toBe('全部 3')
    expect(wrapper.text()).toContain('计数为已加载的 3 篇')
    expect(titles(wrapper)).toEqual(['论文a'])
    expect(router.currentRoute.value.query.thesis).toBe('a')
    expect(wrapper.text()).toContain('将公开的内容')
    expect(wrapper.text()).toContain('不会公开')
    expect(wrapper.get('[data-total]').text()).toBe('82')
    expect(wrapper.get('[data-review-verdict]').text()).toContain('/ 100')
    // P1-1：与学生反馈同一套缺省文案
    expect(wrapper.get('[data-advice] [data-missing]').text()).toBe('未填写修改建议。')
  })

  it('keeps the thesis list when corrections fail and says the correction view is unavailable', async () => {
    api.listCorrections.mockRejectedValueOnce(httpError(500, 'INTERNAL'))
    const { wrapper } = await mountAt('/school/results?view=published')
    expect(tab(wrapper, '更正待确认').text()).toBe('更正待确认')
    expect(wrapper.text()).toContain('更正记录没有加载出来')
    expect(titles(wrapper)).toEqual(['论文b', '论文c'])
  })

  it('shows a list failure without counts and retries', async () => {
    api.listSchoolTheses.mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', '服务暂不可用'))
    const { wrapper } = await mountAt('/school/results')
    expect(tab(wrapper, '待发布').text()).toBe('待发布')
    expect(wrapper.text()).toContain('结果清单没有加载出来')
    await button(wrapper, '重试').trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['论文a'])
  })

  it('opens a linked thesis outside the time scope and refuses one that is not in results', async () => {
    api.getSchoolThesis.mockResolvedValueOnce(thesis('z', { stage: 'COMPLETED', allowed_actions: [] }))
    const first = await mountAt('/school/results?thesis=z')
    expect(api.getSchoolThesis).toHaveBeenCalledWith('z', { quiet: true })
    expect(first.wrapper.text()).toContain('（不在当前时间范围）')
    expect(first.wrapper.text()).toContain('不在当前时间范围内，是从链接单独打开的')
    first.wrapper.unmount()
    api.getSchoolThesis.mockResolvedValueOnce(thesis('y', { stage: 'PREPARING' }))
    const second = await mountAt('/school/results?thesis=y')
    expect(second.wrapper.text()).toContain('这篇论文不在本校可处理的结果中')
  })

  it('says results are not ready and offers no publish', async () => {
    api.getSchoolResults.mockResolvedValueOnce(results('a', { items: [], summary_total: null }))
    const { wrapper } = await mountAt('/school/results?thesis=a')
    expect(wrapper.text()).toContain('尚未收到有效评阅意见')
    expect(wrapper.find('[data-action="publish-results"]').exists()).toBe(false)
  })

  it('offers publish only with PUBLISH_RESULT', async () => {
    api.listSchoolTheses.mockResolvedValueOnce([thesis('a', { stage: 'RESULT_PROCESSING', allowed_actions: [] })])
    const { wrapper } = await mountAt('/school/results?thesis=a')
    expect(wrapper.find('[data-action="publish-results"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('现在还不能发布这篇论文的结果')
  })

  it('publishes with the result version, then shows the published view', async () => {
    api.publishThesis.mockResolvedValueOnce({})
    const { wrapper, router } = await mountAt('/school/results?thesis=a')
    await wrapper.get('[data-action="publish-results"]').trigger('click')
    expect(wrapper.text()).toContain('学生学生a与其导师会看到')
    api.listSchoolTheses.mockResolvedValue([thesis('a', { stage: 'COMPLETED', allowed_actions: [] })])
    api.getSchoolResults.mockResolvedValue(results('a', { stage: 'COMPLETED', published: true }))
    await wrapper.get('[data-action="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(api.publishThesis).toHaveBeenCalledWith('a', 4, { idempotencyKey: expect.any(String), quiet: true })
    expect(router.currentRoute.value.query).toMatchObject({ view: 'published', thesis: 'a' })
    expect(wrapper.text()).toContain('已发布。学生与导师现在可以阅读正式反馈')
    expect(wrapper.text()).toContain('已发布的内容')
    expect(wrapper.find('[data-action="publish-results"]').exists()).toBe(false)
  })

  it('rereads after a publish conflict and keeps the key on a plain retry', async () => {
    api.publishThesis.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务异常')).mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountAt('/school/results?thesis=a')
    await wrapper.get('[data-action="publish-results"]').trigger('click')
    await wrapper.get('[data-action="confirm-publish"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('.dlg [role="alert"]').text()).toBe('服务异常')
    await wrapper.get('[data-action="confirm-publish"]').trigger('click')
    await flushPromises()
    const [first, second] = api.publishThesis.mock.calls
    expect(second![2].idempotencyKey).toBe(first![2].idempotencyKey)
    expect(wrapper.text()).toContain('没有发布：评阅结果在你打开之后有变化')
    expect(api.getSchoolResults).toHaveBeenCalledTimes(2)
    expect(api.listSchoolTheses).toHaveBeenCalledTimes(2)
  })

  it('says so when the export fails', async () => {
    api.downloadPublishedReview.mockRejectedValueOnce(new Error('Network Error'))
    const { wrapper } = await mountAt('/school/results?view=published&thesis=b')
    await wrapper.get('[data-export-pdf]').trigger('click')
    await flushPromises()
    expect(api.downloadPublishedReview).toHaveBeenCalledWith('b', { quiet: true })
    expect(wrapper.text()).toContain('匿名评阅书没有下载成功')
  })

  it('compares the correction and requires a reason before confirming it', async () => {
    api.correctionCommand.mockResolvedValueOnce(correction({ status: 'ACTIVATED', version: 3 }))
    const { wrapper } = await mountAt('/school/results?view=correction')
    expect(wrapper.text()).toContain('申请理由：研究方法分数录入错误')
    expect(wrapper.text()).toContain('平台意见：同意更正')
    expect(wrapper.text()).toContain('当前生效的发布内容')
    expect(wrapper.findAll('[data-changed] th').map((th) => th.text())).toEqual(['总分', '研究方法'])
    await wrapper.get('[data-action="activate-correction"]').trigger('click')
    await wrapper.get('[data-action="confirm-decision"]').trigger('click')
    expect(wrapper.text()).toContain('请填写确认说明')
    expect(api.correctionCommand).not.toHaveBeenCalled()
    await wrapper.get('[data-correction-reason]').setValue('已核对，属于录入错误')
    api.listCorrections.mockResolvedValue([correction({ status: 'ACTIVATED', version: 3 })])
    await wrapper.get('[data-action="confirm-decision"]').trigger('click')
    await flushPromises()
    expect(api.correctionCommand).toHaveBeenCalledWith('activate', 'c1', { version: 2, reason: '已核对，属于录入错误' }, expect.any(String), { quiet: true })
    expect(wrapper.text()).toContain('已确认更正，系统已自动追加一条发布记录')
    expect(wrapper.find('[data-correction]').exists()).toBe(false)
  })

  it('rereads after a correction conflict', async () => {
    api.correctionCommand.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT'))
    const { wrapper } = await mountAt('/school/results?view=correction&thesis=c')
    await wrapper.get('[data-action="reject-correction"]').trigger('click')
    await wrapper.get('[data-correction-reason]').setValue('分数依据不足')
    await wrapper.get('[data-action="confirm-decision"]').trigger('click')
    await flushPromises()
    expect(api.correctionCommand).toHaveBeenCalledWith('reject', 'c1', { version: 2, reason: '分数依据不足' }, expect.any(String), { quiet: true })
    expect(wrapper.text()).toContain('这条更正在你打开之后有变化')
    expect(api.listCorrections).toHaveBeenCalledTimes(2)
  })

  it('cannot confirm a correction without both versions but can still decline it', async () => {
    api.listCorrections.mockResolvedValue([correction({ before: null })])
    const { wrapper } = await mountAt('/school/results?view=correction&thesis=c')
    expect(wrapper.text()).toContain('没有取得两个版本的对照内容')
    expect(wrapper.get('[data-action="activate-correction"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="reject-correction"]').attributes('disabled')).toBeUndefined()
  })

  it('explains a linked correction that no longer needs the school', async () => {
    api.listCorrections.mockResolvedValue([correction({ id: 'c0', status: 'ACTIVATED' })])
    const { wrapper } = await mountAt('/school/results?thesis=c&correction=c0')
    expect(wrapper.text()).toContain('链接中的这条更正状态为“更正已生效”')
    expect(wrapper.find('[data-correction]').exists()).toBe(false)
  })

  it('starts on the list when narrow and returns to it from the result', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { wrapper, router } = await mountAt('/school/results')
    expect(router.currentRoute.value.query.thesis).toBeUndefined()
    await wrapper.get('.wsd-titem').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.thesis).toBe('a')
    await button(wrapper, '‹').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.thesis).toBeUndefined()
  })
})
