import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CatalogPreview } from '@/api/schoolPrograms'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Page from '../DisciplineSettingsPage.vue'

const api = vi.hoisted(() => ({
  getDisciplines: vi.fn(), getDisciplineSettings: vi.fn(), saveDisciplineSettings: vi.fn(),
  listProgramVersions: vi.fn(), previewPrograms: vi.fn(), publishPrograms: vi.fn(),
}))
vi.mock('@/api/catalogs', () => api)
vi.mock('@/api/schoolPrograms', () => api)
enableAutoUnmount(afterEach)

const options = [
  { code: '0101', name: '哲学', category_code: '01', category_name: '哲学' },
  { code: '0801', name: '力学', category_code: '08', category_name: '工学' },
  { code: '0812', name: '计算机科学与技术', category_code: '08', category_name: '工学' },
]
const entry = (name: string, official = '0812', active = true) => ({ name, official_code: official, official_name: '计算机科学与技术', active, source: '文件', source_version: 'v1' })
const report = (extra: Partial<CatalogPreview> = {}): CatalogPreview => ({
  revision: 3, retained: 2, fingerprint: 'f'.repeat(64), errors: [],
  changes: [
    { code: 'A01', action: '新增', before: null, after: entry('软件工程') },
    { code: 'A02', action: '变更', before: entry('网络工程'), after: entry('网络空间安全', '0812', false) },
    { code: 'A03', action: '未变', before: entry('人工智能'), after: entry('人工智能') },
  ],
  ...extra,
})
const versions = [
  { id: 'v2', year: 2026, revision: 2, count: 40, source: '文件', source_version: '2026 修订', published_at: '2026-09-01T08:00:00Z' },
  { id: 'v1', year: 2026, revision: 1, count: 38, source: '文件', source_version: '2026 初版', published_at: '2026-08-01T08:00:00Z' },
]

beforeEach(() => {
  vi.resetAllMocks()
  api.getDisciplines.mockResolvedValue(options)
  api.getDisciplineSettings.mockResolvedValue({ configured: true, codes: ['0812'], version: 4 })
  api.listProgramVersions.mockResolvedValue(versions)
})

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/disciplines', component: Page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
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
const box = (w: VueWrapper, code: string) => w.get(`[data-code="${code}"]`).element as HTMLInputElement
const check = async (w: VueWrapper, code: string, on: boolean) => {
  await w.get(`[data-code="${code}"]`).setValue(on)
  await flushPromises()
}
async function chooseFile(w: VueWrapper, content = '校内代码,校内名称,官方代码,状态\nA01,软件工程,0812,启用\n') {
  const input = w.get('[data-field="program-file"]')
  Object.defineProperty(input.element, 'files', { value: [new File([content], 'programs.csv', { type: 'text/csv' })], configurable: true })
  await input.trigger('change')
}
async function fillImport(w: VueWrapper) {
  await w.get('[data-field="program-source"]').setValue('研究生院文件')
  await w.get('[data-field="program-edition"]').setValue('2026 修订')
  await chooseFile(w)
}

