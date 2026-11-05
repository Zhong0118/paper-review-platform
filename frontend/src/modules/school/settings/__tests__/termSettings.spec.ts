import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Page from '../TermSettingsPage.vue'

const api = vi.hoisted(() => ({ getSensitiveTerms: vi.fn(), saveSensitiveTerms: vi.fn() }))
vi.mock('@/api/sensitiveChecks', () => api)
enableAutoUnmount(afterEach)

const t = (text: string, severity: 'WARN' | 'BLOCK' = 'WARN', description = '') => ({ text, severity, description })
const saved = [t('示例大学', 'BLOCK', '全称'), t('示大'), t('理工楼')]

beforeEach(() => {
  vi.resetAllMocks()
  api.getSensitiveTerms.mockResolvedValue({ version: 9, terms: saved })
})

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/sensitive-terms', component: Page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push('/school/sensitive-terms')
  await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
const click = async (w: VueWrapper, selector: string) => {
  await w.get(selector).trigger('click')
  await flushPromises()
}
const texts = (w: VueWrapper) => w.findAll('[data-field="term-text"]')
const status = (w: VueWrapper) => w.get('.wsd-commit__text').text()

describe('term settings', () => {
  it('loads the table, counts edits and saves the whole list with the version', async () => {
    api.saveSensitiveTerms.mockResolvedValueOnce({ version: 10, terms: [t('示例大学', 'BLOCK', '全称'), t('示大', 'BLOCK'), t('出版社')] })
    const wrapper = await mountPage()
    expect(api.getSensitiveTerms).toHaveBeenCalledWith({ quiet: true })
    expect(wrapper.text()).toContain('第 9 版　3 / 200')
    expect(status(wrapper)).toBe('没有未保存的修改')
    await wrapper.findAll('[data-field="term-severity"]')[1]!.setValue('BLOCK')
    await wrapper.findAll('[data-action="remove-term"]')[2]!.trigger('click')
    await click(wrapper, '[data-action="add-term"]')
    await texts(wrapper).at(-1)!.setValue(' 出版社 ')
    expect(status(wrapper)).toBe('未保存的修改 3 处')
    await click(wrapper, '[data-action="save-terms"]')
    expect(api.saveSensitiveTerms).toHaveBeenCalledWith({ expected_version: 9, terms: [t('示例大学', 'BLOCK', '全称'), t('示大', 'BLOCK'), t('出版社')] }, { quiet: true })
    expect(wrapper.text()).toContain('已保存为第 10 版')
    expect(wrapper.text()).toContain('待核验论文需要重新检测')
    expect(status(wrapper)).toBe('没有未保存的修改')
  })

  it('validates rows before sending', async () => {
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="add-term"]')
    await click(wrapper, '[data-action="save-terms"]')
    expect(api.saveSensitiveTerms).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写词语，或删除这一行')
    await texts(wrapper).at(-1)!.setValue('示大')
    expect(wrapper.findAll('.field-error').map((e) => e.text())).toContain('与其他行重复')
    await click(wrapper, '[data-action="save-terms"]')
    expect(api.saveSensitiveTerms).not.toHaveBeenCalled()
  })

  it('shows the empty state and keeps edits when saving fails', async () => {
    api.getSensitiveTerms.mockResolvedValue({ version: 0, terms: [] })
    api.saveSensitiveTerms.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务暂时不可用'))
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('词表为空')
    await click(wrapper, '[data-action="add-term"]')
    await texts(wrapper)[0]!.setValue('示例大学')
    await click(wrapper, '[data-action="save-terms"]')
    expect(api.saveSensitiveTerms).toHaveBeenCalledWith({ expected_version: 0, terms: [t('示例大学')] }, { quiet: true })
    expect(wrapper.text()).toContain('没有保存：服务暂时不可用。表格里的修改还在。')
    expect((texts(wrapper)[0]!.element as HTMLInputElement).value).toBe('示例大学')
  })

  it('on 409 lists their changes and can reapply mine onto their version', async () => {
    api.saveSensitiveTerms.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '词表已变化，请刷新后再保存'))
    const wrapper = await mountPage()
    await wrapper.findAll('[data-action="remove-term"]')[2]!.trigger('click')
    await click(wrapper, '[data-action="add-term"]')
    await texts(wrapper).at(-1)!.setValue('出版社')
    api.getSensitiveTerms.mockResolvedValue({ version: 10, terms: [t('示例大学', 'BLOCK', '全称'), t('示大', 'BLOCK'), t('理工楼'), t('附中')] })
    await click(wrapper, '[data-action="save-terms"]')
    const banner = wrapper.get('[data-conflict]').text()
    expect(banner).toContain('刚刚保存了第 10 版')
    expect(banner).toContain('“示大”：警告 → 阻断')
    expect(banner).toContain('新增“附中”（警告）')
    expect(wrapper.get('[data-action="save-terms"]').attributes('disabled')).toBeDefined()
    await click(wrapper, '[data-action="merge-mine"]')
    expect(texts(wrapper).map((i) => (i.element as HTMLInputElement).value)).toEqual(['示例大学', '示大', '附中', '出版社'])
    expect(status(wrapper)).toBe('未保存的修改 2 处')
    api.saveSensitiveTerms.mockResolvedValueOnce({ version: 11, terms: [] })
    await click(wrapper, '[data-action="save-terms"]')
    expect(api.saveSensitiveTerms.mock.calls[1]![0].expected_version).toBe(10)
  })

  it('can drop my edits after a 409', async () => {
    api.saveSensitiveTerms.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '词表已变化'))
    const wrapper = await mountPage()
    await texts(wrapper)[1]!.setValue('示大附中')
    api.getSensitiveTerms.mockResolvedValue({ version: 10, terms: [t('示例大学')] })
    await click(wrapper, '[data-action="save-terms"]')
    await click(wrapper, '[data-action="take-theirs"]')
    expect(texts(wrapper).map((i) => (i.element as HTMLInputElement).value)).toEqual(['示例大学'])
    expect(status(wrapper)).toBe('没有未保存的修改')
    expect(wrapper.text()).toContain('第 10 版')
  })

  it('stops adding rows at 200 and retries a failed load', async () => {
    api.getSensitiveTerms.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务暂时不可用'))
    api.getSensitiveTerms.mockResolvedValueOnce({ version: 3, terms: Array.from({ length: 200 }, (_, i) => t(`词条${i}`)) })
    const wrapper = await mountPage()
    expect(wrapper.text()).toContain('词表没有加载出来')
    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-action="add-term"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('已到 200 条上限')
  })
})
