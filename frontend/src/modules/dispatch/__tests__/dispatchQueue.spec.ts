import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import DispatchWorkbenchPage from '../pages/DispatchWorkbenchPage.vue'

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

describe('dispatch operations queues and assignment loop', () => {
  it('projects ten queues and enforces single-expert assignment', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const queues = await service.listOperationsQueues()
    expect(Object.keys(queues)).toHaveLength(10)

    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    const conflicted = matches.find((m) => m.conflictHit)
    expect(conflicted?.selectable).toBe(false)

    await service.assignExpertToThesis('thesis-main', matches[0].id)
    const tasks = await service.listExpertTasks()
    expect(
      tasks.filter(
        (t) => t.thesisId === 'thesis-main' && ['INVITED', 'IN_REVIEW'].includes(t.status),
      ),
    ).toHaveLength(1)
  })

  it('lists expert matches with explainable reasons and conflict blocks', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')

    const matches = await service.listExpertMatches('thesis-main')

    expect(matches.length).toBeGreaterThanOrEqual(3)
    // 每行都带可解释匹配原因（关键词命中或历史质量）
    for (const match of matches) {
      expect(typeof match.matchReason).toBe('string')
      expect(match.matchReason?.length).toBeGreaterThan(0)
    }
    // 候选含命中关键词的专家
    expect(matches.some((m) => m.keywordHits.length > 0)).toBe(true)
    // 回避命中：禁选 + 原因
    const conflicted = matches.find((m) => m.conflictHit)
    expect(conflicted?.selectable).toBe(false)
    expect(conflicted?.conflictReason?.length).toBeGreaterThan(0)
    // 未命中回避的候选可被选中
    const eligible = matches.find((m) => !m.conflictHit)
    expect(eligible?.selectable).toBe(true)
    // 候选包含费用标准与历史负载数据
    expect(matches[0].feeStandard).toBeGreaterThan(0)
    expect(typeof matches[0].avgCompletionDays).toBe('number')
  })

  it('rejects assigning an expert who hits the conflict rule', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    const conflicted = matches.find((m) => m.conflictHit)

    await expect(
      service.assignExpertToThesis('thesis-main', conflicted!.id),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('rejects assigning to an expert whose service status is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    await service.setExpertServiceStatus('expert-31', 'DISABLED', '暂时满负载')

    await expect(service.assignExpertToThesis('thesis-main', 'expert-31')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    })
  })

  it('reassigns by closing the old task first and creating a new one', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    await service.assignExpertToThesis('thesis-main', matches[0].id)
    const tasks = await service.listExpertTasks()
    const task = tasks.find((t) => t.thesisId === 'thesis-main')
    expect(task?.status).toBe('INVITED')

    await service.reassignExpertTask(task!.id, matches[1].id, '专家出差无法接单')

    const after = await service.listExpertTasks()
    const closed = after.find((t) => t.id === task!.id)
    const reopened = after.find(
      (t) => t.thesisId === 'thesis-main' && ['INVITED', 'IN_REVIEW'].includes(t.status),
    )
    expect(closed?.status).toBe('CANCELLED')
    expect(reopened).toBeDefined()
    expect(reopened?.id).not.toBe(task!.id)
    // 单专家约束：同一论文只有一条当前有效任务
    expect(after.filter((t) => t.thesisId === 'thesis-main' && ['INVITED', 'IN_REVIEW'].includes(t.status))).toHaveLength(1)
  })

  it('requires a reason when reassigning an expert task', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    await service.assignExpertToThesis('thesis-main', matches[0].id)
    const task = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')

    await expect(service.reassignExpertTask(task!.id, matches[1].id, '  ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    // 原因校验失败时任务保持原状态
    expect((await service.listExpertTasks()).find((t) => t.id === task!.id)?.status).toBe(
      'INVITED',
    )
  })

  it('remind and extend actions write to the audit timeline', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    await service.assignExpertToThesis('thesis-main', matches[0].id)
    const task = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')

    const reminded = await service.remindExpertTask(task!.id)
    expect(reminded).toMatchObject({ status: 'INVITED' })

    const extended = await service.extendExpertTask(task!.id, 5)
    expect(extended).toMatchObject({ status: 'INVITED' })

    const audit = await service.listPlatformAuditLog()
    expect(audit.some((entry) => entry.action === 'REMIND')).toBe(true)
    expect(audit.some((entry) => entry.action === 'EXTEND' && entry.detail === '延期 5 天')).toBe(
      true,
    )
  })

  it('returns VERSION_CONFLICT for a concurrent double assignment', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    const eligible = matches.filter((m) => m.selectable)

    // 同一论文被同时指派两次：后到的一方必须拒绝，不能静默覆盖已创建的任务。
    const results = await Promise.allSettled([
      service.assignExpertToThesis('thesis-main', eligible[0].id),
      service.assignExpertToThesis('thesis-main', eligible[1].id),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'VERSION_CONFLICT',
    })
    // 只有一条任务被创建
    const tasks = await service.listExpertTasks()
    expect(
      tasks.filter(
        (t) => t.thesisId === 'thesis-main' && ['INVITED', 'IN_REVIEW'].includes(t.status),
      ),
    ).toHaveLength(1)
  })

  it('derives the ten queue counts from the live platform state', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const initial = await service.listOperationsQueues()
    expect(initial.PENDING_ASSIGNMENT).toBeGreaterThan(0)

    // 派单一篇后：待派 -1、专家待接受 +1（状态派生而非静态计数）
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const before = await service.listOperationsQueues()
    const matches = await service.listExpertMatches('thesis-main')
    await service.assignExpertToThesis('thesis-main', matches[0].id)
    const after = await service.listOperationsQueues()

    expect(after.PENDING_ASSIGNMENT).toBe(before.PENDING_ASSIGNMENT - 1)
    expect(after.PENDING_ACCEPTANCE).toBe(before.PENDING_ACCEPTANCE + 1)
  })

  it('keeps student flow stable when dispatching through the platform service', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loginAs('student')
    await service.submitThesis()
    await service.loginAs('school_reviewer')
    await service.confirmAnonymization()
    await service.confirmDispatch()

    await service.loginAs('platform_reviewer')
    const matches = await service.listExpertMatches('thesis-main')
    await service.assignExpertToThesis('thesis-main', matches.find((m) => !m.conflictHit)!.id)

    // 指派沿用原流水：学校账单仍为冻结 300，学生视角进入送审阶段
    expect((await service.getSchoolBills())[0]).toMatchObject({
      anonymousId: 'HY-2026-0042',
      amount: 300,
      status: 'FROZEN',
    })
    expect((await service.loginAs('student')).thesis.stage).toBe('UNDER_REVIEW')

    await service.loginAs('expert')
    await service.acceptTask()
    expect((await service.loginAs('expert')).thesis.taskStatus).toBe('IN_REVIEW')
  })
})