describe('open disciplines', () => {
  it('groups by category with counts and saves the picked codes with the version', async () => {
    api.saveDisciplineSettings.mockResolvedValueOnce({ configured: true, codes: ['0101', '0812'], version: 5 })
    const { wrapper } = await mountAt('/school/disciplines')
    expect(api.getDisciplineSettings).toHaveBeenCalledWith({ quiet: true })
    expect(wrapper.get('[data-group="08"] legend').text()).toBe('工学　1/2')
    expect(box(wrapper, '0812').checked).toBe(true)
    expect(wrapper.get('[data-action="save-disciplines"]').attributes('disabled')).toBeDefined()
    await check(wrapper, '0101', true)
    expect(wrapper.get('.wsd-commit').text()).toContain('未保存：新增 0101 哲学；取消 无')
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(api.saveDisciplineSettings).toHaveBeenCalledWith(['0101', '0812'], 4, { quiet: true })
    expect(wrapper.text()).toContain('已保存。本校开放 2 个学科')
    expect(wrapper.get('.wsd-commit').text()).toContain('没有未保存的修改')
  })

  it('explains the unconfigured default and lets it be saved as is', async () => {
    api.getDisciplineSettings.mockResolvedValue({ configured: false, codes: [], version: 0 })
    api.saveDisciplineSettings.mockResolvedValueOnce({ configured: true, codes: ['0101', '0801', '0812'], version: 1 })
    const { wrapper } = await mountAt('/school/disciplines')
    expect(wrapper.text()).toContain('尚未设置开放学科：现在开放全部 3 个学科')
    // P1-3：一行横幅，不再是空状态块
    expect(wrapper.get('[data-unconfigured]').classes()).toContain('wsd-banner')
    expect(options.every((o) => box(wrapper, o.code).checked)).toBe(true)
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(api.saveDisciplineSettings).toHaveBeenCalledWith(['0101', '0801', '0812'], 0, { quiet: true })
    expect(wrapper.text()).not.toContain('尚未设置开放学科')
  })

  it('restores every choice with 全选 after clearing (carried over from the old page, U4-9)', async () => {
    const { wrapper } = await mountAt('/school/disciplines')
    await click(wrapper, '[data-action="pick-none"]')
    expect(options.some((o) => box(wrapper, o.code).checked)).toBe(false)
    await click(wrapper, '[data-action="pick-all"]')
    expect(options.every((o) => box(wrapper, o.code).checked)).toBe(true)
    expect(wrapper.get('.wsd-commit').text()).toContain('新增 0101 哲学')
  })

  it('asks before saving an empty selection', async () => {
    api.saveDisciplineSettings.mockResolvedValueOnce({ configured: true, codes: [], version: 5 })
    const { wrapper } = await mountAt('/school/disciplines')
    await click(wrapper, '[data-action="pick-none"]')
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(api.saveDisciplineSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('学生新建论文时没有可选学科')
    await click(wrapper, '[data-action="confirm-empty"]')
    expect(api.saveDisciplineSettings).toHaveBeenCalledWith([], 4, { quiet: true })
  })

  it('on 409 rereads, keeps my picks and can merge them onto the saved result', async () => {
    api.saveDisciplineSettings.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '配置已变化，请刷新后重试'))
    const { wrapper } = await mountAt('/school/disciplines')
    await check(wrapper, '0101', true)
    api.getDisciplineSettings.mockResolvedValue({ configured: true, codes: ['0801', '0812'], version: 5 })
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(wrapper.get('[data-conflict]').text()).toContain('对方新增：0801 力学；对方取消：无')
    expect(box(wrapper, '0101').checked).toBe(true)
    expect(wrapper.get('[data-action="save-disciplines"]').attributes('disabled')).toBeDefined()
    await click(wrapper, '[data-action="merge-mine"]')
    expect(['0101', '0801', '0812'].every((code) => box(wrapper, code).checked)).toBe(true)
    api.saveDisciplineSettings.mockResolvedValueOnce({ configured: true, codes: ['0101', '0801', '0812'], version: 6 })
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(api.saveDisciplineSettings).toHaveBeenLastCalledWith(['0101', '0801', '0812'], 5, { quiet: true })
  })

  it('can drop my picks after a 409', async () => {
    api.saveDisciplineSettings.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '配置已变化'))
    const { wrapper } = await mountAt('/school/disciplines')
    await check(wrapper, '0101', true)
    api.getDisciplineSettings.mockResolvedValue({ configured: true, codes: ['0801'], version: 5 })
    await click(wrapper, '[data-action="save-disciplines"]')
    await click(wrapper, '[data-action="take-theirs"]')
    expect(options.map((o) => box(wrapper, o.code).checked)).toEqual([false, true, false])
    expect(wrapper.get('.wsd-commit').text()).toContain('没有未保存的修改')
  })

  it('shows historical codes and the server reason on 422', async () => {
    api.getDisciplineSettings.mockResolvedValue({ configured: true, codes: ['0699', '0812'], version: 4 })
    api.saveDisciplineSettings.mockRejectedValueOnce(httpError(422, 'VALIDATION_FAILED', '学科必须来自启用的官方目录'))
    const { wrapper } = await mountAt('/school/disciplines')
    expect(wrapper.get('[data-historical]').text()).toContain('0699')
    await check(wrapper, '0101', true)
    await click(wrapper, '[data-action="save-disciplines"]')
    expect(wrapper.get('[role="alert"]').text()).toContain('学科必须来自启用的官方目录')
    await wrapper.get('[data-historical] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-historical]').exists()).toBe(false)
    expect(wrapper.get('.wsd-commit').text()).toContain('取消 0699（已停用）')
  })

  it('retries after a load failure and filters by search', async () => {
    api.getDisciplines.mockRejectedValueOnce(httpError(500, 'INTERNAL', '服务暂时不可用'))
    const { wrapper } = await mountAt('/school/disciplines')
    expect(wrapper.text()).toContain('学科设置没有加载出来')
    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    await wrapper.get('[data-field="discipline-search"]').setValue('计算机')
    expect(wrapper.findAll('[data-code]').map((b) => b.attributes('data-code'))).toEqual(['0812'])
    expect(wrapper.get('[data-group="08"] legend').text()).toBe('工学　1/2')
  })
})

