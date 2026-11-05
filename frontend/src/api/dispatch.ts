import type { TaskDeadline } from './taskTiming'
import type { StatusFilter } from './dashboard'
import { scopeOptions, type TimeScope, type TimeScopeReporter } from './timeScope'
import { httpApi, type RequestOptions } from './request'

export interface DispatchQueueItem {
  thesis_id: string
  tasks?: Array<{ status: string; deadline?:TaskDeadline }>
  reassignable_task?: { id: string; expert_id: string } | null
  allowed_actions: string[]
  stage: string
  student_name: string
  title: string
  discipline_code: string
}

export interface MatchReason { kind: 'research_direction' | 'keyword'; tag: string; points: number }

export interface DispatchCandidate {
  workload?: { invited:number; in_review:number; total:number }
  match_score?: number
  match_rule_version?: string
  match_reasons?: MatchReason[]
  candidate_version?: number
  thesis_version?: number
  hard_allowed?: boolean
  allowed_actions?: string[]
  unavailable_reasons?: string[]
  unit?: string
  title?: string
  research_directions?: string[]
  expert_id: string
  username: string | null
  display_name: string | null
  discipline_codes: string[]
  direction_mismatch: boolean
  avoided: boolean
  service_status: string
  qualification_status: string
}

export function candidateUnavailableReason(row: DispatchCandidate): string {
  if (row.hard_allowed === false) return row.unavailable_reasons?.join('、') || '当前不可派'
  if (row.avoided) return '回避'
  if (row.direction_mismatch) return '方向不符'
  if (row.qualification_status !== 'APPROVED') return '资格未通过'
  if (row.service_status !== 'AVAILABLE') return '暂停服务'
  return ''
}

export interface SchoolProgressTask {
  deadline?:TaskDeadline
  alias: string
  status: string
}

export interface SchoolProgressRow {
  thesis_id: string
  stage: string
  round_status: string | null
  invited_count: number
  in_review_count: number
  submitted_count: number
  rejected_count: number
  tasks: SchoolProgressTask[]
  title?: string
  student_name?: string
}

export interface SchoolProgressList {
  items: SchoolProgressRow[]
  as_of?: string
  filtered_count?: number
  totals: { waiting: number; reviewing: number; completed: number; rejected: number; overdue: number | null }
}

export function confirmDispatch(thesisId: string, version: number, options?: RequestOptions) {
  return httpApi.post(`/school-review/theses/${thesisId}:confirm-dispatch`, { version }, options)
}

export function schoolProgress(thesisId: string) {
  return httpApi.get<SchoolProgressRow>(`/school-review/theses/${thesisId}/progress`)
}

export function schoolProgressList(scope?: TimeScope, report?: TimeScopeReporter, status: StatusFilter = 'ALL') {
  return scope === undefined ? httpApi.get<SchoolProgressList>('/school-review/progress') : httpApi.get<SchoolProgressList>('/school-review/progress', { ...scopeOptions(scope, report), params: { time_scope: scope, status_filter: status } })
}

export function dispatchQueue(scope?: TimeScope, report?: TimeScopeReporter, status: StatusFilter = 'ALL') {
  return scope === undefined ? httpApi.get<DispatchQueueItem[]>('/platform-review/dispatch-queue') : httpApi.get<DispatchQueueItem[]>('/platform-review/dispatch-queue', { ...scopeOptions(scope, report), params: { time_scope: scope, status_filter: status } })
}

export function dispatchCandidates(thesisId: string, options?: RequestOptions) {
  return httpApi.get<DispatchCandidate[]>(`/platform-review/dispatch-candidates?thesis_id=${thesisId}`, options)
}

export function assignExpert(thesisId: string, expertId: string, options?: RequestOptions, expectedExpertVersion?: number) {
  return httpApi.post(`/platform-review/theses/${thesisId}:assign`, { expert_id: expertId, ...(expectedExpertVersion === undefined ? {} : { expected_expert_version: expectedExpertVersion }) }, options)
}

export function reassignExpert(taskId: string, expertId: string, options?: RequestOptions, expectedExpertVersion?: number) {
  return httpApi.post(`/expert-tasks/${taskId}:reassign`, { expert_id: expertId, ...(expectedExpertVersion === undefined ? {} : { expected_expert_version: expectedExpertVersion }) }, options)
}
