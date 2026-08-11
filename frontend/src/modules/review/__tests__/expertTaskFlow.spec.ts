import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import ExpertTaskTable from '../components/ExpertTaskTable.vue'
import ExpertTasksPage from '../pages/ExpertTasksPage.vue'
import InvitationPage from '../pages/InvitationPage.vue'

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
  component: typeof ExpertTasksPage | typeof InvitationPage,
  service = createScenarioService({ storage: createMemoryStorage(), demoMode: true }),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/expert/tasks', component: ExpertTasksPage },
      { path: '/expert/invitation', component: InvitationPage },
      { path: '/expert/review', component: { template: '<div>工作台</div>' } },
    ],
  })
  await router.push(component === ExpertTasksPage ? '/expert/tasks' : '/expert/invitation')
  await router.isReady()
  const wrapper = mount(component, {
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

describe('expert task service', () => {
  it('accepts and rejects invitations with boundary checks', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const tasks = await service.listExpertTasks({ own: true })
    const invited = tasks.find((t) => t.status === 'INVITED')
    expect(invited?.allowedActions).toContain('ACCEPT_TASK')

    await expect(service.rejectExpertTask(invited!.id, '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await service.rejectExpertTask(invited!.id, '时间不足')
    expect(
      (await service.listExpertTasks({ own: true })).find((t) => t.id === invited!.id)?.status,
    ).toBe('REJECTED')
    // 拒绝原因写入审计（演示投影：拒绝后等待平台改派）
    const audit = await service.listPlatformAuditLog()
    expect(audit[0]).toMatchObject({
      action: 'REJECT',
      taskId: invited!.id,
      detail: '专家拒绝接单（原因：时间不足），等待平台改派。',
    })
  })

  it('accepts 其他 with a mandatory explanation and rejects without one', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks({ own: true })).find(
      (t) => t.status === 'INVITED',
    )!

    // 未选原因：拦截
    await expect(service.rejectExpertTask(invited.id, '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    // 选择「其他」但未填说明：拦截
    await expect(service.rejectExpertTask(invited.id, '其他')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    // 其他 + 说明：reason 以「其他：」开头，审计携带完整说明
    await service.rejectExpertTask(invited.id, '其他：研究方向与本课题仅部分重叠')
    expect(
      (await service.listExpertTasks({ own: true })).find((t) => t.id === invited.id)?.status,
    ).toBe('REJECTED')
    const audit = await service.listPlatformAuditLog()
    expect(audit[0]).toMatchObject({
      action: 'REJECT',
      detail: '专家拒绝接单（原因：其他：研究方向与本课题仅部分重叠），等待平台改派。',
    })
  })

  it('hides materials before acceptance and reveals them after', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks({ own: true })).find(
      (t) => t.status === 'INVITED',
    )!
    expect(invited.materialsVisible).toBe(false)

    await service.acceptExpertTask(invited.id)
    const accepted = (await service.listExpertTasks({ own: true })).find(
      (t) => t.id === invited.id,
    )!
    expect(accepted.status).toBe('IN_REVIEW')
    expect(accepted.materialsVisible).toBe(true)
  })

  it('blocks actions on timed-out and foreign tasks', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const tasks = await service.listExpertTasks({ own: true })
    const invited = tasks.find((t) => t.status === 'INVITED')!

    // 接单超时（REJECTED 终态）任务不可再接受
    await service.rejectExpertTask(invited.id, '时间不足')
    await expect(service.acceptExpertTask(invited.id)).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    })
    await expect(service.rejectExpertTask(invited.id, '时间不足')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    })

    // 他人任务不可操作（FORBIDDEN）
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const matches = await service.listExpertMatches('thesis-main')
    const other = matches.find((m) => !m.conflictHit && m.id !== 'expert-17')
    expect(other).toBeDefined()
    await service.assignExpertToThesis('thesis-main', other!.id)
    const foreignTask = (await service.listExpertTasks()).find(
      (t) => t.thesisId === 'thesis-main',
    )!
    expect(foreignTask.expertId).not.toBe('expert-17')
    await expect(service.acceptExpertTask(foreignTask.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })

  it('persists accepted task status and materials across service recreation', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks({ own: true })).find(
      (t) => t.status === 'INVITED',
    )!
    await service.acceptExpertTask(invited.id)

    const restored = createScenarioService({ storage, demoMode: true })
    const task = (await restored.listExpertTasks({ own: true })).find((t) => t.id === invited.id)!
    expect(task.status).toBe('IN_REVIEW')
    expect(task.materialsVisible).toBe(true)
  })

  it('keeps the student-flow fallback task non-interactive on the expert page', async () => {
    // 学生端流程兼容回退：学生端已进入评阅（taskStatus 存在）但平台尚无任务时，
    // 专家页补充一条投影任务；该任务不得成为可接受的死胡同（平台无记录，接单必 NOT_FOUND）。
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('EXPERT_REVIEW')
    const tasks = await service.listExpertTasks({ own: true })
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks.every((t) => t.expertId === 'expert-17')).toBe(true)
    const fallback = tasks.find((t) => t.id === 'task-e-2026-042')
    expect(fallback).toBeDefined()
    // 非待接受状态（学生端已进入评阅）：无接单/拒绝动作，不渲染可点击入口
    expect(fallback!.status).toBe('IN_REVIEW')
    expect(fallback!.allowedActions).toEqual(['CONTINUE_REVIEW'])
    // 平台无该任务记录：接单必然被服务端拒绝
    await expect(service.acceptExpertTask(fallback!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })
})

