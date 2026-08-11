import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import ReviewFormPane from '../components/ReviewFormPane.vue'
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
}

/** 缺项评阅输入（仅各维度分值，缺总体评价/主要问题/修改建议/评审结论）。 */
const incompleteInput = {
  topicValue: 13,
  literatureTheory: 13,
  methodology: 17,
  innovation: 21,
  resultsWorkload: 13,
  writingStandards: 9,
}

/** 越界评阅输入：研究内容与创新 26 分超出该维度满分 25。 */
const outOfRangeInput = {
  ...completeInput,
  innovation: 26,
}

async function mountWorkspace(
  service = createScenarioService({ storage: createMemoryStorage(), demoMode: true }),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/expert/review', component: ReviewWorkspacePage }],
  })
  await router.push('/expert/review')
  await router.isReady()
  const wrapper = mount(ReviewWorkspacePage, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, wrapper }
}

/**
 * 在页面表单中填入完整六维评阅输入（与 completeInput 一致）：
 * 六个维度分值 + 总体评价/主要问题/修改建议，使提交/保存按钮可用。
 */
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

describe('review workspace service', () => {
  it('validates completeness, locks after submit, and requests correction', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const invalid = { ...incompleteInput }
    await expect(service.submitFinalReview(invalid)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    await service.submitFinalReview(completeInput)
    const tasks = await service.listExpertTasks()
    expect(tasks[0].status).toBe('SUBMITTED')

    await service.requestCorrection(tasks[0].id, '总分计算有误')
    expect((await service.listCorrectionRequests())[0].status).toBe('PENDING')
  })

  it('rejects out-of-range scores with a field-level error', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')

    await expect(service.submitFinalReview(outOfRangeInput)).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    // 越界字段级报错：错误信息指出具体维度与满分
    await expect(service.submitFinalReview(outOfRangeInput)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('autosaves a draft and restores it after a reload', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.saveReviewDraft(completeInput)

    // 重新构造服务（模拟刷新页面）：同一 storage 读回持久化草稿。
    // 刷新后 activeRole 重置为 student，评阅内容按角色投影隐藏，先恢复专家视角再读取。
    const restored = createScenarioService({ storage, demoMode: true })
    await restored.loginAs('expert')
    const savedDraft = await restored.saveReviewDraft()
    expect(savedDraft.review?.draftSaved).toBe(true)
    expect(savedDraft.review?.scoreInput).toMatchObject({ innovation: 21 })
  })

  it('still accepts drafts and final submissions on overdue tasks', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('OVERDUE')
    const tasks = await service.listExpertTasks()
    expect(tasks[0].overdue).toBe(true)

    await service.saveReviewDraft(completeInput)
    await service.submitFinalReview(completeInput)
    expect((await service.listExpertTasks())[0].status).toBe('SUBMITTED')
  })

  it('keeps the submitted review version after requesting a correction', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitFinalReview(completeInput)
    const task = (await service.listExpertTasks())[0]

    await service.requestCorrection(task.id, '总分计算有误')

    // 原版本保留：任务仍为 SUBMITTED，评阅版本只读且仍存在
    const after = await service.listExpertTasks()
    expect(after[0].status).toBe('SUBMITTED')
    expect(after[0].correctionPending).toBe(true)
    const versions = await service.listReviewVersions(task.id)
    expect(versions[0]).toMatchObject({ readonly: true, status: 'CURRENT' })
  })

  it('requires a reason when requesting a correction', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('SUBMITTED')
    const task = (await service.listExpertTasks())[0]

    await expect(service.requestCorrection(task.id, '')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    expect(await service.listCorrectionRequests()).toHaveLength(0)
  })
})

