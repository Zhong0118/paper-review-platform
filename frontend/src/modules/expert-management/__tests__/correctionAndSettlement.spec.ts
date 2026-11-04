import '@/__tests__/demoMode'
import { createPinia } from 'pinia'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { CorrectionRequest, StorageLike, WithdrawalRequest } from '@/demo/types'

import CorrectionApprovalPage from '../pages/CorrectionApprovalPage.vue'
import SettlementWorkbenchPage from '../../finance/pages/SettlementWorkbenchPage.vue'

enableAutoUnmount(afterEach)

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

/** 完整评阅输入（与专家端六维模板一致，合计 100 分）。 */
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

async function mountPage(
  component: typeof CorrectionApprovalPage | typeof SettlementWorkbenchPage,
  service = createScenarioService({ demoMode: true }),
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component }],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(component, {
    global: {
      plugins: [createPinia(), router],
      provide: { [scenarioServiceKey as symbol]: service },
    },
  })
  await flushPromises()
  return { service, wrapper }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('correction approval and settlement service', () => {
  it('approves corrections into a new version and settles withdrawals', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const requests = await service.listCorrectionRequests()
    expect(requests.length).toBeGreaterThan(0)
    await service.decideCorrection(requests[0].id, 'APPROVED', '差异属实')
    expect((await service.listCorrectionRequests())[0].status).toBe('APPROVED')

    const withdrawals = await service.listWithdrawals()
    expect(withdrawals.length).toBeGreaterThan(0)
    await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')
    await service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-01')
    expect((await service.listWithdrawals())[0].status).toBe('PAID')
  })

  it('requires a reason when rejecting a correction request', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const requests = await service.listCorrectionRequests()

    await expect(service.decideCorrection(requests[0].id, 'REJECTED', '  ')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    expect((await service.listCorrectionRequests())[0].status).toBe('PENDING')
  })

  it('keeps the old review version read-only and links a new version after approval', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const requests = await service.listCorrectionRequests()

    const approved = await service.decideCorrection(requests[0].id, 'APPROVED', '差异属实')

    // 新版本生成：版本号升级并保留旧版本链接
    expect(approved.newVersionId).toBeDefined()
    expect(approved.version).toMatch(/^R[1-9][0-9]*$/)
    expect(approved.oldVersionId).toBeDefined()

    // 旧评阅版本只读保留且存在版本关系（版本链记录新版本编号）
    const versions = await service.listReviewVersions(requests[0].taskId)
    expect(versions.length).toBeGreaterThanOrEqual(2)
    const [newest, oldest] = versions
    expect(newest.readonly).toBe(true)
    expect(oldest.readonly).toBe(true)
    expect(oldest.nextVersionId).toBe(newest.id)
  })

  it('warns about impact scope when the original result was already published', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('COMPLETED')
    await service.submitFinalReview(completeInput)
    await service.requestCorrection(
      (await service.listExpertTasks())[0].id,
      '总分计算有误，请复核',
    )
    const requests = await service.listCorrectionRequests()
    expect(requests[0].impactWarning).toBeDefined()

    // 演示文案声明影响范围：已发布结果不会自动回滚，需人工同步通知学校与学生
    expect(requests[0].impactWarning).toContain('已发布')
  })

  it('rejects a decision on an already decided correction request', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const requests = await service.listCorrectionRequests()

    await service.decideCorrection(requests[0].id, 'REJECTED', '理由不充分')
    await expect(
      service.decideCorrection(requests[0].id, 'APPROVED', '再次审核'),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('requires a reason when rejecting a withdrawal', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()
    expect(withdrawals.length).toBeGreaterThan(0)

    await expect(service.reviewWithdrawal(withdrawals[0].id, 'REJECT', ' ')).rejects.toMatchObject({
      name: 'PlatformOperationError',
      code: 'INVALID_INPUT',
    })
    expect((await service.listWithdrawals())[0].status).toBe('PENDING')
  })

  it('rejects a withdrawal and unfreezes the expert balance', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()

    await service.reviewWithdrawal(withdrawals[0].id, 'REJECT', '收款信息需重新核验')

    const after = await service.listWithdrawals()
    expect(after[0]).toMatchObject({ status: 'REJECTED', reason: '收款信息需重新核验' })
    // 驳回解除冻结：处理历史追加「解除冻结」记录（演示投影，不模拟真实资金划转）
    expect(after[0].history.at(-1)).toMatchObject({ action: 'REJECT' })
    expect(after[0].history.at(-1)?.note).toContain('解除冻结')
    const audit = await service.listPlatformAuditLog()
    expect(audit.some((entry) => entry.action === 'WITHDRAWAL_REVIEWED')).toBe(true)
  })

  it('records a payment once and keeps later calls idempotent', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()
    await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')

    await service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-01')
    const first = (await service.listWithdrawals())[0]
    expect(first.status).toBe('PAID')

    // 重复回填：幂等，不重复计账，不覆盖原凭证
    const duplicate = await service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-02')
    expect(duplicate).toMatchObject({ status: 'PAID', voucherNo: 'V20260812-01' })
    expect((await service.listWithdrawals())[0]).toMatchObject({
      status: 'PAID',
      voucherNo: 'V20260812-01',
    })
  })

  it('keeps a withdrawal in REVIEWING with a note when offline payment fails', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()
    await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')

    await service.recordWithdrawalPayment(withdrawals[0].id, 'FAILED', 'V20260812-09')

    const after = (await service.listWithdrawals())[0]
    expect(after.status).toBe('REVIEWING')
    expect(after.paymentNote).toBeDefined()
  })

  it('rejects payment recording before the review approval', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()

    await expect(
      service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-01'),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
  })

  it('rejects payment recording with a missing voucher number', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()
    await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')

    await expect(
      service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', '  '),
    ).rejects.toMatchObject({ name: 'PlatformOperationError', code: 'INVALID_INPUT' })
  })

  it('keeps correction requests and withdrawals across service reconstruction', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const requests = await service.listCorrectionRequests()
    const withdrawals = await service.listWithdrawals()
    await service.decideCorrection(requests[0].id, 'APPROVED', '差异属实')
    await service.reviewWithdrawal(withdrawals[0].id, 'APPROVE', '余额充足')
    await service.recordWithdrawalPayment(withdrawals[0].id, 'SUCCESS', 'V20260812-01')

    // 重新构造（模拟刷新页面）：同一 storage 读回持久化状态
    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.listCorrectionRequests())[0]).toMatchObject({
      id: requests[0].id,
      status: 'APPROVED',
      decisionReason: '差异属实',
    })
    expect((await restored.listWithdrawals())[0]).toMatchObject({
      status: 'PAID',
      voucherNo: 'V20260812-01',
    })
  })

  it('masks the withdrawal payment details by default', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const withdrawals = await service.listWithdrawals()

    // 收款信息默认脱敏：不出现完整银行卡号
    const text = JSON.stringify(withdrawals[0])
    expect(text).not.toContain('622202')
    expect(withdrawals[0].bankName).toBeDefined()
    expect(withdrawals[0].maskedAccount).toContain('*')
    expect(withdrawals[0].maskedAccount).not.toContain('622202')
  })
})

