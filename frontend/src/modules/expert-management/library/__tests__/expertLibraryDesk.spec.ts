import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExpertRecord } from '@/api/expertOperations'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Desk from '../ExpertLibraryDesk.vue'
import { expertRecord } from './fixtures'

const api = vi.hoisted(() => ({
  listExperts: vi.fn(), expertOptions: vi.fn(), createExpert: vi.fn(), updateExpert: vi.fn(), reviewQualification: vi.fn(),
  setServiceStatus: vi.fn(), replaceConflicts: vi.fn(), previewExpertImport: vi.fn(), applyExpertImport: vi.fn(), downloadExpertTemplate: vi.fn(),
}))
vi.mock('@/api/expertOperations', () => api)
enableAutoUnmount(afterEach)

let rows: ExpertRecord[]
const choices = {
  provinces: ['北京市', '上海市'], titles: ['教授', '研究员'],
  schools: [{ id: 'school-1', name: '甲大学', status: 'ACTIVE' }, { id: 'school-2', name: '乙大学', status: 'ACTIVE' }],
  disciplines: [{ code: '0812', name: '计算机科学与技术' }, { code: '0701', name: '数学' }],
}
const PASSWORD = 'expert-pass-1234'
const edit = (id: string, extra: Partial<ExpertRecord>) => (rows = rows.map((row) => (row.id === id ? { ...row, ...extra } : row)))