describe('review workspace page (PAGE-010)', () => {
  it('renders a template-driven six-dimension form with per-dimension fields', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountWorkspace(service)

    // 六维评分：每维 分值/评分说明/可选评价 均渲染（页面按模板数据动态渲染）
    const dimensionLabels = ['选题价值', '文献与理论基础', '研究设计与方法', '研究内容与创新', '写作规范', '综合学术水平']
    for (const label of dimensionLabels) {
      const dimension = wrapper
        .findAll('[data-dimension]')
        .find((node) => node.text().includes(label))
      expect(dimension, `dimension ${label} should render`).toBeDefined()
      expect(dimension!.find('[data-dimension-guide]').exists()).toBe(true)
    }

    // 总体评价（必填）/主要问题/修改建议/评审结论
    expect(wrapper.get('textarea[name="overallComment"]').exists()).toBe(true)
    expect(wrapper.get('textarea[name="mainIssues"]').exists()).toBe(true)
    expect(wrapper.get('textarea[name="revisionAdvice"]').exists()).toBe(true)
    expect(wrapper.get('select[name="recommendation"]').exists()).toBe(true)

    // 实时总分
    const total = wrapper.get('[data-total-score]')
    expect(total.text()).toContain('0 / 100')

    // 匿名论文阅读区只读、不提供下载
    expect(wrapper.text()).toContain('匿名版全文')
    expect(wrapper.findAll('[data-download-anonymous]')).toHaveLength(0)
  })

  it('locks the whole page read-only after the final submission', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountWorkspace(service)

    await fillCompleteForm(wrapper)
    await wrapper.get('[data-action="submit-final-review"]').trigger('click')
    await flushPromises()
    // 二次确认对话框：确认后提交
    const confirm = wrapper.get('[data-action="confirm-submit-review"]')
    expect(confirm.text()).toContain('最终提交')
    await confirm.trigger('click')
    await flushPromises()

    expect((await service.listExpertTasks())[0].status).toBe('SUBMITTED')
    // 整页只读锁定：表单与材料区均不可编辑/不可提交（按钮保留在 DOM 中但被禁用）
    expect(wrapper.get('[data-review-locked="true"]').exists()).toBe(true)
    expect(wrapper.get('textarea[name="overallComment"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[name="topicValue"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-action="save-review-draft"]').attributes('disabled')).toBeDefined()
    // 只读视图下提供申请更正入口
    expect(wrapper.findAll('[data-action="open-correction-dialog"]').length).toBeGreaterThan(0)
  })

  it('double-submit is not possible: locked after the first submission', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountWorkspace(service)

    await fillCompleteForm(wrapper)
    await wrapper.get('[data-action="submit-final-review"]').trigger('click')
    await flushPromises()
    const confirm = wrapper.get('[data-action="confirm-submit-review"]')
    await confirm.trigger('click')
    await flushPromises()

    // 提交后按钮禁用，无法再次发起提交（防重复）
    expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
  })

  it('requests a correction with a mandatory reason and keeps the original view', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('SUBMITTED')
    const { wrapper } = await mountWorkspace(service)

    // 只读视图仍展示已提交内容
    expect(wrapper.get('[data-review-locked="true"]').exists()).toBe(true)
    expect(wrapper.get('textarea[name="overallComment"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-action="open-correction-dialog"]').trigger('click')
    const requestSpy = vi.spyOn(service, 'requestCorrection')
    const confirm = wrapper.get('[data-action="confirm-correction"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(requestSpy).not.toHaveBeenCalled()

    await wrapper.get('textarea[name="correctionReason"]').setValue('总分计算有误')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(requestSpy).toHaveBeenCalledWith(expect.any(String), '总分计算有误')
    // 提交后原版本保留：页面仍为只读
    expect(wrapper.get('[data-review-locked="true"]').exists()).toBe(true)
  })

  it('shows the overdue red warning but still allows saving and submitting', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('OVERDUE')
    const { wrapper } = await mountWorkspace(service)

    expect(wrapper.get('[data-overdue-warning]').text()).toContain('逾期')
    await fillCompleteForm(wrapper)
    expect(wrapper.get('[data-action="save-review-draft"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeUndefined()
  })

  it('shows a completion hint listing the missing fields', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountWorkspace(service)

    // 清空总体评价后：完整性检查提示缺项
    await wrapper.get('textarea[name="overallComment"]').setValue('')
    await flushPromises()
    const hint = wrapper.findAll('[data-completeness]')
    expect(hint.length).toBeGreaterThan(0)
    expect(hint[0].text()).toContain('总体评价')
    // 提交按钮禁用，防止缺项提交
    expect(wrapper.get('[data-action="submit-final-review"]').attributes('disabled')).toBeDefined()
  })

  it('shows the autosave indicator after saving a draft', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountWorkspace(service)

    await fillCompleteForm(wrapper)
    await wrapper.get('[data-action="save-review-draft"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-autosave]').text()).toContain('已自动保存草稿')
  })
})

describe('review form pane (six-dimension template)', () => {
  it('derives the real-time total and per-dimension errors from the template', async () => {
    const wrapper = mount(ReviewFormPane, {
      props: { locked: false },
    })
    expect(wrapper.findAll('[data-dimension]')).toHaveLength(6)

    // 分值输入越界：字段级错误提示（满分约束来自模板数据）
    await wrapper.get('input[name="innovation"]').setValue(26)
    await flushPromises()
    const error = wrapper.findAll('[data-score-error]')
    expect(error.length).toBeGreaterThan(0)
    expect(error[0].text()).toContain('25')

    await wrapper.get('input[name="innovation"]').setValue(21)
    await flushPromises()
    expect(wrapper.findAll('[data-score-error]')).toHaveLength(0)
    // 实时总分随输入更新（模板合计 100）
    expect(wrapper.get('[data-total-score]').text()).toContain('21 / 100')
  })
})
