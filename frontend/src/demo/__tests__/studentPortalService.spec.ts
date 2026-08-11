import { describe, expect, it } from 'vitest'

import { createScenarioService } from '../scenarioService'
import type { ThesisFileMeta } from '../types'

function createMemoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('student portal service', () => {
  it('projects the current public student eligibility before draft creation', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.resetStudentDemo()
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    persisted.student.eligibility = {
      ...persisted.student.eligibility,
      eligible: false,
      status: 'SUSPENDED',
      reason: '学校已暂停本批次提交资格。',
    }
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const eligibility = await createScenarioService({
      storage,
      demoMode: true,
    }).getStudentEligibility()

    expect(eligibility).toMatchObject({
      eligible: false,
      status: 'SUSPENDED',
      reason: '学校已暂停本批次提交资格。',
    })
    expect(Object.isFrozen(eligibility)).toBe(true)
  })

  it('projects a school-provided public reason without exposing internal state', async () => {
    const storage = createMemoryStorage()
    const seed = createScenarioService({ storage, demoMode: true })
    await seed.resetStudentDemo()
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    persisted.student.publicReasonsByThesis = {
      'thesis-main': '匿名版文件仍包含可识别身份信息，请修改后重新提交。',
    }
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const detail = await createScenarioService({ storage, demoMode: true }).getStudentThesis(
      'thesis-main',
    )

    expect(detail.publicReason).toBe('匿名版文件仍包含可识别身份信息，请修改后重新提交。')
  })

  it('normalizes keyword whitespace and duplicates at the save boundary', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const current = await service.getStudentThesis('thesis-main')

    await service.saveStudentDraft('thesis-main', {
      title: current.title,
      abstract: current.abstract,
      discipline: current.discipline,
      keywords: ['  知识图谱 ', '多模态推理', '知识图谱', '   '],
      files: current.files,
    })

    expect((await service.getStudentThesis('thesis-main')).keywords).toEqual([
      '知识图谱',
      '多模态推理',
    ])
  })

  it('rejects more than five normalized keywords at the save boundary', async () => {
    const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
    const current = await service.getStudentThesis('thesis-main')

    await expect(
      service.saveStudentDraft('thesis-main', {
        title: current.title,
        abstract: current.abstract,
        discipline: current.discipline,
        keywords: ['一', '二', '三', '四', '五', '六'],
        files: current.files,
      }),
    ).rejects.toMatchObject({
      name: 'StudentPortalError',
      code: 'INVALID_INPUT',
      message: '关键词最多填写 5 个。',
    })
  })

  it('rejects submission when restored state bypasses the keyword limit', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const current = await service.getStudentThesis('thesis-main')
    await service.saveStudentDraft('thesis-main', {
      title: current.title,
      abstract: current.abstract,
      discipline: current.discipline,
      keywords: ['一', '二', '三', '四', '五'],
      files: current.files,
    })
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    const savedThesis = persisted.scenario.theses.find(
      (thesis: { id: string }) => thesis.id === 'thesis-main',
    )
    savedThesis.keywords = ['一', '二', '三', '四', '五', '六']
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = createScenarioService({ storage, demoMode: true })

    await expect(restored.submitStudentThesis('thesis-main')).rejects.toMatchObject({
      name: 'StudentPortalError',
      code: 'INVALID_INPUT',
      message: '关键词最多填写 5 个。',
    })
  })

  it('writes normalized restored keywords back when submission succeeds', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const current = await service.getStudentThesis('thesis-main')
    await service.saveStudentDraft('thesis-main', {
      title: current.title,
      abstract: current.abstract,
      discipline: current.discipline,
      keywords: ['知识图谱', '多模态推理'],
      files: current.files,
    })
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    const savedThesis = persisted.scenario.theses.find(
      (thesis: { id: string }) => thesis.id === 'thesis-main',
    )
    savedThesis.keywords = ['  知识图谱 ', '多模态推理', '知识图谱', '  ']
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = createScenarioService({ storage, demoMode: true })
    await restored.submitStudentThesis('thesis-main')

    const submitted = await createScenarioService({
      storage,
      demoMode: true,
    }).getStudentThesis('thesis-main')
    expect(submitted.stage).toBe('SUBMITTED')
    expect(submitted.keywords).toEqual(['知识图谱', '多模态推理'])
  })

  it('persists the abstract and exact file metadata across service reconstruction', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const files = [
      {
        id: 'file-original-1',
        name: 'complete-original.pdf',
        size: 4321,
        mimeType: 'application/pdf',
        purpose: 'SCHOOL_ARCHIVE' as const,
        validationStatus: 'VALID' as const,
      },
      {
        id: 'file-anonymous-1',
        name: 'complete-anonymous.pdf',
        size: 3210,
        mimeType: 'application/pdf',
        purpose: 'EXPERT_REVIEW' as const,
        validationStatus: 'REVIEW_REQUIRED' as const,
      },
    ]

    await service.saveStudentDraft('thesis-main', {
      title: '完整材料持久化测试',
      abstract: '跨服务实例仍应恢复的摘要。',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['持久化'],
      files,
    })

    const restored = await createScenarioService({ storage, demoMode: true }).getStudentThesis(
      'thesis-main',
    )
    expect(restored.abstract).toBe('跨服务实例仍应恢复的摘要。')
    expect(restored.files).toEqual(files)
  })

  it('projects file metadata through a strict JSON-safe persistence boundary', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    const unsafeFile = {
      id: 'file-safe-boundary',
      name: 'safe-boundary.pdf',
      size: 4,
      mimeType: 'application/pdf',
      purpose: 'SCHOOL_ARCHIVE' as const,
      validationStatus: 'VALID' as const,
      binary: new File(['body'], 'unsafe.pdf', { type: 'application/pdf' }),
      internalNote: 'must-not-persist',
    } satisfies ThesisFileMeta & { binary: File; internalNote: string }

    await service.saveStudentDraft('thesis-main', {
      title: '持久化边界',
      abstract: '只允许六个元数据字段。',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['边界'],
      files: [unsafeFile],
    })

    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    const storedFile = persisted.student.fileMetadataByThesis['thesis-main'][0]
    expect(Object.keys(storedFile).sort()).toEqual(
      ['id', 'mimeType', 'name', 'purpose', 'size', 'validationStatus'].sort(),
    )
    expect(JSON.stringify(persisted)).not.toContain('must-not-persist')
    expect(JSON.stringify(persisted)).not.toContain('body')
  })

  it.each(['PENDING', 'INVALID'] as const)(
    'rejects submission while original material metadata is %s',
    async (validationStatus) => {
      const service = createScenarioService({ storage: createMemoryStorage(), demoMode: true })
      const draft = await service.createStudentDraft()
      await service.saveStudentDraft(draft.id, {
        title: '材料仍在校验',
        abstract: '摘要已填写。',
        discipline: { code: '0812', name: '计算机科学与技术' },
        keywords: ['校验'],
        files: [
          {
            id: 'pending-original',
            name: 'pending.pdf',
            size: 10,
            mimeType: 'application/pdf',
            purpose: 'SCHOOL_ARCHIVE',
            validationStatus,
          },
          {
            id: 'valid-anonymous',
            name: 'anonymous.pdf',
            size: 9,
            mimeType: 'application/pdf',
            purpose: 'EXPERT_REVIEW',
            validationStatus: 'VALID',
          },
        ],
      })

      await expect(service.submitStudentThesis(draft.id)).rejects.toMatchObject({
        code: 'ILLEGAL_ACTION',
      })
    },
  )

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
      abstract: '删除后不应泄漏。',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['删除测试'],
      files: [
        {
          id: 'deleted-original',
          name: 'deleted-original.pdf',
          size: 100,
          mimeType: 'application/pdf',
          purpose: 'SCHOOL_ARCHIVE',
          validationStatus: 'VALID',
        },
      ],
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
      abstract: '越权摘要',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['越权'],
      files: [],
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
      id: 'file-thesis-main-original',
      purpose: 'SCHOOL_ARCHIVE',
      name: '林知远-硕士学位论文.pdf',
      size: 3145728,
      mimeType: 'application/pdf',
      validationStatus: 'VALID',
    })

    await service.saveStudentDraft('thesis-main', {
      title: '更新后的论文题目',
      abstract: '仅保存元数据，不保存文件正文。',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['持久化'],
      files: [
        {
          id: 'changed-original',
          name: 'changed-original.pdf',
          size: 1234,
          mimeType: 'application/pdf',
          purpose: 'SCHOOL_ARCHIVE',
          validationStatus: 'VALID',
        },
        {
          id: 'changed-anonymous',
          name: 'changed-anonymous.pdf',
          size: 1200,
          mimeType: 'application/pdf',
          purpose: 'EXPERT_REVIEW',
          validationStatus: 'REVIEW_REQUIRED',
        },
      ],
    })

    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.getStudentThesis('thesis-main')).files).toEqual([
      {
        id: 'changed-original',
        purpose: 'SCHOOL_ARCHIVE',
        name: 'changed-original.pdf',
        size: 1234,
        mimeType: 'application/pdf',
        validationStatus: 'VALID',
      },
      {
        id: 'changed-anonymous',
        purpose: 'EXPERT_REVIEW',
        name: 'changed-anonymous.pdf',
        size: 1200,
        mimeType: 'application/pdf',
        validationStatus: 'REVIEW_REQUIRED',
      },
    ])
  })

  it('migrates legacy v1 file metadata from the persisted thesis filenames', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.saveStudentDraft('thesis-main', {
      title: '旧版快照中的论文',
      abstract: '旧版摘要',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['旧版快照'],
      files: [
        {
          id: 'legacy-original',
          name: 'legacy-changed-original.pdf',
          size: 100,
          mimeType: 'application/pdf',
          purpose: 'SCHOOL_ARCHIVE',
          validationStatus: 'VALID',
        },
        {
          id: 'legacy-anonymous',
          name: 'legacy-changed-anonymous.pdf',
          size: 90,
          mimeType: 'application/pdf',
          purpose: 'EXPERT_REVIEW',
          validationStatus: 'VALID',
        },
      ],
    })
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    delete persisted.student.fileMetadataByThesis
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = createScenarioService({ storage, demoMode: true })

    expect((await restored.getStudentThesis('thesis-main')).files).toEqual([
      {
        id: 'file-thesis-main-original',
        purpose: 'SCHOOL_ARCHIVE',
        name: 'legacy-changed-original.pdf',
        size: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
      {
        id: 'file-thesis-main-anonymous',
        purpose: 'EXPERT_REVIEW',
        name: 'legacy-changed-anonymous.pdf',
        size: 0,
        mimeType: 'application/pdf',
        validationStatus: 'PENDING',
      },
    ])
  })

  it('migrates legacy v1 file metadata objects to the complete metadata contract', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.saveStudentDraft('thesis-main', {
      title: '旧元数据对象',
      abstract: '旧元数据对象迁移摘要',
      discipline: { code: '0812', name: '计算机科学与技术' },
      keywords: ['迁移'],
      files: [],
    })
    const persisted = JSON.parse(storage.getItem('baijie-demo-student:v1')!)
    persisted.student.fileMetadataByThesis['thesis-main'] = [
      {
        kind: 'ANONYMOUS',
        purpose: 'EXPERT_REVIEW',
        fileName: 'legacy-shape.pdf',
        sizeBytes: 765,
        mimeType: 'application/pdf',
        validationStatus: 'VALID',
      },
    ]
    storage.setItem('baijie-demo-student:v1', JSON.stringify(persisted))

    const restored = await createScenarioService({
      storage,
      demoMode: true,
    }).getStudentThesis('thesis-main')

    expect(restored.files).toEqual([
      {
        id: 'file-thesis-main-anonymous',
        name: 'legacy-shape.pdf',
        size: 765,
        mimeType: 'application/pdf',
        purpose: 'EXPERT_REVIEW',
        validationStatus: 'VALID',
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
