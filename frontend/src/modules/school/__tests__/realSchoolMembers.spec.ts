import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMembers: vi.fn(), createMember: vi.fn(), updateMember: vi.fn(), disableMember: vi.fn(), enableMember: vi.fn(), resetMemberPassword: vi.fn(),
  listBatches: vi.fn(), listEligibilities: vi.fn(), createEligibility: vi.fn(), suspendEligibility: vi.fn(), resumeEligibility: vi.fn(),
}))
vi.mock('@/api/schoolOperations', () => api)
import Page from '../pages/SchoolMembersPage.vue'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
const student = { membership_id: 'student-1', user_id: 'user-1', username: 'student.one', display_name: '学生甲', external_id: '20270001', membership_type: 'STUDENT', status: 'ACTIVE', is_active: true, contact_phone: null, contact_email: null, updated_at: '2026-09-23T00:00:00Z' }
const supervisor = { ...student, membership_id: 'supervisor-1', user_id: 'user-2', username: 'supervisor.one', display_name: '导师甲', external_id: 'T-1', membership_type: 'SUPERVISOR' }
const batch = { id: 'batch-1', code: '2027', name: '2027 春季', status: 'DRAFT', start_at: null, end_at: null, rule_version: 1, version: 1, allowed_actions: ['EDIT', 'OPEN'] }
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  sessionStorage.clear()
  api.listMembers.mockImplementation(async (type: string) => type === 'STUDENT' ? [student] : [supervisor])
  api.listBatches.mockResolvedValue([batch])
  api.listEligibilities.mockResolvedValue([])
})

async function page() {
  const wrapper = mount(Page, { global: { plugins: [createPinia()], stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } } } })
  await flushPromises()
  return wrapper
}

it('loads student, supervisor, and eligibility views from one refresh', async () => {
  const wrapper = await page()
  expect(api.listMembers).toHaveBeenCalledWith('STUDENT')
  expect(api.listMembers).toHaveBeenCalledWith('SUPERVISOR')
  expect(api.listBatches).toHaveBeenCalledOnce()
  expect(api.listEligibilities).toHaveBeenCalledWith('batch-1')
  expect(wrapper.text()).toContain('学生甲')
  await wrapper.get('[data-action="tab-supervisor"]').trigger('click')
  expect(wrapper.text()).toContain('导师甲')
  await wrapper.get('[data-action="tab-eligibility"]').trigger('click')
  expect(wrapper.text()).toContain('2027 春季')
})

