import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'

import { toSchoolRow, toStudentThesisDetail } from '@/api/adapters'
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

  it('copies student identity from API projection', () => {
    const mapped = toStudentThesisDetail({
      id: 't1',
      stage: 'DRAFT',
      version: 1,
      return_reason: null,
      allowed_actions: ['EDIT_THESIS'],
      anonymization: { auto_conclusion: null, manual_conclusion: null, findings: [] },
      current_version: {
        id: 'v1',
        title: '题',
        abstract: '',
        discipline_code: '0812',
        discipline_name: '计算机科学与技术',
        keywords: ['盲审'],
        is_editable: true,
        files: [],
      },
      recent_events: [],
      student: {
        name: '林知远',
        student_no: '20260042',
        supervisor_name: '赵文博',
        tenant_name: '演示大学',
        college_name: '计算机学院',
      },
      batch_name: '2026 年春季硕士论文盲审',
    })
    expect(mapped.studentName).toBe('林知远')
    expect(mapped.student.tenantName).toBe('演示大学')
  })

  it('keeps publish and objection actions from the API', () => {
    expect(
      toStudentThesisDetail({
        id: 't1',
        stage: 'COMPLETED',
        version: 8,
        return_reason: null,
        allowed_actions: ['SUBMIT_OBJECTION'],
        anonymization: { auto_conclusion: 'PASS', manual_conclusion: 'PASS', findings: [] },
        current_version: {
          id: 'v1',
          title: '题',
          abstract: '',
          discipline_code: '0812',
          discipline_name: '计算机科学与技术',
          keywords: ['盲审'],
          is_editable: false,
          files: [],
        },
        recent_events: [],
      }).allowedActions,
    ).toEqual(['SUBMIT_OBJECTION'])
    expect(
      toSchoolRow({
        id: 't2',
        stage: 'RESULT_PROCESSING',
        version: 7,
        return_reason: null,
        allowed_actions: ['PUBLISH_RESULT'],
        anonymization: { auto_conclusion: 'PASS', manual_conclusion: 'PASS', findings: [] },
        current_version: {
          id: 'v2',
          title: '待发布',
          abstract: '',
          discipline_code: '0812',
          discipline_name: '计算机科学与技术',
          keywords: ['盲审'],
          is_editable: false,
          files: [],
        },
        recent_events: [],
      }).allowedActions,
    ).toEqual(['PUBLISH_RESULT'])
  })
})
