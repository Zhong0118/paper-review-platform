import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReviewBatch, SchoolMember, StudentEligibility } from '@/api/schoolOperations'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Page from '../MemberSettingsPage.vue'

const api = vi.hoisted(() => ({
  listMembers: vi.fn(), listBatches: vi.fn(), listEligibilities: vi.fn(), createMember: vi.fn(), updateMember: vi.fn(),
  disableMember: vi.fn(), enableMember: vi.fn(), resetMemberPassword: vi.fn(), createEligibility: vi.fn(),
  suspendEligibility: vi.fn(), resumeEligibility: vi.fn(),
}))
vi.mock('@/api/schoolOperations', () => api)
enableAutoUnmount(afterEach)

const member = (id: string, name: string, extra: Partial<SchoolMember> = {}): SchoolMember => ({
  membership_id: id, user_id: `u-${id}`, username: `user.${id}`, display_name: name, external_id: `NO-${id}`, membership_type: 'STUDENT',
  status: 'ACTIVE', is_active: true, contact_phone: null, contact_email: null, updated_at: '2026-10-01T00:00:00Z', ...extra,
})
const batch = (id: string, status: ReviewBatch['status']): ReviewBatch => ({
  id, code: `CODE-${id}`, name: `批次${id}`, status, start_at: '2026-09-01T00:00:00Z', end_at: '2026-12-20T00:00:00Z',
  rule_version: 1, version: 1, allowed_actions: [], accept_days: null, review_days: 14, program_catalog_id: null,
})
const elig = (id: string, batchId: string, student: string, status: StudentEligibility['status'] = 'ELIGIBLE'): StudentEligibility => ({
  id, review_batch_id: batchId, student_membership_id: student, supervisor_membership_id: 't1', student_name: '', student_no: '',
  supervisor_name: '陈老师', degree_type: '工学硕士', status,
})
let students: SchoolMember[]
let supervisors: SchoolMember[]
let eligs: StudentEligibility[]
const PASSWORD = 'correct-horse-12'

beforeEach(() => {
  vi.resetAllMocks()
  students = [
    member('s1', '张三'), member('s2', '李四', { username: 'li.si' }), member('s3', '王五'),
    member('s4', '赵六', { is_active: false, status: 'DISABLED' }),
  ]
  supervisors = [member('t1', '陈老师', { membership_type: 'SUPERVISOR' }), member('t2', '孙老师', { membership_type: 'SUPERVISOR', is_active: false, status: 'DISABLED' })]
  eligs = [elig('e1', 'o', 's1'), elig('e3', 'o', 's3', 'SUSPENDED'), elig('e9', 'c', 's1')]
  api.listMembers.mockImplementation(async (type: string) => (type === 'STUDENT' ? students : supervisors).map((row) => ({ ...row })))
  api.listBatches.mockResolvedValue([batch('d', 'DRAFT'), batch('o', 'OPEN'), batch('c', 'SUBMISSION_CLOSED')])
  api.listEligibilities.mockImplementation(async (batchId: string) => eligs.filter((row) => row.review_batch_id === batchId).map((row) => ({ ...row })))
})
afterEach(() => vi.unstubAllGlobals())

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/school/members', component: Page }, { path: '/:rest(.*)*', component: { render: () => null } }] })
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
const titles = (w: VueWrapper) => w.findAll('.wsd-titem__title').map((t) => t.text())
const rowText = (w: VueWrapper, name: string) => w.findAll('.wsd-titem').find((row) => row.find('.wsd-titem__title').text() === name)!.text()
const editStudent = (id: string, extra: Partial<SchoolMember>) => (students = students.map((row) => (row.membership_id === id ? { ...row, ...extra } : row)))