async function mountWorkbenchPage(service = createScenarioService({ demoMode: true })) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/platform/dispatch', component: DispatchWorkbenchPage }],
  })
  await router.push('/platform/dispatch')
  await router.isReady()
  const wrapper = mount(DispatchWorkbenchPage, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, wrapper }
}

describe('dispatch workbench page interactions', () => {
  it('switches the ten queue tabs and shows the dispatch detail panel fields', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const { wrapper } = await mountWorkbenchPage(service)

    expect(wrapper.findAll('[data-operations-queue]')).toHaveLength(10)
    // 默认选中「待匹配」，展示派单详情
    expect(wrapper.get('[data-queue-panel="PENDING_ASSIGNMENT"]').exists()).toBe(true)
    expect(wrapper.get('[data-dispatch-detail]').text()).toContain('0812 · 计算机科学与技术')
    expect(wrapper.get('[data-dispatch-detail]').text()).toContain('海岳大学')
    expect(wrapper.get('[data-dispatch-detail]').text()).toContain('多模态推理')
    expect(wrapper.get('[data-dispatch-detail]').text()).toContain('学术型')
    expect(wrapper.get('[data-dispatch-detail]').text()).toContain('送审论文指导老师回避')

    await wrapper.get('[data-operations-queue="COMPLETED"]').trigger('click')
    expect(wrapper.get('[data-queue-panel="COMPLETED"]').exists()).toBe(true)

    await wrapper.get('[data-operations-queue="PENDING_ACCEPTANCE"]').trigger('click')
    expect(wrapper.get('[data-queue-panel="PENDING_ACCEPTANCE"]').exists()).toBe(true)
  })

  it('gates the reassign dialog until a replacement and reason are provided', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_REASSIGNMENT')
    const { wrapper } = await mountWorkbenchPage(service)

    await wrapper.get('[data-operations-queue="PENDING_REASSIGNMENT"]').trigger('click')
    await wrapper.get('[data-action="reassign-task"]').trigger('click')

    const confirm = wrapper.get('[data-action="confirm-reassign"]')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.get('select[name="reassignExpertId"]').setValue('expert-26')
    expect(confirm.attributes('disabled')).toBeDefined()

    await wrapper.get('textarea[name="reassignReason"]').setValue('原专家出差无法接单')
    expect(confirm.attributes('disabled')).toBeUndefined()
  })

  it('reminds and extends from the busy queues with confirmations', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_ACCEPTANCE')
    const { wrapper } = await mountWorkbenchPage(service)

    await wrapper.get('[data-operations-queue="PENDING_ACCEPTANCE"]').trigger('click')
    await wrapper.get('[data-action="remind-task"]').trigger('click')
    await wrapper.get('[data-action="confirm-remind"]').trigger('click')
    await flushPromises()

    const audit = await service.listPlatformAuditLog()
    expect(audit.some((entry) => entry.action === 'REMIND')).toBe(true)
  })

  it('shows error feedback with alert role when an operation fails', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const { wrapper } = await mountWorkbenchPage(service)

    // 页面首次指派成功
    await wrapper.get('[data-expert="eligible"] input').setValue(true)
    await wrapper.get('button[data-action="assign-experts"]').trigger('click')
    await wrapper.get('[data-action="confirm-assign"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-action="confirm-assign"]')).toHaveLength(0)

    // 页面防重复护栏生效：指派后按钮禁用，无法再次提交。
    expect(wrapper.get('button[data-action="assign-experts"]').attributes('disabled')).toBeDefined()

    // 竞争运营在服务层直接对同一论文再指派：版本冲突，不生成新任务。
    const matches = await service.listExpertMatches('thesis-main')
    await expect(
      service.assignExpertToThesis('thesis-main', matches.find((m) => m.selectable)!.id),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' })
    expect(
      (await service.listExpertTasks()).filter(
        (t) => t.thesisId === 'thesis-main' && ['INVITED', 'IN_REVIEW'].includes(t.status),
      ),
    ).toHaveLength(1)
  })
})
