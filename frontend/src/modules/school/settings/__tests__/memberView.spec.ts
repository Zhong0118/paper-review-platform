import { describe, expect, it } from 'vitest'

import type { ReviewBatch, SchoolMember, StudentEligibility } from '@/api/schoolOperations'

import { batchesForNewEligibility, contactDiff, contactDirty, contactFrom, eligibilityState, newMemberErrors, passwordError } from '../memberView'

const batch = (id: string, status: ReviewBatch['status']) => ({ id, status }) as ReviewBatch
const elig = (id: string, batchId: string, status: StudentEligibility['status'], member = 's1') => ({ id, review_batch_id: batchId, student_membership_id: member, status }) as StudentEligibility
const member = { membership_id: 's1', display_name: '林同学', contact_phone: null, contact_email: 'lin@example.edu' } as SchoolMember
const batches = [batch('open', 'OPEN'), batch('draft', 'DRAFT'), batch('old', 'ARCHIVED')]

describe('member view', () => {
  it('reads eligibility only from draft and open batches', () => {
    expect(eligibilityState('s1', [elig('e1', 'old', 'ELIGIBLE')], batches)).toBe('none')
    expect(eligibilityState('s1', [elig('e1', 'open', 'SUSPENDED')], batches)).toBe('suspended')
    expect(eligibilityState('s1', [elig('e1', 'open', 'SUSPENDED'), elig('e2', 'draft', 'ELIGIBLE')], batches)).toBe('eligible')
    expect(eligibilityState('s2', [elig('e1', 'open', 'ELIGIBLE')], batches)).toBe('none')
  })

  it('offers only current batches the student is not yet in', () => {
    expect(batchesForNewEligibility('s1', [elig('e1', 'open', 'ELIGIBLE')], batches).map((b) => b.id)).toEqual(['draft'])
  })

  it('compares the contact form with the server', () => {
    const form = { ...contactFrom(member), phone: '138 0000 0199' }
    expect(contactDirty(contactFrom(member), member)).toBe(false)
    expect(contactDirty(form, member)).toBe(true)
    expect(contactDiff(form, { ...member, contact_email: 'new@example.edu' })).toEqual([
      { key: 'phone', label: '电话', mine: '138 0000 0199', theirs: '未填写' },
      { key: 'email', label: '邮箱', mine: 'lin@example.edu', theirs: 'new@example.edu' },
    ])
  })

  it('checks passwords the way the server does', () => {
    expect(passwordError('', '')).toBe('请输入密码。')
    expect(passwordError('short', 'short')).toBe('密码至少 12 位。')
    expect(passwordError('a'.repeat(12), 'b'.repeat(12))).toBe('两次输入不一致。')
    expect(passwordError('a'.repeat(12), 'a'.repeat(12))).toBe('')
  })

  it('checks a new member against the account rules', () => {
    const ok = { type: 'STUDENT' as const, name: '林同学', externalId: '2026001', username: 'Lin.Tx', password: 'a'.repeat(12), again: 'a'.repeat(12) }
    expect(newMemberErrors(ok)).toEqual({})
    expect(newMemberErrors({ ...ok, username: 'li' }).username).toContain('3–64 位')
    expect(newMemberErrors({ ...ok, username: '林同学' }).username).toContain('只能用字母')
    expect(newMemberErrors({ ...ok, type: 'SUPERVISOR', externalId: '' }).externalId).toBe('请填写工号。')
  })
})
