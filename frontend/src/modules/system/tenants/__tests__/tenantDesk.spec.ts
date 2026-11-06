import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SchoolReviewer, TenantSummary } from '@/api/systemOperations'
import { httpError } from '@/modules/school/preparation/__tests__/fixtures'

import Desk from '../TenantDesk.vue'
import { institution, reviewerRecord, tenantRecord } from './fixtures'

const api = vi.hoisted(() => ({
  listTenants: vi.fn(), createTenant: vi.fn(), listReviewers: vi.fn(), createReviewer: vi.fn(),
  suspendTenant: vi.fn(), resumeTenant: vi.fn(), disableReviewer: vi.fn(), enableReviewer: vi.fn(),
  resetReviewerPassword: vi.fn(), searchInstitutions: vi.fn(),
}))
vi.mock('@/api/systemOperations', () => api)
vi.mock('@/api/catalogs', () => ({ searchInstitutions: api.searchInstitutions }))
enableAutoUnmount(afterEach)

const PASSWORD = 'Initial-pass-2026'
let tenants: TenantSummary[]
let reviewers: SchoolReviewer[]

beforeEach(() => {
  vi.resetAllMocks()
  tenants = [
    tenantRecord(),
    tenantRecord({ id: 'tenant-2', code: 'north-agri', name: '北方农业大学', status: 'SUSPENDED', allowed_actions: ['RESUME'], reviewer_count: 2 }),
  ]
  reviewers = [reviewerRecord(), reviewerRecord({ user_id: 'user-2', membership_id: 'member-2', username: 'school.two', display_name: '乙管理员', external_id: 'T002', is_active: false })]
  api.listTenants.mockImplementation(async () => tenants.map((row) => ({ ...row })))
  api.listReviewers.mockImplementation(async () => reviewers.map((row) => ({ ...row })))
  api.searchInstitutions.mockResolvedValue([institution(), institution({ code: '4111010002', name: '北方农业职业学院', level: '' })])
})

async function mountAt(url: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/system/tenants', component: Desk }, { path: '/:rest(.*)*', component: { render: () => null } }] })
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
const set = async (w: VueWrapper, field: string, value: string) => {
  await w.get(`[data-field="${field}"]`).setValue(value)
}
const inputValue = (w: VueWrapper, field: string) => (w.get(`[data-field="${field}"]`).element as HTMLInputElement).value
const lastKey = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls.at(-1)?.at(-1) as { idempotencyKey: string }).idempotencyKey

const byText = async (w: VueWrapper, text: string) => {
  await w.findAll('button').find((b) => b.text() === text)!.trigger('click')
  await flushPromises()
}
async function fillCreate(w: VueWrapper) {
  await set(w, 'institution-search', '农业')
  await click(w, '[data-action="search-institution"]')
  await click(w, '[data-institution="4111010001"]')
  await fillRest(w)
}
async function fillRest(w: VueWrapper) {
  await set(w, 'org-id', 'GS')
  await set(w, 'org-name', '研究生院')
  await set(w, 'reviewer-name', '吕青')
  await set(w, 'reviewer-staff', 'T009')
  await set(w, 'reviewer-username', 'Lv.Qing')
  await set(w, 'reviewer-password', PASSWORD)
  await set(w, 'reviewer-again', PASSWORD)
}

