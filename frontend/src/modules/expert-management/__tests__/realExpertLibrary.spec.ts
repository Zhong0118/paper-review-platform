import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listExperts: vi.fn(), expertOptions: vi.fn(), createExpert: vi.fn(), updateExpert: vi.fn(),
  reviewQualification: vi.fn(), setServiceStatus: vi.fn(), replaceConflicts: vi.fn(),
}))
vi.mock('@/api/expertOperations', () => api)

import RealExpertLibraryPage from '../pages/RealExpertLibraryPage.vue'

const expert = {
  id: 'expert-1', user_id: 'user-1', username: 'expert.one', display_name: '周教授',
  account_status: 'ACTIVE', unit: '甲大学', title: '教授', discipline_codes: ['0812'],
  qualification_status: 'PENDING', service_status: 'AVAILABLE', version: 1,
  conflicts: [{ kind: 'TENANT_ID', value: 'school-1' }],
}

async function page() {
  const wrapper = mount(RealExpertLibraryPage, {
    global: { plugins: [createPinia()], stubs: { PortalLayout: { template: '<div><slot/><slot name="modal"/></div>' } } },
  })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listExperts.mockResolvedValue([expert])
  api.expertOptions.mockResolvedValue({ schools: [{ id: 'school-1', name: '甲校', status: 'ACTIVE' }], disciplines: [{ code: '0812', name: '计算机' }] })
})

describe('real expert library', () => {
  it('loads persisted fields and resolves conflict school ids to names without demo fields', async () => {
    const wrapper = await page()
    expect(wrapper.text()).toContain('周教授')
    expect(wrapper.text()).toContain('甲校')
    expect(wrapper.text()).not.toContain('费用标准')
    expect(wrapper.text()).not.toContain('接单率')
  })

  it('does not advertise dispatch when the account is disabled', async () => {
    api.listExperts.mockResolvedValue([{ ...expert, account_status: 'DISABLED', qualification_status: 'APPROVED' }])
    const wrapper = await page()
    expect(wrapper.text()).toContain('账号：停用')
    expect(wrapper.text()).not.toContain('前往派单')
  })

  it('shows a load error and never falls back to demo data', async () => {
    api.listExperts.mockRejectedValue(new Error('网络不可用'))
    const wrapper = await page()
    expect(wrapper.get('[role="alert"]').text()).toContain('网络不可用')
    expect(wrapper.text()).not.toContain('周教授')
  })

  it('saves status and refreshes from server, with paused dispatch warning', async () => {
    api.setServiceStatus.mockResolvedValue({ ...expert, version: 2, service_status: 'UNAVAILABLE' })
    api.listExperts.mockResolvedValueOnce([expert]).mockResolvedValueOnce([{ ...expert, version: 2, service_status: 'UNAVAILABLE' }])
    const wrapper = await page()
    await wrapper.get('[data-action="pause-expert"]').trigger('click')
    await wrapper.get('[data-field="reason"]').setValue('暂停新任务')
    await wrapper.get('[data-action="save-status"]').trigger('click')
    await flushPromises()
    expect(api.setServiceStatus).toHaveBeenCalledWith('expert-1', { version: 1, status: 'UNAVAILABLE', reason: '暂停新任务' })
    expect(wrapper.text()).toContain('不可派单')
  })

  it('refreshes on version conflict and requires a new user decision', async () => {
    api.setServiceStatus.mockRejectedValue({ response: { status: 409 } })
    api.listExperts.mockResolvedValueOnce([expert]).mockResolvedValueOnce([{ ...expert, version: 2 }])
    const wrapper = await page()
    await wrapper.get('[data-action="pause-expert"]').trigger('click')
    await wrapper.get('[data-field="reason"]').setValue('暂停新任务')
    await wrapper.get('[data-action="save-status"]').trigger('click')
    await flushPromises()
    expect(api.setServiceStatus).toHaveBeenCalledTimes(1)
    expect(api.listExperts).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="alert"]').text()).toContain('重新确认')
  })

  it('creates with a stable key after failure and reloads on success', async () => {
    api.createExpert.mockRejectedValueOnce(new Error('超时')).mockResolvedValueOnce(expert)
    const wrapper = await page()
    await wrapper.get('[data-action="create-expert"]').trigger('click')
    for (const [field, value] of Object.entries({ username: 'new.one', display_name: '新专家', initial_password: 'long-password-1', unit: '乙大学', title: '教授' })) {
      await wrapper.get(`[data-field="${field}"]`).setValue(value)
    }
    await wrapper.get('[data-field="discipline_codes"] input[type="checkbox"][value="0812"]').setValue(true)
    await wrapper.get('[data-action="save-expert"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="save-expert"]').trigger('click')
    await flushPromises()
    expect(api.createExpert).toHaveBeenCalledTimes(2)
    expect(api.createExpert.mock.calls[0]?.[1]).toEqual(api.createExpert.mock.calls[1]?.[1])
    expect(api.listExperts).toHaveBeenCalledTimes(2)
  })
})
