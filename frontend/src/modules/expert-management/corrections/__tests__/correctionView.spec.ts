import { describe, expect, it } from 'vitest'

import type { Correction } from '@/api/corrections'

import { inView, laterNotes, progress, requestReason, statusTone } from '../correctionView'

const row = (status: Correction['status'], notes: Correction['notes'] = []): Correction => ({
  id: 'c', task_id: 't', status, version: 1, base_result_id: 'r', base_revision_id: null, created_at: '2026-10-01T00:00:00Z', notes, revision: null,
})

describe('correction view', () => {
  it('puts only requested rows in the pending view', () => {
    expect(inView(row('REQUESTED'), 'pending')).toBe(true)
    expect(inView(row('AWAITING_SCHOOL'), 'pending')).toBe(false)
    expect(inView(row('AWAITING_SCHOOL'), 'done')).toBe(true)
    expect(inView(row('REQUESTED'), 'all')).toBe(true)
    expect(statusTone('ACTIVATED')).toBe('success')
  })

  it('separates the request reason from later records', () => {
    const item = row('APPROVED', [{ kind: 'EXPERT_REQUEST', reason: '第二项分数录入错误' }, { kind: 'PLATFORM_DECISION', reason: '同意更正' }, { kind: 'OTHER', reason: 'x' }])
    expect(requestReason(item)).toBe('第二项分数录入错误')
    expect(laterNotes(item)).toEqual([{ label: '平台审批', reason: '同意更正' }, { label: '处理记录', reason: 'x' }])
  })

  it('maps each status to a step and says where it ended', () => {
    expect(progress('REQUESTED')).toEqual({ step: 1 })
    expect(progress('ACTIVATED')).toEqual({ step: 4, complete: true })
    expect(progress('REJECTED')).toEqual({ step: 1, ended: '平台驳回了申请，原评阅结果不变。' })
    expect(progress('SCHOOL_REJECTED').step).toBe(3)
  })
})