describe('tenant desk: list', () => {
  it('lists schools quietly and filters by keyword and status through the address', async () => {
    const { wrapper, router } = await mountAt('/system/tenants')
    expect(api.listTenants).toHaveBeenCalledWith({ quiet: true })
    expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()))).toEqual([
      ['试点大学', 'pilot', '研究生院', '1', '正常', '2026-09-23'],
      ['北方农业大学', 'north-agri', '研究生院', '2', '已暂停', '2026-09-23'],
    ])
    expect(wrapper.text()).toContain('不读论文正文')
    await set(wrapper, 'tenant-search', 'AGRI')
    await flushPromises()
    expect(router.currentRoute.value.query.q).toBe('AGRI')
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    await wrapper.get('[data-field="tenant-status"]').setValue('ACTIVE')
    await flushPromises()
    expect(wrapper.text()).toContain('当前筛选没有匹配的学校')
    await byText(wrapper, '清除筛选')
    expect(router.currentRoute.value.query).toEqual({})
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('opens a school from its row and shows a gone state for unknown links', async () => {
    const { wrapper, router } = await mountAt('/system/tenants')
    await click(wrapper, '[data-tenant="tenant-1"] .rowlink')
    expect(router.currentRoute.value.query.tenant).toBe('tenant-1')
    expect(api.listReviewers).toHaveBeenCalledWith('tenant-1', { quiet: true })
    expect(wrapper.findAll('[data-reviewer]').map((row) => row.findAll('td').slice(0, 4).map((cell) => cell.text()))).toEqual([
      ['甲管理员', 'school.one', 'T001', '启用中'],
      ['乙管理员', 'school.two', 'T002', '已停用'],
    ])
    await click(wrapper, '[data-action="to-list"]')
    expect(router.currentRoute.value.query.tenant).toBeUndefined()
    const gone = await mountAt('/system/tenants?tenant=nope')
    expect(gone.wrapper.text()).toContain('这所学校已不可见')
  })

  it('shows a retryable error when the list fails', async () => {
    api.listTenants.mockRejectedValueOnce(new Error('网络异常'))
    const { wrapper } = await mountAt('/system/tenants')
    expect(wrapper.text()).toContain('学校列表没有加载出来')
    expect(wrapper.find('[data-action="new-tenant"]').exists()).toBe(false)
    await click(wrapper, '[data-action="retry-tenants"]')
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })
})

