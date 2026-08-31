import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { toStudentThesisDetail } from '@/api/adapters'
import type { ThesisDetail } from '@/api/theses'

vi.mock('@/api/theses', () => ({
  listTheses: vi.fn(),
  createThesis: vi.fn(),
  submitThesis: vi.fn(),
}))

describe('real submit wiring adapters', () => {
  it('maps API thesis into student visible school-review stage', () => {
    setActivePinia(createPinia())
    const detail: ThesisDetail = {
      id: 't1',
      stage: 'PREPARING',
      version: 3,
      return_reason: null,
      allowed_actions: ['WITHDRAW_BEFORE_DISPATCH'],
      anonymization: { auto_conclusion: 'PASS', manual_conclusion: null, findings: [] },
      current_version: {
        id: 'v1',
        title: '门禁论文',
        abstract: '摘要',
        discipline_code: '0812',
        discipline_name: '计算机科学与技术',
        keywords: ['盲审'],
        is_editable: false,
        files: [],
      },
      recent_events: [{ action: 'submit', from_stage: 'DRAFT', to_stage: 'SUBMITTED', reason: null }],
    }
    const mapped = toStudentThesisDetail(detail)
    expect(mapped.studentVisibleStage).toBe('SCHOOL_REVIEW')
    expect(mapped.allowedActions).toContain('WITHDRAW_BEFORE_DISPATCH')
  })
})