beforeEach(() => {
  vi.resetAllMocks()
  rows = [
    expertRecord('a', { display_name: '王教授', research_directions: ['机器学习'], conflicts: [{ kind: 'TENANT_ID', value: 'school-1' }] }),
    expertRecord('b', { display_name: '李研究员', qualification_status: 'PENDING', discipline_codes: ['0701'], research_directions: ['代数'] }),
    expertRecord('c', { display_name: '赵老师', service_status: 'UNAVAILABLE' }),
    expertRecord('d', { display_name: '钱老师', account_status: 'DISABLED' }),
  ]
  api.listExperts.mockImplementation(async () => rows.map((row) => ({ ...row, conflicts: [...row.conflicts] })))
  api.expertOptions.mockResolvedValue(choices)
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/platform/experts', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
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
/** R3-2：清单是比较表，每行姓名是打开预览的按钮 */
const titles = (w: VueWrapper) => w.findAll('[data-preview]').map((t) => t.text())
const inBody = (selector: string) => document.body.querySelector(selector)
async function decideWith(w: VueWrapper, action: string, text: string) {
  await click(w, `[data-action="${action}"]`)
  await w.get('[data-field="decision-reason"]').setValue(text)
  await click(w, '[data-action="confirm-decision"]')
}

describe('expert library desk', () => {
  it('splits views with counts and names reasons separately; the full profile opens by address', async () => {
    const { wrapper, router } = await mountAt('/platform/experts')
    expect(api.listExperts).toHaveBeenCalledWith({}, { quiet: true })
    expect(api.expertOptions).toHaveBeenCalledWith({ quiet: true })
    // 全部 / 可指派 / 待审核 / 暂不可派（R1 样板：默认“全部”）
    expect(wrapper.findAll('[data-view-tabs] button').map((b) => b.text())).toEqual(['全部 4', '可指派 1', '待审核 1', '暂不可派 2'])
    expect(titles(wrapper)).toEqual(['王教授', '李研究员', '赵老师', '钱老师'])
    expect(router.currentRoute.value.query.expert).toBeUndefined()
    expect(wrapper.text()).toContain('显示 4 / 4 位专家')
    wrapper.unmount()
    const ready = await mountAt('/platform/experts?view=ready')
    expect(titles(ready.wrapper)).toEqual(['王教授'])
    ready.wrapper.unmount()
    const profile = await mountAt('/platform/experts?expert=a')
    expect(profile.wrapper.get('[data-availability]').text()).toBe('可以指派；对 1 项回避对象的论文不可派')
    expect(profile.wrapper.get('[data-conflicts]').text()).toContain('甲大学')
    expect(profile.wrapper.text()).not.toContain('在途')
    profile.wrapper.unmount()
    const blocked = await mountAt('/platform/experts?view=blocked')
    expect(titles(blocked.wrapper)).toEqual(['赵老师', '钱老师'])
    expect(blocked.wrapper.findAll('tbody tr')[1]!.text()).toContain('账号停用')
    blocked.wrapper.unmount()
    const paused = await mountAt('/platform/experts?view=blocked&expert=c')
    expect(paused.wrapper.get('[data-availability]').text()).toBe('现在不能指派：已暂停接单')
  })

  it('searches the loaded experts, filters by discipline and removes a filter chip', async () => {
    const { wrapper, router } = await mountAt('/platform/experts?q=代数')
    expect(titles(wrapper)).toEqual(['李研究员'])
    await wrapper.get('[data-search] input').setValue('')
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBeUndefined()
    expect(titles(wrapper)).toHaveLength(4)
    wrapper.unmount()
    const byDiscipline = await mountAt('/platform/experts?discipline=0701')
    expect(titles(byDiscipline.wrapper)).toEqual(['李研究员'])
    expect(byDiscipline.wrapper.text()).toContain('学科：数学')
    await byDiscipline.wrapper.get('[aria-label="已应用的筛选"] button').trigger('click')
    await flushPromises()
    expect(byDiscipline.router.currentRoute.value.query.discipline).toBeUndefined()
    expect(titles(byDiscipline.wrapper)).toHaveLength(4)
    byDiscipline.wrapper.unmount()
    const none = await mountAt('/platform/experts?q=量子')
    expect(none.wrapper.text()).toContain('当前筛选没有匹配的专家')
    await click(none.wrapper, '[data-action="clear-filters"]')
    expect(none.router.currentRoute.value.query.q).toBeUndefined()
  })

  it('writes every empty table value as one dash and names the “all” filters (P1-2)', async () => {
    edit('a', { unit: '', title: '', province_name: null, doctoral_supervisor: null, masters_supervisor: null })
    const { wrapper } = await mountAt('/platform/experts?view=all')
    const cells = (id: string) => wrapper.get(`[data-preview="${id}"]`).element.closest('tr')!.querySelectorAll('td')
    const a = [...cells('a')].map((cell) => cell.textContent?.trim())
    expect(a.slice(1, 3)).toEqual(['—', '—'])
    expect(a[4]).toBe('—')
    expect(a[5]).toBe('—')
    expect([...cells('b')][5]!.textContent?.trim()).toBe('是 / —')
    expect(wrapper.text()).not.toContain('未填')
    expect(wrapper.findAll('[data-combo]').map((combo) => combo.text())).toEqual(['全部学科', '全部省份'])
  })

  it('says when a linked expert is not in the library', async () => {
    const { wrapper } = await mountAt('/platform/experts?expert=gone')
    expect(wrapper.text()).toContain('这位专家不在专家库中')
  })

  it('requires a reason for qualification and service changes and sends the version', async () => {
    api.reviewQualification.mockResolvedValueOnce(rows[1])
    const { wrapper } = await mountAt('/platform/experts?view=pending&expert=b')
    await click(wrapper, '[data-action="approve"]')
    await click(wrapper, '[data-action="confirm-decision"]')
    expect(api.reviewQualification).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('请填写原因。')
    edit('b', { qualification_status: 'APPROVED', version: 4 })
    await wrapper.get('[data-field="decision-reason"]').setValue(' 材料齐全 ')
    await click(wrapper, '[data-action="confirm-decision"]')
    expect(api.reviewQualification).toHaveBeenCalledWith('b', { version: 3, reason: '材料齐全', status: 'APPROVED' }, { quiet: true })
    expect(wrapper.text()).toContain('资格已通过')
    expect(wrapper.get('[data-qualification]').text()).toContain('已通过')

    api.setServiceStatus.mockResolvedValueOnce(rows[1])
    edit('b', { service_status: 'UNAVAILABLE', version: 5 })
    await decideWith(wrapper, 'pause', '出差两周')
    expect(api.setServiceStatus).toHaveBeenCalledWith('b', { version: 4, reason: '出差两周', status: 'UNAVAILABLE' }, { quiet: true })
    expect(wrapper.text()).toContain('已暂停接单。已接的任务不受影响。')
  })

  it('rereads on a command 409: success when already in the target state, otherwise says it changed', async () => {
    api.setServiceStatus.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '数据已变更，请刷新后重试'))
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    edit('a', { service_status: 'UNAVAILABLE', version: 4 })
    await decideWith(wrapper, 'pause', '休假')
    expect(wrapper.text()).toContain('已暂停接单。')
    api.setServiceStatus.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '数据已变更'))
    edit('a', { qualification_status: 'REJECTED', version: 5 })
    await decideWith(wrapper, 'resume', '回来了')
    expect(api.setServiceStatus).toHaveBeenLastCalledWith('a', expect.objectContaining({ version: 4 }), { quiet: true })
    expect(wrapper.get('[role="alert"]').text()).toContain('已读回最新状态（暂停接单）')
  })

  it('adds and removes conflicts as a whole list using school ids and shows names', async () => {
    api.replaceConflicts.mockResolvedValue(rows[0])
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    const options = wrapper.get('[data-field="conflict-school"]').findAll('option').map((o) => o.text())
    expect(options).toEqual(['选择学校', '乙大学'])
    await wrapper.get('[data-field="conflict-school"]').setValue('school-2')
    edit('a', { conflicts: [{ kind: 'TENANT_ID', value: 'school-1' }, { kind: 'TENANT_ID', value: 'school-2' }], version: 4 })
    await click(wrapper, '[data-action="add-conflict"]')
    expect(api.replaceConflicts).toHaveBeenCalledWith('a', { version: 3, items: [{ kind: 'TENANT_ID', value: 'school-1' }, { kind: 'TENANT_ID', value: 'school-2' }] }, { quiet: true })
    expect(wrapper.text()).toContain('已添加回避：乙大学')
    await wrapper.get('[data-field="conflict-kind"]').setValue('SUPERVISOR_NAME')
    await wrapper.get('[data-field="conflict-name"]').setValue(' 张导师 ')
    await click(wrapper, '[data-action="add-conflict"]')
    expect(api.replaceConflicts.mock.calls[1]![1].items.at(-1)).toEqual({ kind: 'SUPERVISOR_NAME', value: '张导师' })
    await wrapper.findAll('[data-action="remove-conflict"]')[0]!.trigger('click')
    await flushPromises()
    expect(api.replaceConflicts.mock.calls[2]![1]).toEqual({ version: 4, items: [{ kind: 'TENANT_ID', value: 'school-2' }] })
  })

  it('saves the profile with the version and shows both values on a 409', async () => {
    api.updateExpert.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '数据已变更'))
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    await wrapper.get('[data-field="profile-title"]').setValue('二级教授')
    await wrapper.get('[data-field="profile-directions"]').setValue('机器学习；联邦学习')
    edit('a', { title: '研究员', version: 4 })
    await click(wrapper, '[data-action="save-profile"]')
    expect(api.updateExpert).toHaveBeenCalledWith('a', expect.objectContaining({ title: '二级教授', research_directions: ['机器学习', '联邦学习'], version: 3 }), { quiet: true })
    const banner = wrapper.get('[data-profile-conflict]').text()
    expect(banner).toContain('二级教授')
    expect(banner).toContain('研究员')
    api.updateExpert.mockResolvedValueOnce({ ...rows[0]!, title: '二级教授', version: 5 })
    await click(wrapper, '[data-action="keep-mine"]')
    expect(api.updateExpert.mock.calls[1]![1]).toMatchObject({ title: '二级教授', version: 4 })
    expect(wrapper.text()).toContain('档案已保存')
  })

  it('drops the local edit after a profile 409 and explains a non-profile change', async () => {
    api.updateExpert.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '数据已变更'))
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    await wrapper.get('[data-field="profile-unit"]').setValue('新单位')
    edit('a', { unit: '新单位', service_status: 'UNAVAILABLE', version: 4 })
    await click(wrapper, '[data-action="save-profile"]')
    expect(wrapper.get('[data-profile-conflict]').text()).toContain('档案字段与当前值一致')
    expect(wrapper.find('[data-action="keep-mine"]').exists()).toBe(false)
    await click(wrapper, '[data-action="take-theirs"]')
    expect(wrapper.find('[data-profile-conflict]').exists()).toBe(false)
  })

  it('blocks an invalid profile before sending', async () => {
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    await wrapper.get('[data-field="profile-source-url"]').setValue('ftp://example.cn')
    await click(wrapper, '[data-action="save-profile"]')
    expect(api.updateExpert).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('来源须为不含账号密码的 http 或 https 链接。')
  })

  it('creates an expert with validation, shows a duplicate name and opens the new one', async () => {
    const { wrapper, router } = await mountAt('/platform/experts?new=1')
    await click(wrapper, '[data-action="submit-expert"]')
    expect(api.createExpert).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('至少选择 1 个学科。')
    await wrapper.get('[data-field="expert-name"]').setValue('孙教授')
    await wrapper.get('[data-field="expert-username"]').setValue('Sun.Prof')
    await wrapper.get('[data-field="expert-password"]').setValue(PASSWORD)
    await wrapper.get('[data-field="expert-password-again"]').setValue(PASSWORD)
    await wrapper.get('[data-field="expert-disciplines"] input[value="0812"]').setValue(true)
    api.createExpert.mockRejectedValueOnce(httpError(409, 'RESOURCE_CONFLICT', '登录名已存在'))
    await click(wrapper, '[data-action="submit-expert"]')
    expect(api.createExpert).toHaveBeenCalledWith({ username: 'sun.prof', display_name: '孙教授', initial_password: PASSWORD, unit: '', title: '', discipline_codes: ['0812'] }, { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('登录名已存在')
    const created = expertRecord('n', { display_name: '孙教授', qualification_status: 'PENDING' })
    api.createExpert.mockResolvedValueOnce(created)
    rows = [...rows, created]
    await click(wrapper, '[data-action="submit-expert"]')
    expect(api.createExpert.mock.calls[1]![1].idempotencyKey).not.toBe(api.createExpert.mock.calls[0]![1].idempotencyKey)
    expect(router.currentRoute.value.query).toEqual({ view: 'pending', expert: 'n' })
    expect(wrapper.get('.wsd-obj__title').text()).toContain('孙教授')
    expect(document.body.innerHTML).not.toContain(PASSWORD)
  })

  it('previews a row, opens the full profile and returns with the view kept', async () => {
    const { wrapper, router } = await mountAt('/platform/experts?view=blocked')
    await click(wrapper, '[data-preview="c"]')
    expect(inBody('[data-expert-preview]')?.textContent).toContain('赵老师')
    expect(router.currentRoute.value.query.expert).toBeUndefined()
    ;(inBody('[data-action="open-full"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ view: 'blocked', expert: 'c' })
    expect(wrapper.get('[data-availability]').text()).toContain('已暂停接单')
    await click(wrapper, '[data-back]')
    expect(router.currentRoute.value.query).toEqual({ view: 'blocked' })
    expect(titles(wrapper)).toEqual(['赵老师', '钱老师'])
  })
})

describe('expert import pane', () => {
  const preview = (extra = {}) => ({
    preview_id: 'p1', expires_at: new Date(Date.now() + 600_000).toISOString(), errors: [],
    changes: [
      { expert_id: 'a', username: 'expert.a', version: 3, diff: { title: { before: '教授', after: '二级教授' }, masters_supervisor: { before: null, after: true } } },
      { expert_id: 'c', username: 'expert.c', version: 3, diff: {} },
    ],
    ...extra,
  })
  async function pick(w: VueWrapper, size = 10) {
    const input = w.get('[data-field="import-file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'.repeat(size)], 'experts.csv', { type: 'text/csv' })], configurable: true })
    await input.trigger('change')
  }

  it('previews without writing, applies with one key and reloads the list', async () => {
    api.previewExpertImport.mockResolvedValueOnce(preview())
    api.applyExpertImport.mockRejectedValueOnce(httpError(503, 'UNAVAILABLE', '网关超时'))
    api.applyExpertImport.mockResolvedValueOnce({ preview_id: 'p1', updated_count: 1 })
    const { wrapper } = await mountAt('/platform/experts?import=1')
    await pick(wrapper)
    await click(wrapper, '[data-action="preview-import"]')
    expect(api.previewExpertImport).toHaveBeenCalledWith(expect.any(File), { quiet: true })
    const text = wrapper.get('[data-import-preview]').text()
    expect(text).toContain('预览未写入')
    expect(text).toContain('1 位专家有变化，1 位与现有档案一致')
    expect(text).toContain('未知')
    await click(wrapper, '[data-action="apply-import"]')
    expect(wrapper.text()).toContain('可以再次点击应用，系统会防止重复写入')
    await click(wrapper, '[data-action="apply-import"]')
    const keys = api.applyExpertImport.mock.calls.map((call) => call[1])
    expect(keys[0]).toBe(keys[1])
    expect(api.applyExpertImport).toHaveBeenLastCalledWith('p1', keys[0], { quiet: true })
    expect(wrapper.text()).toContain('已更新 1 位专家的档案')
    expect(api.listExperts).toHaveBeenCalledTimes(2)
  })

  it('cannot apply a preview with errors, and a 409 voids the preview', async () => {
    api.previewExpertImport.mockResolvedValueOnce(preview({ errors: [{ row: 3, message: '登录名不存在' }] }))
    const { wrapper } = await mountAt('/platform/experts?import=1')
    await pick(wrapper)
    await click(wrapper, '[data-action="preview-import"]')
    expect(wrapper.get('[data-import-errors]').text()).toContain('第 3 行：登录名不存在')
    expect(wrapper.find('[data-action="apply-import"]').exists()).toBe(false)

    api.previewExpertImport.mockResolvedValueOnce(preview())
    api.applyExpertImport.mockRejectedValueOnce(httpError(409, 'VERSION_CONFLICT', '专家档案或资格已变更，整批未更新，请重新预览'))
    await click(wrapper, '[data-action="preview-import"]')
    await click(wrapper, '[data-action="apply-import"]')
    expect(wrapper.find('[data-import-preview]').exists()).toBe(false)
    expect(wrapper.text()).toContain('整批没有更新：专家档案或资格已变更')
  })

  it('treats an expired preview as unusable and refuses files over 1 MiB', async () => {
    api.previewExpertImport.mockResolvedValueOnce(preview({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    const { wrapper } = await mountAt('/platform/experts?import=1')
    await pick(wrapper)
    await click(wrapper, '[data-action="preview-import"]')
    expect(wrapper.text()).toContain('这份预览已过期，整批没有更新')
    expect(wrapper.find('[data-action="apply-import"]').exists()).toBe(false)
    await pick(wrapper, 1024 * 1024 + 1)
    expect(wrapper.text()).toContain('CSV 不得超过 1 MiB')
    expect(wrapper.get('[data-action="preview-import"]').attributes('disabled')).toBeDefined()
  })
})

/** U4-9：删除旧 RealExpertLibraryPage 前，从 realExpertLibrary／expertImport 两个旧 spec 补过来的行为（对照见 U4 计划 §16.5）。 */
describe('carried over from the old real expert library', () => {
  it('shows a load error without any expert data and recovers on retry', async () => {
    api.listExperts.mockRejectedValueOnce(new Error('网络不可用'))
    const { wrapper } = await mountAt('/platform/experts')
    expect(wrapper.text()).toContain('专家清单没有加载出来')
    expect(wrapper.text()).toContain('网络不可用')
    expect(wrapper.text()).not.toContain('王教授')
    await wrapper.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await flushPromises()
    expect(titles(wrapper)).toEqual(['王教授', '李研究员', '赵老师', '钱老师'])
  })

  it('does not offer a disabled account for dispatch and shows no demo-only fields', async () => {
    const { wrapper } = await mountAt('/platform/experts?view=blocked&expert=d')
    expect(wrapper.get('[data-availability]').text()).toContain('现在不能指派')
    expect(wrapper.get('[data-availability]').text()).toContain('账号不可登录')
    for (const demoOnly of ['费用标准', '接单率', '前往派单']) expect(wrapper.text()).not.toContain(demoOnly)
  })

  it('reuses the key when creating again after a network failure and reloads on success', async () => {
    const created = expertRecord('n', { display_name: '孙教授', qualification_status: 'PENDING' })
    api.createExpert.mockRejectedValueOnce(new Error('超时')).mockImplementationOnce(async () => {
      rows = [...rows, created]
      return created
    })
    const { wrapper } = await mountAt('/platform/experts?new=1')
    await wrapper.get('[data-field="expert-name"]').setValue('孙教授')
    await wrapper.get('[data-field="expert-username"]').setValue('sun.prof')
    await wrapper.get('[data-field="expert-password"]').setValue(PASSWORD)
    await wrapper.get('[data-field="expert-password-again"]').setValue(PASSWORD)
    await wrapper.get('[data-field="expert-disciplines"] input[value="0812"]').setValue(true)
    await click(wrapper, '[data-action="submit-expert"]')
    await click(wrapper, '[data-action="submit-expert"]')
    expect(api.createExpert).toHaveBeenCalledTimes(2)
    expect(api.createExpert.mock.calls[1]![1].idempotencyKey).toBe(api.createExpert.mock.calls[0]![1].idempotencyKey)
    expect(api.listExperts).toHaveBeenCalledTimes(2)
  })

  it('keeps an unknown supervisor status as null when saving the profile', async () => {
    edit('a', { doctoral_supervisor: null, masters_supervisor: false })
    api.updateExpert.mockResolvedValueOnce(rows[0])
    const { wrapper } = await mountAt('/platform/experts?expert=a')
    await wrapper.get('[data-field="profile-title"]').setValue('二级教授')
    await click(wrapper, '[data-action="save-profile"]')
    expect(api.updateExpert).toHaveBeenCalledWith('a', expect.objectContaining({ doctoral_supervisor: null, masters_supervisor: false, version: 3 }), { quiet: true })
  })

  it('says the import only updates existing experts and shows cleared fields and unknown supervisors', async () => {
    api.previewExpertImport.mockResolvedValueOnce({
      preview_id: 'p1', expires_at: new Date(Date.now() + 600_000).toISOString(), errors: [],
      changes: [{ expert_id: 'a', username: 'expert.a', version: 3, diff: { province_name: { before: '北京市', after: null }, doctoral_supervisor: { before: null, after: false } } }],
    })
    const { wrapper } = await mountAt('/platform/experts?import=1')
    expect(wrapper.text()).toContain('不会新建账号')
    const input = wrapper.get('[data-field="import-file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'experts.csv', { type: 'text/csv' })], configurable: true })
    await input.trigger('change')
    await click(wrapper, '[data-action="preview-import"]')
    const cells = wrapper.findAll('[data-import-preview] tbody tr').map((row) => row.findAll('td').slice(1).map((cell) => cell.text()))
    expect(cells).toEqual([['省份', '北京市', '清空'], ['博导', '未知', '否']])
  })

  it('drops a preview that arrives after leaving the import pane', async () => {
    let resolve!: (value: unknown) => void
    api.previewExpertImport.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const { wrapper, router } = await mountAt('/platform/experts?import=1')
    const input = wrapper.get('[data-field="import-file"]')
    Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'experts.csv', { type: 'text/csv' })], configurable: true })
    await input.trigger('change')
    await wrapper.get('[data-action="preview-import"]').trigger('click')
    await router.replace('/platform/experts?view=all')
    await flushPromises()
    resolve({ preview_id: 'late', expires_at: new Date(Date.now() + 600_000).toISOString(), errors: [], changes: [] })
    await flushPromises()
    await router.replace('/platform/experts?import=1')
    await flushPromises()
    expect(wrapper.find('[data-import-preview]').exists()).toBe(false)
    expect(api.applyExpertImport).not.toHaveBeenCalled()
  })
})