describe('tenant desk: school detail', () => {
  it('suspends only after confirmation and resumes directly', async () => {
    api.suspendTenant.mockImplementation(async () => {
      tenants = tenants.map((row) => (row.id === 'tenant-1' ? { ...row, status: 'SUSPENDED', allowed_actions: ['RESUME'] } : row))
      return tenants[0]
    })
    const { wrapper } = await mountAt('/system/tenants?tenant=tenant-1')
    await click(wrapper, '[data-action="suspend-tenant"]')
    expect(api.suspendTenant).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('该校全部账号立即退出')
    await click(wrapper, '[data-action="confirm-suspend"]')
    expect(api.suspendTenant).toHaveBeenCalledWith('tenant-1', { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.get('[data-flash]').text()).toContain('已暂停试点大学')
    expect(wrapper.find('[data-action="resume-tenant"]').exists()).toBe(true)
    expect(wrapper.get('[data-action="new-reviewer"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('学校暂停期间不能新增管理员')

    api.resumeTenant.mockResolvedValue(tenants[0])
    await click(wrapper, '[data-action="resume-tenant"]')
    expect(api.resumeTenant).toHaveBeenCalledWith('tenant-1', { idempotencyKey: expect.any(String), quiet: true })
  })

  it('treats a 409 as success when the school already has the target status, otherwise shows the server text', async () => {
    api.suspendTenant.mockImplementation(async () => {
      tenants = tenants.map((row) => (row.id === 'tenant-1' ? { ...row, status: 'SUSPENDED', allowed_actions: ['RESUME'] } : row))
      throw httpError(409, 'CONFLICT', '学校当前状态不允许该操作')
    })
    const { wrapper } = await mountAt('/system/tenants?tenant=tenant-1')
    await click(wrapper, '[data-action="suspend-tenant"]')
    await click(wrapper, '[data-action="confirm-suspend"]')
    expect(wrapper.get('[data-flash]').text()).toContain('试点大学已是已暂停状态')
    expect(wrapper.find('[data-notice]').exists()).toBe(false)

    api.resumeTenant.mockRejectedValue(httpError(409, 'CONFLICT', '学校当前状态不允许该操作'))
    tenants = tenants.map((row) => (row.id === 'tenant-1' ? { ...row, status: 'SUSPENDED', allowed_actions: ['RESUME'] } : row))
    await click(wrapper, '[data-action="resume-tenant"]')
    expect(wrapper.get('[data-notice]').text()).toContain('学校当前状态不允许该操作')
  })

  it('adds an admin with a staff id and does not echo the password', async () => {
    api.createReviewer.mockImplementation(async (_id: string, body: { username: string; display_name: string; external_id: string }) => {
      reviewers = [...reviewers, reviewerRecord({ user_id: 'user-3', username: body.username, display_name: body.display_name, external_id: body.external_id })]
      return reviewers.at(-1)
    })
    const { wrapper } = await mountAt('/system/tenants?tenant=tenant-1')
    await click(wrapper, '[data-action="new-reviewer"]')
    await click(wrapper, '[data-action="confirm-reviewer"]')
    expect(api.createReviewer).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请填写工号。')
    await set(wrapper, 'reviewer-name', '丙管理员')
    await set(wrapper, 'reviewer-username', 'School.Three')
    await set(wrapper, 'reviewer-staff', 'T003')
    await set(wrapper, 'reviewer-password', PASSWORD)
    await set(wrapper, 'reviewer-again', `${PASSWORD}x`)
    await click(wrapper, '[data-action="confirm-reviewer"]')
    expect(wrapper.text()).toContain('两次输入不一致。')
    await set(wrapper, 'reviewer-again', PASSWORD)
    await click(wrapper, '[data-action="confirm-reviewer"]')
    expect(api.createReviewer).toHaveBeenCalledWith('tenant-1', { username: 'school.three', display_name: '丙管理员', external_id: 'T003', password: PASSWORD }, { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.get('[data-flash]').text()).toContain('初始密码不会再显示')
    expect(wrapper.html()).not.toContain(PASSWORD)
    expect(inputValue(wrapper, 'reviewer-password')).toBe('')
    expect(wrapper.findAll('[data-reviewer]')).toHaveLength(3)
  })

  it('resets a password with two entries and clears it afterwards', async () => {
    api.resetReviewerPassword.mockResolvedValue(reviewers[0])
    const { wrapper } = await mountAt('/system/tenants?tenant=tenant-1')
    await click(wrapper, '[data-reviewer="user-1"] [data-action="reset-reviewer"]')
    await set(wrapper, 'reset-password', 'short')
    await set(wrapper, 'reset-again', 'short')
    await click(wrapper, '[data-action="confirm-reset"]')
    expect(wrapper.text()).toContain('至少 12 位。')
    expect(api.resetReviewerPassword).not.toHaveBeenCalled()
    await set(wrapper, 'reset-password', PASSWORD)
    await set(wrapper, 'reset-again', PASSWORD)
    await click(wrapper, '[data-action="confirm-reset"]')
    expect(api.resetReviewerPassword).toHaveBeenCalledWith('tenant-1', 'user-1', PASSWORD, { idempotencyKey: expect.any(String), quiet: true })
    expect(wrapper.get('[data-flash]').text()).toContain('已重置 甲管理员 的密码')
    expect(wrapper.html()).not.toContain(PASSWORD)
    expect(inputValue(wrapper, 'reset-password')).toBe('')
  })

  it('shows the server text when disabling the last admin is refused, and reuses the key on a network retry', async () => {
    reviewers = [reviewerRecord()]
    api.disableReviewer.mockRejectedValueOnce(new Error('网络异常')).mockRejectedValueOnce(httpError(409, 'CONFLICT', '不能停用最后一名学校管理员'))
    const { wrapper } = await mountAt('/system/tenants?tenant=tenant-1')
    await click(wrapper, '[data-reviewer="user-1"] [data-action="toggle-reviewer"]')
    const first = lastKey(api.disableReviewer)
    await click(wrapper, '[data-reviewer="user-1"] [data-action="toggle-reviewer"]')
    expect(lastKey(api.disableReviewer)).toBe(first)
    expect(wrapper.get('[data-notice]').text()).toContain('不能停用最后一名学校管理员')
    expect(wrapper.get('[data-reviewer="user-1"]').text()).toContain('启用中')
  })
})

describe('tenant desk: new school', () => {
  it('requires an official institution and checks every field before sending', async () => {
    const { wrapper, router } = await mountAt('/system/tenants')
    await click(wrapper, '[data-action="new-tenant"]')
    expect(router.currentRoute.value.query.new).toBe('1')
    await click(wrapper, '[data-action="submit-tenant"]')
    expect(api.createTenant).not.toHaveBeenCalled()
    const text = wrapper.text()
    for (const message of ['请从官方名录中选择一所院校。', '2–32 位小写字母、数字或短横线。', '请填写根组织编号。', '请填写根组织名称。', '请填写姓名。', '请填写工号。', '请填写登录名。', '请输入密码。']) expect(text).toContain(message)
  })

  it('searches the official list, defaults the code to the institution code and sends the request', async () => {
    api.createTenant.mockImplementation(async () => {
      const created = tenantRecord({ id: 'tenant-3', code: '4111010001', name: '北方农业大学' })
      tenants = [...tenants, created]
      return created
    })
    const { wrapper, router } = await mountAt('/system/tenants?new=1')
    await set(wrapper, 'institution-search', '农业')
    await wrapper.get('[data-field="institution-search"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(api.searchInstitutions).toHaveBeenCalledWith('农业', { quiet: true })
    expect(wrapper.get('[data-institution="4111010002"]').text()).toContain('成人高校')
    await click(wrapper, '[data-institution="4111010001"]')
    expect(wrapper.get('[data-picked]').text()).toContain('北方农业大学')
    expect(inputValue(wrapper, 'tenant-code')).toBe('4111010001')
    await fillRest(wrapper)
    await click(wrapper, '[data-action="submit-tenant"]')
    expect(api.createTenant).toHaveBeenCalledWith({
      institution_code: '4111010001',
      code: '4111010001',
      name: '北方农业大学',
      organization: { external_id: 'GS', name: '研究生院' },
      reviewer: { username: 'lv.qing', display_name: '吕青', external_id: 'T009', password: PASSWORD },
    }, { idempotencyKey: expect.any(String), quiet: true })
    expect(router.currentRoute.value.query).toEqual({ tenant: 'tenant-3' })
    expect(wrapper.get('[data-flash]').text()).toContain('已建立北方农业大学与首位学校管理员')
    expect(wrapper.html()).not.toContain(PASSWORD)
  })

  it('keeps an edited code when the institution is picked again', async () => {
    const { wrapper } = await mountAt('/system/tenants?new=1')
    await set(wrapper, 'tenant-code', 'north-agri-2')
    await wrapper.get('[data-field="tenant-code"]').trigger('input')
    await set(wrapper, 'institution-search', '农业')
    await click(wrapper, '[data-action="search-institution"]')
    await click(wrapper, '[data-institution="4111010001"]')
    expect(inputValue(wrapper, 'tenant-code')).toBe('north-agri-2')
  })

  it('reuses the key for an unchanged retry and takes a new one after any edit', async () => {
    api.createTenant.mockRejectedValue(new Error('网络异常'))
    const { wrapper } = await mountAt('/system/tenants?new=1')
    await fillCreate(wrapper)
    await click(wrapper, '[data-action="submit-tenant"]')
    const first = lastKey(api.createTenant)
    expect(inputValue(wrapper, 'reviewer-password')).toBe(PASSWORD)
    await click(wrapper, '[data-action="submit-tenant"]')
    expect(lastKey(api.createTenant)).toBe(first)
    await set(wrapper, 'reviewer-staff', 'T010')
    await click(wrapper, '[data-action="submit-tenant"]')
    expect(lastKey(api.createTenant)).not.toBe(first)
    expect(wrapper.get('[data-failure]').text()).toContain('其他内容已保留')
  })

  it('keeps the input on a duplicate code, clears the passwords and links to the school using it', async () => {
    api.createTenant.mockRejectedValue(httpError(409, 'CONFLICT', '学校代码已存在'))
    const { wrapper, router } = await mountAt('/system/tenants?new=1')
    await fillCreate(wrapper)
    await set(wrapper, 'tenant-code', 'North-Agri')
    await click(wrapper, '[data-action="submit-tenant"]')
    expect(api.listTenants).toHaveBeenCalledTimes(2)
    const banner = wrapper.get('[data-failure]').text()
    expect(banner).toContain('没有建立：学校代码已存在')
    expect(banner).toContain('学校代码 north-agri 已被北方农业大学使用')
    expect(inputValue(wrapper, 'tenant-code')).toBe('North-Agri')
    expect(inputValue(wrapper, 'reviewer-name')).toBe('吕青')
    expect(inputValue(wrapper, 'reviewer-password')).toBe('')
    expect(wrapper.get('[data-field="tenant-code"]').attributes('aria-invalid')).toBe('true')
    await click(wrapper, '[data-action="open-owner"]')
    expect(router.currentRoute.value.query).toEqual({ tenant: 'tenant-2' })
  })
})
