import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SupervisorResultPage from '../pages/SupervisorResultPage.vue'
import ResultProcessingPage from '../pages/ResultProcessingPage.vue'
import ResultSummaryPanel from '../components/ResultSummaryPanel.vue'

const api = vi.hoisted(() => ({
  listSupervisedPublishedTheses: vi.fn(), getPublishedResult: vi.fn(), listTheses: vi.fn(),
  getSchoolResults: vi.fn(), publishThesis: vi.fn(), listSchoolTheses: vi.fn(),
}))
vi.mock('@/api/results', () => api)
vi.mock('@/api/theses', () => api)
vi.mock('@/api/schoolReview', () => api)
enableAutoUnmount(afterEach)

const item = { alias: 'E-001', total: 69, scores: {}, recommendation: '不通过', overall_comment: '需要重做实验', issues: '实验不充分' }
const published = { thesis_id: 'a', total: 69, items: [item] }
const schoolResult = { thesis_id: 'a', version: 7, stage: 'RESULT_PROCESSING', summary_total: 69, published: false, items: [item] }
const choices = [{ id: 'a', title: '论文甲', student_name: '学生甲' }, { id: 'b', title: '论文乙', student_name: '学生乙' }]
const schoolQueue = choices.map(row => ({
  id: row.id, stage: 'RESULT_PROCESSING', version: 7,
  allowed_actions: ['PUBLISH_RESULT'], current_version: { title: row.title },
}))

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  api.listTheses.mockResolvedValue([{ id: 'a' }])
  api.listSupervisedPublishedTheses.mockResolvedValue(choices)
  api.getPublishedResult.mockResolvedValue(published)
  api.listSchoolTheses.mockResolvedValue(schoolQueue)
  api.getSchoolResults.mockResolvedValue(schoolResult)
})
afterEach(() => vi.unstubAllEnvs())

async function page(component = SupervisorResultPage) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component }] })
  await router.push('/')
  const wrapper = mount(component, { global: {
    plugins: [createPinia(), router],
    stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } },
  } })
  await flushPromises()
  return wrapper
}

describe('real result pages', () => {
  it('uses the supervisor endpoint and faithfully shows the selected result', async () => {
    const wrapper = await page()
    expect(api.listSupervisedPublishedTheses).toHaveBeenCalledOnce()
    expect(api.listTheses).not.toHaveBeenCalled()
    expect(wrapper.get('select').text()).toContain('学生甲')
    expect(wrapper.getComponent(ResultSummaryPanel).props()).toMatchObject({ average: 69, conclusion: '不通过' })
    expect(wrapper.text()).not.toContain('建议通过')
  })

  it.each([SupervisorResultPage, ResultProcessingPage])('never invents a passing recommendation for empty input', async (component) => {
    api.getPublishedResult.mockResolvedValue({ ...published, items: [{ ...item, recommendation: '' }] })
    api.getSchoolResults.mockResolvedValue({ ...schoolResult, items: [{ ...item, recommendation: '' }] })
    const wrapper = await page(component)
    expect(wrapper.getComponent(ResultSummaryPanel).props('conclusion')).toBe('未填写评审建议')
    expect(wrapper.text()).not.toContain('建议通过')
  })

  it('separates supervisor list errors from an empty result and can retry', async () => {
    api.listSupervisedPublishedTheses.mockRejectedValueOnce(new Error('权限已失效'))
    const wrapper = await page()
    expect(wrapper.get('[role="alert"]').text()).toContain('权限已失效')
    expect(wrapper.text()).not.toContain('结果尚未发布')
    await wrapper.get('[data-action="retry-results"]').trigger('click')
    await flushPromises()
    expect(wrapper.getComponent(ResultSummaryPanel).props('conclusion')).toBe('不通过')
  })

  it('shows a genuine empty supervisor list without a fabricated score', async () => {
    api.listSupervisedPublishedTheses.mockResolvedValue([])
    const wrapper = await page()
    expect(wrapper.text()).toContain('暂无已发布结果')
    expect(wrapper.findComponent(ResultSummaryPanel).exists()).toBe(false)
    expect(api.getPublishedResult).not.toHaveBeenCalled()
  })

  it('clears old supervisor results when another result fails to load', async () => {
    const wrapper = await page()
    api.getPublishedResult.mockRejectedValueOnce(new Error('资源不存在或不可见'))
    await wrapper.get('select').setValue('b')
    await flushPromises()
    expect(wrapper.findComponent(ResultSummaryPanel).exists()).toBe(false)
    expect(wrapper.get('[role="alert"]').text()).toContain('资源不存在或不可见')
  })

  it.each([SupervisorResultPage, ResultProcessingPage])('ignores an old response after a new selection', async (component) => {
    const wrapper = await page(component)
    const getter = component === SupervisorResultPage ? api.getPublishedResult : api.getSchoolResults
    let resolveOld!: (value: typeof published & Partial<typeof schoolResult>) => void
    getter.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
    await wrapper.get('select').setValue('b')
    getter.mockResolvedValueOnce(component === SupervisorResultPage ? published : schoolResult)
    await wrapper.get('select').setValue('a')
    await flushPromises()
    resolveOld({ ...published, ...schoolResult, thesis_id: 'b', items: [{ ...item, recommendation: '旧请求建议通过' }] })
    await flushPromises()
    expect(wrapper.getComponent(ResultSummaryPanel).props('conclusion')).toBe('不通过')
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('a')
  })

  it('shows the real school recommendation and pins publication to loaded id/version', async () => {
    const wrapper = await page(ResultProcessingPage)
    expect(wrapper.getComponent(ResultSummaryPanel).props('conclusion')).toBe('不通过')
    await wrapper.get('[data-action="publish-results"]').trigger('click')
    await flushPromises()
    expect(api.publishThesis).toHaveBeenCalledWith('a', 7, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  })

  it('does not show a summary or allow publishing after school results fail', async () => {
    api.getSchoolResults.mockRejectedValueOnce(new Error('结果加载失败'))
    const wrapper = await page(ResultProcessingPage)
    expect(wrapper.get('[role="alert"]').text()).toContain('结果加载失败')
    expect(wrapper.findComponent(ResultSummaryPanel).exists()).toBe(false)
    expect(wrapper.get('[data-action="publish-results"]').attributes('disabled')).toBeDefined()
  })

  it('clears old school results and disables publish while a new selection loads', async () => {
    const wrapper = await page(ResultProcessingPage)
    api.getSchoolResults.mockReturnValueOnce(new Promise(() => {}))
    await wrapper.get('select').setValue('b')
    expect(wrapper.findComponent(ResultSummaryPanel).exists()).toBe(false)
    expect(wrapper.get('[data-action="publish-results"]').attributes('disabled')).toBeDefined()
  })

  it('reports publication failures without pretending the result was published', async () => {
    api.publishThesis.mockRejectedValueOnce(new Error('版本冲突，请刷新'))
    const wrapper = await page(ResultProcessingPage)
    await wrapper.get('[data-action="publish-results"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('版本冲突')
    expect(wrapper.get('[data-action="publish-results"]').text()).not.toContain('结果已发布')
  })
})
