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

  it('does not reuse a deleted draft id or leak its file metadata into a new draft', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const deleted = await service.createStudentDraft()
    await service.saveStudentDraft(deleted.id, {
      title: '即将删除的草稿',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['删除测试'],
      originalFileName: 'deleted-original.pdf',
      anonymousFileName: 'deleted-anonymous.pdf',
    })

    await service.deleteStudentDraft(deleted.id)
    const created = await service.createStudentDraft()

    expect(created.id).not.toBe(deleted.id)
    expect(created.files).toEqual([])
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

  it('rejects student scenario loading when demo mode is disabled', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: false })

    await expect(service.loadStudentScenario('UNDER_REVIEW')).rejects.toMatchObject({
      name: 'StudentPortalError',
      code: 'DEMO_MODE_DISABLED',
    })
  })

  it('rejects all thesis-specific reads and mutations outside the current student ownership', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const foreignThesisId = 'thesis-0048'
    const draftInput = {
      title: '不应写入的论文',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['越权'],
      originalFileName: 'foreign.pdf',
      anonymousFileName: 'foreign-anonymous.pdf',
    }

    expect((await service.listStudentTheses()).map((thesis) => thesis.id)).not.toContain(
      foreignThesisId,
    )
    for (const operation of [
      () => service.getStudentThesis(foreignThesisId),
      () => service.saveStudentDraft(foreignThesisId, draftInput),
      () => service.submitStudentThesis(foreignThesisId),
      () => service.deleteStudentDraft(foreignThesisId),
      () => service.withdrawStudentThesis(foreignThesisId, '越权撤回'),
      () => service.requestStudentWithdrawal(foreignThesisId, '越权申请'),
      () => service.getStudentResult(foreignThesisId),
      () => service.submitStudentObjection(foreignThesisId, { reason: '越权异议' }),
    ]) {
      await expect(operation()).rejects.toMatchObject({
        name: 'StudentPortalError',
        code: 'FORBIDDEN',
      })
    }
  })

  it('projects and persists file metadata without retaining file binaries', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })

    expect((await service.getStudentThesis('thesis-main')).files).toContainEqual({
      kind: 'ORIGINAL',
      purpose: 'SCHOOL_ARCHIVE',
      fileName: '林知远-硕士学位论文.pdf',
      sizeBytes: 3145728,
      mimeType: 'application/pdf',
      validationStatus: 'VALID',
    })

    await service.saveStudentDraft('thesis-main', {
      title: '更新后的论文题目',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['持久化'],
      originalFileName: 'changed-original.pdf',
      anonymousFileName: 'changed-anonymous.pdf',
    })

    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.getStudentThesis('thesis-main')).files).toEqual([
      {
        kind: 'ORIGINAL',
        purpose: 'SCHOOL_ARCHIVE',
        fileName: 'changed-original.pdf',
        sizeBytes: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
      {
        kind: 'ANONYMOUS',
        purpose: 'EXPERT_REVIEW',
        fileName: 'changed-anonymous.pdf',
        sizeBytes: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
    ])
  })

  it('migrates legacy v1 file metadata from the persisted thesis filenames', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.saveStudentDraft('thesis-main', {
      title: '旧版快照中的论文',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['旧版快照'],
      originalFileName: 'legacy-changed-original.pdf',
      anonymousFileName: 'legacy-changed-anonymous.pdf',
    })
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    delete persisted.student.fileMetadataByThesis
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = createScenarioService({ storage, demoMode: true })

    expect((await restored.getStudentThesis('thesis-main')).files).toEqual([
      {
        kind: 'ORIGINAL',
        purpose: 'SCHOOL_ARCHIVE',
        fileName: 'legacy-changed-original.pdf',
        sizeBytes: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
      {
        kind: 'ANONYMOUS',
        purpose: 'EXPERT_REVIEW',
        fileName: 'legacy-changed-anonymous.pdf',
        sizeBytes: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
    ])
  })

  it('returns results associated with the requested completed thesis only', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    await service.loadStudentScenario('COMPLETED')

    expect(await service.getStudentResult('thesis-main')).toMatchObject({
      thesisId: 'thesis-main',
      results: [expect.objectContaining({ expertAlias: '专家 A', score: 86 })],
    })
    expect(await service.getStudentResult('thesis-0031')).toEqual({
      thesisId: 'thesis-0031',
      results: [
        {
          expertAlias: '专家 B',
          score: 82,
          recommendation: '建议通过',
          comment: '历史论文评阅结果。',
          submittedAt: '2026-01-18 09:35',
        },
      ],
    })
  })
})