describe('correction approval page interactions', () => {
  it('lists correction requests with required columns and a reason filter', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const { wrapper } = await mountPage(CorrectionApprovalPage, service)

    expect(wrapper.findAll('[data-correction-request]').length).toBeGreaterThan(0)
    const row = wrapper.get('[data-correction-request]')
    expect(row.text()).toContain('COR')
    expect(row.text()).toContain('宋清和')
    expect(row.text()).toContain('HY-')
    expect(row.text()).toContain('待审批')
    expect(wrapper.get('[data-filter="correction-status"]').exists()).toBe(true)
  })

  it('requires a review opinion before a rejection can be confirmed', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const decideSpy = vi.spyOn(service, 'decideCorrection')
    const { wrapper } = await mountPage(CorrectionApprovalPage, service)

    await wrapper.get('[data-correction-request] [data-action="open-correction-detail"]').trigger('click')
    await wrapper.get('[data-action="reject-correction"]').trigger('click')

    const confirm = wrapper.get('[data-action="confirm-correction-reject"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    expect(decideSpy).not.toHaveBeenCalled()

    await wrapper.get('textarea[name="correctionOpinion"]').setValue('证据不足')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(decideSpy).toHaveBeenCalledWith(expect.any(String), 'REJECTED', '证据不足')
  })

  it('approves a correction with a second confirmation and a mandatory opinion', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const decideSpy = vi.spyOn(service, 'decideCorrection')
    const { wrapper } = await mountPage(CorrectionApprovalPage, service)

    await wrapper.get('[data-correction-request] [data-action="open-correction-detail"]').trigger('click')
    await wrapper.get('[data-action="approve-correction"]').trigger('click')

    // 二次确认：先出现确认对话框，未填写审核意见时确认按钮禁用
    const confirm = wrapper.get('[data-action="confirm-correction-approve"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="correctionOpinion"]').setValue('差异属实')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(decideSpy).toHaveBeenCalledWith(expect.any(String), 'APPROVED', '差异属实')
    // 反馈条声明已生成新版本
    const feedback = wrapper.findAll('[role="status"]').map((node) => node.text()).join('')
    expect(feedback).toContain('生成新版本')
  })

  it('shows a published-result impact warning before the final confirmation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('COMPLETED')
    await service.submitFinalReview(completeInput)
    await service.requestCorrection((await service.listExpertTasks())[0].id, '总分计算有误')
    const { wrapper } = await mountPage(CorrectionApprovalPage, service)

    await wrapper.get('[data-correction-request] [data-action="open-correction-detail"]').trigger('click')
    await wrapper.get('[data-action="approve-correction"]').trigger('click')

    // 影响范围提示出现在确认对话框内（演示文案，不宣称自动回滚）
    expect(wrapper.get('[data-impact-warning]').text()).toContain('已发布')
  })

  it('shows the read-only original review diff inside the detail panel', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const { wrapper } = await mountPage(CorrectionApprovalPage, service)

    await wrapper.get('[data-correction-request] [data-action="open-correction-detail"]').trigger('click')

    expect(wrapper.get('[data-correction-detail]').exists()).toBe(true)
    const detail = wrapper.get('[data-correction-detail]')
    expect(detail.text()).toContain('更正原因')
    expect(detail.text()).toContain('拟更正差异')
    expect(detail.text()).toContain('证据')
    // 原版本只读展示，不提供编辑入口
    expect(detail.findAll('[data-version-edit]')).toHaveLength(0)
  })
})

