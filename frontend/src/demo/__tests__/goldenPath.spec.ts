import { describe, expect, it } from 'vitest'
import { createScenarioService } from '../scenarioService'

describe('D0-D7 golden path', () => {
  it('moves from student submission to anonymized published results', async () => {
    const service = createScenarioService()
    await service.loginAs('student'); await service.submitThesis()
    await service.loginAs('school_reviewer'); await service.confirmAnonymization(); await service.confirmDispatch()
    await service.loginAs('platform_reviewer'); await service.assignExperts()
    await service.loginAs('expert'); await service.acceptTask(); await service.submitFinalReview({
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
    expect((await service.getSchoolBills())[0]).toMatchObject({ amount: 300, status: 'CONSUMED' })
    expect((await service.getSchoolAccount()).frozenAmount).toBe(0)
    expect((await service.getExpertAccount()).availableAmount).toBe(300)
    await service.loginAs('school_reviewer'); await service.publishResult()
    await service.loginAs('student')

    const results = await service.listPublishedResults()
    expect(results).toEqual([
      expect.objectContaining({ expertAlias: '专家 A', score: 86, recommendation: '建议通过' }),
    ])
    expect(JSON.stringify(results)).not.toMatch(/周明远|林知远|赵文博|20260042/)
  })
})
