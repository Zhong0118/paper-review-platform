/**
 * U4-1 学校结果处理的纯函数：视图归类、结果解读、更正对照。
 * 结果解读沿用 U2-6 的 readPublished（发布快照 v1/v2 规则）；学校接口把总分叫 summary_total。
 */
import type { Correction } from '@/api/corrections'
import type { ReviewRuleDimension } from '@/api/review'
import type { SchoolResults } from '@/api/results'
import type { ThesisDetail } from '@/api/theses'

import { readPublished, type FeedbackView } from '../feedback/publishedFeedback'

export type ResultView = 'publish' | 'correction' | 'published'

/** 每篇论文待学校确认的更正（按接口顺序取第一条） */
export function awaitingByThesis(corrections: Correction[]): Map<string, Correction> {
  const map = new Map<string, Correction>()
  for (const row of corrections) if (row.status === 'AWAITING_SCHOOL' && row.thesis_id && !map.has(row.thesis_id)) map.set(row.thesis_id, row)
  return map
}

export function viewOf(row: ThesisDetail, awaiting: Map<string, Correction>): ResultView {
  if (awaiting.has(row.id)) return 'correction'
  return row.stage === 'COMPLETED' ? 'published' : 'publish'
}

/** null：结果无法解读，按接口错误处理 */
export function readSchoolResult(results: SchoolResults, correctionPending: boolean): FeedbackView | null {
  if (results.summary_total === null) return null
  return readPublished({ ...results, total: results.summary_total, correction_pending: correctionPending })
}

export const correctionStatus: Record<Correction['status'], string> = {
  REQUESTED: '待平台审批', APPROVED: '已批准，待专家提交', REJECTED: '平台已驳回', CANCELLED: '申请已取消',
  AWAITING_SCHOOL: '待学校确认', ACTIVATED: '更正已生效', SCHOOL_REJECTED: '学校未予确认',
}

/** 评语字段的显示顺序与名称（与旧更正面板一致）；分项分数的名称取自规则快照 */
const COMMENT_FIELDS: [string, string][] = [
  ['recommendation', '评审建议'], ['overallComment', '总体评价'], ['issues', '主要问题'],
  ['revisionAdvice', '修改建议'], ['strengths', '主要优点'], ['evaluations', '分项评价'],
]
const DEFAULT_SCORE_LABELS: Record<string, string> = {
  topicValue: '选题价值', literatureTheory: '文献与理论基础', methodology: '研究方法', innovation: '创新性',
  writingStandards: '写作与学术规范', resultsWorkload: '研究成果与工作量',
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}：${String(v)}`).join('；')
  return String(value)
}

export interface CompareRow { key: string; label: string; before: string; after: string; changed: boolean }

/** 原生效版本与待确认更正逐项对照；缺少任一版本时返回空表 */
export function compareRows(correction: Correction, dimensions: ReviewRuleDimension[] = []): CompareRow[] {
  const before = correction.before?.payload as Record<string, unknown> | undefined
  const after = correction.revision?.payload as Record<string, unknown> | undefined
  if (!before || !after || !correction.before || !correction.revision) return []
  const order: [string, string][] = dimensions.length
    ? dimensions.map((d) => [d.key, d.label])
    : Object.entries(DEFAULT_SCORE_LABELS)
  const known = new Set([...order.map(([k]) => k), ...COMMENT_FIELDS.map(([k]) => k)])
  const extra = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !known.has(k)).sort().map((k): [string, string] => [k, k])
  const rows: CompareRow[] = [{ key: 'total', label: '总分', before: String(correction.before.total), after: String(correction.revision.total), changed: correction.before.total !== correction.revision.total }]
  for (const [key, label] of [...order, ...COMMENT_FIELDS, ...extra]) {
    if (!(key in before) && !(key in after)) continue
    const b = text(before[key])
    const a = text(after[key])
    rows.push({ key, label, before: b, after: a, changed: b !== a })
  }
  return rows
}

export function noteOf(correction: Correction, kind: 'EXPERT_REQUEST' | 'PLATFORM_DECISION' | 'SCHOOL_DECISION'): string {
  return correction.notes.find((note) => note.kind === kind)?.reason ?? ''
}
