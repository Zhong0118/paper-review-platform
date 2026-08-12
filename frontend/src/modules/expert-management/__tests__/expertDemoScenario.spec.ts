import { createPinia } from 'pinia'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService, EXPERT_PERSONA_ID } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike } from '@/demo/types'

import ExpertDemoScenarioController from '@/modules/expert-management/components/ExpertDemoScenarioController.vue'

enableAutoUnmount(afterEach)

interface InspectableStorage extends StorageLike {
  removedKeys: string[]
}

function createMemoryStorage(): InspectableStorage {
  const values = new Map<string, string>()
  const removedKeys: string[] = []
  return {
    removedKeys,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      removedKeys.push(key)
      values.delete(key)
    },
  }
}

function persistedPlatformState(storage: StorageLike) {
  return JSON.parse(storage.getItem('baijie-demo-platform:v1') ?? '{}') as {
    platform: {
      expertTasks: Array<{ id: string; status: string; expertId: string; overdue: boolean }>
      dispatchTheses: Array<{ id: string; status: string }>
      correctionRequests: Array<{ id: string; status: string }>
      withdrawals: Array<{ id: string; status: string }>
      expertLedger: Array<{ id: string }>
      notifications: Array<{ id: string; recipientRole: string; kind: string }>
    }
  }
}

function persistedStudentState(storage: StorageLike) {
  return JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}') as {
    scenario: { stage: string; taskStatus?: string; review: { draftSaved: boolean; submitted: boolean } }
    student: {
      notifications: Array<{ id: string; kind: string }>
    }
  }
}

