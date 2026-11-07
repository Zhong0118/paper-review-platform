import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import ExpertFinancePage from '../pages/ExpertFinancePage.vue'
import ExpertProfilePage from '../pages/ExpertProfilePage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

/** 六维完整评阅输入（与专家端六维模板一致，合计 100 分）：提交后专家账户 +300 入账。 */
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

const formatAmount = (value: number) => `¥ ${value.toFixed(2)}`

async function mountPage(
  component: typeof ExpertFinancePage | typeof ExpertProfilePage,
  service = createScenarioService({ storage: createMemoryStorage(), demoMode: true }),
) {
  const path = component === ExpertFinancePage ? '/expert/finance' : '/expert/profile'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path, component }],
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
  return { service, router, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('expert account and profile', () => {
  it('shows review income and withdrawals without school quota', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 演示装载注入历史入账基准（3 笔评阅收入，可提现 ¥ 900.00）；有效评阅再入账 +300。
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitFinalReview(completeInput)
    const { wrapper } = await mountPage(ExpertFinancePage, service)

    // 账户摘要：可提现 / 冻结来自费用流水汇总（只读，页面格式化两位小数）
    expect(wrapper.get('[data-account="available"]').text()).toContain('可提现余额')
    expect(wrapper.get('[data-account="available"]').text()).toContain(formatAmount(1200))
    expect(wrapper.get('[data-account="frozen"]').text()).toContain('冻结金额')

    // 费用流水：评阅收入入账 +300 只追加展示；提现记录可见（本次流水未提交提现 → 空态）
    expect(wrapper.text()).toContain('评阅收入')
    expect(wrapper.findAll('[data-ledger-row]').length).toBe(4)
    expect(wrapper.text()).toContain('暂无提现记录')

    // 红线：专家端不展示送审学校的账户额度（学校账户与专家账户隔离；
    // BlindRail 文案仅声明隔离范围，不出现学校额度标签，也不出现其他专家身份）
    expect(wrapper.text()).not.toContain('学校可用额度')
    expect(wrapper.text()).not.toMatch(/顾远航|宋清和|陈知微/)
  })

  it('shows only the current expert profile and qualification', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const { wrapper } = await mountPage(ExpertProfilePage, service)

    // 本人档案：姓名只读展示，资格状态标签来自服务投影（初始为「审核中」）
    const nameField = wrapper.get('[data-field="name"]')
    expect((nameField.element as HTMLInputElement).value).toBe('周明远')
    expect(wrapper.get('[data-qualification-status]').text()).toContain('资格审核中')
    expect(wrapper.get('[data-qualification-status]').attributes('data-qualification-status')).toBe(
      'REVIEWING',
    )
    // 学科专业来自受控目录投影（0812 计算机科学与技术）
    expect(wrapper.text()).toContain('0812')
    expect(wrapper.text()).toContain('计算机科学与技术')

    // 红线：只展示本人档案，不暴露其他专家身份与学校侧信息
    expect(wrapper.text()).not.toMatch(/顾远航|宋清和|陈知微|海岳大学/)
  })
})
