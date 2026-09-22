import { httpApi, type RequestOptions } from './request'

export interface DispatchQueueItem {
  thesis_id: string
  reassignable_task?: { id: string; expert_id: string } | null
  allowed_actions: string[]
  stage: string
  student_name: string
  title: string
  discipline_code: string
}

export interface DispatchCandidate {
  expert_id: string
  username: string | null
  display_name: string | null
  discipline_codes: string[]
  direction_mismatch: boolean
  avoided: boolean
  service_status: string
}

export interface SchoolProgressTask {
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
  totals: { waiting: number; reviewing: number; completed: number; rejected: number; overdue: number }
}

export function confirmDispatch(thesisId: string, version: number, options?: RequestOptions) {
  return httpApi.post(`/school-review/theses/${thesisId}:confirm-dispatch`, { version }, options)
}

export function schoolProgress(thesisId: string) {
  return httpApi.get<SchoolProgressRow>(`/school-review/theses/${thesisId}/progress`)
}

export function schoolProgressList() {
  return httpApi.get<SchoolProgressList>('/school-review/progress')
}

export function dispatchQueue() {
  return httpApi.get<DispatchQueueItem[]>('/platform-review/dispatch-queue')
}

export function dispatchCandidates(thesisId: string) {
  return httpApi.get<DispatchCandidate[]>(`/platform-review/dispatch-candidates?thesis_id=${thesisId}`)
}

export function assignExpert(thesisId: string, expertId: string, options?: RequestOptions) {
  return httpApi.post(`/platform-review/theses/${thesisId}:assign`, { expert_id: expertId }, options)
}

export function reassignExpert(taskId: string, expertId: string, options?: RequestOptions) {
  return httpApi.post(`/expert-tasks/${taskId}:reassign`, { expert_id: expertId }, options)
}