describe('program import', () => {
  it('lists versions and switches tab through the query', async () => {
    const { wrapper, router } = await mountAt('/school/disciplines')
    await click(wrapper, '[data-tab="programs"]')
    expect(router.currentRoute.value.query.tab).toBe('programs')
    expect(api.listProgramVersions).toHaveBeenCalledWith({ quiet: true })
    const rows = wrapper.findAll('[data-version]')
    expect(rows[0]!.text()).toContain('2026 年第 2 版')
    expect(rows[0]!.text()).toContain('本年度最新')
    expect(rows[1]!.text()).not.toContain('本年度最新')
  })

  it('previews without writing, voids the preview on any edit and publishes after a confirmation', async () => {
    api.previewPrograms.mockResolvedValue(report())
    api.publishPrograms.mockResolvedValueOnce({ id: 'v3', year: 2026, revision: 3, count: 5, source: '研究生院文件', source_version: '2026 修订', published_at: '2026-11-05T08:00:00Z' })
    const { wrapper } = await mountAt('/school/disciplines?tab=programs')
    expect(wrapper.get('[data-action="preview-programs"]').attributes('disabled')).toBeDefined()
    await fillImport(wrapper)
    await click(wrapper, '[data-action="preview-programs"]')
    const [body, opts] = api.previewPrograms.mock.calls[0]!
    expect(body).toMatchObject({ year: new Date().getFullYear(), source: '研究生院文件', source_version: '2026 修订' })
    expect(body.csv).toContain('A01,软件工程,0812,启用')
    expect(opts).toEqual({ quiet: true })
    const preview = wrapper.get('[data-preview]').text()
    expect(preview).toContain('预览未写入')
    expect(preview).toContain('网络空间安全（原：网络工程）')
    expect(preview).not.toContain('人工智能')
    expect(api.publishPrograms).not.toHaveBeenCalled()

    await wrapper.get('[data-field="program-edition"]').setValue('2026 再修订')
    expect(wrapper.find('[data-preview]').exists()).toBe(false)
    await click(wrapper, '[data-action="preview-programs"]')
    await click(wrapper, '[data-action="publish-programs"]')
    expect(api.publishPrograms).not.toHaveBeenCalled()
    await click(wrapper, '[data-action="confirm-publish"]')
    expect(api.publishPrograms).toHaveBeenCalledWith(expect.objectContaining({ source_version: '2026 再修订' }), 'f'.repeat(64), { quiet: true })
    expect(wrapper.text()).toContain('已发布 2026 年第 3 版，共 5 项。已绑定旧版本的批次不受影响')
    expect(api.listProgramVersions).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-preview]').exists()).toBe(false)
  })

  it('blocks publishing a preview with errors', async () => {
    api.previewPrograms.mockResolvedValueOnce(report({ fingerprint: null, errors: ['第 3 行：官方代码不存在/未启用，或状态无效'] }))
    const { wrapper } = await mountAt('/school/disciplines?tab=programs')
    await fillImport(wrapper)
    await click(wrapper, '[data-action="preview-programs"]')
    expect(wrapper.get('[data-preview-errors]').text()).toContain('第 3 行：官方代码不存在')
    expect(wrapper.get('[data-action="publish-programs"]').attributes('disabled')).toBeDefined()
  })

  it('voids the preview when the fingerprint no longer matches', async () => {
    api.previewPrograms.mockResolvedValueOnce(report())
    api.publishPrograms.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '目录或预览内容已变化，请重新预览'))
    const { wrapper } = await mountAt('/school/disciplines?tab=programs')
    await fillImport(wrapper)
    await click(wrapper, '[data-action="preview-programs"]')
    await click(wrapper, '[data-action="publish-programs"]')
    await click(wrapper, '[data-action="confirm-publish"]')
    expect(wrapper.find('[data-preview]').exists()).toBe(false)
    expect(wrapper.text()).toContain('没有发布：目录或预览内容已变化，请重新预览')
  })

  it('rejects files over 512 KB before sending', async () => {
    const { wrapper } = await mountAt('/school/disciplines?tab=programs')
    await wrapper.get('[data-field="program-source"]').setValue('研究生院文件')
    await wrapper.get('[data-field="program-edition"]').setValue('2026 修订')
    await chooseFile(wrapper, 'x'.repeat(512_001))
    await click(wrapper, '[data-action="preview-programs"]')
    expect(api.previewPrograms).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('CSV 不得超过 512 KB')
  })
})
