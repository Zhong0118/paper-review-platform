import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ObjectionRow } from '@/api/objections'
import { httpError, thesis } from '@/modules/school/preparation/__tests__/fixtures'

import Desk from '../SchoolObjectionsDesk.vue'

const api = vi.hoisted(() => ({ listSchoolObjections: vi.fn(), startObjection: vi.fn(), resolveObjection: vi.fn(), listSchoolTheses: vi.fn() }))
vi.mock('@/api/objections', () => api)
vi.mock('@/api/schoolReview', () => api)
enableAutoUnmount(afterEach)

const row = (id: string, status: string, extra: Partial<ObjectionRow> = {}): ObjectionRow => ({
  id, thesis_id: `t-${id}`, reason: `理由${id}`, request: `诉求${id}`, created_at: '2026-11-03T09:00:00Z', status, channel: null, conclusion: null, student_name: `学生${id}`, ...extra,
})
const objections = () => [row('o1', 'SUBMITTED'), row('o2', 'PROCESSING'), row('o3', 'RESOLVED', { channel: 'ONLINE', conclusion: '评阅结论不变' }), row('o4', 'SUBMITTED', { thesis_id: 'gone' })]
const theses = () => ['o1', 'o2', 'o3'].map((id) => thesis(`t-${id}`, { stage: 'COMPLETED', allowed_actions: [] }))

