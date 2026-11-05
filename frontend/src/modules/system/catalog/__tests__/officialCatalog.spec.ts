import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImportPreview } from '@/api/catalogs'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Page from '../OfficialCatalogPage.vue'

const api = vi.hoisted(() => ({ previewCatalogImport: vi.fn(), applyCatalogImport: vi.fn() }))
vi.mock('@/api/catalogs', () => api)
enableAutoUnmount(afterEach)

const preview = (patch: Partial<ImportPreview> = {}): ImportPreview => ({
  fingerprint: 'fp-1',
  disciplines: { added: 3, changed: 1, unchanged: 110 },
  institutions: { added: 12, changed: 0, unchanged: 2800 },
  sources: [{ name: '研究生教育学科专业目录', version: '2022', url: 'https://example.edu.cn/catalog' }],
  ...patch,
})

beforeEach(() => {
  vi.resetAllMocks()
  api.previewCatalogImport.mockResolvedValue(preview())
  api.applyCatalogImport.mockResolvedValue(preview())
})

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/system/catalog', component: Page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
  await router.push('/system/catalog')
  await router.isReady()
  const wrapper = mount(Page, { global: { plugins: [createPinia(), router] }, attachTo: document.body })
  await flushPromises()
  return wrapper
}
const click = async (w: VueWrapper, selector: string) => {
  await w.get(selector).trigger('click')
  await flushPromises()
}
const counts = (w: VueWrapper) => w.findAll('[data-count]').map((row) => [row.get('th').text(), ...row.findAll('td').map((cell) => cell.text())])

describe('official catalog page', () => {
  it('does nothing until asked, then previews counts and sources without writing', async () => {
    const wrapper = await mountPage()
    expect(api.previewCatalogImport).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('预览只读取与比较，不写入任何数据')
    await click(wrapper, '[data-action="preview-catalog"]')
    expect(api.previewCatalogImport).toHaveBeenCalledWith({ quiet: true })
    expect(counts(wrapper)).toEqual([['学科', '3', '1', '110'], ['院校', '12', '0', '2800']])
    expect(wrapper.get('[data-preview]').text()).toContain('预览未写入')
    const link = wrapper.get('.sources a')
    expect(link.attributes()).toMatchObject({ href: 'https://example.edu.cn/catalog', target: '_blank', rel: 'noopener noreferrer' })
    expect(api.applyCatalogImport).not.toHaveBeenCalled()
  })

  it('confirms before importing with the fingerprint and reports what was written', async () => {
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="preview-catalog"]')
    await click(wrapper, '[data-action="apply-catalog"]')
    expect(api.applyCatalogImport).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('将写入学科 4 项、院校 12 项变化')
    expect(wrapper.text()).toContain('不停用任何已有条目')
    await click(wrapper, '[data-action="confirm-apply"]')
    expect(api.applyCatalogImport).toHaveBeenCalledWith('fp-1', { quiet: true })
    expect(wrapper.get('[data-applied]').text()).toContain('学科新增 3、变更 1；院校新增 12、变更 0')
    expect(wrapper.find('[data-preview]').exists()).toBe(false)
  })

  it('does not offer an import when nothing changed', async () => {
    api.previewCatalogImport.mockResolvedValue(preview({ disciplines: { added: 0, changed: 0, unchanged: 114 }, institutions: { added: 0, changed: 0, unchanged: 2812 } }))
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="preview-catalog"]')
    expect(wrapper.find('[data-unchanged]').exists()).toBe(true)
    expect(wrapper.get('[data-action="apply-catalog"]').attributes('disabled')).toBeDefined()
  })

  it('voids the preview on a 409 and only offers a new preview', async () => {
    api.applyCatalogImport.mockRejectedValue(httpError(409, 'CONFLICT', '目录或预览已变化，请重新预览'))
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="preview-catalog"]')
    await click(wrapper, '[data-action="apply-catalog"]')
    await click(wrapper, '[data-action="confirm-apply"]')
    expect(wrapper.find('[data-expired]').exists()).toBe(true)
    expect(wrapper.find('[data-action="apply-catalog"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="discard-preview"]').exists()).toBe(false)
    api.previewCatalogImport.mockResolvedValue(preview({ fingerprint: 'fp-2' }))
    api.applyCatalogImport.mockResolvedValue(preview({ fingerprint: 'fp-2' }))
    await click(wrapper, '[data-preview] [data-action="preview-catalog"]')
    expect(wrapper.find('[data-expired]').exists()).toBe(false)
    await click(wrapper, '[data-action="apply-catalog"]')
    await click(wrapper, '[data-action="confirm-apply"]')
    expect(api.applyCatalogImport).toHaveBeenLastCalledWith('fp-2', { quiet: true })
  })

  it('keeps the preview after another failure so the import can be confirmed again', async () => {
    api.applyCatalogImport.mockRejectedValueOnce(new Error('网络异常'))
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="preview-catalog"]')
    await click(wrapper, '[data-action="apply-catalog"]')
    await click(wrapper, '[data-action="confirm-apply"]')
    expect(wrapper.text()).toContain('网络异常')
    expect(wrapper.find('[data-expired]').exists()).toBe(false)
    await click(wrapper, '[data-action="confirm-apply"]')
    expect(api.applyCatalogImport).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-applied]').exists()).toBe(true)
  })

  it('shows the server text when a preview is refused and lets the admin retry', async () => {
    api.previewCatalogImport.mockRejectedValueOnce(httpError(409, 'CONFLICT', '已有学校专用目录，需先复核映射'))
    const wrapper = await mountPage()
    await click(wrapper, '[data-action="preview-catalog"]')
    expect(wrapper.text()).toContain('已有学校专用目录，需先复核映射')
    expect(wrapper.text()).toContain('库内目录没有变化')
    await click(wrapper, '[data-action="preview-catalog"]')
    expect(counts(wrapper)).toHaveLength(2)
  })
})
