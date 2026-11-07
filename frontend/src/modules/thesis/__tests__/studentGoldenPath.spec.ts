import { describe, expect, it } from 'vitest'

import { createScenarioService } from '@/demo/scenarioService'
import type { StorageLike, StudentDraftInput, ThesisFileMeta } from '@/demo/types'

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const originalFile: ThesisFileMeta = {
  id: 'golden-original',
  name: '林知远-硕士学位论文.pdf',
  size: 3145728,
  mimeType: 'application/pdf',
  purpose: 'SCHOOL_ARCHIVE',
  validationStatus: 'VALID',
}

const anonymousFile: ThesisFileMeta = {
  id: 'golden-anonymous',
  name: '匿名版.pdf',
  size: 3140624,
  mimeType: 'application/pdf',
  purpose: 'EXPERT_REVIEW',
  validationStatus: 'VALID',
}

const completeDraft: StudentDraftInput = {
  title: '面向开放知识图谱的多模态推理研究',
  abstract: '研究面向开放知识图谱的多模态推理方法，验证跨模态证据融合与推理路径生成的有效性。',
  discipline: { code: '0812', name: '计算机科学与技术' },
  keywords: ['知识图谱', '多模态推理', '推理路径生成'],
  files: [originalFile, anonymousFile],
}

describe('student golden path', () => {
  it('persists the complete legal student path', async () => {
    const storage = createMemoryStorage()
    const service = createScenarioService({ storage, demoMode: true })
    await service.saveStudentDraft('thesis-main', completeDraft)
    await service.submitStudentThesis('thesis-main')
    expect((await service.getStudentThesis('thesis-main')).studentVisibleStage).toBe(
      'SCHOOL_REVIEW',
    )

    await service.loadStudentScenario('COMPLETED')
    await service.submitStudentObjection('thesis-main', {
      reason: '对评价依据存在疑问',
      request: '申请学校复核处理',
      attachments: [],
    })

    const restored = createScenarioService({ storage, demoMode: true })
    expect((await restored.getStudentThesis('thesis-main')).stage).toBe('COMPLETED')
    expect((await restored.getStudentResult('thesis-main'))?.objection?.status).toBe('SUBMITTED')
  })
})
