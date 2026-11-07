import { createPinia, setActivePinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike } from '@/demo/types'
import { useAuthStore } from '@/stores/auth'

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

/** 与正式路由一致的目标集：角色通知跳转两端的页面路由（学生端目标由既有测试覆盖）。 */
const roleTargetRoutes = [
  { path: '/expert/tasks', name: '专家任务', component: { template: '<div data-route-target />' } },
  { path: '/expert/finance', name: '费用与提现', component: { template: '<div data-route-target />' } },
  {
    path: '/platform/dispatch',
    name: '送审运营台',
    component: { template: '<div data-route-target />' },
  },
  { path: '/platform/experts', name: '专家库', component: { template: '<div data-route-target />' } },
  {
    path: '/platform/corrections',
    name: '评阅更正审批',
    component: { template: '<div data-route-target />' },
  },
  { path: '/platform/settlements', name: '费用结算', component: { template: '<div data-route-target />' } },
]

async function mountNotifications(service: ScenarioService, role: 'expert' | 'platform_reviewer') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...roleTargetRoutes, { path: '/login', component: { template: '<div>登录</div>' } }],
  })
  await router.push('/notifications')
  await router.isReady()

  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.setSession('demo-session', {
    id: `demo-${role}`,
    displayName: role === 'expert' ? '周明远教授' : '陈岚',
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

describe('role notifications', () => {
  it('isolates notifications by recipient role and routes to pages', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const expertNotices = await service.listRoleNotifications('expert')
    expect(expertNotices.some((n) => n.kind === 'TASK_INVITED')).toBe(true)

    await service.loadPlatformScenario('PENDING_DISPATCH')
    const platformNotices = await service.listRoleNotifications('platform_reviewer')
    expect(platformNotices.every((n) => n.recipientRole === 'platform_reviewer')).toBe(true)
  })

  it('keeps school notifications invisible to both roles', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    await service.submitStudentObjection('thesis-main', {
      reason: '对评价依据存在疑问',
      request: '申请学校复核处理',
      attachments: [],
    })
    const schoolNotices = await service.listSchoolNotifications()
    expect(schoolNotices.some((n) => n.kind === 'OBJECTION_RECEIVED')).toBe(true)

    const platformNotices = await service.listRoleNotifications('platform_reviewer')
    const expertNotices = await service.listRoleNotifications('expert')
    expect(platformNotices.some((n) => n.recipientRole === 'school_reviewer')).toBe(false)
    expect(expertNotices.some((n) => n.recipientRole === 'school_reviewer')).toBe(false)
  })

  it('marks read only within the same role', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const expertNotices = await service.listRoleNotifications('expert')
    expect(expertNotices.some((n) => !n.read)).toBe(true)

    await service.markAllRoleNotificationsRead('expert')
    expect((await service.listRoleNotifications('expert')).every((n) => n.read)).toBe(true)

    // 平台通知由真实动作生成（演示快照不预置平台消息，保持诚实投影）。
    // 重新装载专家快照（原子替换通知）后接受任务，产生新的平台侧通知。
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks()).find((t) => t.status === 'INVITED')!
    await service.acceptExpertTask(invited.id)
    const platformNotices = await service.listRoleNotifications('platform_reviewer')
    expect(platformNotices.some((n) => !n.read)).toBe(true)

    await service.markRoleNotificationRead('platform_reviewer', platformNotices[0]!.id)
    expect(
      (await service.listRoleNotifications('platform_reviewer'))[0]!.read,
    ).toBe(true)
    // 平台侧标已读不影响专家侧（recipientRole 隔离：新装载的专家邀请仍为未读）。
    expect((await service.listRoleNotifications('expert')).some((n) => !n.read)).toBe(true)
  })

  it('emits the acceptance and rejection events to the platform reviewer', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks()).find((t) => t.status === 'INVITED')!

    await service.acceptExpertTask(invited.id)
    expect(
      (await service.listRoleNotifications('platform_reviewer')).some(
        (n) => n.kind === 'TASK_ACCEPTED',
      ),
    ).toBe(true)

    // 接受后任务进入 IN_REVIEW，拒绝只对 INVITED 生效：重新装载快照后再拒绝。
    await service.loadExpertScenario('INVITED')
    const freshInvited = (await service.listExpertTasks()).find((t) => t.status === 'INVITED')!
    await service.rejectExpertTask(freshInvited.id, '时间不足')
    expect(
      (await service.listRoleNotifications('platform_reviewer')).some(
        (n) => n.kind === 'TASK_REJECTED',
      ),
    ).toBe(true)
  })

  it('emits remind and correction events to the expert', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const inReview = (await service.listExpertTasks()).find((t) => t.status === 'IN_REVIEW')!

    await service.remindExpertTask(inReview.id)
    expect(
      (await service.listRoleNotifications('expert')).some(
        (n) => n.kind === 'REVIEW_REMINDER' && n.taskId === inReview.id,
      ),
    ).toBe(true)

    // 更正申请种子只在结算演示场景存在（COR-2026-014）。
    await service.loadPlatformScenario('CORRECTION_PENDING')
    await service.decideCorrection('COR-2026-014', 'APPROVED', '差异属实')
    expect(
      (await service.listRoleNotifications('expert')).some((n) => n.kind === 'CORRECTION_DECIDED'),
    ).toBe(true)
  })

  it('emits the withdrawal result event to the expert after payment is recorded', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()
    await service.reviewWithdrawal(withdrawals[0]!.id, 'APPROVE', '余额充足')
    await service.recordWithdrawalPayment(withdrawals[0]!.id, 'SUCCESS', 'V20260812-01')

    expect(
      (await service.listRoleNotifications('expert')).some(
        (n) => n.kind === 'WITHDRAWAL_DECIDED' && n.withdrawalId === withdrawals[0]!.id,
      ),
    ).toBe(true)
  })

  it('notifies the expert with the rejection context when a withdrawal is rejected', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()

    await service.reviewWithdrawal(withdrawals[0]!.id, 'REJECT', '收款信息不完整，请核对后重新申请')
    const notices = await service.listRoleNotifications('expert')

    const decided = notices.find(
      (n) => n.kind === 'WITHDRAWAL_DECIDED' && n.withdrawalId === withdrawals[0]!.id,
    )
    expect(decided).toBeDefined()
    expect(decided!.message).toContain('收款信息不完整，请核对后重新申请')
    expect(decided!.recipientRole).toBe('expert')
    // 驳回同时解除冻结：金额回到可提现（Task 8 RELEASE 入账保留）。
    const account = await service.getExpertAccount()
    expect(account.availableAmount).toBe(900)
    expect(account.pendingAmount).toBe(0)
  })

  it('navigates an expert task notification to the expert tasks page', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    const { router, wrapper } = await mountNotifications(service, 'expert')

    const invited = (await service.listRoleNotifications('expert')).find(
      (n) => n.kind === 'TASK_INVITED',
    )!
    await wrapper
      .get(`[data-notification-id="${invited.id}"] [data-action="open-notification"]`)
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({
      path: '/expert/tasks',
      query: { taskId: invited.taskId },
    })
  })

  it('navigates a platform reviewer notification to the dispatch workbench', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 平台通知由真实动作生成：专家接受任务 → 平台收到 TASK_ACCEPTED。
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks()).find((t) => t.status === 'INVITED')!
    await service.acceptExpertTask(invited.id)
    const { router, wrapper } = await mountNotifications(service, 'platform_reviewer')

    const notice = (await service.listRoleNotifications('platform_reviewer')).find(
      (n) => n.kind === 'TASK_ACCEPTED',
    )!
    await wrapper
      .get(`[data-notification-id="${notice.id}"] [data-action="open-notification"]`)
      .trigger('click')
    await flushPromises()

    expect(router.currentRoute.value).toMatchObject({ path: '/platform/dispatch' })
  })

  it('projects the notification center by current role without the static message sheet', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 平台通知由真实动作生成（演示快照不预置平台消息，保持诚实投影）。
    await service.loadExpertScenario('INVITED')
    const invited = (await service.listExpertTasks()).find((t) => t.status === 'INVITED')!
    await service.acceptExpertTask(invited.id)
    const { wrapper } = await mountNotifications(service, 'platform_reviewer')

    expect(wrapper.get('[data-notification-count="all"]').text()).toContain('1')
    expect(wrapper.get('[data-notification-count="unread"]').text()).toContain('1')
    expect(wrapper.find('[data-role-notification-list]').exists()).toBe(true)
    expect(wrapper.find('.message-sheet').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('评审任务状态发生变化')
    expect(wrapper.text()).not.toContain('演示环境数据说明')
  })

  it('shows the honest demo boundary notice on the role notification center', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const { wrapper } = await mountNotifications(service, 'platform_reviewer')

    expect(wrapper.text()).toContain('演示数据 · 邮件与短信后端待接入')
  })
})