describe('expert task list page (PAGE-008)', () => {
  it('renders three main tabs, auxiliary tabs, and a stats row', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('CORRECTION_PENDING')
    const { wrapper } = await mountPage(ExpertTasksPage, service)

    const tabs = wrapper.findAll('[data-tab]')
    expect(tabs.map((tab) => tab.attributes('data-tab'))).toEqual([
      'INVITED',
      'IN_REVIEW',
      'SUBMITTED',
      'REJECTED',
      'CANCELLED',
      'CORRECTION_PENDING',
    ])
    // 统计行：各 Tab 计数
    const stats = wrapper.findAll('[data-tab-count]')
    expect(stats.length).toBeGreaterThan(0)
    expect(stats.some((s) => s.text() === '0')).toBe(true)

    // CORRECTION_PENDING 场景：需要更正标记只挂在本人任务（任务与申请均 expertId 匹配），
    // 更正申请属于他人（expert-31）时不误标，辅助 Tab 计数为 0。
    const pendingCount = wrapper.get('[data-tab="CORRECTION_PENDING"] [data-tab-count]')
    expect(pendingCount.text()).toBe('0')
    expect(wrapper.findAll('[data-correction-tag]')).toHaveLength(0)
  })

  it('lists own tasks with columns and drives actions from allowedActions', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { wrapper } = await mountPage(ExpertTasksPage, service)

    const rows = wrapper.findAll('[data-expert-task]')
    expect(rows.length).toBeGreaterThan(0)
    // 列表列：匿名编号 / 匿名题目 / 送审方向 / 接单截止 / 费用
    expect(wrapper.text()).toContain('HY-2026-0042')
    expect(wrapper.text()).toContain('匿名题目')
    expect(wrapper.text()).toContain('计算机科学与技术')
    expect(wrapper.text()).toContain('2026-08-26 18:00')
    expect(wrapper.text()).toContain('¥ 300.00')
    // 操作按钮由服务端允许动作驱动：待接受任务出现「接受」入口
    expect(wrapper.findAll('[data-action="accept-task"]').length).toBeGreaterThan(0)
    // 接单前不开放匿名版全文
    expect(wrapper.text()).not.toContain('匿名版全文')
    expect(wrapper.text()).not.toMatch(/林知远|20260042/)
  })

  it('accepts a task after double confirmation and moves it out of the invited tab', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { router, wrapper } = await mountPage(ExpertTasksPage, service)
    const task = (await service.listExpertTasks({ own: true })).find((t) => t.status === 'INVITED')!
    const row = wrapper.get(`[data-expert-task="${task.id}"]`)

    await row.get('[data-action="accept-task"]').trigger('click')
    await flushPromises()
    // 接受二次确认对话框
    const confirmDialog = wrapper.get('[data-action="confirm-accept-task"]')
    expect(confirmDialog.text()).toContain('确认接受')
    await confirmDialog.trigger('click')
    await flushPromises()

    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === task.id)?.status).toBe(
      'IN_REVIEW',
    )
    // 接受后进入工作台
    expect(router.currentRoute.value.path).toBe('/expert/review')
  })

  it('shows an overdue warning tag on overdue in-review tasks but still allows entry', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('OVERDUE')
    const { wrapper } = await mountPage(ExpertTasksPage, service)

    expect(wrapper.findAll('[data-overdue="true"]').length).toBeGreaterThan(0)
    // 逾期仍可进入评阅
    expect(wrapper.findAll('[data-action="continue-review"]').length).toBeGreaterThan(0)
  })

  it('rejects an invitation with a mandatory reason; 其他 requires an explanation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { wrapper } = await mountPage(InvitationPage, service)
    const task = (await service.listExpertTasks({ own: true })).find((t) => t.status === 'INVITED')!

    // 拒绝原因下拉必填：直接拒绝被拦截
    await wrapper.get('[data-action="open-reject-dialog"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-action="confirm-reject-task"]').attributes('disabled')).toBeDefined()

    const options = wrapper
      .findAll('[data-reject-reason] option')
      .map((option) => option.attributes('value'))
    expect(options).toEqual(['', '方向不符', '时间不足', '利益冲突', '其他'])

    // 选中「其他」时出现必填说明输入框；未填说明时确认按钮仍禁用
    await wrapper.get('[data-reject-reason]').setValue('其他')
    await flushPromises()
    const detail = wrapper.get('[data-reject-reason-detail]')
    expect(detail.exists()).toBe(true)
    expect(wrapper.get('[data-action="confirm-reject-task"]').attributes('disabled')).toBeDefined()

    // 填写说明后可确认；服务层收到的原因是「其他：说明」
    const rejectSpy = vi.spyOn(service, 'rejectExpertTask')
    await detail.setValue('研究方向与本课题仅部分重叠')
    await wrapper.get('[data-action="confirm-reject-task"]').trigger('click')
    await flushPromises()
    expect(rejectSpy).toHaveBeenCalledWith(task.id, '其他：研究方向与本课题仅部分重叠')
    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === task.id)?.status).toBe(
      'REJECTED',
    )
  })
})

