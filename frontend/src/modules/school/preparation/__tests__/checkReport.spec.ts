import { describe, expect, it } from 'vitest'

import type { ThesisDetail } from '@/api/theses'
import { apiFailure, readReport, reportPills } from '../checkReport'

type Report = ThesisDetail['anonymization']
const source = { thesis_version_id: 'v1', file_id: 'anon', file_sha256: 'x', detector_version: 'd1', terms_version: 12, title_status: 'FOUND' as const, uncertain: false, uncertain_pages: [], page_count: 12 }
function detail(report: Partial<Report>, extra: Partial<ThesisDetail> = {}): ThesisDetail {
  return {
    id: 't', stage: 'PREPARING', version: 3, return_reason: null, allowed_actions: ['CONFIRM_ANONYMIZATION', 'REJECT_ANONYMIZATION'], recent_events: [],
    current_version: { id: 'v1', title: '论文', abstract: '', discipline_code: '0812', discipline_name: '计算机科学与技术', keywords: [], is_editable: false, files: [{ file_id: 'orig', purpose: 'original', filename: 'o.pdf' }, { file_id: 'anon', purpose: 'anonymous', filename: 'a.pdf' }] },
    anonymization: { auto_conclusion: 'PASS', manual_conclusion: null, findings: [], stale: false, source_metadata: source, ...report },
    ...extra,
  }
}
const warnTerm = { field: 'file', location: 'p3', matched_text: '某校区', kind: 'SCHOOL_TERM' as const, severity: 'WARN' as const, page_number: 3, context: '……某校区……' }
const warnIdentity = { field: 'file', location: 'p5', matched_text: '周老师', kind: 'IDENTITY' as const, severity: 'WARN' as const, page_number: 5 }
const block = { field: 'file', location: 'p1', matched_text: '张三', kind: 'IDENTITY' as const, severity: 'BLOCK' as const, page_number: 1 }

describe('readReport', () => {
  it('keeps the automatic conclusion as the server sent it and treats unknown values as not checked', () => {
    expect(readReport(detail({ auto_conclusion: 'REVIEW_REQUIRED' })).auto).toBe('REVIEW_REQUIRED')
    expect(readReport(detail({ auto_conclusion: 'FAIL' })).auto).toBe('FAIL')
    expect(readReport(detail({ auto_conclusion: 'OTHER' })).auto).toBeNull()
    const none = readReport(detail({ auto_conclusion: null, source_metadata: null }))
    expect(none.auto).toBeNull()
    expect(none.stale).toBe(false)
    expect(none.passBlocked).toContain('还没有')
  })

  it('counts BLOCK and WARN separately and ignores the title marker', () => {
    const view = readReport(detail({ auto_conclusion: 'FAIL', findings: [block, warnTerm, warnIdentity, { field: 'title', location: 'p1', matched_text: '', kind: 'TITLE_NOT_FOUND' }] }))
    expect(view.blockCount).toBe(1)
    expect(view.warnCount).toBe(2)
    expect(view.findings).toHaveLength(3)
  })

  it('marks the report stale from the server flag or when it no longer matches the current anonymous file', () => {
    expect(readReport(detail({ stale: true })).stale).toBe(true)
    expect(readReport(detail({ source_metadata: { ...source, file_id: 'older' } })).stale).toBe(true)
    expect(readReport(detail({ source_metadata: { ...source, thesis_version_id: 'v0' } })).stale).toBe(true)
    const stale = readReport(detail({ stale: true, findings: [warnTerm] }))
    expect(stale.findings).toEqual([])
    expect(stale.passBlocked).toContain('过期')
  })

  it('mirrors the server pass rules without adding new ones', () => {
    expect(readReport(detail({ auto_conclusion: 'FAIL', findings: [block] })).passBlocked).toContain('不通过')
    expect(readReport(detail({ auto_conclusion: 'PASS' })).passBlocked).toBe('')
    expect(readReport(detail({ auto_conclusion: 'REVIEW_REQUIRED', findings: [warnIdentity] })).passBlocked).toBe('')
  })

  it('requires a pass reason only for school-term warnings, as the server does', () => {
    expect(readReport(detail({ auto_conclusion: 'REVIEW_REQUIRED', findings: [warnTerm] })).passNeedsReason).toBe(true)
    expect(readReport(detail({ auto_conclusion: 'REVIEW_REQUIRED', findings: [warnIdentity] })).passNeedsReason).toBe(false)
    expect(readReport(detail({ auto_conclusion: 'PASS' })).passNeedsReason).toBe(false)
  })

  it('reports scanned pages and the manual conclusion on their own', () => {
    const view = readReport(detail({ manual_conclusion: 'FAIL', source_metadata: { ...source, uncertain: true, uncertain_pages: [9, 10] } }))
    expect(view.uncertainPages).toEqual([9, 10])
    expect(view.manual).toBe('FAIL')
  })
})

describe('reportPills', () => {
  it('labels a stale conclusion as the previous one and adds an expiry pill', () => {
    expect(reportPills(readReport(detail({ auto_conclusion: 'PASS', stale: true }))).map((p) => p.text)).toEqual(['上次自动结论：未发现线索', '报告已过期'])
  })
  it('shows a confirmed manual pass instead of the automatic result', () => {
    expect(reportPills(readReport(detail({ auto_conclusion: 'REVIEW_REQUIRED', manual_conclusion: 'PASS' }))).map((p) => p.text)).toEqual(['人工已通过核验'])
  })
  it('never invents a result when nothing was checked', () => {
    expect(reportPills(readReport(detail({ auto_conclusion: null, source_metadata: null }))).map((p) => p.text)).toEqual(['尚未检测'])
  })
})

describe('apiFailure', () => {
  it('reads status and code from an axios-style error', () => {
    expect(apiFailure({ response: { status: 409, data: { code: 'VERSION_CONFLICT', message: '检测依据已变化' } } })).toEqual({ status: 409, code: 'VERSION_CONFLICT', message: '检测依据已变化' })
    expect(apiFailure(new Error('Network Error'))).toEqual({ status: undefined, code: undefined, message: 'Network Error' })
  })
})
