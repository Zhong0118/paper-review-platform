import '@/__tests__/demoMode'
import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { scenarioServiceKey } from '@/demo/serviceProvider'
import { createScenarioService } from '@/demo/scenarioService'
import { StudentPortalError, type ScenarioService, type StorageLike } from '@/demo/types'
import StudentDashboardPage from '../pages/StudentDashboardPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountWorkspace(service: ScenarioService = createScenarioService()) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/student/dashboard', component: StudentDashboardPage },
      { path: '/student/thesis/edit', component: { template: '<div>论文编辑</div>' } },
      { path: '/student/results', component: { template: '<div>评审结果</div>' } },
      { path: '/notifications', component: { template: '<div>消息通知</div>' } },
      { path: '/login', component: { template: '<div>登录</div>' } },
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
        provide: { [scenarioServiceKey as symbol]: service },
      },
    },
  )
  await flushPromises()
  return { router, service, wrapper }
}

async function completeWithdrawalDialog(
  wrapper: Awaited<ReturnType<typeof mountWorkspace>>['wrapper'],
  reason: string,
) {
  await wrapper.get('textarea[name="withdrawalReason"]').setValue(reason)
  await wrapper.get('[data-action="confirm-withdrawal"]').trigger('click')
  await flushPromises()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('student thesis workspace', () => {
  it('changes the progress and allowed actions from one selected thesis projection', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loginAs('expert')
    const { wrapper } = await mountWorkspace(service)

    expect(JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}').scenario.activeRole).toBe(
      'expert',
    )

    expect(wrapper.get('[data-selected-thesis]').attributes('data-selected-thesis')).toBe(
      'thesis-main',
    )
    expect(wrapper.get('[data-student-stage="MATERIALS"]').exists()).toBe(true)
    expect(wrapper.findAll('[aria-label="流程进度"] > li')).toHaveLength(5)

    await wrapper.get('[data-thesis-id="thesis-0031"]').trigger('click')

    expect(wrapper.get('[data-selected-thesis]').attributes('data-selected-thesis')).toBe(
      'thesis-0031',
    )
    expect(wrapper.get('[data-student-stage="COMPLETED"]').exists()).toBe(true)
    expect(wrapper.get('[data-action="view-result"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="edit-thesis"]').exists()).toBe(false)
  })

  it('computes statistics before filtering and searches title, anonymous id and discipline', async () => {
    const { wrapper } = await mountWorkspace()

    expect(wrapper.get('[data-stat="needs-action"]').text()).toContain('1')
    expect(wrapper.get('[data-stat="in-review"]').text()).toContain('0')
    expect(wrapper.get('[data-stat="completed"]').text()).toContain('1')

    for (const query of ['可信联邦学习', 'HY-2025-0031', '0812', '计算机科学与技术']) {
      await wrapper.get('[data-search-theses]').setValue(query)
      expect(wrapper.findAll('[data-thesis-id]')).toHaveLength(
        query === '0812' || query === '计算机科学与技术' ? 2 : 1,
      )
      expect(wrapper.get('[data-thesis-id="thesis-0031"]').exists()).toBe(true)
    }

    await wrapper.get('[data-search-theses]').setValue('')
    await wrapper.get('[data-filter="COMPLETED"]').trigger('click')
    expect(wrapper.findAll('[data-thesis-id]')).toHaveLength(1)
    expect(wrapper.get('[data-thesis-id="thesis-0031"]').text()).toContain('计算机科学与技术')
    expect(wrapper.get('[data-stat="needs-action"]').text()).toContain('1')
  })

  it('opens a detail drawer with material metadata and the public timeline', async () => {
    const { wrapper } = await mountWorkspace()

    await wrapper.get('[data-thesis-id="thesis-main"] [data-action="open-detail"]').trigger('click')

    const drawer = wrapper.get('[data-thesis-detail-drawer]')
    expect(drawer.attributes('data-thesis-id')).toBe('thesis-main')
    expect(drawer.text()).toContain('已创建论文草稿')
    expect(drawer.text()).toContain('林知远-硕士学位论文.pdf')
    expect(drawer.text()).toContain('HY-2026-0042-匿名版.pdf')
  })

  it('manages drawer focus, closes on Escape and restores the detail opener', async () => {
    const { wrapper } = await mountWorkspace()
    const opener = wrapper.get('[data-thesis-id="thesis-main"] [data-action="open-detail"]')
    ;(opener.element as HTMLButtonElement).focus()

    await opener.trigger('click')
    await flushPromises()

    const drawer = wrapper.get('[data-thesis-detail-drawer]')
    const close = wrapper.get('[data-action="close-detail"]')
    expect(document.activeElement).toBe(close.element)
    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeDefined()

    await drawer.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('[data-thesis-detail-drawer]').exists()).toBe(false)
    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(opener.element)
  })

  it('shows the school public reason in both terminated progress and thesis detail', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.resetStudentDemo()
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    persisted.scenario.stage = 'TERMINATED'
    persisted.student.publicReasonsByThesis = {
      'thesis-main': '学校确认该批次资格已终止，详情请联系研究生院。',
    }
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))
    const { wrapper } = await mountWorkspace(createScenarioService({ storage, demoMode: true }))

    expect(wrapper.find('[aria-label="流程进度"]').exists()).toBe(false)
    expect(wrapper.get('[data-selected-thesis]').text()).toContain(
      '学校确认该批次资格已终止，详情请联系研究生院',
    )

    await wrapper.get('[data-thesis-id="thesis-main"] [data-action="open-detail"]').trigger('click')
    expect(wrapper.get('[data-thesis-detail-drawer]').text()).toContain(
      '学校确认该批次资格已终止，详情请联系研究生院',
    )
  })

  it('deletes a student draft only after explicit confirmation', async () => {
    const { service, wrapper } = await mountWorkspace()
    const deleteSpy = vi.spyOn(service, 'deleteStudentDraft')
    const deleteOpener = wrapper.get('[data-action="delete-draft"]')
    ;(deleteOpener.element as HTMLButtonElement).focus()

    await deleteOpener.trigger('click')
    expect(deleteSpy).not.toHaveBeenCalled()
    await wrapper.get('[data-action="confirm-delete-draft"]').trigger('click')
    await flushPromises()

    expect(deleteSpy).toHaveBeenCalledWith('thesis-main')
    expect(wrapper.find('[data-thesis-id="thesis-main"]').exists()).toBe(false)
    expect(wrapper.get('[data-selected-thesis]').attributes('data-selected-thesis')).toBe(
      'thesis-0031',
    )
    expect(document.activeElement).toBe(wrapper.get('[data-thesis-id="thesis-0031"]').element)
  })

  it('clears the selected projection when deleting the only thesis matching the search', async () => {
    const { wrapper } = await mountWorkspace()

    await wrapper.get('[data-search-theses]').setValue('面向复杂场景')
    expect(wrapper.findAll('[data-thesis-id]')).toHaveLength(1)
    expect(wrapper.get('[data-thesis-id="thesis-main"]').exists()).toBe(true)

    await wrapper.get('[data-action="delete-draft"]').trigger('click')
    await wrapper.get('[data-action="confirm-delete-draft"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-thesis-id]')).toHaveLength(0)
    expect(wrapper.find('[data-selected-thesis]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="流程进度"]').exists()).toBe(false)
  })

  it('traps confirmation focus, closes on Escape and restores the action opener', async () => {
    const { wrapper } = await mountWorkspace()
    const opener = wrapper.get('[data-action="delete-draft"]')
    ;(opener.element as HTMLButtonElement).focus()

    await opener.trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[role="dialog"]')
    const cancel = wrapper.get('[data-action="cancel-confirmation"]')
    const confirm = wrapper.get('[data-action="confirm-delete-draft"]')
    expect(document.activeElement).toBe(cancel.element)

    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(confirm.element)
    await dialog.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(cancel.element)
    await dialog.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm.element)

    await dialog.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('.portal-layout__background').attributes('inert')).toBeUndefined()
    expect(document.activeElement).toBe(opener.element)
  })

  it('keeps school-submitted records read-only in both the table and detail drawer', async () => {
    const service = createScenarioService()
    await service.submitThesisAsSchool({
      studentId: '20260042',
      batchId: 'batch-2026-spring',
      title: '学校代传的智能教育研究',
      discipline: { code: '0401', name: '教育学' },
      keywords: ['智能教育'],
      originalFileName: 'school-original.pdf',
      anonymousFileName: 'school-anonymous.pdf',
    })
    const { wrapper } = await mountWorkspace(service)
    const schoolRow = wrapper.get('[data-source="SCHOOL_MANUAL"]').element.closest('tr')
    expect(schoolRow).not.toBeNull()
    const schoolThesisId = schoolRow?.getAttribute('data-thesis-id') ?? ''

    await wrapper.get(`[data-thesis-id="${schoolThesisId}"]`).trigger('click')
    await wrapper
      .get(`[data-thesis-id="${schoolThesisId}"] [data-action="open-detail"]`)
      .trigger('click')

    const drawer = wrapper.get('[data-thesis-detail-drawer]')
    expect(drawer.text()).toContain('学校代传')
    expect(drawer.find('[data-action="edit-thesis"]').exists()).toBe(false)
    expect(drawer.find('[data-action="delete-draft"]').exists()).toBe(false)
    expect(drawer.find('[data-action="withdraw-before-dispatch"]').exists()).toBe(false)
    expect(drawer.find('[data-action="request-withdrawal"]').exists()).toBe(false)
  })

  it('requires a reason and confirmation before withdrawing prior to dispatch', async () => {
    const service = createScenarioService()
    await service.submitStudentThesis('thesis-main')
    const withdrawSpy = vi.spyOn(service, 'withdrawStudentThesis')
    const { wrapper } = await mountWorkspace(service)
    const withdrawOpener = wrapper.get('[data-action="withdraw-before-dispatch"]')
    ;(withdrawOpener.element as HTMLButtonElement).focus()

    await withdrawOpener.trigger('click')
    expect(wrapper.get('[data-action="confirm-withdrawal"]').attributes('disabled')).toBeDefined()
    expect(withdrawSpy).not.toHaveBeenCalled()

    await completeWithdrawalDialog(wrapper, '需要替换匿名版文件')

    expect(withdrawSpy).toHaveBeenCalledWith('thesis-main', '需要替换匿名版文件')
    expect(wrapper.get('[data-student-stage="MATERIALS"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('论文已撤回，可继续修改材料')
    expect(document.activeElement).toBe(wrapper.get('[data-thesis-id="thesis-main"]').element)
  })

  it('removes an updated thesis from the active filter and clears its stale progress projection', async () => {
    const service = createScenarioService()
    await service.submitStudentThesis('thesis-main')
    const { wrapper } = await mountWorkspace(service)

    await wrapper.get('[data-filter="IN_REVIEW"]').trigger('click')
    expect(wrapper.get('[data-thesis-id="thesis-main"]').exists()).toBe(true)
    await wrapper.get('[data-action="withdraw-before-dispatch"]').trigger('click')
    await completeWithdrawalDialog(wrapper, '返回材料准备继续修改')

    expect(wrapper.find('[data-thesis-id="thesis-main"]').exists()).toBe(false)
    expect(wrapper.find('[data-selected-thesis]').exists()).toBe(false)
  })

  it('creates an under-review withdrawal request without changing the thesis stage', async () => {
    const service = createScenarioService()
    await service.loadStudentScenario('EXPERT_REVIEW')
    const requestSpy = vi.spyOn(service, 'requestStudentWithdrawal')
    const { wrapper } = await mountWorkspace(service)

    await wrapper.get('[data-action="request-withdrawal"]').trigger('click')
    await completeWithdrawalDialog(wrapper, '个人培养安排发生变化')

    expect(requestSpy).toHaveBeenCalledWith('thesis-main', '个人培养安排发生变化')
    expect(wrapper.get('[data-student-stage="EXPERT_REVIEW"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('已提交学校处理')
    expect((await service.getStudentThesis('thesis-main')).stage).toBe('UNDER_REVIEW')
  })

  it('keeps the page title on list failure and retries the same service load', async () => {
    const service = createScenarioService()
    const listSpy = vi
      .spyOn(service, 'listStudentTheses')
      .mockRejectedValueOnce(new Error('temporary list failure'))
    const { wrapper } = await mountWorkspace(service)

    expect(wrapper.get('h1').text()).toBe('我的论文')
    expect(wrapper.get('[role="alert"]').text()).toContain('论文列表加载失败')
    expect(wrapper.find('[data-selected-thesis]').exists()).toBe(false)

    await wrapper.get('[data-action="reload-theses"]').trigger('click')
    await flushPromises()

    expect(listSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-selected-thesis]').attributes('data-selected-thesis')).toBe(
      'thesis-main',
    )
  })

  it('refreshes the selected detail and gives a public message after STATE_CONFLICT', async () => {
    const service = createScenarioService()
    await service.submitStudentThesis('thesis-main')
    const conflict = new StudentPortalError('STATE_CONFLICT', 'stale state')
    vi.spyOn(service, 'withdrawStudentThesis').mockRejectedValueOnce(conflict)
    const getDetailSpy = vi.spyOn(service, 'getStudentThesis')
    const { wrapper } = await mountWorkspace(service)
    const withdrawOpener = wrapper.get('[data-action="withdraw-before-dispatch"]')
    ;(withdrawOpener.element as HTMLButtonElement).focus()

    await withdrawOpener.trigger('click')
    await completeWithdrawalDialog(wrapper, '替换材料')

    expect(getDetailSpy).toHaveBeenCalledWith('thesis-main')
    expect(wrapper.get('[role="status"]').text()).toContain('论文状态已更新，本次操作未执行')
    expect(wrapper.get('[data-student-stage="SCHOOL_REVIEW"]').exists()).toBe(true)
    expect(document.activeElement).toBe(withdrawOpener.element)
  })

  it('creates a real draft from the empty state and routes with its returned id', async () => {
    const service = createScenarioService()
    vi.spyOn(service, 'listStudentTheses').mockResolvedValue([])
    const createSpy = vi.spyOn(service, 'createStudentDraft')
    const { router, wrapper } = await mountWorkspace(service)

    expect(wrapper.text()).toContain('还没有论文记录')
    expect(wrapper.find('[data-selected-thesis]').exists()).toBe(false)
    await wrapper.get('[data-action="create-thesis"]').trigger('click')
    await flushPromises()

    const created = await createSpy.mock.results[0]?.value
    expect(router.currentRoute.value.path).toBe('/student/thesis/edit')
    expect(router.currentRoute.value.query.thesisId).toBe(created.id)
  })

  it('disables empty-state creation and shows the public eligibility reason', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.resetStudentDemo()
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    persisted.student.eligibility = {
      ...persisted.student.eligibility,
      eligible: false,
      status: 'SUSPENDED',
      reason: '学校已暂停本批次提交资格。',
    }
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))
    const service = createScenarioService({ storage, demoMode: true })
    vi.spyOn(service, 'listStudentTheses').mockResolvedValue([])
    const createSpy = vi.spyOn(service, 'createStudentDraft')
    const { wrapper } = await mountWorkspace(service)

    const createButton = wrapper.get('[data-action="create-thesis"]')
    expect(wrapper.text()).toContain('学校已暂停本批次提交资格')
    expect(createButton.attributes('disabled')).toBeDefined()
    expect(createSpy).not.toHaveBeenCalled()
  })
})