describe('expert invitation detail (PAGE-009)', () => {
  it('shows the anonymous overview and hides full materials before acceptance', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { wrapper } = await mountPage(InvitationPage, service)

    // 匿名概要：匿名题目 / 摘要（匿名化）/ 送审方向 / 专业匹配说明 / 评阅截止（绝对时间）/ 评审费用（含说明）
    expect(wrapper.text()).toContain('匿名任务')
    expect(wrapper.text()).toContain('计算机科学与技术')
    expect(wrapper.text()).toContain('匹配说明')
    expect(wrapper.text()).toContain('2026-08-26 18:00')
    expect(wrapper.text()).toContain('¥ 300.00')
    // 模板说明
    expect(wrapper.text()).toContain('模板')
    // 接单前不开放匿名版全文
    expect(wrapper.text()).not.toContain('匿名版全文')
    expect(wrapper.text()).not.toMatch(/林知远|20260042/)
  })

  it('accepts with double confirmation and routes to the review workspace', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { router, wrapper } = await mountPage(InvitationPage, service)

    await wrapper.get('[data-action="accept-task"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-action="confirm-accept-task"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/expert/review')
  })
})

describe('expert task table (desktop rows, mobile cards)', () => {
  it('renders desktop rows and mobile cards from the same data', async () => {
    const wrapper = mount(ExpertTaskTable, {
      props: { rows: [] },
      global: { stubs: { RouterLink: true } },
    })
    await wrapper.setProps({
      rows: [
        {
          id: 'task-e-2026-042',
          anonymousId: 'HY-2026-0042',
          anonymousTitle: '面向复杂场景的多模态知识推理研究',
          discipline: { code: '0812', name: '计算机科学与技术' },
          status: 'INVITED',
          fee: 300,
          dueAt: '2026-08-26 18:00',
          overdue: false,
          round: 1,
          allowedActions: ['ACCEPT_TASK'],
          materialsVisible: false,
        },
      ],
    })
    expect(wrapper.findAll('[data-expert-task]')).toHaveLength(1)
    expect(wrapper.find('[data-expert-task]').text()).toContain('HY-2026-0042')
  })
})
