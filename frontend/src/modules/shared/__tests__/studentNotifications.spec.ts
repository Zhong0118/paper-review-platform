import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike, StudentNotification } from '@/demo/types'
import { useAuthStore } from '@/stores/auth'
import { studentNotificationRoutes } from '@/router/studentNotificationRoutes'

import NotificationCenterPage from '../pages/NotificationCenterPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountNotifications(
  service: ScenarioService,
  role: 'student' | 'expert' = 'student',
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      ...studentNotificationRoutes.map((route) => ({
        ...route,
        component: { template: '<div data-route-target />' },
      })),
      { path: '/login', component: { template: '<div>登录</div>' } },
    ],
  })
  await router.push('/notifications')
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setSession('demo-session', {
    id: `demo-${role}`,
    displayName: role === 'student' ? '林知远' : '周明远教授',
    role,
  } as Parameters<typeof auth.setSession>[1])
  const wrapper = mount(NotificationCenterPage, {
    global: {
      plugins: [pinia, router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { router, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('student notifications', () => {
  it('loads the real student projection with type, title, public summary, time and unread count', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.submitStudentThesis('thesis-main')

    const { wrapper } = await mountNotifications(service)
    const item = wrapper.get('[data-notification-id="notification-thesis-main-submitted"]')

    expect(wrapper.get('[data-notification-count="all"]').text()).toContain('1')
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('1')
    expect(item.get('[data-notification-type]').text()).toBe('流程提醒')
    expect(item.get('h2').text()).toBe('论文已提交')
    expect(item.get('p').text()).toContain('论文已提交，等待学校审核')
    expect(item.get('time').text()).toContain('2026-08-11 09:00')
    expect(item.attributes('data-unread')).toBe('true')
    expect(item.get('[data-notification-read-state]').text()).toBe('未读')
  })

  it('marks a notification read before navigating to its owned thesis target', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.submitStudentThesis('thesis-main')
    const realMarkRead = service.markStudentNotificationRead.bind(service)
    let releaseMarkRead!: () => void
    const markReadGate = new Promise<void>((resolve) => {
      releaseMarkRead = resolve
    })
    const markRead = vi
      .spyOn(service, 'markStudentNotificationRead')
      .mockImplementation(async (id) => {
        await markReadGate
        return realMarkRead(id)
      })
    const { router, wrapper } = await mountNotifications(service)

    await wrapper
      .get(
        '[data-notification-id="notification-thesis-main-submitted"] [data-action="open-notification"]',
      )
      .trigger('click')
    await Promise.resolve()

    expect(markRead).toHaveBeenCalledWith('notification-thesis-main-submitted')
    expect(router.currentRoute.value.path).toBe('/notifications')

    releaseMarkRead()
    await flushPromises()

    expect((await service.listStudentNotifications())[0]?.read).toBe(true)
    expect(router.currentRoute.value).toMatchObject({
      path: '/student/dashboard',
      query: { thesisId: 'thesis-main' },
    })
  })

  it('opens an objection notification on the owned result and objection page', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    await service.submitStudentObjection('thesis-main', {
      reason: '对评价依据存在疑问',
      request: '申请学校复核处理',
      attachments: [],
    })
    const { router, wrapper } = await mountNotifications(service)

    await wrapper
      .get(
        '[data-notification-id="notification-thesis-main-objection"] [data-action="open-notification"]',
      )
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({
      path: '/student/results',
      query: { thesisId: 'thesis-main' },
    })
  })

  it('opens a published result notification on the named student result route', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.loadStudentScenario('COMPLETED')
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    persisted.student.notifications.unshift({
      id: 'notification-thesis-main-result',
      kind: 'RESULT_PUBLISHED',
      thesisId: 'thesis-main',
      message: '评审结果已发布，可查看公开评审结论。',
      createdAt: '2026-08-11 10:30',
      read: false,
    })
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))
    const service = createScenarioService({ storage, demoMode: true })
    const { router, wrapper } = await mountNotifications(service)

    await wrapper
      .get(
        '[data-notification-id="notification-thesis-main-result"] [data-action="open-notification"]',
      )
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({
      name: '学生评审结果',
      path: '/student/results',
      query: { thesisId: 'thesis-main' },
    })
  })

  it('marks all notifications read with one service action and updates the count', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.submitStudentThesis('thesis-main')
    await service.withdrawStudentThesis('thesis-main', '补充材料')
    const markAll = vi.spyOn(service, 'markAllStudentNotificationsRead')
    const { wrapper } = await mountNotifications(service)

    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('2')
    await wrapper.get('[data-action="mark-all-notifications-read"]').trigger('click')
    await flushPromises()

    expect(markAll).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('0')
    expect(wrapper.findAll('[data-unread="true"]')).toHaveLength(0)
  })

  it('shows an empty state when the student has no notifications', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { wrapper } = await mountNotifications(service)

    expect(wrapper.get('[data-notification-empty]').text()).toContain('暂无消息')
    expect(wrapper.get('[data-notification-count="all"]').text()).toContain('0')
  })

  it('marks a system notice read without requiring a navigation target', async () => {
    const storage = createMemoryStorage()
    storage.setItem('baijie-demo-student:v1', '{invalid json')
    const service = createScenarioService({ storage, demoMode: true })
    const markRead = vi.spyOn(service, 'markStudentNotificationRead')
    const { router, wrapper } = await mountNotifications(service)

    expect(wrapper.get('[data-notification-read-state]').text()).toBe('未读')
    await wrapper.get('[data-action="mark-notification-read"]').trigger('click')
    await flushPromises()

    expect(markRead).toHaveBeenCalledWith('notification-demo-data-reset')
    expect(wrapper.get('[data-notification-read-state]').text()).toBe('已读')
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('0')
    expect(router.currentRoute.value.path).toBe('/notifications')
  })

  it('restores the thesis target for notifications saved before Task 6', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.submitStudentThesis('thesis-main')
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    delete persisted.student.notifications[0].thesisId
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = createScenarioService({ storage, demoMode: true })
    const { router, wrapper } = await mountNotifications(restored)
    await wrapper.get('[data-action="open-notification"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({
      path: '/student/dashboard',
      query: { thesisId: 'thesis-main' },
    })
  })

  it('keeps list and read failures recoverable without losing local notification state', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.submitStudentThesis('thesis-main')
    const realList = service.listStudentNotifications.bind(service)
    vi.spyOn(service, 'listStudentNotifications')
      .mockRejectedValueOnce(new Error('temporary list failure'))
      .mockImplementation(realList)

    const { router, wrapper } = await mountNotifications(service)
    expect(wrapper.get('[role="alert"]').text()).toContain('消息加载失败，请重试')

    await wrapper.get('[data-action="reload-notifications"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    const realMarkRead = service.markStudentNotificationRead.bind(service)
    vi.spyOn(service, 'markStudentNotificationRead')
      .mockRejectedValueOnce(new Error('temporary mark failure'))
      .mockImplementation(realMarkRead)
    await wrapper
      .get(
        '[data-notification-id="notification-thesis-main-submitted"] [data-action="open-notification"]',
      )
      .trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('消息状态更新失败，请重试')
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('1')
    expect(router.currentRoute.value.path).toBe('/notifications')

    await wrapper
      .get(
        '[data-notification-id="notification-thesis-main-submitted"] [data-action="open-notification"]',
      )
      .trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/student/dashboard')
  })

  it('keeps an all-read failure recoverable and does not clear the unread count', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.submitStudentThesis('thesis-main')
    const realMarkAll = service.markAllStudentNotificationsRead.bind(service)
    const markAll = vi
      .spyOn(service, 'markAllStudentNotificationsRead')
      .mockRejectedValueOnce(new Error('temporary mark-all failure'))
      .mockImplementation(realMarkAll)
    const { wrapper } = await mountNotifications(service)

    await wrapper.get('[data-action="mark-all-notifications-read"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('消息状态更新失败，请重试')
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('1')

    await wrapper.get('[data-action="mark-all-notifications-read"]').trigger('click')
    await flushPromises()
    expect(markAll).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('0')
  })

  it('refuses to navigate when a notification target is not one of the current student theses', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const foreignNotification = {
      id: 'notification-thesis-0048-submitted',
      kind: 'THESIS_SUBMITTED',
      thesisId: 'thesis-0048',
      message: '论文已提交，等待学校审核。',
      createdAt: '2026-08-11 09:00',
      read: false,
    } satisfies StudentNotification
    const unsafeService = {
      ...service,
      listStudentNotifications: vi.fn(async () => [foreignNotification]),
      markStudentNotificationRead: vi.fn(async () => [{ ...foreignNotification, read: true }]),
    } as ScenarioService
    const { router, wrapper } = await mountNotifications(unsafeService)

    await wrapper.get('[data-action="open-notification"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('无法打开不属于本人的论文消息')
    expect(router.currentRoute.value.path).toBe('/notifications')
  })

  it('projects the role notification list for the expert without the static message sheet', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const listStudent = vi.spyOn(service, 'listStudentNotifications')
    const listRole = vi.spyOn(service, 'listRoleNotifications')
    const { wrapper } = await mountNotifications(service, 'expert')

    expect(wrapper.get('[data-role-notification-list]').exists()).toBe(true)
    expect(listStudent).not.toHaveBeenCalled()
    expect(listRole).toHaveBeenCalledWith('expert')
    expect(wrapper.get('[data-notification-count="all"]').text()).toContain('0')
    expect(wrapper.find('.message-sheet').exists()).toBe(false)
  })

  it('keeps school notifications outside student list and unread after student mark-all', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    await service.submitStudentObjection('thesis-main', {
      reason: '对评价依据存在疑问',
      request: '申请学校复核处理',
      attachments: [],
    })

    expect((await service.listStudentNotifications()).map((item) => item.id)).not.toContain(
      'notification-thesis-main-objection-school',
    )
    await service.markAllStudentNotificationsRead()

    expect(
      (await service.listSchoolNotifications()).find(
        (item) => item.id === 'notification-thesis-main-objection-school',
      ),
    ).toMatchObject({ read: false, kind: 'OBJECTION_RECEIVED' })
  })
})