beforeEach(() => {
  vi.resetAllMocks()
  api.listSchoolObjections.mockResolvedValue(objections())
  api.listSchoolTheses.mockResolvedValue(theses())
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/objections', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push(url)
  await router.isReady()
  const wrapper = mount(Desk, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return { wrapper, router }
}
const tab = (w: VueWrapper, label: string) => w.findAll('[data-view]').find((t) => t.text().startsWith(label))!
const titles = (w: VueWrapper) => w.findAll('.wsd-titem__title').map((t) => t.text())
const click = async (w: VueWrapper, selector: string) => {
  await w.get(selector).trigger('click')
  await flushPromises()
}

describe('school objections desk', () => {
  it('lists objections by status with titles from the school theses', async () => {
    const { wrapper, router } = await mountAt('/school/objections')
    expect(api.listSchoolObjections).toHaveBeenCalledWith({ quiet: true })
    expect(api.listSchoolTheses).toHaveBeenCalledWith(undefined, undefined, { quiet: true })
    expect(tab(wrapper, '待处理').text()).toBe('待处理 2')
    expect(tab(wrapper, '处理中').text()).toBe('处理中 1')
    expect(tab(wrapper, '已办结').text()).toBe('已办结 1')
    expect(titles(wrapper)).toEqual(['论文t-o1', '论文已不在当前范围'])
    expect(router.currentRoute.value.query.objection).toBe('o1')
    expect(wrapper.text()).toContain('理由o1')
    expect(wrapper.text()).toContain('诉求o1')
    expect(wrapper.get('a[data-result-link]').attributes('href')).toBe('/school/results?view=published&thesis=t-o1')
  })

  it('keeps the objections when theses fail', async () => {
    api.listSchoolTheses.mockRejectedValueOnce(httpError(500, 'INTERNAL'))
    const { wrapper } = await mountAt('/school/objections')
    expect(titles(wrapper)).toEqual(['论文题目没有加载出来', '论文题目没有加载出来'])
    expect(wrapper.find('a[data-result-link]').exists()).toBe(false)
  })

  it('shows a list failure without counts and retries', async () => {
    api.listSchoolObjections.mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', '服务暂不可用'))
    const { wrapper } = await mountAt('/school/objections')
    expect(tab(wrapper, '待处理').text()).toBe('待处理')
    expect(wrapper.text()).toContain('异议清单没有加载出来')
    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toHaveLength(2)
  })

  it('opens a linked objection in its own view and refuses an unknown one', async () => {
    const first = await mountAt('/school/objections?objection=o3')
    expect(tab(first.wrapper, '已办结').attributes('aria-pressed')).toBe('true')
    expect(first.wrapper.text()).toContain('评阅结论不变')
    expect(first.wrapper.text()).toContain('线上答复')
    first.wrapper.unmount()
    const second = await mountAt('/school/objections?objection=nope')
    expect(second.wrapper.text()).toContain('这条异议不在本校的异议记录中')
  })

  it('starts a submitted objection and follows it to the processing view', async () => {
    api.startObjection.mockResolvedValueOnce(row('o1', 'PROCESSING'))
    const { wrapper, router } = await mountAt('/school/objections?objection=o1')
    api.listSchoolObjections.mockResolvedValue([row('o1', 'PROCESSING'), ...objections().slice(1)])
    await click(wrapper, '[data-action="start-objection"]')
    expect(api.startObjection).toHaveBeenCalledWith('o1', { quiet: true })
    expect(router.currentRoute.value.query).toMatchObject({ view: 'PROCESSING', objection: 'o1' })
    expect(wrapper.text()).toContain('已开始处理')
    expect(wrapper.find('[data-action="resolve-objection"]').exists()).toBe(true)
  })

  it('requires a channel and a conclusion, then resolves after confirmation', async () => {
    api.resolveObjection.mockResolvedValueOnce(row('o2', 'RESOLVED'))
    const { wrapper, router } = await mountAt('/school/objections?view=PROCESSING')
    await click(wrapper, '[data-action="resolve-objection"]')
    expect(wrapper.text()).toContain('请选择办理渠道')
    expect(wrapper.text()).toContain('请填写处理结论')
    await wrapper.get('input[value="OFFLINE"]').setValue(true)
    await wrapper.get('[data-conclusion]').setValue('已线下沟通，评阅结论不变')
    await click(wrapper, '[data-action="resolve-objection"]')
    expect(wrapper.get('.dlg').text()).toContain('已线下沟通，评阅结论不变')
    api.listSchoolObjections.mockResolvedValue([row('o2', 'RESOLVED', { channel: 'OFFLINE', conclusion: '已线下沟通，评阅结论不变' })])
    await click(wrapper, '[data-action="confirm-resolve"]')
    expect(api.resolveObjection).toHaveBeenCalledWith('o2', { channel: 'OFFLINE', conclusion: '已线下沟通，评阅结论不变' }, { quiet: true })
    expect(router.currentRoute.value.query).toMatchObject({ view: 'RESOLVED', objection: 'o2' })
    expect(wrapper.text()).toContain('已办结。学生现在可以在反馈页看到处理结论')
  })

  it('keeps the input and explains a plain resolve failure', async () => {
    api.resolveObjection.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务异常'))
    const { wrapper } = await mountAt('/school/objections?view=PROCESSING')
    await wrapper.get('input[value="ONLINE"]').setValue(true)
    await wrapper.get('[data-conclusion]').setValue('结论')
    await click(wrapper, '[data-action="resolve-objection"]')
    await click(wrapper, '[data-action="confirm-resolve"]')
    expect(wrapper.get('.dlg [role="alert"]').text()).toBe('服务异常')
    expect((wrapper.get('[data-conclusion]').element as HTMLTextAreaElement).value).toBe('结论')
  })

  it('treats a conflict that already holds the same conclusion as done', async () => {
    api.resolveObjection.mockRejectedValueOnce(httpError(409, 'STATE_TRANSITION_DENIED'))
    const { wrapper } = await mountAt('/school/objections?view=PROCESSING')
    await wrapper.get('input[value="ONLINE"]').setValue(true)
    await wrapper.get('[data-conclusion]').setValue('结论')
    await click(wrapper, '[data-action="resolve-objection"]')
    api.listSchoolObjections.mockResolvedValue([row('o2', 'RESOLVED', { channel: 'ONLINE', conclusion: '结论' })])
    await click(wrapper, '[data-action="confirm-resolve"]')
    expect(wrapper.text()).toContain('已办结。学生现在可以在反馈页看到处理结论')
    expect(wrapper.text()).not.toContain('状态已变化')
  })

  it('warns when someone else changed the objection first', async () => {
    api.resolveObjection.mockRejectedValueOnce(httpError(409, 'STATE_TRANSITION_DENIED'))
    const { wrapper } = await mountAt('/school/objections?view=PROCESSING')
    await wrapper.get('input[value="ONLINE"]').setValue(true)
    await wrapper.get('[data-conclusion]').setValue('我的结论')
    await click(wrapper, '[data-action="resolve-objection"]')
    api.listSchoolObjections.mockResolvedValue([row('o2', 'RESOLVED', { channel: 'OFFLINE', conclusion: '别人的结论' })])
    await click(wrapper, '[data-action="confirm-resolve"]')
    expect(wrapper.get('.wsd-banner--danger').text()).toContain('这条异议的状态在你打开之后有变化')
    expect(wrapper.text()).toContain('别人的结论')
  })

  it('treats a start conflict as started when it is already processing', async () => {
    api.startObjection.mockRejectedValueOnce(httpError(409, 'STATE_TRANSITION_DENIED'))
    const { wrapper } = await mountAt('/school/objections?objection=o1')
    api.listSchoolObjections.mockResolvedValue([row('o1', 'PROCESSING')])
    await click(wrapper, '[data-action="start-objection"]')
    expect(wrapper.text()).toContain('已开始处理')
  })

  it('starts on the list when narrow and returns to it', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { wrapper, router } = await mountAt('/school/objections')
    expect(router.currentRoute.value.query.objection).toBeUndefined()
    await click(wrapper, '.wsd-titem')
    expect(router.currentRoute.value.query.objection).toBe('o1')
    await wrapper.findAll('button').find((b) => b.text().startsWith('‹'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.objection).toBeUndefined()
  })
})
