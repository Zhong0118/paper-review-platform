import { createPinia } from 'pinia'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { studentPortalServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike, StudentScenarioPreset } from '@/demo/types'

import StudentDemoScenarioController from '../components/StudentDemoScenarioController.vue'
import StudentNotificationList from '@/modules/shared/components/StudentNotificationList.vue'

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

function persistedStudentState(storage: StorageLike) {
  return JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}') as {
    scenario: { stage: string; taskStatus?: string; review: { submitted: boolean } }
    student: {
      eligibility: { status: string; eligible: boolean }
      fileMetadataByThesis: Record<string, Array<{ validationStatus: string }>>
      notifications: Array<{
        id: string
        kind: string
        thesisId?: string
        message: string
        createdAt: string
        read: boolean
      }>
      objections: Array<{ thesisId: string }>
      withdrawalRequests: Array<{
        id: string
        thesisId: string
        reason: string
        requestedAt: string
      }>
      resultsByThesis: Record<string, unknown[]>
      timelines: Record<string, Array<{ kind: string }>>
    }
  }
}

function mountController(service: ScenarioService, enabled = true) {
  return mount(StudentDemoScenarioController, {
    attachTo: document.body,
    props: { enabled },
    global: {
      plugins: [createPinia()],
      provide: { [studentPortalServiceKey as symbol]: service },
    },
  })
}

function bodyElement<T extends HTMLElement>(selector: string) {
  const element = document.body.querySelector<T>(selector)
  if (!element) throw new Error(`Missing body element: ${selector}`)
  return new DOMWrapper(element)
}

