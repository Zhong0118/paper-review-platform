import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import ExpertTasksPage from '../pages/ExpertTasksPage.vue'
import InvitationPage from '../pages/InvitationPage.vue'
import ReviewWorkspacePage from '../pages/ReviewWorkspacePage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

/** 完整六维评阅输入（与专家端六维模板一致，合计 100 分）。 */
const completeInput = {
  topicValue: 13,
  literatureTheory: 13,
  methodology: 17,
  innovation: 21,
  resultsWorkload: 13,
  writingStandards: 9,
  recommendation: '建议通过',
  strengths: '选题具有价值，研究路径完整。',
  issues: '对最新基线的比较仍需加强。',
  revisionAdvice: '补充消融实验与限制讨论。',
  overallComment: '论文结构完整，达到硕士学位论文要求。',
} as const

async function mountPage(
  component: typeof ExpertTasksPage | typeof InvitationPage | typeof ReviewWorkspacePage,
  service: ReturnType<typeof createScenarioService>,
) {
  const path =
    component === ExpertTasksPage
      ? '/expert/tasks'
      : component === InvitationPage
        ? '/expert/invitation'
        : '/expert/review'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/expert/tasks', component: ExpertTasksPage },
      { path: '/expert/invitation', component: InvitationPage },
      { path: '/expert/review', component: ReviewWorkspacePage },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(component, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { router, service, wrapper }
}

/** 在页面表单中填入完整六维评阅输入（与 completeInput 一致）。 */
async function fillCompleteForm(wrapper: VueWrapper) {
  const scoreValues: Record<string, number> = {
    topicValue: 13,
    literatureTheory: 13,
    methodology: 17,
    innovation: 21,
    resultsWorkload: 13,
    writingStandards: 9,
  }
  for (const [name, value] of Object.entries(scoreValues)) {
    await wrapper.get(`input[name="${name}"]`).setValue(value)
  }
  await wrapper.get('textarea[name="overallComment"]').setValue('论文结构完整，达到硕士学位论文要求。')
  await wrapper.get('textarea[name="mainIssues"]').setValue('对最新基线的比较仍需加强。')
  await wrapper.get('textarea[name="revisionAdvice"]').setValue('补充消融实验与限制讨论。')
  await flushPromises()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('expert review flow', () => {
  it('blocks final submission when a score exceeds its dimension limit or a comment is empty', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountPage(ReviewWorkspacePage, service)
    const submit = wrapper.get('button[data-action="submit-final-review"]')

    // 空表单：必填评语缺失（分值缺省 0 在范围内），提交被禁用
    expect(submit.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="overallComment"]').setValue('论文结构完整，达到硕士学位论文要求。')
    await wrapper.get('textarea[name="mainIssues"]').setValue('对最新基线的比较仍需加强。')
    await wrapper.get('textarea[name="revisionAdvice"]').setValue('补充消融实验与限制讨论。')
    await flushPromises()
    expect(submit.attributes('disabled')).toBeUndefined()

    // 越界分值：研究内容与创新满分 25，输入 26 → 字段级错误（提示满分），提交被禁用
    await wrapper.get('input[name="innovation"]').setValue(26)
    await flushPromises()
    const error = wrapper.findAll('[data-score-error]').at(0)
    expect(error?.text()).toContain('满分 25')
    expect(wrapper.get('[data-completeness]').text()).toContain('研究内容与创新')
    expect(submit.attributes('disabled')).toBeDefined()

    // 修正分值后提交可用；清空必填评语（总体评价）→ 缺项拦截，提交再次禁用
    await wrapper.get('input[name="innovation"]').setValue(21)
    await flushPromises()
    expect(submit.attributes('disabled')).toBeUndefined()
    await wrapper.get('textarea[name="overallComment"]').setValue('')
    await flushPromises()
    expect(wrapper.get('[data-completeness]').text()).toContain('总体评价为必填项')
    expect(submit.attributes('disabled')).toBeDefined()
  })

  it('hides document content and identities before the expert accepts', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')
    // 接单前：任务列表只展示匿名概要（匿名题目/送审方向/接单截止/费用），不开放全文
    const tasks = await mountPage(ExpertTasksPage, service)
    expect(tasks.wrapper.text()).toContain('HY-2026-0042')
    expect(tasks.wrapper.text()).toContain('2026-08-26 18:00')
    expect(tasks.wrapper.text()).toContain('¥ 300.00')
    expect(tasks.wrapper.text()).not.toContain('匿名版全文')
    expect(tasks.wrapper.text()).not.toMatch(/林知远|赵文博|20260042/)

    // 接单详情：匿名摘要与模板说明可见，但论文正文/作者/导师身份不可见
    const invitation = await mountPage(InvitationPage, service)
    expect(invitation.wrapper.text()).toContain('匿名任务')
    expect(invitation.wrapper.text()).toContain('匿名化摘要')
    expect(invitation.wrapper.text()).not.toContain('匿名版全文')
    expect(invitation.wrapper.text()).not.toMatch(/林知远|赵文博|20260042/)

    // 服务投影同源断言：接单前材料不可见，且演示人格任务不含学生身份字段
    const tasksForExpert = await service.listExpertTasks({ own: true })
    const invited = tasksForExpert.find((task) => task.status === 'INVITED')
    expect(invited?.materialsVisible).toBe(false)
    const snapshot = await service.loginAs('expert')
    expect(JSON.stringify(snapshot)).not.toMatch(/林知远|赵文博|20260042/)
  })

  it('opens anonymous material after acceptance and locks the final review', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('INVITED')

    // 接单（二次确认）：任务推进到 IN_REVIEW，匿名材料转为可见
    const invitation = await mountPage(InvitationPage, service)
    const task = (await service.listExpertTasks({ own: true })).find((t) => t.status === 'INVITED')!
    await invitation.wrapper.get('[data-action="accept-task"]').trigger('click')
    await flushPromises()
    await invitation.wrapper.get('[data-action="confirm-accept-task"]').trigger('click')
    await flushPromises()
    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === task.id)?.status).toBe(
      'IN_REVIEW',
    )
    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === task.id)?.materialsVisible).toBe(
      true,
    )

    // 工作台：匿名版全文可见、六维模板完整、实时总分 0/100
    const workspace = await mountPage(ReviewWorkspacePage, service)
    expect(workspace.wrapper.text()).toContain('匿名版全文')
    expect(workspace.wrapper.findAll('[data-dimension]')).toHaveLength(6)
    expect(workspace.wrapper.get('[data-total-score]').text()).toContain('0 / 100')
    expect(
      workspace.wrapper.get('button[data-action="save-review-draft"]').attributes('disabled'),
    ).toBeUndefined()

    // 填写完整六维评阅 → 二次确认 → 最终提交：任务 SUBMITTED，整页只读锁定
    await fillCompleteForm(workspace.wrapper)
    await workspace.wrapper.get('button[data-action="submit-final-review"]').trigger('click')
    await flushPromises()
    await workspace.wrapper.get('button[data-action="confirm-submit-review"]').trigger('click')
    await flushPromises()
    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === task.id)?.status).toBe(
      'SUBMITTED',
    )
    expect(workspace.wrapper.get('[data-review-locked="true"]').exists()).toBe(true)
    expect(workspace.wrapper.get('textarea[name="overallComment"]').attributes('disabled')).toBeDefined()
    expect(
      workspace.wrapper.get('button[data-action="submit-final-review"]').attributes('disabled'),
    ).toBeDefined()
    expect((await service.loginAs('expert')).review?.submitted).toBe(true)
  })
})