function mountController(service: ScenarioService, enabled = true) {
  return mount(ExpertDemoScenarioController, {
    attachTo: document.body,
    props: { enabled },
    global: {
      plugins: [createPinia()],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
}

function bodyElement<T extends HTMLElement>(selector: string) {
  const element = document.body.querySelector<T>(selector)
  if (!element) throw new Error(`Missing body element: ${selector}`)
  return new DOMWrapper(element)
}

describe('expert demo scenario controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('does not render without explicit demo mode', () => {
    const wrapper = mount(ExpertDemoScenarioController, { props: { enabled: false } })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  it.each([
    {
      preset: 'INVITED',
      taskStatus: 'INVITED',
      overdue: false,
      notificationKind: 'TASK_INVITED',
      reviewSubmitted: false,
      correctionRequests: 0,
    },
    {
      preset: 'IN_REVIEW',
      taskStatus: 'IN_REVIEW',
      overdue: false,
      notificationKind: undefined,
      reviewSubmitted: false,
      correctionRequests: 0,
    },
    {
      preset: 'OVERDUE',
      taskStatus: 'IN_REVIEW',
      overdue: true,
      notificationKind: undefined,
      reviewSubmitted: false,
      correctionRequests: 0,
    },
    {
      preset: 'SUBMITTED',
      taskStatus: 'SUBMITTED',
      overdue: false,
      notificationKind: undefined,
      reviewSubmitted: false,
      correctionRequests: 0,
    },
    {
      preset: 'CORRECTION_PENDING',
      taskStatus: 'SUBMITTED',
      overdue: false,
      notificationKind: undefined,
      reviewSubmitted: false,
      correctionRequests: 1,
    },
    {
      preset: 'REJECTED',
      taskStatus: 'REJECTED',
      overdue: false,
      notificationKind: undefined,
      reviewSubmitted: false,
      correctionRequests: 0,
    },
  ])(
    'loads the %s scenario as one atomic snapshot replacing tasks, drafts, results and notifications',
    async (expected) => {
      const storage = createMemoryStorage()
      const service = createScenarioService({ storage, demoMode: true })
      await service.loadExpertScenario('IN_REVIEW')
      await service.saveReviewDraft({
        topicValue: 12,
        literatureTheory: 12,
        methodology: 16,
        innovation: 20,
        resultsWorkload: 12,
        writingStandards: 8,
        recommendation: '建议通过',
        strengths: '结构完整。',
        issues: '部分章节分析不足。',
        revisionAdvice: '补充对比实验。',
        overallComment: '总体良好。',
      })
      const dirty = persistedPlatformState(storage)
      dirty.platform.notifications.push({
        id: 'notification-stale',
        recipientRole: 'expert',
        kind: 'TASK_INVITED',
      })
      storage.setItem('baijie-demo-platform:v1', JSON.stringify(dirty))
      const studentDirty = persistedStudentState(storage)
      studentDirty.student.notifications.push({ id: 'student-stale', kind: 'THESIS_RETURNED' })
      storage.setItem('baijie-demo-student:v1', JSON.stringify(studentDirty))
      expect(dirty.platform.notifications.length).toBeGreaterThan(0)
      expect(studentDirty.student.notifications.length).toBeGreaterThan(0)

      const scenarioService = createScenarioService({ storage, demoMode: true })
      const wrapper = mountController(scenarioService)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
      await wrapper.get(`[data-scenario="${expected.preset}"]`).trigger('click')
      await flushPromises()

      const restored = createScenarioService({ storage, demoMode: true })
      const persisted = persistedPlatformState(storage)
      const tasks = await restored.listExpertTasks({ own: true })
      expect(tasks.filter((task) => task.expertId === EXPERT_PERSONA_ID)).toHaveLength(1)
      expect(tasks[0]).toMatchObject({
        status: expected.taskStatus,
        overdue: expected.overdue,
      })
      // 原子替换：结果未发布（服务快照无 review 投影）、更正申请与通知与快照一致。
      expect((await restored.getSnapshot()).review).toBeUndefined()
      expect(persisted.platform.correctionRequests).toHaveLength(expected.correctionRequests)
      const expertNotificationKinds = (await restored.listRoleNotifications('expert')).map(
        (item) => item.kind,
      )
      expect(expertNotificationKinds).toEqual(
        expected.notificationKind ? [expected.notificationKind] : [],
      )
      expect(persisted.platform.expertLedger.length).toBeGreaterThan(0)
      wrapper.unmount()
    },
  )

  it('switches the review template auxiliary projection', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 六维模板说明随任务投影派生：先载入快照（含模板说明的任务），再切换模板。
    await service.loadExpertScenario('IN_REVIEW')
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    await wrapper.get('[data-template="INNOVATION_WEIGHTED"]').trigger('click')
    await flushPromises()

    const tasks = await service.listExpertTasks({ own: true })
    // 创新加权版快照：研究内容与创新 30（标准版为 25），维度权重随模板投影派生。
    expect(tasks[0].templateNote).toContain('研究内容与创新 30')
    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it('switches the file validation auxiliary projection', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    await wrapper.get('[data-file-validation="INVALID"]').trigger('click')
    await flushPromises()

    expect(await service.getExpertDemoFileValidation()).toBe('INVALID')
    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it('resets only after confirmation, clears persisted data and reinstalls fixtures', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadExpertScenario('OVERDUE')
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    const opener = wrapper.get('[data-action="reset-expert-demo"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    expect(storage.removedKeys).toEqual([])
    expect(bodyElement<HTMLElement>('[data-expert-demo-reset-dialog]').text()).toContain(
      '确认恢复默认演示数据',
    )
    await bodyElement<HTMLButtonElement>('[data-action="confirm-reset-expert-demo"]').trigger(
      'click',
    )
    await flushPromises()

    expect(storage.removedKeys).toContain('baijie-demo-platform:v1')
    expect(storage.removedKeys).toContain('baijie-demo-student:v1')
    const restored = createScenarioService({ storage, demoMode: true })
    expect(await restored.listExpertTasks({ own: true })).toEqual([])
    expect((await restored.getSnapshot()).review).toBeUndefined()
    expect(await restored.getExpertDemoFileValidation()).toBe('VALID')
    expect(document.activeElement).toBe(opener.element)
  })

  it('names and traps the reset confirmation, closes on Escape and restores focus', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    const opener = wrapper.get('[data-action="reset-expert-demo"]')
    ;(opener.element as HTMLButtonElement).focus()

    await opener.trigger('click')
    await flushPromises()

    const dialog = bodyElement<HTMLElement>('[data-expert-demo-reset-dialog]')
    const cancel = bodyElement<HTMLButtonElement>('[data-action="cancel-reset-expert-demo"]')
    const confirm = bodyElement<HTMLButtonElement>('[data-action="confirm-reset-expert-demo"]')
    expect(dialog.attributes('aria-labelledby')).toBe('expert-demo-reset-title')
    expect(document.activeElement).toBe(cancel.element)

    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(cancel.element)
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(document.body.querySelector('[data-expert-demo-reset-dialog]')).toBeNull()
    expect(document.activeElement).toBe(opener.element)
  })

  it('locks the real page background while reset confirmation is open', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const Page = (await import('@/modules/review/pages/ExpertTasksPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/expert/tasks', component: Page }],
    })
    await router.push('/expert/tasks')
    await router.isReady()
    const wrapper = mount(
      { template: '<RouterView />', components: { RouterView } },
      {
        attachTo: document.body,
        global: {
          plugins: [createPinia(), router],
          provide: { [scenarioServiceKey as symbol]: service },
        },
      },
    )
    await flushPromises()

    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    const opener = wrapper.get('[data-action="reset-expert-demo"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    await flushPromises()

    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeDefined()
    expect(document.body.querySelector('[data-expert-demo-reset-dialog]')).not.toBeNull()

    await bodyElement<HTMLButtonElement>('[data-action="cancel-reset-expert-demo"]').trigger(
      'click',
    )
    await flushPromises()
    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(opener.element)
  })

  it('rejects every demo-only service action when demo mode is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: false })

    for (const operation of [
      () => service.loadExpertScenario('IN_REVIEW'),
      () => service.setExpertDemoTemplate('INNOVATION_WEIGHTED'),
      () => service.setExpertDemoFileValidation('INVALID'),
      () => service.reset(),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: 'PlatformOperationError',
        code: 'DEMO_MODE_DISABLED',
      })
    }
  })

  it.each([
    {
      path: '/expert/tasks',
      page: () => import('@/modules/review/pages/ExpertTasksPage.vue'),
      action: '[data-scenario="REJECTED"]',
      expected: '[data-expert-task="task-e-2026-042"]',
    },
    {
      path: '/expert/review',
      page: () => import('@/modules/review/pages/ReviewWorkspacePage.vue'),
      // 提交后只读视图的「申请更正」入口：需 SUBMITTED 快照（IN_REVIEW 快照无该按钮）。
      action: '[data-scenario="SUBMITTED"]',
      expected: '[data-action="open-correction-dialog"]',
    },
    {
      path: '/expert/profile',
      page: () => import('@/modules/review/pages/ExpertProfilePage.vue'),
      // 模板切换后任务投影重读（个人资料页展示本人任务无关，但 @changed 触发 loadProfile 重读）。
      action: '[data-template="INNOVATION_WEIGHTED"]',
      expected: '[data-qualification-status]',
    },
    {
      path: '/expert/finance',
      page: () => import('@/modules/review/pages/ExpertFinancePage.vue'),
      // 文件校验状态切换（余额额度辅助场景在运营端控制器，见设计 §7）。
      action: '[data-file-validation="INVALID"]',
      expected: '[data-account="available"]',
    },
  ])('refreshes the real service projection on $path after a demo change', async (entry) => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const Page = (await entry.page()).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/expert/tasks', component: Page },
        { path: '/expert/review', component: Page },
        { path: '/expert/profile', component: Page },
        { path: '/expert/finance', component: Page },
      ],
    })
    await router.push(entry.path)
    await router.isReady()
    const wrapper = mount(
      { template: '<RouterView />', components: { RouterView } },
      {
        attachTo: document.body,
        global: {
          plugins: [createPinia(), router],
          provide: { [scenarioServiceKey as symbol]: service },
        },
      },
    )
    await flushPromises()

    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    await wrapper.get(entry.action).trigger('click')
    await flushPromises()

    expect(wrapper.get(entry.expected).exists()).toBe(true)
  })

  it.each([
    ['/expert/tasks', () => import('@/modules/review/pages/ExpertTasksPage.vue')],
    ['/expert/review', () => import('@/modules/review/pages/ReviewWorkspacePage.vue')],
    ['/expert/profile', () => import('@/modules/review/pages/ExpertProfilePage.vue')],
    ['/expert/finance', () => import('@/modules/review/pages/ExpertFinancePage.vue')],
  ])(
    'does not expose the demo controller on %s when the env gate is false',
    async (path, loadPage) => {
      vi.stubEnv('VITE_DEMO_MODE', 'false')
      const Page = (await loadPage()).default
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/expert/tasks', component: Page },
          { path: '/expert/review', component: Page },
          { path: '/expert/profile', component: Page },
          { path: '/expert/finance', component: Page },
        ],
      })
      await router.push(path)
      await router.isReady()
      const wrapper = mount(
        { template: '<RouterView />', components: { RouterView } },
        {
          attachTo: document.body,
          global: {
            plugins: [createPinia(), router],
            provide: {
              [scenarioServiceKey as symbol]: createScenarioService({
                storage: createMemoryStorage(),
                demoMode: false,
              }),
            },
          },
        },
      )
      await flushPromises()

      expect(wrapper.find('[data-action="toggle-demo-scenarios"]').exists()).toBe(false)
      expect(document.body.querySelector('[data-expert-demo-reset-dialog]')).toBeNull()
    },
  )
})
