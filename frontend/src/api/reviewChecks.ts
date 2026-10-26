import { httpApi } from './request'
import type { ReviewScoreInput } from '@/demo/types'

export interface CheckTarget { kind: 'task' | 'correction'; id: string }
export interface CheckAck { payload_hash: string; rule_version: string; codes: string[] }
export interface CheckFinding {
  code: string; field: string; start: number; end: number; message: string; suggestion: string | null; severity: 'WARN'
}
export interface SimilarityReport {
  status: 'COMPLETE' | 'NO_HISTORY' | 'INSUFFICIENT_TEXT'
  hit_count: number; max_similarity: number; metric: string; threshold: number; rule_version: string; fingerprint: string
  coverage: { window_days: number; limit: number; examined: number; truncated: boolean }
}
export interface CheckReport {
  similarity?: SimilarityReport
  payload_hash: string; rule_version: string; findings: CheckFinding[]; checked_at: string; status: 'COMPLETE'
  coverage: { dictionary_version: string; dictionary_entries: number; description: string }
}
export interface CheckSummary {
  rule_version: string; codes: string[]; counts: Record<string, number>; confirmed_at: string
}
export function getReviewChecks(target: CheckTarget, payload: ReviewScoreInput) {
  const scope = target.kind === 'task' ? 'expert-tasks' : 'expert-corrections'
  return httpApi.post<CheckReport>(`/${scope}/${target.id}/review-checks`, { payload })
}
