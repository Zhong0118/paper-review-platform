import { createPinia } from 'pinia'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike } from '@/demo/types'

import PlatformDemoScenarioController from '../components/PlatformDemoScenarioController.vue'

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
      expertTasks: Array<{ id: string; status: string; expertId: string }>
      dispatchTheses: Array<{ id: string; status: string }>
      correctionRequests: Array<{ id: string; status: string }>
      withdrawals: Array<{ id: string; status: string }>
      expertLedger: Array<{ id: string }>
      notifications: Array<{ id: string; recipientRole: string; kind: string }>
      auditLog: Array<{ id: string }>
    }
  }
}

function mountController(service: ScenarioService, enabled = true) {
  return mount(PlatformDemoScenarioController, {
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

describe('platform demo scenario controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('does not render without explicit demo mode', () => {
    const wrapper = mount(PlatformDemoScenarioController, { props: { enabled: false } })

    expect(wrapper.html()).toBe('<!--v-if-->')
  })

  it('loads a completed operations snapshot with queues and notifications', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)

    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    await wrapper.get('[data-scenario="COMPLETED"]').trigger('click')
    await flushPromises()

    const queues = await service.listOperationsQueues()
    // 队列计数键与运营台页面消费一致（大写枚举键，见 platformOperationService 投影）。
    expect(queues.COMPLETED).toBeGreaterThan(0)
    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it('loads each main scenario as one internally consistent operations snapshot', async () => {
    const cases: Array<{
      preset: string
      thesisStatus: string
      taskStatus: string
      overdue?: boolean
      correctionRequests: number
      withdrawals: number
      notificationKind?: string
    }> = [
      {
        preset: 'PENDING_DISPATCH',
        thesisStatus: 'PENDING_DISPATCH',
        taskStatus: 'NONE',
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'PENDING_ACCEPTANCE',
        thesisStatus: 'PENDING_ACCEPTANCE',
        taskStatus: 'INVITED',
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'IN_REVIEW',
        thesisStatus: 'IN_REVIEW',
        taskStatus: 'IN_REVIEW',
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'DUE_SOON',
        thesisStatus: 'IN_REVIEW',
        taskStatus: 'IN_REVIEW',
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'OVERDUE',
        thesisStatus: 'IN_REVIEW',
        taskStatus: 'IN_REVIEW',
        overdue: true,
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'PENDING_REASSIGNMENT',
        thesisStatus: 'PENDING_ACCEPTANCE',
        taskStatus: 'REJECTED',
        correctionRequests: 0,
        withdrawals: 0,
        notificationKind: 'TASK_REJECTED',
      },
      {
        preset: 'COMPLETED',
        thesisStatus: 'COMPLETED',
        taskStatus: 'SUBMITTED',
        correctionRequests: 0,
        withdrawals: 0,
      },
      {
        preset: 'CORRECTION_PENDING',
        thesisStatus: 'COMPLETED',
        taskStatus: 'SUBMITTED',
        correctionRequests: 1,
        withdrawals: 1,
      },
    ]

    for (const expected of cases) {
      const storage = createMemoryStorage()
      const service = createScenarioService({ storage, demoMode: true })
      await service.loadPlatformScenario('IN_REVIEW')
      await service.requestCorrection('task-e-2026-042', '补充遗漏的实验限制说明')
      await service.submitWithdrawal(100)
      const dirty = persistedPlatformState(storage)
      dirty.platform.notifications.push({
        id: 'notification-stale',
        recipientRole: 'platform_reviewer',
        kind: 'TASK_REJECTED',
      })
      storage.setItem('baijie-demo-platform:v1', JSON.stringify(dirty))
      expect(dirty.platform.correctionRequests.length).toBeGreaterThan(0)
      expect(dirty.platform.withdrawals.length).toBeGreaterThan(0)

      const scenarioService = createScenarioService({ storage, demoMode: true })
      const wrapper = mountController(scenarioService)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
      await wrapper.get(`[data-scenario="${expected.preset}"]`).trigger('click')
      await flushPromises()

      const restored = createScenarioService({ storage, demoMode: true })
      const persisted = persistedPlatformState(storage)
      const theses = await restored.listDispatchTheses()
      const tasks = await restored.listExpertTasks()
      expect(theses.find((thesis) => thesis.id === 'thesis-main')?.status).toBe(
        expected.thesisStatus,
      )
      // 原子替换：更正申请、提现、流水与旧通知全部被快照覆盖。
      // 未派单快照无专家任务（PENDING_DISPATCH → 'NONE'），按空数组断言。
      expect(persisted.platform.correctionRequests).toHaveLength(expected.correctionRequests)
      expect(persisted.platform.withdrawals).toHaveLength(expected.withdrawals)
      expect(persisted.platform.expertLedger.length).toBeGreaterThan(0)
      if (expected.taskStatus === 'NONE') {
        expect(tasks).toEqual([])
      } else {
        expect(
          tasks.some(
            (task) =>
              task.status === expected.taskStatus &&
              task.overdue === (expected.overdue ?? false),
          ),
        ).toBe(true)
      }
      expect(persisted.platform.notifications.map((item) => item.kind)).toEqual(
        expected.notificationKind ? [expected.notificationKind] : [],
      )
      wrapper.unmount()
    }
  })

  it('switches the qualification auxiliary projection', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    await wrapper.get('[data-eligibility="REJECTED"]').trigger('click')
    await flushPromises()

    expect((await service.listExpertProfiles()).find((row) => row.id === 'expert-17')).toMatchObject(
      { qualification: 'REJECTED', serviceStatus: 'DISABLED' },
    )
    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it.each([
    ['FULL', 900, 0],
    ['FROZEN', 600, 300],
  ] as const)(
    'switches the %s balance projection',
    async (balance, available, pending) => {
      const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
      const wrapper = mountController(service)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

      await wrapper.get(`[data-balance="${balance}"]`).trigger('click')
      await flushPromises()

      const account = await service.getExpertAccount()
      expect(account.availableAmount).toBe(available)
      expect(account.pendingAmount).toBe(pending)
      expect(wrapper.emitted('changed')).toEqual([[]])
    },
  )

  it('resets only after confirmation, clears persisted data and reinstalls fixtures', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    const opener = wrapper.get('[data-action="reset-platform-demo"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    expect(storage.removedKeys).toEqual([])
    expect(bodyElement<HTMLElement>('[data-platform-demo-reset-dialog]').text()).toContain(
      '确认恢复默认演示数据',
    )
    await bodyElement<HTMLButtonElement>('[data-action="confirm-reset-platform-demo"]').trigger(
      'click',
    )
    await flushPromises()

    expect(storage.removedKeys).toContain('baijie-demo-platform:v1')
    expect(storage.removedKeys).toContain('baijie-demo-student:v1')
    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.listDispatchTheses()).find((thesis) => thesis.id === 'thesis-main')?.status).toBe(
      'PENDING_DISPATCH',
    )
    expect(await restored.listExpertTasks()).toEqual([])
    expect(await restored.listCorrectionRequests()).toEqual([])
    expect(await restored.listWithdrawals()).toEqual([])
    expect(document.activeElement).toBe(opener.element)
  })

  it('names and traps the reset confirmation, closes on Escape and restores focus', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    const opener = wrapper.get('[data-action="reset-platform-demo"]')
    ;(opener.element as HTMLButtonElement).focus()

    await opener.trigger('click')
    await flushPromises()

    const dialog = bodyElement<HTMLElement>('[data-platform-demo-reset-dialog]')
    const cancel = bodyElement<HTMLButtonElement>('[data-action="cancel-reset-platform-demo"]')
    const confirm = bodyElement<HTMLButtonElement>('[data-action="confirm-reset-platform-demo"]')
    expect(dialog.attributes('aria-labelledby')).toBe('platform-demo-reset-title')
    expect(document.activeElement).toBe(cancel.element)

    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(cancel.element)
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(document.body.querySelector('[data-platform-demo-reset-dialog]')).toBeNull()
    expect(document.activeElement).toBe(opener.element)
  })

  it('rejects every demo-only service action when demo mode is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: false })

    for (const operation of [
      () => service.loadPlatformScenario('IN_REVIEW'),
      () => service.setPlatformDemoEligibility('REJECTED'),
      () => service.setPlatformDemoBalance('FROZEN'),
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
      path: '/platform/dispatch',
      page: () => import('../pages/DispatchWorkbenchPage.vue'),
      action: '[data-scenario="COMPLETED"]',
      expected: '[data-operations-queue="COMPLETED"] b',
    },
    {
      path: '/platform/experts',
      page: () => import('@/modules/expert-management/pages/ExpertLibraryPage.vue'),
      action: '[data-eligibility="REJECTED"]',
      expected: '[data-stat="dispatchable"]',
    },
    {
      path: '/platform/corrections',
      page: () => import('@/modules/expert-management/pages/CorrectionApprovalPage.vue'),
      action: '[data-scenario="CORRECTION_PENDING"]',
      expected: '[data-correction-request]',
    },
    {
      path: '/platform/settlements',
      page: () => import('@/modules/finance/pages/SettlementWorkbenchPage.vue'),
      action: '[data-scenario="CORRECTION_PENDING"]',
      expected: '[data-stat="pending"]',
    },
  ])('refreshes the real service projection on $path after a demo change', async (entry) => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const Page = (await entry.page()).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/platform/dispatch', component: Page },
        { path: '/platform/experts', component: Page },
        { path: '/platform/corrections', component: Page },
        { path: '/platform/settlements', component: Page },
        { path: '/login', component: { template: '<div />' } },
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
    ['/platform/dispatch', () => import('../pages/DispatchWorkbenchPage.vue')],
    ['/platform/experts', () => import('@/modules/expert-management/pages/ExpertLibraryPage.vue')],
    [
      '/platform/corrections',
      () => import('@/modules/expert-management/pages/CorrectionApprovalPage.vue'),
    ],
    [
      '/platform/settlements',
      () => import('@/modules/finance/pages/SettlementWorkbenchPage.vue'),
    ],
  ])(
    'does not expose the demo controller on %s when the env gate is false',
    async (path, loadPage) => {
      vi.stubEnv('VITE_DEMO_MODE', 'false')
      const Page = (await loadPage()).default
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/platform/dispatch', component: Page },
          { path: '/platform/experts', component: Page },
          { path: '/platform/corrections', component: Page },
          { path: '/platform/settlements', component: Page },
          { path: '/login', component: { template: '<div />' } },
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
      expect(document.body.querySelector('[data-platform-demo-reset-dialog]')).toBeNull()
    },
  )
})
