import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'
import { disciplineCatalog } from '@/modules/thesis/data/disciplineCatalog'

import ExpertProfilePage from '../pages/ExpertProfilePage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountPage(
  service = createScenarioService({ storage: createMemoryStorage(), demoMode: true }),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/expert/profile', component: ExpertProfilePage }],
  })
  await router.push('/expert/profile')
  await router.isReady()
  const wrapper = mount(ExpertProfilePage, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, router, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('expert profile service (PAGE-021)', () => {
  it('saves own profile with controlled discipline tags', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profile = await service.getExpertProfile()
    expect(profile.name).toBe('周明远')

    await service.saveExpertProfile({
      ...profile,
      researchTags: ['知识图谱', '知识图谱', ' 机器学习 '],
    })
    expect((await service.getExpertProfile()).researchTags).toEqual(['知识图谱', '机器学习'])

    await expect(
      service.saveExpertProfile({
        ...profile,
        researchTags: ['一', '二', '三', '四', '五', '六', '七', '八', '九'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('keeps the name read-only on save', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 改名尝试被服务端拒绝（姓名只读，PAGE-021 基本信息首项）
    await expect(
      service.saveExpertProfile({ name: '冒名者' } as never),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', message: '姓名不可修改。' })
    // 仅填写可编辑字段：其他字段保持不变
    await service.saveExpertProfile({ unit: '东江理工大学' })
    const profile = await service.getExpertProfile()
    expect(profile.name).toBe('周明远')
    expect(profile.unit).toBe('东江理工大学')
    expect(profile.title).toBe('教授')
  })

  it('accepts only disciplines from the controlled 184-entry catalog', async () => {
    expect(disciplineCatalog).toHaveLength(184)
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profile = await service.getExpertProfile()
    expect(disciplineCatalog.some((d) => d.code === profile.discipline.code)).toBe(true)

    await expect(
      service.saveExpertProfile({
        ...profile,
        discipline: { code: '9999', name: '不存在学科' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    await service.saveExpertProfile({
      ...profile,
      discipline: { code: '0835', name: '软件工程' },
    })
    expect((await service.getExpertProfile()).discipline.code).toBe('0835')
  })

  it('persists profile and audit entries across service recreation', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const profile = await service.getExpertProfile()
    await service.saveExpertProfile({
      ...profile,
      unit: '东江理工大学',
      reviewableTypes: ['硕士学位论文', '学术型'],
    })

    const restored = createScenarioService({ storage, demoMode: true })
    const saved = await restored.getExpertProfile()
    expect(saved.reviewableTypes).toEqual(['硕士学位论文', '学术型'])
    const audit = await restored.listPlatformAuditLog()
    expect(audit.some((entry) => entry.action === 'PROFILE_UPDATED')).toBe(true)
    expect(audit[0].operator).toBe('周明远')
  })

  it('projects only the own profile for the expert persona', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profile = await service.getExpertProfile()
    expect(profile.id).toBe('expert-17')
    expect(profile.name).toBe('周明远')
    // 仅本人资料：不暴露其他专家的任何信息
    expect(profile).not.toHaveProperty('otherExperts')
    expect(profile).not.toHaveProperty('servingSchools')
    expect(profile).not.toHaveProperty('schoolUsage')
  })
})

describe('expert profile page (PAGE-021)', () => {
  it('shows qualification status with reject reason and a re-submit entry', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profile = await service.getExpertProfile()
    await service.reviewExpertQualification(profile.id, 'REJECTED', '职称证明已过期')
    const { wrapper } = await mountPage(service)

    expect(wrapper.text()).toContain('资格驳回')
    expect(wrapper.text()).toContain('职称证明已过期')
    // 驳回后有重新提交入口
    expect(wrapper.findAll('[data-action="re-submit-qualification"]').length).toBe(1)
    expect(wrapper.get('[data-qualification-status]').attributes('data-qualification-status')).toBe(
      'REJECTED',
    )
  })

  it('shows 通过 and 审核中 qualification states', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const profile = await service.getExpertProfile()
    await service.reviewExpertQualification(profile.id, 'APPROVED', '材料齐全')
    const { wrapper } = await mountPage(service)
    expect(wrapper.get('[data-qualification-status]').text()).toContain('资格通过')

    const reviewing = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { wrapper: reviewingWrapper } = await mountPage(reviewing)
    expect(reviewingWrapper.get('[data-qualification-status]').text()).toContain('资格审核中')
  })

  it('renders the profile form with read-only name and 8-tag research fields', async () => {
    const { wrapper } = await mountPage()
    const nameInput = wrapper.get('[data-field="name"]')
    expect(nameInput.attributes('readonly')).toBeDefined()
    expect(nameInput.attributes('disabled')).toBeUndefined()
    expect((nameInput.element as HTMLInputElement).value).toBe('周明远')

    expect(wrapper.text()).toContain('擅长评审领域')
    expect(wrapper.text()).toContain('最多填写 8 个')
    expect(wrapper.get('[data-field="tags"]').exists()).toBe(true)
    expect(wrapper.get('[data-action="open-discipline"]').exists()).toBe(true)
  })

  it('saves the form after double confirmation and writes an audit entry', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { wrapper } = await mountPage(service)
    const saveSpy = vi.spyOn(service, 'saveExpertProfile')

    await wrapper.get('[data-action="save-profile"]').trigger('click')
    await flushPromises()
    const confirm = wrapper.get('[data-action="confirm-save-profile"]')
    expect(confirm.text()).toContain('保存资料')
    // 保存前确认按钮可用（服务端仍会拒绝越界输入）
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalledTimes(1)
    // 表单不提交姓名（姓名只读字段不参与保存），提交本人可编辑字段
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: '东江理工大学',
        discipline: { code: '0812', name: '计算机科学与技术' },
        researchTags: ['知识图谱', '机器学习'],
      }),
    )
    expect(saveSpy.mock.calls[0][0]).not.toHaveProperty('name')
    const audit = await service.listPlatformAuditLog()
    expect(audit.some((entry) => entry.action === 'PROFILE_UPDATED')).toBe(true)
    // 防重复：确认后按钮不可再次触发
    expect(wrapper.findAll('[data-action="confirm-save-profile"]').length).toBe(0)
  })

  it('shows only own data: no other experts, no serving schools, no school usage', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.text()).not.toMatch(/顾远航|宋清和|海岳大学|陈知微/)
    // 基本资料不展示平台运营维护字段：服务状态、历史负载、费用标准
    expect(wrapper.text()).not.toContain('服务状态')
    expect(wrapper.text()).not.toContain('历史接受率')
    expect(wrapper.text()).not.toContain('费用标准')
  })
})