it('creates one student at a time and clears password after success or failure', async () => {
  api.createMember.mockResolvedValueOnce(student).mockRejectedValueOnce(new Error('建立失败'))
  const wrapper = await page()
  await wrapper.get('[data-action="new-member"]').trigger('click')
  await wrapper.get('[data-field="member-username"]').setValue('student.new')
  await wrapper.get('[data-field="member-name"]').setValue('新学生')
  await wrapper.get('[data-field="member-id"]').setValue('20270002')
  await wrapper.get('[data-field="password"]').setValue('long-secret-1')
  await wrapper.get('[data-action="submit-member"]').trigger('click')
  await flushPromises()
  expect(api.createMember).toHaveBeenCalledWith({ membership_type: 'STUDENT', username: 'student.new', display_name: '新学生', external_id: '20270002', password: 'long-secret-1' }, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect(JSON.stringify(sessionStorage)).not.toContain('long-secret-1')
  await wrapper.get('[data-action="new-member"]').trigger('click')
  await wrapper.get('[data-field="member-username"]').setValue('student.retry')
  await wrapper.get('[data-field="password"]').setValue('other-secret-1')
  await wrapper.get('[data-action="submit-member"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('建立失败')
  expect((wrapper.get('[data-field="member-username"]').element as HTMLInputElement).value).toBe('student.retry')
  expect((wrapper.get('[data-field="password"]').element as HTMLInputElement).value).toBe('')
})

it('does not submit a member twice while creation is pending', async () => {
  let finish!: (value: unknown) => void
  api.createMember.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const wrapper = await page()
  await wrapper.get('[data-action="new-member"]').trigger('click')
  await wrapper.get('[data-action="submit-member"]').trigger('click')
  expect(wrapper.get('[data-action="submit-member"]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-action="submit-member"]').trigger('click')
  expect(api.createMember).toHaveBeenCalledOnce()
  finish(student)
  await flushPromises()
})

it('updates only editable member fields and protects status and password commands', async () => {
  api.updateMember.mockResolvedValue(student)
  api.disableMember.mockResolvedValue(student)
  api.resetMemberPassword.mockRejectedValueOnce(new Error('重置失败')).mockResolvedValueOnce(student)
  const wrapper = await page()
  await wrapper.get('[data-action="edit-member"]').trigger('click')
  await wrapper.get('[data-field="member-name"]').setValue('学生甲修订')
  await wrapper.get('[data-action="submit-edit"]').trigger('click')
  await flushPromises()
  expect(api.updateMember).toHaveBeenCalledWith('student-1', expect.objectContaining({ display_name: '学生甲修订', expected_updated_at: student.updated_at }))
  await wrapper.get('[data-action="disable-member"]').trigger('click')
  await flushPromises()
  expect(api.disableMember).toHaveBeenCalledWith('student-1', expect.objectContaining({ idempotencyKey: expect.any(String) }))
  await wrapper.get('[data-action="reset-member"]').trigger('click')
  await wrapper.get('[data-field="password"]').setValue('replacement-secret')
  await wrapper.get('[data-action="submit-reset"]').trigger('click')
  await flushPromises()
  expect(api.resetMemberPassword).toHaveBeenCalledWith('student-1', 'replacement-secret', expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect((wrapper.get('[data-field="password"]').element as HTMLInputElement).value).toBe('')
  await wrapper.get('[data-field="password"]').setValue('replacement-success')
  await wrapper.get('[data-action="submit-reset"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('replacement-success')
})

it('closes a stale edit after a version conflict and refreshes member data', async () => {
  api.updateMember.mockRejectedValue({ response: { status: 409 } })
  const wrapper = await page()
  await wrapper.get('[data-action="edit-member"]').trigger('click')
  await wrapper.get('[data-action="submit-edit"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(wrapper.get('[role="alert"]').text()).toContain('数据已变更')
  expect(api.listMembers).toHaveBeenCalledTimes(4)
})

it('offers only active members and draft/open batches for a new eligibility', async () => {
  const inactive = { ...student, membership_id: 'student-disabled', username: 'student.disabled', is_active: false, status: 'DISABLED' }
  const archived = { ...batch, id: 'batch-archived', name: '旧批次', status: 'ARCHIVED' }
  api.listMembers.mockImplementation(async (type: string) => type === 'STUDENT' ? [student, inactive] : [supervisor])
  api.listBatches.mockResolvedValue([batch, archived])
  api.createEligibility.mockResolvedValue({})
  const wrapper = await page()
  await wrapper.get('[data-action="tab-eligibility"]').trigger('click')
  await wrapper.get('[data-action="new-eligibility"]').trigger('click')
  expect(wrapper.get('[data-field="eligibility-student"]').text()).toContain('学生甲')
  expect(wrapper.get('[data-field="eligibility-student"]').text()).not.toContain('student.disabled')
  expect(wrapper.get('[data-field="eligibility-batch"]').text()).toContain('2027 春季')
  expect(wrapper.get('[data-field="eligibility-batch"]').text()).not.toContain('旧批次')
  await wrapper.get('[data-field="eligibility-batch"]').setValue('batch-1')
  await wrapper.get('[data-field="eligibility-student"]').setValue('student-1')
  await wrapper.get('[data-field="eligibility-supervisor"]').setValue('supervisor-1')
  await wrapper.get('[data-action="submit-eligibility"]').trigger('click')
  await flushPromises()
  expect(api.createEligibility).toHaveBeenCalledWith('batch-1', expect.objectContaining({ student_membership_id: 'student-1', supervisor_membership_id: 'supervisor-1' }), expect.objectContaining({ idempotencyKey: expect.any(String) }))
})
