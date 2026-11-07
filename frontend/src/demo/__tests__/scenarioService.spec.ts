import { describe, expect, it } from 'vitest'

import { createScenarioService } from '../scenarioService'
import { createScenarioServiceProvider } from '../serviceProvider'

describe('demo scenario service', () => {
  it('keeps thesis, task, and school billing states in separate lifecycles', async () => {
    const service = createScenarioService()

    await service.loginAs('student')
    expect((await service.submitThesis()).thesis.stage).toBe('SUBMITTED')

    await service.loginAs('school_reviewer')
    expect((await service.confirmAnonymization()).thesis.stage).toBe('READY_FOR_DISPATCH')
    const confirmed = await service.confirmDispatch()
    expect(confirmed.thesis.stage).toBe('READY_FOR_DISPATCH')
    expect((await service.getSchoolAccount()).frozenAmount).toBe(300)
    expect((await service.getSchoolBills())[0]).toMatchObject({
      anonymousId: 'HY-2026-0042',
      amount: 300,
      status: 'FROZEN',
    })

    await service.loginAs('platform_reviewer')
    const assigned = await service.assignExperts()
    expect(assigned.thesis.stage).toBe('UNDER_REVIEW')
    expect((await service.listExpertTasks())[0]).toMatchObject({ status: 'INVITED', fee: 300 })

    await service.loginAs('expert')
    await service.acceptTask()
    const reviewed = await service.submitFinalReview({
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
    })
    expect(reviewed.thesis.stage).toBe('RESULT_PROCESSING')
    expect(reviewed.review?.score).toBe(86)
    expect((await service.getSchoolBills())[0].status).toBe('CONSUMED')
    expect((await service.getSchoolAccount()).frozenAmount).toBe(0)

    await service.loginAs('school_reviewer')
    expect((await service.publishResult()).thesis.stage).toBe('COMPLETED')
    expect(await service.listPublishedResults()).toHaveLength(1)
  })

  it('moves one thesis through the golden review path', async () => {
    const service = createScenarioService()

    expect((await service.loginAs('student')).thesis.stage).toBe('DRAFT')
    expect((await service.submitThesis()).thesis.stage).toBe('SUBMITTED')
    await service.loginAs('school_reviewer')
    expect((await service.confirmAnonymization()).thesis.stage).toBe('READY_FOR_DISPATCH')
    expect((await service.confirmDispatch()).thesis.stage).toBe('READY_FOR_DISPATCH')
    await service.loginAs('platform_reviewer')
    expect((await service.assignExperts()).thesis.taskStatus).toBe('INVITED')
    await service.loginAs('expert')
    expect((await service.acceptTask()).thesis.taskStatus).toBe('IN_REVIEW')
    expect((await service.saveReviewDraft()).review?.draftSaved).toBe(true)
    expect(
      (
        await service.submitFinalReview({
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
        })
      ).thesis.stage
    ).toBe('RESULT_PROCESSING')
    await service.loginAs('school_reviewer')
    expect((await service.publishResult()).thesis.stage).toBe('COMPLETED')
  })

  it('projects identity fields according to the active role', async () => {
    const service = createScenarioService()

    const schoolView = await service.loginAs('school_reviewer')
    expect(schoolView.thesis.studentName).toBe('林知远')
    expect(JSON.stringify(schoolView)).not.toContain('周明远')

    const expertView = await service.loginAs('expert')
    expect(expertView.context.displayName).toBe('周明远教授')
    expect(expertView.thesis.studentName).toBeUndefined()
    expect(JSON.stringify(expertView)).not.toContain('林知远')
  })

  it('returns immutable snapshots so pages cannot alter scenario state', async () => {
    const service = createScenarioService()
    const before = await service.loginAs('student')

    expect(() => {
      before.thesis.title = '被页面篡改的标题'
    }).toThrow()

    const after = await service.loginAs('student')
    expect(after.thesis.title).toBe('面向复杂场景的多模态知识推理研究')
  })

  it('never falls back to demo data when demo mode is disabled', async () => {
    const service = createScenarioServiceProvider(false)

    await expect(service.loginAs('student')).rejects.toThrow('真实服务尚未配置')
  })

  it('lets school submit for a student without a second confirmation', async () => {
    const service = createScenarioService()

    const created = await service.submitThesisAsSchool({
      studentId: '20260042',
      batchId: 'batch-2026-spring',
      title: '学校代传的可信计算研究',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['可信计算', '知识图谱'],
      originalFileName: '20260042.pdf',
      anonymousFileName: 'HY-2026-0043.pdf',
    })

    expect(created.stage).toBe('SUBMITTED')
    expect(created.submissionSource).toBe('SCHOOL_MANUAL')
    expect((await service.listStudentTheses()).map((item) => item.id)).toContain(created.id)
  })

  it('keeps expert identity out of school lists and returns all batch validation states', async () => {
    const service = createScenarioService()

    expect(JSON.stringify(await service.listSchoolTheses())).not.toContain('周明远')
    expect((await service.previewBatchImport()).map((row) => row.validationStatus)).toEqual([
      'VALID',
      'DUPLICATE',
      'UNKNOWN_DISCIPLINE',
      'MISSING_FILE',
    ])
  })
})
