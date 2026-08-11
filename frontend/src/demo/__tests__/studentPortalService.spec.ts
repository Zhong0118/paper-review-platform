import { describe, expect, it } from 'vitest'

import { createScenarioService } from '../scenarioService'

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('student portal service', () => {
  it('allows only legal student actions and keeps related projections in sync', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const draft = await service.getStudentThesis('thesis-main')
    expect(draft.allowedActions).toContain('EDIT_THESIS')

    await service.submitStudentThesis('thesis-main')
    const submitted = await service.getStudentThesis('thesis-main')
    expect(submitted.stage).toBe('SUBMITTED')
    expect(submitted.allowedActions).toContain('WITHDRAW_BEFORE_DISPATCH')
    expect((await service.listStudentNotifications())[0].kind).toBe('THESIS_SUBMITTED')

    await service.withdrawStudentThesis('thesis-main', '修改匿名版文件')
    expect((await service.getStudentThesis('thesis-main')).stage).toBe('DRAFT')
  })

  it('does not give school-submitted records an edit action', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    const theses = await service.listStudentTheses()
    expect(theses[0].studentVisibleStage).toBe('MATERIALS')
    const schoolRecord = theses.find((thesis) => thesis.submissionSource === 'SCHOOL_BATCH')

    expect(schoolRecord?.allowedActions).not.toContain('EDIT_THESIS')
  })

  it('removes a deleted student draft from the portal state', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const draft = await service.createStudentDraft()

    await service.deleteStudentDraft(draft.id)

    await expect(service.getStudentThesis(draft.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('allows only a withdrawal request while a thesis is under review', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('UNDER_REVIEW')

    const thesis = await service.getStudentThesis('thesis-main')
    expect(thesis.allowedActions).toEqual(['REQUEST_WITHDRAWAL'])
    await expect(service.withdrawStudentThesis('thesis-main', '不再参评')).rejects.toMatchObject({
      code: 'ILLEGAL_ACTION',
    })
    await expect(
      service.requestStudentWithdrawal('thesis-main', '不再参评'),
    ).resolves.toMatchObject({
      thesisId: 'thesis-main',
      reason: '不再参评',
    })
  })

  it('exposes results and objections only after completion', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })

    expect(await service.getStudentResult('thesis-main')).toBeNull()
    await expect(
      service.submitStudentObjection('thesis-main', { reason: '评审意见与材料不符' }),
    ).rejects.toMatchObject({ code: 'ILLEGAL_ACTION' })

    await service.loadStudentScenario('COMPLETED')
    expect((await service.getStudentThesis('thesis-main')).allowedActions).toEqual([
      'VIEW_RESULT',
      'SUBMIT_OBJECTION',
    ])
    expect(await service.getStudentResult('thesis-main')).not.toBeNull()
    await expect(
      service.submitStudentObjection('thesis-main', { reason: '评审意见与材料不符' }),
    ).resolves.toMatchObject({ thesisId: 'thesis-main', reason: '评审意见与材料不符' })
  })

  it('returns immutable student snapshots and restores saved workflow state', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const draft = await service.getStudentThesis('thesis-main')

    expect(() => {
      draft.form.title = '被页面篡改的标题'
    }).toThrow()

    await service.submitStudentThesis('thesis-main')
    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.getStudentThesis('thesis-main')).stage).toBe('SUBMITTED')
  })
})