describe('student demo scenario controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('does not render or require an injected service without explicit demo mode', () => {
    const wrapper = mount(StudentDemoScenarioController, { props: { enabled: false } })

    expect(wrapper.html()).toBe('<!--v-if-->')
    expect(wrapper.find('[data-action="toggle-demo-scenarios"]').exists()).toBe(false)
  })

  it('loads each scenario as one internally consistent snapshot', async () => {
    const cases: Array<{
      preset: StudentScenarioPreset
      stage: string
      timelineKind: string
      notificationKind?: string
      hasResult: boolean
    }> = [
      { preset: 'DRAFT', stage: 'DRAFT', timelineKind: 'DRAFT_CREATED', hasResult: false },
      {
        preset: 'RETURNED',
        stage: 'DRAFT',
        timelineKind: 'THESIS_RETURNED',
        notificationKind: 'THESIS_RETURNED',
        hasResult: false,
      },
      {
        preset: 'SCHOOL_REVIEW',
        stage: 'SUBMITTED',
        timelineKind: 'THESIS_SUBMITTED',
        notificationKind: 'THESIS_SUBMITTED',
        hasResult: false,
      },
      {
        preset: 'EXPERT_REVIEW',
        stage: 'UNDER_REVIEW',
        timelineKind: 'EXPERT_REVIEW_STARTED',
        notificationKind: 'EXPERT_REVIEW_STARTED',
        hasResult: false,
      },
      {
        preset: 'RESULT_PROCESSING',
        stage: 'RESULT_PROCESSING',
        timelineKind: 'RESULT_PROCESSING_STARTED',
        hasResult: false,
      },
      {
        preset: 'COMPLETED',
        stage: 'COMPLETED',
        timelineKind: 'RESULT_PUBLISHED',
        notificationKind: 'RESULT_PUBLISHED',
        hasResult: true,
      },
    ]

    for (const expected of cases) {
      const storage = createMemoryStorage()
      const service = createScenarioService({ storage, demoMode: true })
      await service.loadStudentScenario('COMPLETED')
      await service.submitStudentObjection('thesis-main', {
        reason: '用于验证场景切换会清除旧异议',
        request: '装载确定快照',
        attachments: [],
      })
      const dirty = persistedStudentState(storage)
      dirty.student.withdrawalRequests = [
        {
          thesisId: 'thesis-main',
          id: 'withdrawal-stale',
          reason: '旧撤回申请',
          requestedAt: '2026-08-24 12:00',
        },
      ]
      dirty.student.notifications.push({
        id: 'notification-stale-withdrawal',
        kind: 'WITHDRAWAL_REQUESTED',
        thesisId: 'thesis-main',
        message: '旧撤回通知',
        createdAt: '2026-08-24 12:00',
        read: false,
      })
      storage.setItem('baijie-demo-student:v1', JSON.stringify(dirty))
      expect(dirty.student.objections).toHaveLength(1)
      expect(dirty.student.withdrawalRequests).toHaveLength(1)
      expect(dirty.student.notifications.length).toBeGreaterThan(1)
      expect(dirty.student.resultsByThesis['thesis-main']).not.toEqual([])

      const scenarioService = createScenarioService({ storage, demoMode: true })
      const wrapper = mountController(scenarioService)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
      await wrapper.get(`[data-scenario="${expected.preset}"]`).trigger('click')
      await flushPromises()

      const restored = createScenarioService({ storage, demoMode: true })
      const detail = await restored.getStudentThesis('thesis-main')
      const persisted = persistedStudentState(storage)
      expect(detail.stage).toBe(expected.stage)
      expect(detail.timeline.at(-1)?.kind).toBe(expected.timelineKind)
      expect(Boolean(await restored.getStudentResult('thesis-main'))).toBe(expected.hasResult)
      expect(persisted.student.objections).toEqual([])
      expect(persisted.student.withdrawalRequests).toEqual([])
      expect((await restored.listStudentNotifications()).map((item) => item.kind)).toEqual(
        expected.notificationKind ? [expected.notificationKind] : [],
      )
      wrapper.unmount()
    }
  })

  it('shows the permission disclaimer and emits after the service projection changes', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)

    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    expect(wrapper.text()).toContain('仅用于演示，不代表学生拥有该操作权限')
    await wrapper.get('[data-scenario="COMPLETED"]').trigger('click')
    await flushPromises()

    expect((await service.getStudentThesis('thesis-main')).stage).toBe('COMPLETED')
    expect(wrapper.emitted('changed')).toEqual([[]])
  })

  it.each([
    ['ELIGIBLE', true],
    ['SUSPENDED', false],
    ['EXPIRED', false],
  ] as const)('loads the %s eligibility projection', async (status, eligible) => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    await wrapper.get(`[data-eligibility="${status}"]`).trigger('click')
    await flushPromises()

    expect(await service.getStudentEligibility()).toMatchObject({ status, eligible })
  })

  it.each(['VALID', 'INVALID'] as const)(
    'loads the %s file validation projection',
    async (validationStatus) => {
      const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
      const wrapper = mountController(service)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

      await wrapper.get(`[data-file-validation="${validationStatus}"]`).trigger('click')
      await flushPromises()

      expect((await service.getStudentThesis('thesis-main')).files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ validationStatus }),
          expect.objectContaining({ validationStatus }),
        ]),
      )
    },
  )

  it.each(['VALID', 'INVALID'] as const)(
    'restores fixture files before loading the %s validation projection from an empty draft',
    async (validationStatus) => {
      const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
      const current = await service.getStudentThesis('thesis-main')
      await service.saveStudentDraft('thesis-main', {
        ...current.form,
        files: [],
      })
      expect((await service.getStudentThesis('thesis-main')).files).toEqual([])

      const wrapper = mountController(service)
      await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
      await wrapper.get(`[data-file-validation="${validationStatus}"]`).trigger('click')
      await flushPromises()

      const files = (await service.getStudentThesis('thesis-main')).files
      expect(files).toHaveLength(2)
      expect(files.every((file) => file.validationStatus === validationStatus)).toBe(true)
    },
  )

  it('resets only after confirmation, clears persisted data and reinstalls fixtures', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')

    const opener = wrapper.get('[data-action="reset-student-demo"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    expect(storage.removedKeys).toEqual([])
    expect(bodyElement<HTMLElement>('[data-student-demo-reset-dialog]').text()).toContain(
      '确认恢复默认演示数据',
    )
    await bodyElement<HTMLButtonElement>('[data-action="confirm-reset-student-demo"]').trigger(
      'click',
    )
    await flushPromises()

    expect(storage.removedKeys).toContain('baijie-demo-student:v1')
    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.getStudentThesis('thesis-main')).stage).toBe('DRAFT')
    expect(await restored.getStudentResult('thesis-main')).toBeNull()
    expect((await restored.getStudentEligibility()).status).toBe('ELIGIBLE')
    expect(document.activeElement).toBe(opener.element)
  })

  it('names and traps the reset confirmation, closes on Escape and restores focus', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const wrapper = mountController(service)
    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    const opener = wrapper.get('[data-action="reset-student-demo"]')
    ;(opener.element as HTMLButtonElement).focus()

    await opener.trigger('click')
    await flushPromises()

    const dialog = bodyElement<HTMLElement>('[data-student-demo-reset-dialog]')
    const cancel = bodyElement<HTMLButtonElement>('[data-action="cancel-reset-student-demo"]')
    const confirm = bodyElement<HTMLButtonElement>('[data-action="confirm-reset-student-demo"]')
    expect(dialog.attributes('aria-labelledby')).toBe('student-demo-reset-title')
    expect(document.activeElement).toBe(cancel.element)

    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(cancel.element)
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(document.body.querySelector('[data-student-demo-reset-dialog]')).toBeNull()
    expect(document.activeElement).toBe(opener.element)
  })

  it('locks the real page background while reset confirmation is open', async () => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const Page = (await import('../pages/StudentDashboardPage.vue')).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/student/dashboard', component: Page },
        { path: '/notifications', component: { template: '<div />' } },
        { path: '/login', component: { template: '<div />' } },
      ],
    })
    await router.push('/student/dashboard')
    await router.isReady()
    const wrapper = mount(
      { template: '<RouterView />', components: { RouterView } },
      {
        attachTo: document.body,
        global: {
          plugins: [createPinia(), router],
          provide: { [studentPortalServiceKey as symbol]: service },
        },
      },
    )
    await flushPromises()

    await wrapper.get('[data-action="toggle-demo-scenarios"]').trigger('click')
    const opener = wrapper.get('[data-action="reset-student-demo"]')
    ;(opener.element as HTMLButtonElement).focus()
    await opener.trigger('click')
    await flushPromises()

    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeDefined()
    expect(document.body.querySelector('[data-student-demo-reset-dialog]')).not.toBeNull()

    await bodyElement<HTMLButtonElement>('[data-action="cancel-reset-student-demo"]').trigger(
      'click',
    )
    await flushPromises()
    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(opener.element)
  })

  it('rejects every demo-only service action when demo mode is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: false })

    for (const operation of [
      () => service.loadStudentScenario('EXPERT_REVIEW'),
      () => service.setStudentDemoEligibility('SUSPENDED'),
      () => service.setStudentDemoFileValidation('INVALID'),
      () => service.resetStudentDemo(),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: 'StudentPortalError',
        code: 'DEMO_MODE_DISABLED',
      })
    }
  })

  it.each([
    {
      path: '/student/dashboard',
      page: () => import('../pages/StudentDashboardPage.vue'),
      action: '[data-scenario="EXPERT_REVIEW"]',
      expected: '[data-student-stage="EXPERT_REVIEW"]',
    },
    {
      path: '/student/thesis/edit?thesisId=thesis-main',
      page: () => import('../pages/ThesisEditPage.vue'),
      action: '[data-file-validation="INVALID"]',
      expected: '[data-validation-status="INVALID"]',
    },
    {
      path: '/student/results?thesisId=thesis-main',
      page: () => import('@/modules/result/pages/StudentResultPage.vue'),
      action: '[data-scenario="COMPLETED"]',
      expected: '[data-result-total]',
    },
  ])('refreshes the real service projection on $path after a demo change', async (entry) => {
    vi.stubEnv('VITE_DEMO_MODE', 'true')
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const Page = (await entry.page()).default
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/student/dashboard', component: Page },
        { path: '/student/thesis/edit', component: Page },
        { path: '/student/results', component: Page },
        { path: '/notifications', component: { template: '<div />' } },
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
          provide: { [studentPortalServiceKey as symbol]: service },
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
    ['/student/dashboard', () => import('../pages/StudentDashboardPage.vue')],
    ['/student/thesis/edit?thesisId=thesis-main', () => import('../pages/ThesisEditPage.vue')],
    [
      '/student/results?thesisId=thesis-main',
      () => import('@/modules/result/pages/StudentResultPage.vue'),
    ],
  ])(
    'does not expose the demo controller on %s when the env gate is false',
    async (path, loadPage) => {
      vi.stubEnv('VITE_DEMO_MODE', 'false')
      const Page = (await loadPage()).default
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: '/student/dashboard', component: Page },
          { path: '/student/thesis/edit', component: Page },
          { path: '/student/results', component: Page },
          { path: '/notifications', component: { template: '<div />' } },
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
              [studentPortalServiceKey as symbol]: createScenarioService({
                storage: createMemoryStorage(),
                demoMode: false,
              }),
            },
          },
        },
      )
      await flushPromises()

      expect(wrapper.find('[data-action="toggle-demo-scenarios"]').exists()).toBe(false)
      expect(document.body.querySelector('[data-student-demo-reset-dialog]')).toBeNull()
    },
  )

  it.each([
    ['RETURNED', '学校退回', '论文材料已退回'],
    ['EXPERT_REVIEW', '流程提醒', '已进入送审评阅'],
  ] as const)('renders the %s snapshot notification as %s', async (preset, type, title) => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario(preset)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/student/dashboard', name: '学生工作台', component: { template: '<div />' } },
        { path: '/student/results', name: '学生评审结果', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(StudentNotificationList, {
      global: {
        plugins: [router],
        provide: { [studentPortalServiceKey as symbol]: service },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain(type)
    expect(wrapper.text()).toContain(title)
  })
})