describe('member settings', () => {
  it('lists students first with counts, flags and the first one selected', async () => {
    const { wrapper, router } = await mountAt('/school/members')
    expect(api.listMembers).toHaveBeenCalledWith('STUDENT', { quiet: true })
    expect(api.listMembers).toHaveBeenCalledWith('SUPERVISOR', { quiet: true })
    expect(api.listEligibilities).toHaveBeenCalledWith('o', { quiet: true })
    expect(titles(wrapper)).toEqual(['张三', '李四', '王五', '赵六'])
    expect(wrapper.findAll('.wsd-views__count').map((c) => c.text())).toEqual(['4', '2', '6'])
    expect(rowText(wrapper, '张三')).not.toMatch(/无资格|资格暂停|已停用/)
    expect(rowText(wrapper, '李四')).toContain('无资格')
    expect(rowText(wrapper, '王五')).toContain('资格暂停')
    expect(rowText(wrapper, '赵六')).toContain('已停用')
    expect(router.currentRoute.value.query.member).toBe('s1')
    expect(wrapper.get('.wsd-obj__title').text()).toBe('张三')
  })

  it('switches views and searches by name, number or username within the loaded members', async () => {
    const { wrapper, router } = await mountAt('/school/members')
    await wrapper.findAll('.wsd-views__tab')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.view).toBe('SUPERVISOR')
    expect(titles(wrapper)).toEqual(['陈老师', '孙老师'])
    wrapper.unmount()
    const searched = await mountAt('/school/members?view=all&q=LI.SI')
    expect(titles(searched.wrapper)).toEqual(['李四'])
    searched.wrapper.unmount()
    const none = await mountAt('/school/members?q=nobody')
    expect(none.wrapper.text()).toContain('没有匹配“nobody”的成员')
    await none.wrapper.findAll('button').find((b) => b.text() === '清除搜索')!.trigger('click')
    await flushPromises()
    expect(none.router.currentRoute.value.query.q).toBeUndefined()
  })

  it('shows eligibility by batch and creates one for a batch that has none, with only active supervisors', async () => {
    api.createEligibility.mockResolvedValueOnce(elig('e5', 'd', 's1'))
    const { wrapper } = await mountAt('/school/members?member=s1')
    expect(wrapper.findAll('[data-eligibility-row]').map((r) => r.attributes('data-eligibility-row'))).toEqual(['e1'])
    expect(wrapper.get('[data-eligibility]').text()).toContain('往期批次的资格 1')
    expect((wrapper.get('[data-field="eligibility-batch"]').element as HTMLSelectElement).value).toBe('d')
    const options = wrapper.get('[data-field="eligibility-supervisor"]').findAll('option').map((o) => o.text())
    expect(options).toEqual(['不指定', '陈老师（NO-t1）'])
    await wrapper.get('[data-field="eligibility-supervisor"]').setValue('t1')
    await wrapper.get('[data-field="degree-type"]').setValue(' 工学硕士 ')
    eligs = [...eligs, elig('e5', 'd', 's1')]
    await click(wrapper, '[data-action="create-eligibility"]')
    expect(api.createEligibility).toHaveBeenCalledWith('d', { student_membership_id: 's1', supervisor_membership_id: 't1', degree_type: '工学硕士' }, { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('已为“批次d”建立送审资格')
    expect(wrapper.findAll('[data-eligibility-row]')).toHaveLength(2)
    expect(wrapper.find('[data-new-eligibility]').exists()).toBe(false)
  })

  it('sends empty supervisor and degree as null and shows the server reason on 409', async () => {
    api.createEligibility.mockRejectedValueOnce(httpError(409, 'CONFLICT', '学生已在其他开放批次'))
    const { wrapper } = await mountAt('/school/members?member=s2')
    await wrapper.get('[data-field="eligibility-batch"]').setValue('d')
    await click(wrapper, '[data-action="create-eligibility"]')
    expect(api.createEligibility.mock.calls[0]![1]).toEqual({ student_membership_id: 's2', supervisor_membership_id: null, degree_type: null })
    expect(wrapper.get('[data-new-eligibility]').text()).toContain('学生已在其他开放批次')
    expect(wrapper.text()).not.toContain('已为“批次d”建立送审资格')
  })

  it('suspends after a confirmation and resumes directly', async () => {
    api.suspendEligibility.mockResolvedValueOnce(elig('e1', 'o', 's1', 'SUSPENDED'))
    const { wrapper } = await mountAt('/school/members?member=s1')
    await click(wrapper, '[data-action="suspend-eligibility"]')
    expect(api.suspendEligibility).not.toHaveBeenCalled()
    eligs = eligs.map((row) => (row.id === 'e1' ? { ...row, status: 'SUSPENDED' } : row))
    await click(wrapper, '[data-action="confirm-suspend"]')
    expect(api.suspendEligibility).toHaveBeenCalledWith('e1', { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('已暂停“批次o”的送审资格')
    api.resumeEligibility.mockResolvedValueOnce(elig('e1', 'o', 's1'))
    eligs = eligs.map((row) => (row.id === 'e1' ? { ...row, status: 'ELIGIBLE' } : row))
    await click(wrapper, '[data-action="resume-eligibility"]')
    expect(api.resumeEligibility).toHaveBeenCalledWith('e1', { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('已恢复“批次o”的送审资格')
  })

  it('rereads on a command 409: success when already in the target state, otherwise the server reason', async () => {
    api.suspendEligibility.mockRejectedValueOnce(httpError(409, 'CONFLICT', '资格状态已变化'))
    eligs = eligs.map((row) => (row.id === 'e1' ? { ...row, status: 'SUSPENDED' } : row))
    const stale = elig('e1', 'o', 's1')
    api.listEligibilities.mockImplementationOnce(async () => [stale, elig('e3', 'o', 's3', 'SUSPENDED')])
    const { wrapper } = await mountAt('/school/members?member=s1')
    await click(wrapper, '[data-action="suspend-eligibility"]')
    await click(wrapper, '[data-action="confirm-suspend"]')
    expect(wrapper.text()).toContain('已暂停“批次o”的送审资格')
    expect(wrapper.get('[data-eligibility-row="e1"]').text()).toContain('已暂停')

    api.resumeEligibility.mockRejectedValueOnce(httpError(409, 'CONFLICT', '资格状态已变化'))
    await click(wrapper, '[data-action="resume-eligibility"]')
    expect(wrapper.get('[role="alert"]').text()).toContain('资格状态已变化')
  })

  it('on an edit 409 keeps the input, lists both values and can overwrite with the new version', async () => {
    api.updateMember.mockRejectedValueOnce(httpError(409, 'CONFLICT', '成员资料已变化'))
    const { wrapper } = await mountAt('/school/members?member=s1')
    await wrapper.get('[data-field="member-phone"]').setValue('13800000000')
    editStudent('s1', { contact_phone: '13911111111', updated_at: '2026-10-02T00:00:00Z' })
    await click(wrapper, '[data-action="save-member"]')
    expect(api.updateMember).toHaveBeenCalledWith('s1', { display_name: '张三', contact_phone: '13800000000', contact_email: null, expected_updated_at: '2026-10-01T00:00:00Z' }, { quiet: true })
    const banner = wrapper.get('[data-conflict]').text()
    expect(banner).toContain('电话')
    expect(banner).toContain('13800000000')
    expect(banner).toContain('13911111111')
    expect((wrapper.get('[data-field="member-phone"]').element as HTMLInputElement).value).toBe('13800000000')
    api.updateMember.mockResolvedValueOnce({ ...students[0]!, contact_phone: '13800000000', updated_at: '2026-10-03T00:00:00Z' })
    await click(wrapper, '[data-action="keep-mine"]')
    expect(api.updateMember.mock.calls[1]![1]).toMatchObject({ contact_phone: '13800000000', expected_updated_at: '2026-10-02T00:00:00Z' })
    expect(wrapper.find('[data-conflict]').exists()).toBe(false)
    expect(wrapper.text()).toContain('已保存。')
  })

  it('can drop the local edit after a 409 and load the server value', async () => {
    api.updateMember.mockRejectedValueOnce(httpError(409, 'CONFLICT', '成员资料已变化'))
    const { wrapper } = await mountAt('/school/members?member=s1')
    await wrapper.get('[data-field="member-name"]').setValue('张三丰')
    editStudent('s1', { display_name: '张叁', updated_at: '2026-10-02T00:00:00Z' })
    await click(wrapper, '[data-action="save-member"]')
    await click(wrapper, '[data-action="take-theirs"]')
    expect((wrapper.get('[data-field="member-name"]').element as HTMLInputElement).value).toBe('张叁')
    expect(wrapper.find('[data-conflict]').exists()).toBe(false)
    expect(api.updateMember).toHaveBeenCalledTimes(1)
  })

  it('resets a password through two inputs, then clears it without echoing it', async () => {
    api.resetMemberPassword.mockResolvedValueOnce(students[0])
    const { wrapper, router } = await mountAt('/school/members?member=s1')
    await click(wrapper, '[data-action="reset-password"]')
    await wrapper.get('[data-field="new-password"]').setValue(PASSWORD)
    await wrapper.get('[data-field="new-password-again"]').setValue('different-12345')
    await click(wrapper, '[data-action="confirm-reset"]')
    expect(api.resetMemberPassword).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('两次输入不一致。')
    await wrapper.get('[data-field="new-password-again"]').setValue(PASSWORD)
    await click(wrapper, '[data-action="confirm-reset"]')
    expect(api.resetMemberPassword).toHaveBeenCalledWith('s1', PASSWORD, { idempotencyKey: expect.any(String), quiet: true })
    expect(api.resetMemberPassword.mock.calls[0]![2].idempotencyKey).not.toContain(PASSWORD)
    expect((wrapper.get('[data-field="new-password"]').element as HTMLInputElement).value).toBe('')
    expect((wrapper.get('[data-field="new-password-again"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.text()).toContain('密码已重置')
    expect(document.body.innerHTML).not.toContain(PASSWORD)
    expect(router.currentRoute.value.fullPath).not.toContain(PASSWORD)
    await click(wrapper, '[data-action="reset-password"]')
    expect((wrapper.get('[data-field="new-password"]').element as HTMLInputElement).value).toBe('')
  })

  it('disables after a confirmation and enables directly', async () => {
    api.disableMember.mockResolvedValueOnce(students[0])
    const { wrapper } = await mountAt('/school/members?member=s1')
    await click(wrapper, '[data-action="disable-member"]')
    expect(api.disableMember).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('已登录的会话也会失效')
    editStudent('s1', { is_active: false, status: 'DISABLED', updated_at: '2026-10-02T00:00:00Z' })
    await click(wrapper, '[data-action="confirm-disable"]')
    expect(api.disableMember).toHaveBeenCalledWith('s1', { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('已停用。本人无法登录')
    expect(rowText(wrapper, '张三')).toContain('已停用')
    api.enableMember.mockResolvedValueOnce(students[0])
    editStudent('s1', { is_active: true, status: 'ACTIVE', updated_at: '2026-10-03T00:00:00Z' })
    await click(wrapper, '[data-action="enable-member"]')
    expect(api.enableMember).toHaveBeenCalledWith('s1', { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('已启用')
  })

  it('validates a new member, shows a duplicate 409 and opens the created member', async () => {
    const { wrapper, router } = await mountAt('/school/members?new=1')
    await click(wrapper, '[data-action="submit-member"]')
    expect(api.createMember).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写姓名。')
    expect(wrapper.text()).toContain('请填写登录账号。')
    await wrapper.get('[data-field="member-name"]').setValue('周七')
    await wrapper.get('[data-field="member-id"]').setValue('2026001')
    await wrapper.get('[data-field="member-username"]').setValue('Zhou.Qi')
    await wrapper.get('[data-field="password"]').setValue(PASSWORD)
    await wrapper.get('[data-field="password-again"]').setValue(PASSWORD)
    api.createMember.mockRejectedValueOnce(httpError(409, 'CONFLICT', '学校代码或成员信息已存在'))
    await click(wrapper, '[data-action="submit-member"]')
    expect(api.createMember).toHaveBeenCalledWith({ membership_type: 'STUDENT', username: 'zhou.qi', display_name: '周七', external_id: '2026001', password: PASSWORD }, { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.text()).toContain('学校代码或成员信息已存在')
    const created = member('s7', '周七', { username: 'zhou.qi' })
    api.createMember.mockResolvedValueOnce(created)
    students = [...students, created]
    await click(wrapper, '[data-action="submit-member"]')
    expect(api.createMember.mock.calls[1]![1].idempotencyKey).not.toBe(api.createMember.mock.calls[0]![1].idempotencyKey)
    expect(router.currentRoute.value.query).toEqual({ view: 'STUDENT', member: 's7' })
    expect(wrapper.get('.wsd-obj__title').text()).toBe('周七')
  })

  it('says the member is gone when the link no longer matches anyone', async () => {
    const { wrapper } = await mountAt('/school/members?member=gone')
    expect(wrapper.text()).toContain('这个成员已不在本校')
  })

  it('degrades only the eligibility parts when eligibilities fail to load', async () => {
    api.listEligibilities.mockImplementation(async (batchId: string) => {
      if (batchId === 'c') throw httpError(500, 'INTERNAL', '服务暂时不可用')
      return eligs.filter((row) => row.review_batch_id === batchId)
    })
    const { wrapper } = await mountAt('/school/members?member=s2')
    expect(wrapper.text()).toContain('送审资格没有加载出来，行上不标资格状态。')
    expect(rowText(wrapper, '李四')).not.toContain('无资格')
    expect(rowText(wrapper, '赵六')).toContain('已停用')
    expect(wrapper.get('[data-eligibility]').text()).toContain('服务暂时不可用')
    expect(wrapper.find('[data-new-eligibility]').exists()).toBe(false)
    expect(wrapper.find('[data-field="member-name"]').exists()).toBe(true)
  })

  it('starts on the list when narrow', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const { wrapper, router } = await mountAt('/school/members')
    expect(router.currentRoute.value.query.member).toBeUndefined()
    await click(wrapper, '.wsd-titem')
    expect(router.currentRoute.value.query.member).toBe('s1')
    await wrapper.findAll('button').find((b) => b.text().startsWith('‹'))!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.member).toBeUndefined()
  })
})

describe('carried over from the old member page (U4-9)', () => {
  it('does not submit a new member twice while creation is pending, and keeps the password out of storage', async () => {
    let finish!: (value: SchoolMember) => void
    api.createMember.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    const { wrapper } = await mountAt('/school/members?new=1')
    await wrapper.get('[data-field="member-name"]').setValue('周七')
    await wrapper.get('[data-field="member-id"]').setValue('2026001')
    await wrapper.get('[data-field="member-username"]').setValue('zhou.qi')
    await wrapper.get('[data-field="password"]').setValue(PASSWORD)
    await wrapper.get('[data-field="password-again"]').setValue(PASSWORD)
    await wrapper.get('[data-action="submit-member"]').trigger('click')
    expect(wrapper.get('[data-action="submit-member"]').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-action="submit-member"]').trigger('click')
    expect(api.createMember).toHaveBeenCalledOnce()
    expect(JSON.stringify(sessionStorage) + JSON.stringify(localStorage)).not.toContain(PASSWORD)
    const created = member('s7', '周七', { username: 'zhou.qi' })
    students = [...students, created]
    finish(created)
    await flushPromises()
    expect(wrapper.get('.wsd-obj__title').text()).toBe('周七')
  })

  it('does not offer a new eligibility to a disabled student', async () => {
    const { wrapper } = await mountAt('/school/members?member=s4')
    expect(wrapper.get('[data-eligibility]').text()).toContain('账号已停用，启用后才能建立送审资格。')
    expect(wrapper.find('[data-new-eligibility]').exists()).toBe(false)
  })
})
