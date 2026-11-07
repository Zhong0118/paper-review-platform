import { describe, expect, it } from 'vitest'

import type { Correction } from '@/api/corrections'
import type { SchoolResults } from '@/api/results'
import type { ThesisDetail } from '@/api/theses'

import { awaitingByThesis, compareRows, noteOf, readSchoolResult, viewOf } from '../resultView'

const row = (id: string, stage: string) => ({ id, stage }) as ThesisDetail
const correction = (id: string, thesis: string, status: Correction['status'], extra: Partial<Correction> = {}): Correction => ({
  id, task_id: `t-${id}`, thesis_id: thesis, status, version: 2, base_result_id: 'r', base_revision_id: null, created_at: '2026-11-01T00:00:00Z', notes: [], revision: null, ...extra,
})
const rule = { version: 'pilot-v3', required_experts: 1, mode: 'sum', dimensions: [{ key: 'topicValue', label: '选题价值', max_score: 10 }, { key: 'methodology', label: '研究方法', max_score: 20 }], bands: [] }
const item = { alias: 'E-001', total: 25, scores: { topicValue: 8, methodology: 17 }, recommendation: '修改后通过', overall_comment: '总体', issues: '问题', revision_advice: '' }
const results = (extra: Partial<SchoolResults> = {}): SchoolResults => ({
  snapshot_schema_version: 2, thesis_id: 'a', stage: 'RESULT_PROCESSING', version: 4, base_result_id: 'r', effective_revision_id: null,
  summary_total: 25, items: [item], published: false, rule_snapshot: rule as SchoolResults['rule_snapshot'], outcome: { code: 'REVISION_REQUIRED', label: '修改后通过' }, ...extra,
})

describe('result views', () => {
  it('puts a thesis with an awaiting correction in the correction view first', () => {
    const awaiting = awaitingByThesis([correction('c1', 'a', 'AWAITING_SCHOOL'), correction('c2', 'b', 'ACTIVATED')])
    expect([...awaiting.keys()]).toEqual(['a'])
    expect(viewOf(row('a', 'COMPLETED'), awaiting)).toBe('correction')
    expect(viewOf(row('b', 'COMPLETED'), awaiting)).toBe('published')
    expect(viewOf(row('c', 'RESULT_PROCESSING'), awaiting)).toBe('publish')
  })

  it('reads school results with the summary total and the snapshot rules', () => {
    const view = readSchoolResult(results(), false)!
    expect(view).toMatchObject({ total: 25, maxTotal: 30, ruleVersion: 'pilot-v3', correctionPending: false })
    expect(view.items[0]!.scores.map((s) => `${s.label}${s.score}/${s.max}`)).toEqual(['选题价值8/10', '研究方法17/20'])
    expect(view.items[0]!.advice).toEqual({ kind: 'v2', text: '' })
    expect(readSchoolResult(results(), true)!.correctionPending).toBe(true)
  })

  it('refuses a result it cannot read instead of showing part of it', () => {
    expect(readSchoolResult(results({ summary_total: null }), false)).toBeNull()
    expect(readSchoolResult(results({ items: [{ ...item, scores: { topicValue: 8 } }] }), false)).toBeNull()
  })

  it('lists the total first, then each field in order, marking changes', () => {
    const c = correction('c1', 'a', 'AWAITING_SCHOOL', {
      before: { total: 25, payload: { topicValue: 8, methodology: 17, overallComment: '旧评价', issues: '问题' } as never },
      revision: { id: 'v', total: 27, payload: { topicValue: 8, methodology: 19, overallComment: '新评价', issues: '问题' } as never },
    })
    const rows = compareRows(c, rule.dimensions)
    expect(rows.map((r) => r.label)).toEqual(['总分', '选题价值', '研究方法', '总体评价', '主要问题'])
    expect(rows.filter((r) => r.changed).map((r) => r.label)).toEqual(['总分', '研究方法', '总体评价'])
    expect(rows[2]).toMatchObject({ before: '17', after: '19' })
    expect(compareRows(correction('c2', 'a', 'AWAITING_SCHOOL'), rule.dimensions)).toEqual([])
  })

  it('finds the reason by note kind', () => {
    const c = correction('c1', 'a', 'AWAITING_SCHOOL', { notes: [{ kind: 'EXPERT_REQUEST', reason: '录入错误' }, { kind: 'PLATFORM_DECISION', reason: '同意' }] })
    expect(noteOf(c, 'EXPERT_REQUEST')).toBe('录入错误')
    expect(noteOf(c, 'SCHOOL_DECISION')).toBe('')
  })
})
