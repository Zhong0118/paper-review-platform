import { scopeOptions, type TimeScope, type TimeScopeReporter } from './timeScope'
import http, { httpApi, type RequestOptions } from './request'
import type { CheckSummary } from './reviewChecks'
import type { ReviewRule } from './review'

export interface ReviewOutcome { code: 'FAIL' | 'REVISION_REQUIRED' | 'PASS'; label: string }

export interface PublishedItem {
  check_summary?: CheckSummary | null
  alias: string
  total: number
  scores: Record<string, number>
  recommendation: string
  overall_comment: string
  issues: string
}

export interface SchoolResults {
  thesis_id: string
  stage: string
  version: number
  base_result_id: string | null
  effective_revision_id: string | null
  summary_total: number | null
  items: PublishedItem[]
  published: boolean
  rule_snapshot: ReviewRule | null
  outcome: ReviewOutcome | null
}

export function getSchoolResults(thesisId: string) {
  return httpApi.get<SchoolResults>(`/school-review/theses/${thesisId}/results`)
}

export function publishThesis(thesisId: string, version: number, options?: RequestOptions) {
  return httpApi.post(`/school-review/theses/${thesisId}:publish`, { version }, options)
}

export function getPublishedResult(thesisId: string) {
  return httpApi.get<{ thesis_id: string; base_result_id: string; effective_revision_id: string | null; total: number; correction_pending: boolean; items: PublishedItem[]; rule_snapshot: ReviewRule; outcome: ReviewOutcome }>(
    `/my/theses/${thesisId}/published-result`,
  )
}


export interface SupervisedPublishedThesis {
  id: string
  title: string
  student_name: string
}

export function listSupervisedPublishedTheses(scope?: TimeScope, report?: TimeScopeReporter) {
  return scope === undefined ? httpApi.get<SupervisedPublishedThesis[]>('/supervisor/theses/published') : httpApi.get<SupervisedPublishedThesis[]>('/supervisor/theses/published', scopeOptions(scope, report))
}

export async function downloadPublishedReview(id: string) {
  const response = await http.get<Blob>(`/school-review/theses/${id}/published-review.pdf`, {responseType:'blob'})
  const filename = /filename="(review-[a-f0-9]{8}-v\d+\.pdf)"/.exec(String(response.headers['content-disposition']))?.[1]
  return {file: response.data, filename: filename ?? 'anonymous-review.pdf'}
}