describe('settlement workbench page interactions', () => {
  it('lists withdrawals with required columns and status filter', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    expect(wrapper.findAll('[data-withdrawal-row]').length).toBeGreaterThan(0)
    const row = wrapper.get('[data-withdrawal-row]')
    expect(row.text()).toContain('WD-')
    expect(row.text()).toContain('周明远')
    expect(row.text()).toContain('¥')
    expect(row.text()).toContain('待审核')
    expect(wrapper.get('[data-filter="withdrawal-status"]').exists()).toBe(true)
  })

  it('approves a withdrawal into REVIEWING with second confirmation', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const reviewSpy = vi.spyOn(service, 'reviewWithdrawal')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    await wrapper.get('[data-withdrawal-row] [data-action="open-withdrawal-detail"]').trigger('click')
    await wrapper.get('[data-action="approve-withdrawal"]').trigger('click')

    // 二次确认：确认按钮先禁用，填写审核意见后可确认
    const confirm = wrapper.get('[data-action="confirm-withdrawal-approve"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="withdrawalOpinion"]').setValue('余额充足')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(reviewSpy).toHaveBeenCalledWith(expect.any(String), 'APPROVE', '余额充足')
  })

  it('rejects a withdrawal with a mandatory reason and unfreezes the balance', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const reviewSpy = vi.spyOn(service, 'reviewWithdrawal')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    await wrapper.get('[data-withdrawal-row] [data-action="open-withdrawal-detail"]').trigger('click')
    await wrapper.get('[data-action="reject-withdrawal"]').trigger('click')

    const confirm = wrapper.get('[data-action="confirm-withdrawal-reject"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('textarea[name="withdrawalOpinion"]').setValue('收款信息需重新核验')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(reviewSpy).toHaveBeenCalledWith(expect.any(String), 'REJECT', '收款信息需重新核验')
    // 反馈条声明解除冻结（演示投影，不模拟真实资金划转）
    const feedback = wrapper.findAll('[role="status"]').map((node) => node.text()).join('')
    expect(feedback).toContain('解除冻结')
  })

  it('fills back a successful offline payment with voucher and idempotent guard', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const recordSpy = vi.spyOn(service, 'recordWithdrawalPayment')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    await wrapper.get('[data-withdrawal-row] [data-action="open-withdrawal-detail"]').trigger('click')
    await wrapper.get('[data-action="approve-withdrawal"]').trigger('click')
    await wrapper.get('textarea[name="withdrawalOpinion"]').setValue('余额充足')
    await wrapper.get('[data-action="confirm-withdrawal-approve"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-action="fill-payment"]').trigger('click')
    const confirm = wrapper.get('[data-action="confirm-payment-success"]')
    // 二次确认：凭证号必填
    expect(confirm.attributes('disabled')).toBeDefined()
    await wrapper.get('input[name="voucherNo"]').setValue('V20260812-01')
    expect(confirm.attributes('disabled')).toBeUndefined()

    await confirm.trigger('click')
    await flushPromises()
    expect(recordSpy).toHaveBeenCalledWith(expect.any(String), 'SUCCESS', 'V20260812-01')
    expect(wrapper.text()).toContain('已回填付款结果')
  })

  it('masks the withdrawal payment details unless re-authenticated', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    await wrapper.get('[data-withdrawal-row] [data-action="open-withdrawal-detail"]').trigger('click')

    // 默认脱敏：不出现完整银行卡号，仅展示尾号
    expect(wrapper.get('[data-masked-account]').text()).toContain('*')
    // 完整查看需重认证 + 审计：点击后出现确认提示（演示，不展示真实卡号）
    await wrapper.get('[data-action="reveal-account"]').trigger('click')
    const revealConfirm = wrapper.get('[data-reveal-confirm]')
    expect(revealConfirm.exists()).toBe(true)
    expect(revealConfirm.text()).toContain('重新认证')
  })

  it('keeps a failed offline payment in REVIEWING with a note', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    const recordSpy = vi.spyOn(service, 'recordWithdrawalPayment')
    const { wrapper } = await mountPage(SettlementWorkbenchPage, service)

    await wrapper.get('[data-withdrawal-row] [data-action="open-withdrawal-detail"]').trigger('click')
    await wrapper.get('[data-action="approve-withdrawal"]').trigger('click')
    await wrapper.get('textarea[name="withdrawalOpinion"]').setValue('余额充足')
    await wrapper.get('[data-action="confirm-withdrawal-approve"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-action="fill-payment"]').trigger('click')
    await wrapper.get('input[name="voucherNo"]').setValue('V20260812-09')
    await wrapper.get('[data-action="confirm-payment-failed"]').trigger('click')
    await flushPromises()
    expect(recordSpy).toHaveBeenCalledWith(expect.any(String), 'FAILED', 'V20260812-09')
    expect(wrapper.text()).toContain('保持待付款')
  })
})
