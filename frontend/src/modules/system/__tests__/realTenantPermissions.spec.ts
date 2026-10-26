import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listTenants: vi.fn(), createTenant: vi.fn(), listReviewers: vi.fn(), createReviewer: vi.fn(),
  suspendTenant: vi.fn(), resumeTenant: vi.fn(), disableReviewer: vi.fn(),
  enableReviewer: vi.fn(), resetReviewerPassword: vi.fn(), searchInstitutions: vi.fn(),
}))
vi.mock('@/api/systemOperations', () => api)
vi.mock('@/api/catalogs', () => ({searchInstitutions:api.searchInstitutions,previewCatalogImport:vi.fn(),applyCatalogImport:vi.fn()}))

import Page from '../pages/TenantPermissionsPage.vue'

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'false')
  vi.resetAllMocks()
  api.listTenants.mockResolvedValue([])
  api.listReviewers.mockResolvedValue([])
  api.createTenant.mockResolvedValue({})
  api.searchInstitutions.mockResolvedValue([{code:'4111010001',name:'北京大学',province:'北京市',level:'本科'}])
})

const tenant = {
  id: 'tenant-1', code: 'pilot', name: '试点大学', status: 'ACTIVE',
  root_organization: { id: 'org-1', external_id: 'root', name: '试点大学' },
  reviewer_count: 1, created_at: '2026-09-23T00:00:00Z', allowed_actions: ['SUSPEND'],
}
const secondTenant = {
  ...tenant, id: 'tenant-2', code: 'pilot-2', name: '第二大学',
  root_organization: { ...tenant.root_organization, id: 'org-2', name: '第二大学' },
}
const firstReviewer = {
  membership_id: 'member-1', user_id: 'user-1', username: 'school.one',
  display_name: 'A管理员', external_id: 'staff-1', status: 'ACTIVE', is_active: true,
}
const secondReviewer = {
  ...firstReviewer, membership_id: 'member-2', user_id: 'user-2',
  username: 'school.two', display_name: 'B管理员', external_id: 'staff-2',
}

function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function page() {
  const wrapper = mount(Page, { global: { plugins: [createPinia()], stubs: {
    PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' },
  } } })
  await flushPromises()
  return wrapper
}

async function chooseInstitution(wrapper: Awaited<ReturnType<typeof page>>) {
  await wrapper.get('input[aria-label="院校名称或学校标识码"]').setValue('北京大学')
  await wrapper.get('input[aria-label="院校名称或学校标识码"]').trigger('keydown', {key:'Enter'})
  await flushPromises()
  await wrapper.get('.institution-options button').trigger('click')
}

