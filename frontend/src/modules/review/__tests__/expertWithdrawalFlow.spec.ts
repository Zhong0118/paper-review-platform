import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { StorageLike } from '@/demo/types'

import ExpertFinancePage from '../pages/ExpertFinancePage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

/** 六维完整评阅输入（与 reviewWorkspaceFlow 一致）：提交后专家账户 +300 入账。 */
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
  service = createScenarioService({ storage: createMemoryStorage(), demoMode: true }),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/expert/finance', component: ExpertFinancePage }],
  })
  await router.push('/expert/finance')
  await router.isReady()
  const wrapper = mount(ExpertFinancePage, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, router, wrapper }
}

function formatAmount(value: number) {
  return `¥ ${value.toFixed(2)}`
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('expert withdrawal service (PAGE-014)', () => {
  it('submits withdrawals within balance and appends ledger only', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 演示装载提供历史入账基准（可提现 ¥ 900.00）。brief 片段在初始服务上调用，
    // 而初始服务按「账户由业务动作投影」为 0（黄金路径依赖）；可提现基准由
    // 演示场景装载注入（计划 Task 10「余额额度」辅助场景的同一数据源）。
    await service.loadExpertScenario('IN_REVIEW')
    const account = await service.getExpertAccount()
    await expect(service.submitWithdrawal(account.availableAmount + 1)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await service.submitWithdrawal(100)
    const ledger = await service.listExpertLedger()
    expect(ledger.at(-1)?.kind).toBe('WITHDRAWAL')
    expect(ledger.filter((l) => l.kind === 'WITHDRAWAL')).toHaveLength(1)
  })

  it('requires a positive amount not exceeding the available balance', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    // 金额必填：0 与非有限值均拒绝（页面必填校验，服务端兜底）
    await expect(service.submitWithdrawal(0)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(service.submitWithdrawal(Number.NaN)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(service.submitWithdrawal(-1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    // 超出可提现余额拒绝
    const account = await service.getExpertAccount()
    await expect(service.submitWithdrawal(account.availableAmount + 1)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    // 全额提现成功：账户可提现归零，冻结金额增加
    await service.submitWithdrawal(account.availableAmount)
    const after = await service.getExpertAccount()
    expect(after.availableAmount).toBe(0)
    expect(after.pendingAmount).toBe(account.availableAmount)
  })

  it('creates a withdrawal request the operations workbench can review', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitWithdrawal(200)
    const withdrawals = await service.listWithdrawals()
    expect(withdrawals.at(-1)).toMatchObject({
      expertId: 'expert-17',
      amount: 200,
      status: 'PENDING',
    })
    expect(withdrawals.at(-1)?.history.at(-1)?.action).toBe('SUBMIT')
    // 运营结算工作台（PAGE-022）审核 → 付款回填：跨角色闭环状态正确
    await service.reviewWithdrawal(withdrawals.at(-1)!.id, 'APPROVE', '余额充足')
    await service.recordWithdrawalPayment(withdrawals.at(-1)!.id, 'SUCCESS', 'V20260812-01')
    expect((await service.listWithdrawals()).at(-1)?.status).toBe('PAID')
  })

  it('is idempotent: a submitted withdrawal cannot be changed by the expert', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitWithdrawal(100)
    // 提交后只能查看状态：已存在待审核申请，任何再次提交（相同或不同金额）都被拒绝
    await expect(service.submitWithdrawal(100)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    await expect(service.submitWithdrawal(50)).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
    const withdrawals = await service.listWithdrawals()
    expect(withdrawals.filter((item) => item.status === 'PENDING')).toHaveLength(1)
    // 服务层不存在撤回/修改本人申请的接口（只读状态，见设计 §5.9）
    expect(service).not.toHaveProperty('cancelWithdrawal')
    expect(service).not.toHaveProperty('updateWithdrawal')
  })

  it('keeps the ledger append-only and credits review income on final submission', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const before = await service.listExpertLedger()
    // 演示装载注入历史入账基准（3 条 REVIEW_CREDIT，见演示流水种子）
    expect(before).toHaveLength(3)
    expect(before.every((entry) => entry.kind === 'REVIEW_CREDIT')).toBe(true)
    await service.submitFinalReview(completeInput)
    // 有效评阅入账：REVIEW_CREDIT +300（Task 6 submitFinalReview 计账），只追加
    const ledger = await service.listExpertLedger()
    expect(ledger.at(-1)).toMatchObject({ kind: 'REVIEW_CREDIT', amount: 300 })
    expect(ledger).toHaveLength(before.length + 1)
    // 同一输入重复提交（防重复）：幂等空操作，不重复入账
    await service.submitFinalReview(completeInput)
    expect(await service.listExpertLedger()).toHaveLength(before.length + 1)
    // 提现后再次入账：新条目追加在末尾，历史条目不被覆盖
    await service.submitWithdrawal(200)
    const finalLedger = await service.listExpertLedger()
    expect(finalLedger.at(-1)?.kind).toBe('WITHDRAWAL')
    expect(finalLedger.at(-1)?.amount).toBe(-200)
    expect(finalLedger[3]?.kind).toBe('REVIEW_CREDIT')
    // 不可变快照：调用方无法覆盖已返回的流水条目
    expect(Object.isFrozen(finalLedger)).toBe(true)
  })

  it('aggregates account totals from the ledger projection', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    // 初始账户为 0（演示加载不含预置流水）：账户由业务动作投影，可提现/冻结均按流水汇总
    const initial = await service.getExpertAccount()
    expect(initial.availableAmount).toBe(0)
    expect(initial.pendingAmount).toBe(0)
    await service.loadExpertScenario('IN_REVIEW')
    const seeded = await service.getExpertAccount()
    expect(seeded.availableAmount).toBe(900)
    expect(seeded.pendingAmount).toBe(0)
    await service.submitFinalReview(completeInput)
    await service.submitWithdrawal(100)
    // +300 入账，-100 冻结：可提现 1100、冻结 100（流水只追加不覆盖）
    const after = await service.getExpertAccount()
    expect(after.availableAmount).toBe(1100)
    expect(after.pendingAmount).toBe(100)
  })

  it('rounds withdrawal amounts to cents at the service boundary', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitWithdrawal(100.009)
    const account = await service.getExpertAccount()
    expect(account.pendingAmount).toBe(100.01)
    const ledger = await service.listExpertLedger()
    expect(ledger.at(-1)).toMatchObject({ kind: 'WITHDRAWAL', amount: -100.01 })
  })

  it('keeps the settlement scenario account consistent through operations review', async () => {
    // 结算演示场景（CORRECTION_PENDING）自带「已提交提现申请」快照：WD-2026-0088
    // 待审核 ¥ 300.00。流水必须含匹配的 WITHDRAWAL 冻结条目（评审修复），
    // 保证「可提现 + 冻结 = 入账合计 − 已付款」恒等，且审核/付款/驳回不会产生负冻结。
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const seeded = await service.getExpertAccount()
    // 冻结在账（不在可提现中）：900 入账 − 300 冻结
    expect(seeded.availableAmount).toBe(600)
    expect(seeded.pendingAmount).toBe(300)
    const ledger = await service.listExpertLedger()
    expect(
      ledger.some(
        (entry) =>
          entry.kind === 'WITHDRAWAL' &&
          entry.withdrawalId === 'WD-2026-0088' &&
          entry.amount === -300,
      ),
    ).toBe(true)

    // 运营审核通过 → 线下付款成功：冻结清零，已付款金额不再回到可提现，全程无负冻结
    await service.reviewWithdrawal('WD-2026-0088', 'APPROVE', '余额充足')
    expect((await service.getExpertAccount()).pendingAmount).toBe(300)
    await service.recordWithdrawalPayment('WD-2026-0088', 'SUCCESS', 'V20260812-99')
    const paid = await service.getExpertAccount()
    expect(paid.pendingAmount).toBe(0)
    expect(paid.availableAmount).toBe(600)

    // 驳回路径：RELEASE 解除冻结并回补可提现（冻结清零、无负值）
    const rejectedService = createScenarioService({
      storage: createMemoryStorage(),
      demoMode: true,
    })
    await rejectedService.loadPlatformScenario('CORRECTION_PENDING')
    await rejectedService.reviewWithdrawal('WD-2026-0088', 'REJECT', '收款信息不完整，请核对后重新申请')
    const rejected = await rejectedService.getExpertAccount()
    expect(rejected.pendingAmount).toBe(0)
    expect(rejected.availableAmount).toBe(900)
  })

  it('never drives frozen amount negative across a failed then successful payment', async () => {
    // 评审修复：付款失败 REVERSAL 已解除冻结并回补可提现，随后重试成功必须从可提现
    // 出账（正数 PAYMENT），否则冻结会被二次扣减为负数。
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    await service.reviewWithdrawal('WD-2026-0088', 'APPROVE', '余额充足')

    await service.recordWithdrawalPayment('WD-2026-0088', 'FAILED', 'V-FAIL-01')
    const afterFailed = await service.getExpertAccount()
    // 冲正：冻结恢复为零，金额回补到可提现（REVERSAL 正数入账）
    expect(afterFailed.pendingAmount).toBe(0)
    expect(afterFailed.availableAmount).toBe(900)

    await service.recordWithdrawalPayment('WD-2026-0088', 'SUCCESS', 'V-OK-01')
    const afterSuccess = await service.getExpertAccount()
    // 成功出账从可提现扣减：600 / 0，任何一步冻结都不为负
    expect(afterSuccess.pendingAmount).toBe(0)
    expect(afterSuccess.availableAmount).toBe(600)
  })

  it('does not leak other experts withdrawals to the expert page', async () => {
    // 平台流水混入其他专家的申请（运营侧新增种子）：专家端不得展示（红线「专家仅访问本人申请」）
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const persisted = JSON.parse(storage.getItem('baijie-demo-platform:v1')!)
    persisted.platform.withdrawals.push({
      id: 'WD-2026-0100',
      expertId: 'expert-31',
      expertName: '宋清和',
      amount: 300,
      status: 'PENDING',
      requestedAt: '2026-08-25 11:00',
      withdrawableBasis: '其他专家入账合计。',
      freezeLedger: '其他专家冻结。',
      bankName: '招商银行',
      maskedAccount: '招商银行（**** **** **** 5678）',
      history: [
        {
          action: 'SUBMIT',
          at: '2026-08-25 11:00',
          note: '其他专家提交提现申请。',
        },
      ],
    })
    storage.setItem('baijie-demo-platform:v1', JSON.stringify(persisted))
    const reloaded = createScenarioService({ storage, demoMode: true })
    const { wrapper } = await mountPage(reloaded)

    // 页面只展示本人申请：其他专家的记录不可见
    expect(wrapper.text()).not.toContain('WD-2026-0100')
    expect(wrapper.text()).not.toContain('宋清和')
    // 幂等守卫按本人过滤：他人待审核申请不阻塞本人提现（评审修复）
    await expect(reloaded.submitWithdrawal(100)).resolves.toMatchObject({
      expertId: 'expert-17',
      status: 'PENDING',
    })
  })
})

describe('expert finance page (PAGE-014)', () => {
  it('shows account summary, ledger and withdrawal records read-only', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitFinalReview(completeInput)
    await service.submitWithdrawal(100)
    const { wrapper } = await mountPage(service)

    // 我的账户：可提现 / 冻结金额（来自流水汇总，只读）
    const available = wrapper.get('[data-account="available"]')
    expect(available.text()).toContain('可提现')
    expect(available.text()).toContain(formatAmount(1100))
    const frozen = wrapper.get('[data-account="frozen"]')
    expect(frozen.text()).toContain('冻结')
    expect(frozen.text()).toContain(formatAmount(100))

    // 费用流水：只读只追加，展示入账条目
    expect(wrapper.text()).toContain('费用流水')
    expect(wrapper.text()).toContain('评阅收入')
    expect(wrapper.text()).toContain(formatAmount(300))

    // 提现记录：申请时间 / 金额 / 状态 / 付款时间 / 备注
    expect(wrapper.text()).toContain('提现记录')
    const record = wrapper.get('[data-withdrawal-record]')
    expect(record.text()).toContain('¥ 100.00')
    expect(record.text()).toContain('待审核')
    // 没有可编辑入口：记录与流水均为只读展示
    expect(wrapper.findAll('input[type="number"]').length).toBeGreaterThan(0)
  })

  it('requires an amount and enforces the available balance before opening confirmation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const { wrapper } = await mountPage(service)

    // 金额必填：空值提交给出校验提示，不打开二次确认
    await wrapper.get('[data-action="submit-withdrawal"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-action="confirm-withdrawal"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('请输入提现金额')

    // 超可提现：字段级报错，二次确认不出现（演示装载基准可提现 ¥ 900.00）
    const input = wrapper.get('[data-field="withdrawal-amount"]')
    await input.setValue('99999')
    await wrapper.get('[data-action="submit-withdrawal"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-action="confirm-withdrawal"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('不能超过可提现余额')

    // 有效金额：打开二次确认对话框
    await input.setValue('100')
    await wrapper.get('[data-action="submit-withdrawal"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-action="confirm-withdrawal"]').exists()).toBe(true)
  })

  it('submits only after the second confirmation and disables duplicate submission', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    const submitSpy = vi.spyOn(service, 'submitWithdrawal')
    const { wrapper } = await mountPage(service)

    await wrapper.get('[data-field="withdrawal-amount"]').setValue('100')
    await wrapper.get('[data-action="submit-withdrawal"]').trigger('click')
    await flushPromises()
    // 确认前不产生任何调用（服务端此时无副作用）
    expect(submitSpy).not.toHaveBeenCalled()

    const confirm = wrapper.get('[data-action="confirm-withdrawal"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()

    expect(submitSpy).toHaveBeenCalledTimes(1)
    expect(submitSpy).toHaveBeenCalledWith(100)
    // 提交成功：对话框关闭、余额联动更新、记录出现且状态只读
    expect(wrapper.findAll('[data-action="confirm-withdrawal"]').length).toBe(0)
    expect(wrapper.get('[data-account="available"]').text()).toContain(formatAmount(800))
    expect(wrapper.get('[data-account="frozen"]').text()).toContain(formatAmount(100))
    expect(wrapper.get('[data-withdrawal-record]').text()).toContain('待审核')
  })

  it('shows the public reason when a withdrawal is rejected by operations', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitWithdrawal(100)
    // 运营结算处理驳回（PAGE-022）：驳回原因对专家公开，并解除冻结
    const withdrawal = (await service.listWithdrawals()).at(-1)!
    await service.reviewWithdrawal(withdrawal.id, 'REJECT', '收款信息不完整，请核对后重新申请')
    const { wrapper } = await mountPage(service)

    expect(wrapper.get('[data-withdrawal-record]').text()).toContain('已驳回')
    expect(wrapper.text()).toContain('收款信息不完整，请核对后重新申请')
    // 驳回解除冻结：可提现余额恢复（¥ 900.00），冻结归零
    expect(wrapper.get('[data-account="available"]').text()).toContain(formatAmount(900))
    expect(wrapper.get('[data-account="frozen"]').text()).toContain(formatAmount(0))
  })

  it('shows paid time and voucher note once payment is recorded', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadExpertScenario('IN_REVIEW')
    await service.submitWithdrawal(100)
    const withdrawal = (await service.listWithdrawals()).at(-1)!
    await service.reviewWithdrawal(withdrawal.id, 'APPROVE', '余额充足')
    await service.recordWithdrawalPayment(withdrawal.id, 'SUCCESS', 'V20260812-01')
    const { wrapper } = await mountPage(service)

    const record = wrapper.get('[data-withdrawal-record]')
    expect(record.text()).toContain('已付款')
    // 付款时间与凭证备注（演示文案，不宣称真实支付）
    expect(record.text()).toContain('2026-08-26 11:00')
    expect(wrapper.text()).toContain('V20260812-01')
  })

  it('shows only own account data: no school quota and no other expert income', async () => {
    const { wrapper } = await mountPage()
    expect(wrapper.text()).toContain('可提现')
    expect(wrapper.text()).not.toContain('学校可用额度')
    expect(wrapper.text()).not.toMatch(/顾远航|宋清和|陈知微/)
    // 演示边界文案：不宣称真实支付已完成
    expect(wrapper.text()).toContain('演示')
    expect(wrapper.text()).not.toContain('支付成功')
  })
})
