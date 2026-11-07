import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import type { StorageLike } from '@/demo/types'

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

/** 完整六维评阅输入（与专家端六维模板一致，合计 100 分，见设计 §4.4）。 */
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

/**
 * 黄金路径起点（运营端 PAGE-006 工作流）：专家端演示人格（expert-17 周明远）
 * 初始资格为「审核中」（PAGE-021 演示状态），运营先完成资格审核通过，
 * 使其进入候选列表（buildCandidates 仅含 APPROVED 专家）后才可派单。
 */
async function approvePersonaQualification(service: ReturnType<typeof createScenarioService>) {
  await service.reviewExpertQualification('expert-17', 'APPROVED', '材料齐全')
  const matches = await service.listExpertMatches('thesis-main')
  const persona = matches.find((m) => m.id === 'expert-17')
  expect(persona).toBeDefined()
  expect(persona?.selectable).toBe(true)
  return persona!
}

describe('platform and expert interactive golden path', () => {
  it('persists the complete platform dispatch to expert review path', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const persona = await approvePersonaQualification(service)
    await service.assignExpertToThesis('thesis-main', persona.id)
    const tasks = await service.listExpertTasks()
    expect(tasks.find((t) => t.thesisId === 'thesis-main')?.status).toBe('INVITED')

    await service.acceptExpertTask(tasks.find((t) => t.thesisId === 'thesis-main')!.id)
    await service.submitFinalReview(completeInput)
    expect((await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')?.status).toBe(
      'SUBMITTED',
    )

    const restored = createScenarioService({ storage, demoMode: true })
    expect(
      (await restored.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')?.status,
    ).toBe('SUBMITTED')
  })

  it('persists the correction, approval and withdrawal path across service recreation', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    // 运营派单 → 专家接受 → 六维评阅 → 最终提交
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const persona = await approvePersonaQualification(service)
    await service.assignExpertToThesis('thesis-main', persona.id)
    const task = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')!
    await service.acceptExpertTask(task.id)
    await service.submitFinalReview(completeInput)
    expect((await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')?.status).toBe(
      'SUBMITTED',
    )

    // 专家申请更正（提交后只读视图入口；原因必填）
    await service.requestCorrection(task.id, '研究方法维度评分需要更正')
    const requests = await service.listCorrectionRequests()
    expect(requests.at(-1)?.status).toBe('PENDING')

    // 平台批准更正：生成新版本 R2，旧版本 R1 只读保留并建立版本关系
    const approved = await service.decideCorrection(requests.at(-1)!.id, 'APPROVED', '差异属实')
    expect(approved.status).toBe('APPROVED')
    const versions = await service.listReviewVersions(task.id)
    expect(versions.map((version) => version.version)).toEqual(['R2', 'R1'])
    expect(versions[1]).toMatchObject({ version: 'R1', status: 'SUPERSEDED', readonly: true })
    expect(versions[0]).toMatchObject({ version: 'R2', status: 'CURRENT', readonly: true })

    // 专家提交提现申请（金额 ≤ 可提现；可提现 = 场景装载流水种子 + 最终提交入账 ¥ 300）
    const account = await service.getExpertAccount()
    expect(account.availableAmount).toBeGreaterThanOrEqual(300)
    const withdrawal = await service.submitWithdrawal(300)
    expect(withdrawal).toMatchObject({ status: 'PENDING', amount: 300 })

    // 平台审核通过 → 线下付款回填（凭证号必填，幂等防重复）
    await service.reviewWithdrawal(withdrawal.id, 'APPROVE', '余额充足')
    const paid = await service.recordWithdrawalPayment(withdrawal.id, 'SUCCESS', 'V20260812-01')
    expect(paid.status).toBe('PAID')
    // 幂等：已付款申请重复回填不重复计账，原凭证号保留
    await service.recordWithdrawalPayment(withdrawal.id, 'SUCCESS', 'V20260812-02')
    expect((await service.listWithdrawals()).find((item) => item.id === withdrawal.id)).toMatchObject(
      { status: 'PAID', voucherNo: 'V20260812-01' },
    )

    // 重新构造（模拟刷新页面）：同一 storage 读回全链路持久化状态
    const restored = createScenarioService({ storage, demoMode: true })
    const restoredTask = (await restored.listExpertTasks()).find(
      (t) => t.thesisId === 'thesis-main',
    )!
    expect(restoredTask.status).toBe('SUBMITTED')
    const restoredRequests = await restored.listCorrectionRequests()
    expect(restoredRequests.at(-1)).toMatchObject({ status: 'APPROVED', decisionReason: '差异属实' })
    expect(await restored.listReviewVersions(restoredTask.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 'R2', status: 'CURRENT' }),
        expect.objectContaining({ version: 'R1', status: 'SUPERSEDED' }),
      ]),
    )
    expect(
      (await restored.listWithdrawals()).find((item) => item.id === withdrawal.id),
    ).toMatchObject({ status: 'PAID', voucherNo: 'V20260812-01' })
    // 流水只追加：种子 3 笔 + 最终提交入账 + 提现冻结 + 付款出账共 6 笔；
    // 重复提交/重复回填均被幂等拦截，不追加新条目。
    expect((await restored.listExpertLedger()).length).toBe(6)
  })

  it('keeps the platform assignment visible across roles and recreation', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const persona = await approvePersonaQualification(service)
    await service.assignExpertToThesis('thesis-main', persona.id)
    const invited = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')!

    // 专家视角（本人任务投影）能看到同一条邀请；接受后仅本人任务推进
    await service.acceptExpertTask(invited.id)
    expect((await service.listExpertTasks({ own: true })).find((t) => t.id === invited.id)?.status).toBe(
      'IN_REVIEW',
    )

    // 平台队列派生同步：评阅中队列计数来自任务状态（状态派生而非静态计数）
    const queues = await service.listOperationsQueues()
    expect(queues.IN_REVIEW).toBeGreaterThan(0)

    // 重新构造：指派与接单状态跨刷新持久化
    const restored = createScenarioService({ storage, demoMode: true })
    const restoredTask = (await restored.listExpertTasks()).find((t) => t.id === invited.id)!
    expect(restoredTask).toMatchObject({ status: 'IN_REVIEW', expertId: persona.id })
  })

  it('rejects invalid steps with service-level guards on the golden path', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const persona = await approvePersonaQualification(service)
    await service.assignExpertToThesis('thesis-main', persona.id)
    // 已有在评任务时重复指派：版本冲突，不静默覆盖
    await expect(service.assignExpertToThesis('thesis-main', persona.id)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
    })

    // 提交前完整性检查：缺项/越界字段级报错，不产生状态写入
    await expect(
      service.submitFinalReview({ ...completeInput, overallComment: '' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    // 更正审批驳回必须带审核意见
    const task = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')!
    await service.acceptExpertTask(task.id)
    await service.submitFinalReview(completeInput)
    await service.requestCorrection(task.id, '研究方法维度评分需要更正')
    const request = (await service.listCorrectionRequests()).at(-1)!
    await expect(service.decideCorrection(request.id, 'REJECTED', ' ')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })

    // 提现金额不能超过可提现余额
    await expect(service.submitWithdrawal(9999)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('clears stale review drafts when loading a platform scenario', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    // 专家视角保存草稿（评阅投影仅 expert 角色可见）
    await service.loginAs('expert')
    await service.saveReviewDraft(completeInput)
    expect((await service.getSnapshot()).review?.scoreInput).toBeDefined()

    // 运营端装载场景：与专家端装载对称地清除评阅草稿/结果投影，
    // 陈旧草稿不得跨场景复活（Task 11 对称修复）。
    await service.loadPlatformScenario('PENDING_DISPATCH', { ensureRole: true })
    const snapshot = await service.getSnapshot()
    expect(snapshot.review?.draftSaved).toBe(false)
    expect(snapshot.review?.scoreInput).toBeUndefined()
    // 角色视角已对齐运营端
    expect(snapshot.context.role).toBe('platform_reviewer')

    // 重新构造（模拟刷新，同一 storage）：清除结果持久化，不会在刷新后复活
    const restored = createScenarioService({ storage, demoMode: true })
    const restoredSnapshot = await restored.getSnapshot()
    expect(restoredSnapshot.review?.draftSaved).toBe(false)
    expect(restoredSnapshot.review?.scoreInput).toBeUndefined()
  })

  it('submits after loading a settlement snapshot without stale result locks', async () => {
    // 浏览器复现回归（Task 11）：先装载结算演示场景（快照只写平台投影、不写学生端
    // 结果状态），再走 PENDING_DISPATCH → 派单 → 接单 → 终审提交的完整链路。
    // 旧实现下 CORRECTION_PENDING 装载遗留的快照 taskStatus=SUBMITTED 命中
    // submitFinalReview 的幂等早退守卫，平台任务停留在 IN_REVIEW、页面不锁定。
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.loadPlatformScenario('CORRECTION_PENDING')
    await service.loadPlatformScenario('PENDING_DISPATCH')
    const persona = await approvePersonaQualification(service)
    await service.assignExpertToThesis('thesis-main', persona.id)
    const task = (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')!
    await service.acceptExpertTask(task.id)
    await service.submitFinalReview(completeInput)

    // 平台任务真实进入 SUBMITTED（与工作台锁定、任务列表「已提交」一致）
    expect(
      (await service.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')?.status,
    ).toBe('SUBMITTED')
    // 学生端快照不再残留结果锁：结果状态由平台任务派生，跨场景装载可重复闭环
    expect((await service.getSnapshot()).thesis.taskStatus).toBe('SUBMITTED')
    // 评阅投影按角色可见（expert 视角）：终审已提交
    await service.loginAs('expert')
    expect((await service.getSnapshot()).review?.submitted).toBe(true)

    // 重新构造（模拟刷新）：平台任务与版本在服务重建后仍可读
    const restored = createScenarioService({ storage, demoMode: true })
    expect(
      (await restored.listExpertTasks()).find((t) => t.thesisId === 'thesis-main')?.status,
    ).toBe('SUBMITTED')
  })
})
