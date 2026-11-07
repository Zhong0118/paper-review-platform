import { describe, expect, it } from 'vitest'

import type { ReviewBatch } from '@/api/schoolOperations'

import { changedParts, diffFields, formFrom, parseDays, sortBatches, toIso, toLocal, validate } from '../batchForm'

export const batch = (extra: Partial<ReviewBatch> = {}): ReviewBatch => ({
  id: 'b1', code: '2026-AUT', name: '2026 秋季送审', status: 'DRAFT', start_at: '2026-09-01T00:00:00.000Z', end_at: '2026-12-20T00:00:00.000Z',
  rule_version: 1, version: 3, allowed_actions: ['EDIT', 'OPEN'], accept_days: null, review_days: 14, program_catalog_id: null, ...extra,
})

describe('batch form', () => {
  it('round-trips server times through the local editor value', () => {
    expect(toIso(toLocal('2026-09-01T00:00:00.000Z'))).toBe('2026-09-01T00:00:00.000Z')
    expect(toLocal(null)).toBe('')
    expect(toIso('')).toBeNull()
  })

  it('reads days as null when empty and rejects anything that is not 1–32767', () => {
    expect(parseDays('')).toBeNull()
    expect(parseDays(' 7 ')).toBe(7)
    for (const bad of ['0', '-1', '1.5', 'abc', '32768']) expect(parseDays(bad)).toBeUndefined()
  })

  it('tells which part changed and lists only differing fields', () => {
    const form = formFrom(batch())
    expect(changedParts(form, batch())).toEqual({ basic: false, deadlines: false })
    form.reviewDays = '10'
    expect(changedParts(form, batch())).toEqual({ basic: false, deadlines: true })
    form.name = '2026 秋季学位论文送审'
    expect(diffFields(form, batch({ name: '别人改的名称' })).map((d) => [d.label, d.mine, d.theirs])).toEqual([
      ['名称', '2026 秋季学位论文送审', '别人改的名称'],
      ['评阅期限（天）', '10', '14'],
    ])
  })

  it('validates only the parts being saved', () => {
    const form = { ...formFrom(batch()), name: ' ', acceptDays: '0' }
    expect(validate(form, { basic: false, deadlines: true })).toEqual({ acceptDays: expect.any(String) })
    expect(Object.keys(validate(form, { basic: true, deadlines: false }))).toEqual(['name'])
    const reversed = { ...formFrom(batch()), startAt: '2026-12-01T00:00', endAt: '2026-11-01T00:00' }
    expect(validate(reversed, { basic: true, deadlines: false }).endAt).toBe('结束时间须晚于开始时间。')
  })

  it('sorts open batches first', () => {
    const rows = [batch({ id: 'a', status: 'ARCHIVED' }), batch({ id: 'd', status: 'DRAFT' }), batch({ id: 'o', status: 'OPEN' }), batch({ id: 'c', status: 'SUBMISSION_CLOSED' })]
    expect(sortBatches(rows).map((r) => r.id)).toEqual(['o', 'd', 'c', 'a'])
  })
})
