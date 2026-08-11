import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { scenarioServiceKey } from '@/demo/serviceProvider'
import { createScenarioService } from '@/demo/scenarioService'
import type { ScenarioService } from '@/demo/types'
import ThesisEditPage from '../pages/ThesisEditPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

async function mountEditor(options?: { service?: ScenarioService; thesisId?: string }) {
  const service = options?.service ?? createScenarioService()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/student/thesis/edit', component: ThesisEditPage },
      { path: '/student/dashboard', component: { template: '<div>学生工作台</div>' } },
      { path: '/login', component: { template: '<div>登录</div>' } },
      { path: '/student/results', component: { template: '<div>结果</div>' } },
      { path: '/notifications', component: { template: '<div>通知</div>' } },
    ],
  })
  await router.push({
    path: '/student/thesis/edit',
    query: { thesisId: options?.thesisId ?? 'thesis-main' },
  })
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
  return { service, router, wrapper }
}

async function choosePageFile(wrapper: ReturnType<typeof mount>, purpose: string, file: File) {
  const input = wrapper.get(`[data-file-purpose="${purpose}"] input[type="file"]`)
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('student thesis material editor', () => {
  it('loads editable material and renders all student identity fields as read-only text', async () => {
    const { wrapper } = await mountEditor()

    expect((wrapper.get('textarea[name="abstract"]').element as HTMLTextAreaElement).value).toBe(
      '研究面向复杂场景中的多模态知识推理方法与可信机制。',
    )
    const identity = wrapper.get('[data-student-identity]')
    for (const text of [
      '海岳大学',
      '计算机学院',
      '20260042',
      '林知远',
      '硕士研究生',
      '工学硕士',
      '赵文博教授',
      '2026 年春季硕士论文盲审',
      '2026-05-20 18:00',
    ]) {
      expect(identity.text()).toContain(text)
    }
    expect(identity.find('input').exists()).toBe(false)
  })

  it('saves a complete draft and reports the saved time', async () => {
    const { service, wrapper } = await mountEditor()
    const saveSpy = vi.spyOn(service, 'saveStudentDraft')

    await wrapper.get('textarea[name="abstract"]').setValue('研究摘要')
    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalledWith(
      'thesis-main',
      expect.objectContaining({
        abstract: '研究摘要',
        discipline: { code: '0812', name: '计算机科学与技术' },
      }),
    )
    expect((await service.getStudentThesis('thesis-main')).abstract).toBe('研究摘要')
    expect(wrapper.get('[data-save-status]').text()).toContain('已保存')
  })

  it('keeps draft input and file metadata after a save failure, then retries the same action', async () => {
    const service = createScenarioService()
    const saveSpy = vi
      .spyOn(service, 'saveStudentDraft')
      .mockRejectedValueOnce(new Error('temporary failure'))
    const { wrapper } = await mountEditor({ service })

    await wrapper.get('textarea[name="abstract"]').setValue('失败后保留的摘要')
    vi.useFakeTimers()
    await choosePageFile(
      wrapper,
      'SCHOOL_ARCHIVE',
      new File(['new pdf'], 'retry-original.pdf', { type: 'application/pdf' }),
    )
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-save-status]').text()).toContain('保存失败，请重试')
    expect((wrapper.get('textarea[name="abstract"]').element as HTMLTextAreaElement).value).toBe(
      '失败后保留的摘要',
    )
    expect(wrapper.text()).toContain('retry-original.pdf')
    expect(wrapper.get('[data-action="save-draft"]').text()).toBe('重新保存')

    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()
    expect(saveSpy).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[data-save-status]').text()).toContain('已保存')
    expect((await service.getStudentThesis('thesis-main')).files).toContainEqual(
      expect.objectContaining({ name: 'retry-original.pdf', size: 7 }),
    )
  })

  it('keeps new edits dirty when an older save request finishes', async () => {
    const { router, wrapper } = await mountEditor()
    const textarea = wrapper.get('textarea[name="abstract"]')
    await textarea.setValue('准备保存的版本')

    const saveRequest = wrapper.get('[data-action="save-draft"]').trigger('click')
    const newerEdit = textarea.setValue('保存请求期间的新修改')
    await Promise.all([saveRequest, newerEdit])
    await flushPromises()

    expect(wrapper.get('[data-save-status]').text()).toContain('有未保存修改')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await router.push('/student/dashboard')
    expect(confirm).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/student/thesis/edit')
  })

  it('creates a real draft id for thesisId=new and replaces the route before saving', async () => {
    const { router, service, wrapper } = await mountEditor({ thesisId: 'new' })
    const realId = String(router.currentRoute.value.query.thesisId)

    expect(realId).toMatch(/^thesis-draft-/)
    expect(realId).not.toBe('new')
    await wrapper.get('input[name="title"]').setValue('新草稿题目')
    await wrapper.get('textarea[name="abstract"]').setValue('新草稿摘要')
    await wrapper.get('[data-action="save-draft"]').trigger('click')
    await flushPromises()
    expect((await service.getStudentThesis(realId)).title).toBe('新草稿题目')
  })

  it('validates submission in title, abstract, discipline, keywords, original, anonymous order', async () => {
    const { wrapper } = await mountEditor({ thesisId: 'new' })
    const submit = wrapper.get('[data-action="open-submit-confirmation"]')

    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请填写论文题目')
    expect(document.activeElement).toBe(wrapper.get('input[name="title"]').element)

    await wrapper.get('input[name="title"]').setValue('论文题目')
    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请填写论文摘要')

    await wrapper.get('textarea[name="abstract"]').setValue('论文摘要')
    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请选择学科专业')

    await wrapper.get('[data-action="open-discipline"]').trigger('click')
    await wrapper.get('input[type="search"]').setValue('0812')
    await wrapper.get('[data-discipline="0812"]').trigger('click')
    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请至少填写 1 个关键词')

    await wrapper.get('#keyword-draft').setValue('知识图谱')
    await wrapper.get('#keyword-draft').trigger('keydown.enter')
    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请上传原始版论文')

    vi.useFakeTimers()
    await choosePageFile(
      wrapper,
      'SCHOOL_ARCHIVE',
      new File(['pdf'], 'original.pdf', { type: 'application/pdf' }),
    )
    await vi.runAllTimersAsync()
    await flushPromises()
    await submit.trigger('click')
    expect(wrapper.get('[data-validation-error]').text()).toContain('请上传匿名版论文')
  })

  it('submits only once after confirmation and returns to the dashboard', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const { router, wrapper } = await mountEditor({ service })
    const submitSpy = vi.spyOn(service, 'submitStudentThesis')

    await wrapper.get('input[name="title"]').setValue('未单独保存的新题目')
    await wrapper.get('textarea[name="abstract"]').setValue('提交动作必须先保存的新摘要')

    await wrapper.get('[data-action="open-submit-confirmation"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('提交后将进入学校材料审核')

    const confirm = wrapper.get('[data-action="confirm-submit"]')
    void confirm.trigger('click')
    void confirm.trigger('click')
    await flushPromises()

    expect(submitSpy).toHaveBeenCalledTimes(1)
    const restored = await createScenarioService({ storage, demoMode: true }).getStudentThesis(
      'thesis-main',
    )
    expect(restored).toMatchObject({
      stage: 'SUBMITTED',
      title: '未单独保存的新题目',
      abstract: '提交动作必须先保存的新摘要',
    })
    expect(router.currentRoute.value.path).toBe('/student/dashboard')
  })

  it.each(['PENDING', 'INVALID'] as const)(
    'blocks %s file metadata in the matching validation slot',
    async (validationStatus) => {
      const service = createScenarioService()
      const current = await service.getStudentThesis('thesis-main')
      await service.saveStudentDraft('thesis-main', {
        title: current.title,
        abstract: current.abstract,
        discipline: current.discipline,
        keywords: current.keywords,
        files: current.files.map((file) =>
          file.purpose === 'SCHOOL_ARCHIVE' ? { ...file, validationStatus } : file,
        ),
      })
      const { wrapper } = await mountEditor({ service })

      await wrapper.get('[data-action="open-submit-confirmation"]').trigger('click')

      expect(wrapper.get('[data-validation-error]').text()).toContain('请上传原始版论文')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    },
  )

  it('shows a submit failure without losing input and allows retry', async () => {
    const service = createScenarioService()
    const submitSpy = vi
      .spyOn(service, 'submitStudentThesis')
      .mockRejectedValueOnce(new Error('submit unavailable'))
    const { router, wrapper } = await mountEditor({ service })
    await wrapper.get('textarea[name="abstract"]').setValue('提交失败后保留')
    await wrapper.get('[data-action="open-submit-confirmation"]').trigger('click')

    await wrapper.get('[data-action="confirm-submit"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-submit-error]').text()).toContain('提交失败，请重试')
    expect((wrapper.get('textarea[name="abstract"]').element as HTMLTextAreaElement).value).toBe(
      '提交失败后保留',
    )
    expect(router.currentRoute.value.path).toBe('/student/thesis/edit')

    await wrapper.get('[data-action="confirm-submit"]').trigger('click')
    await flushPromises()
    expect(submitSpy).toHaveBeenCalledTimes(2)
    expect(router.currentRoute.value.path).toBe('/student/dashboard')
  })

  it('asks before leaving only while unsaved changes are dirty', async () => {
    const clean = await mountEditor()
    const cleanConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await clean.router.push('/student/dashboard')
    expect(cleanConfirm).not.toHaveBeenCalled()
    clean.wrapper.unmount()

    const dirty = await mountEditor()
    const dirtyConfirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await dirty.wrapper.get('textarea[name="abstract"]').setValue('尚未保存')
    await dirty.router.push('/student/dashboard')

    expect(dirtyConfirm).toHaveBeenCalledWith('当前修改尚未保存，确认离开吗？')
    expect(dirty.router.currentRoute.value.path).toBe('/student/thesis/edit')
  })
})