it('loads real tenants and distinguishes empty, failed, and retry states', async () => {
  api.listTenants.mockResolvedValueOnce([tenant]).mockRejectedValueOnce(new Error('加载失败')).mockResolvedValueOnce([])
  const wrapper = await page()
  expect(wrapper.text()).toContain('试点大学')
  expect(wrapper.text()).not.toContain('12,486')
  await wrapper.get('[data-action="reload-tenants"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('加载失败')
  expect(wrapper.text()).not.toContain('试点大学')
  await wrapper.get('[data-action="reload-tenants"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('尚无学校租户')
})

it('creates a school with the approved fields, then clears the password', async () => {
  api.listTenants.mockResolvedValueOnce([]).mockResolvedValueOnce([tenant])
  const wrapper = await page()
  await wrapper.get('[data-action="new-tenant"]').trigger('click')
  await chooseInstitution(wrapper)
  await wrapper.get('[data-field="organization-id"]').setValue('root')
  await wrapper.get('[data-field="organization-name"]').setValue('试点大学')
  await wrapper.get('[data-field="reviewer-username"]').setValue('school.one')
  await wrapper.get('[data-field="reviewer-name"]').setValue('管理员')
  await wrapper.get('[data-field="reviewer-id"]').setValue('staff-1')
  await wrapper.get('[data-field="password"]').setValue('long-secret-1')
  await wrapper.get('[data-action="submit-tenant"]').trigger('click')
  await flushPromises()
  expect(api.createTenant).toHaveBeenCalledWith({
    code: '4111010001', institution_code:'4111010001', name: '北京大学', organization: { external_id: 'root', name: '试点大学' },
    reviewer: { username: 'school.one', display_name: '管理员', external_id: 'staff-1', password: 'long-secret-1' },
  }, expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect(wrapper.text()).toContain('试点大学')
  await wrapper.get('[data-action="new-tenant"]').trigger('click')
  expect((wrapper.get('[data-field="password"]').element as HTMLInputElement).value).toBe('')
})

it('retains non-secret fields but clears password after a failed create', async () => {
  api.createTenant.mockRejectedValueOnce(new Error('创建失败'))
  const wrapper = await page()
  await wrapper.get('[data-action="new-tenant"]').trigger('click')
  await chooseInstitution(wrapper)
  await wrapper.get('[data-field="password"]').setValue('long-secret-1')
  await wrapper.get('[data-action="submit-tenant"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('创建失败')
  expect(wrapper.text()).toContain('已选：4111010001 · 北京大学')
  expect((wrapper.get('[data-field="password"]').element as HTMLInputElement).value).toBe('')
})

it('uses server actions for tenant commands and refreshes the selected tenant', async () => {
  api.listTenants.mockResolvedValue([tenant])
  api.suspendTenant.mockResolvedValue({})
  const wrapper = await page()
  await wrapper.get('[data-action="select-tenant"]').trigger('click')
  await flushPromises()
  expect(api.listReviewers).toHaveBeenCalledWith('tenant-1')
  await wrapper.get('[data-action="suspend-tenant"]').trigger('click')
  await flushPromises()
  expect(api.suspendTenant).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect(api.listTenants).toHaveBeenCalledTimes(2)
  expect(api.listReviewers).toHaveBeenCalledTimes(2)
})

it('disables duplicate creation while pending and clears reset secrets after failure', async () => {
  let finish!: (value: unknown) => void
  api.createTenant.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  api.listTenants.mockResolvedValue([tenant])
  api.listReviewers.mockResolvedValue([{
    membership_id: 'member-1', user_id: 'user-1', username: 'school.one',
    display_name: '管理员', external_id: 'staff-1', status: 'ACTIVE', is_active: true,
  }])
  const wrapper = await page()
  await wrapper.get('[data-action="new-tenant"]').trigger('click')
  await chooseInstitution(wrapper)
  await wrapper.get('[data-action="submit-tenant"]').trigger('click')
  expect(wrapper.get('[data-action="submit-tenant"]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-action="submit-tenant"]').trigger('click')
  expect(api.createTenant).toHaveBeenCalledTimes(1)
  finish({})
  await flushPromises()
  await wrapper.get('[data-action="select-tenant"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-action="reset-reviewer"]').trigger('click')
  api.resetReviewerPassword.mockRejectedValueOnce(new Error('重置失败'))
  await wrapper.get('[data-field="password"]').setValue('replacement-secret')
  await wrapper.get('[data-action="submit-reset"]').trigger('click')
  await flushPromises()
  expect(api.resetReviewerPassword).toHaveBeenCalledWith('tenant-1', 'user-1', 'replacement-secret', expect.objectContaining({ idempotencyKey: expect.any(String) }))
  expect((wrapper.get('[data-field="password"]').element as HTMLInputElement).value).toBe('')
  expect(wrapper.get('[role="alert"]').text()).toContain('重置失败')
})

it('keeps the selected school reviewers when an older success arrives last', async () => {
  api.listTenants.mockResolvedValue([tenant, secondTenant])
  const first = pending<typeof firstReviewer[]>()
  const second = pending<typeof secondReviewer[]>()
  api.listReviewers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const wrapper = await page()
  await wrapper.findAll('[data-action="select-tenant"]')[0].trigger('click')
  await wrapper.findAll('[data-action="select-tenant"]')[1].trigger('click')
  expect(api.listReviewers.mock.calls.map(([id]) => id)).toEqual(['tenant-1', 'tenant-2'])
  second.resolve([secondReviewer])
  await flushPromises()
  expect(wrapper.text()).toContain('第二大学 · 学校管理员')
  expect(wrapper.text()).toContain('B管理员')
  first.resolve([firstReviewer])
  await flushPromises()
  expect(wrapper.text()).toContain('B管理员')
  expect(wrapper.text()).not.toContain('A管理员')
  expect(wrapper.text()).not.toContain('正在加载管理员')
})

it('ignores an older failure without clearing the current loading or success', async () => {
  api.listTenants.mockResolvedValue([tenant, secondTenant])
  const first = pending<typeof firstReviewer[]>()
  const second = pending<typeof secondReviewer[]>()
  api.listReviewers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const wrapper = await page()
  await wrapper.findAll('[data-action="select-tenant"]')[0].trigger('click')
  await wrapper.findAll('[data-action="select-tenant"]')[1].trigger('click')
  first.reject(new Error('旧学校加载失败'))
  await flushPromises()
  expect(wrapper.text()).toContain('正在加载管理员')
  expect(wrapper.text()).not.toContain('旧学校加载失败')
  second.resolve([secondReviewer])
  await flushPromises()
  expect(wrapper.text()).toContain('B管理员')
  expect(wrapper.text()).not.toContain('正在加载管理员')
})

it('does not reopen an old result after the school is cleared and another selected', async () => {
  api.listTenants.mockResolvedValueOnce([tenant, secondTenant]).mockResolvedValueOnce([secondTenant])
  const first = pending<typeof firstReviewer[]>()
  const second = pending<typeof secondReviewer[]>()
  api.listReviewers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const wrapper = await page()
  await wrapper.findAll('[data-action="select-tenant"]')[0].trigger('click')
  await wrapper.get('[data-action="reload-tenants"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).not.toContain('学校管理员')
  await wrapper.get('[data-action="select-tenant"]').trigger('click')
  second.resolve([secondReviewer])
  await flushPromises()
  first.resolve([firstReviewer])
  await flushPromises()
  expect(wrapper.text()).toContain('B管理员')
  expect(wrapper.text()).not.toContain('A管理员')
})

it('invalidates a pending reviewer request when schools refresh', async () => {
  api.listTenants.mockResolvedValue([tenant])
  const first = pending<typeof firstReviewer[]>()
  api.listReviewers.mockReturnValueOnce(first.promise)
  const wrapper = await page()
  await wrapper.get('[data-action="select-tenant"]').trigger('click')
  expect(wrapper.text()).toContain('正在加载管理员')
  await wrapper.get('[data-action="reload-tenants"]').trigger('click')
  await flushPromises()
  first.resolve([firstReviewer])
  await flushPromises()
  expect(wrapper.text()).not.toContain('A管理员')
  expect(wrapper.text()).not.toContain('正在加载管理员')
})
