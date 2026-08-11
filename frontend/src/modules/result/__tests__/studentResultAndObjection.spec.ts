import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ScenarioService, StorageLike } from '@/demo/types'

import StudentResultPage from '../pages/StudentResultPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

async function mountStudentResult(service: ScenarioService, path = '/student/results') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/student/results', component: StudentResultPage },
      { path: '/student/dashboard', component: { template: '<div>论文工作台</div>' } },
      { path: '/notifications', component: { template: '<div>消息通知</div>' } },
      { path: '/login', component: { template: '<div>登录</div>' } },
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
        provide: { [scenarioServiceKey as symbol]: service },
      },
    },
  )
  await flushPromises()
  return { router, wrapper }
}

function chooseAttachment(
  wrapper: Awaited<ReturnType<typeof mountStudentResult>>['wrapper'],
  file: File,
) {
  const input = wrapper.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  return input.trigger('change')
}

describe('student result and objection workflow', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('uses thesisId to select one of the current student theses', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { router, wrapper } = await mountStudentResult(
      service,
      '/student/results?thesisId=thesis-0031',
    )

    expect(wrapper.get('select[data-student-result-selector]').element).toHaveProperty(
      'value',
      'thesis-0031',
    )
    expect(wrapper.text()).toContain('面向边缘环境的可信联邦学习方法研究')
    expect(wrapper.text()).toContain('82.0')

    await wrapper.get('select[data-student-result-selector]').setValue('thesis-main')
    await flushPromises()
    expect(router.currentRoute.value.query.thesisId).toBe('thesis-main')
    expect(wrapper.text()).toContain('结果尚未发布')
  })

  it('shows only five-stage progress and the latest public event before publication', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')

    expect(wrapper.findAll('[aria-label="流程进度"] > li')).toHaveLength(5)
    expect(wrapper.get('[data-latest-public-event]').text()).toContain('已创建论文草稿')
    expect(wrapper.text()).toContain('结果尚未发布')
    expect(wrapper.find('[data-result-total]').exists()).toBe(false)
    expect(wrapper.find('[data-score-dimension]').exists()).toBe(false)
    expect(wrapper.find('form[data-objection-form]').exists()).toBe(false)
  })

  it('shows total, six dimensions, conclusion, public comment and publication time only after publication', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')

    expect(wrapper.get('[data-result-total]').text()).toContain('86.0')
    expect(wrapper.findAll('[data-score-dimension]')).toHaveLength(6)
    expect(wrapper.text()).toContain('建议通过')
    expect(wrapper.text()).toContain('论文结构完整')
    expect(wrapper.text()).toContain('2026-08-25 10:00')
    expect(wrapper.text()).toContain('专家 A')
    expect(wrapper.text()).not.toMatch(/周明远|138\d{8}|\w+@\w+|internal/i)
    expect(JSON.stringify(await service.getStudentResult('thesis-main'))).not.toMatch(
      /周明远|phone|email|internal/i,
    )
  })

  it('requires both a reason and a request before opening confirmation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')

    await wrapper.get('[data-action="submit-objection"]').trigger('click')
    expect(wrapper.text()).toContain('请填写异议理由')
    expect(wrapper.find('[data-action="confirm-objection"]').exists()).toBe(false)

    await wrapper.get('textarea[name="reason"]').setValue('对评价依据存在疑问')
    await wrapper.get('[data-action="submit-objection"]').trigger('click')
    expect(wrapper.text()).toContain('请填写处理诉求')
    expect(wrapper.find('[data-action="confirm-objection"]').exists()).toBe(false)
  })

  it('keeps entered text when an attachment fails and blocks submission until replacement', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')
    vi.useFakeTimers()

    await wrapper.get('textarea[name="reason"]').setValue('对评价依据存在疑问')
    await wrapper.get('textarea[name="request"]').setValue('申请学校复核处理')
    await chooseAttachment(
      wrapper,
      new File(['invalid'], '异议说明.doc', { type: 'application/msword' }),
    )
    await vi.runAllTimersAsync()

    expect(wrapper.get('textarea[name="reason"]').element).toHaveProperty(
      'value',
      '对评价依据存在疑问',
    )
    expect(wrapper.get('textarea[name="request"]').element).toHaveProperty(
      'value',
      '申请学校复核处理',
    )
    expect(wrapper.text()).toContain('上传失败')
    expect(wrapper.text()).toContain('重新选择附件')
    expect(wrapper.get('[data-action="submit-objection"]').attributes('disabled')).toBeDefined()

    await chooseAttachment(
      wrapper,
      new File(['replacement'], '异议说明.pdf', { type: 'application/pdf' }),
    )
    await vi.runAllTimersAsync()
    expect(wrapper.text()).toContain('异议说明.pdf')
    expect(wrapper.get('[data-action="submit-objection"]').attributes('disabled')).toBeUndefined()
  })

  it('submits once after confirmation, creates a notification and hides duplicate submission while unresolved', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')

    await wrapper.get('textarea[name="reason"]').setValue('对评价依据存在疑问')
    await wrapper.get('textarea[name="request"]').setValue('申请学校复核处理')
    await wrapper.get('[data-action="submit-objection"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('提交后不可撤回')
    await wrapper.get('[data-action="confirm-objection"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('异议已提交')
    expect(wrapper.get('[data-objection-status="SUBMITTED"]').text()).toContain('已提交')
    expect(wrapper.find('[data-action="submit-objection"]').exists()).toBe(false)
    const thesis = await service.getStudentThesis('thesis-main')
    expect(thesis.stage).toBe('COMPLETED')
    expect(thesis.allowedActions).not.toContain('SUBMIT_OBJECTION')
    expect((await service.listStudentNotifications())[0]).toMatchObject({
      kind: 'OBJECTION_SUBMITTED',
    })
    await expect(
      service.submitStudentObjection('thesis-main', {
        reason: '重复异议',
        request: '再次复核',
        attachments: [],
      }),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('projects a resolved objection timeline without changing the completed thesis stage', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.loadStudentScenario('COMPLETED')
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    persisted.student.objections = [
      {
        id: 'objection-resolved',
        thesisId: 'thesis-main',
        reason: '对评价依据存在疑问',
        request: '申请学校复核处理',
        attachments: [],
        status: 'RESOLVED',
        submittedAt: '2026-08-11 09:00',
        processingAt: '2026-08-12 10:00',
        resolvedAt: '2026-08-15 16:30',
        publicResolution: '学校已复核，原评阅结论维持不变。',
      },
    ]
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))
    const service = createScenarioService({ storage, demoMode: true })
    const { wrapper } = await mountStudentResult(service, '/student/results?thesisId=thesis-main')

    expect(wrapper.get('[data-objection-status="RESOLVED"]').text()).toContain('已办结')
    expect(wrapper.text()).toContain('学校已复核，原评阅结论维持不变')
    expect((await service.getStudentThesis('thesis-main')).stage).toBe('COMPLETED')
  })

  it('restores a legacy persisted objection as one unresolved submitted record', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.loadStudentScenario('COMPLETED')
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1') ?? '{}')
    persisted.student.objections = [
      {
        id: 'legacy-objection',
        thesisId: 'thesis-main',
        reason: '旧版异议理由',
        submittedAt: '2026-08-10 09:00',
      },
    ]
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const service = createScenarioService({ storage, demoMode: true })
    expect((await service.getStudentResult('thesis-main'))?.objection).toMatchObject({
      status: 'SUBMITTED',
      request: '',
      attachments: [],
    })
    expect((await service.getStudentThesis('thesis-main')).allowedActions).not.toContain(
      'SUBMIT_OBJECTION',
    )
  })
})
