import type { SensitiveReport } from './sensitiveChecks'
import { scopeOptions, type TimeScope, type TimeScopeReporter } from './timeScope'
import { httpApi, type RequestOptions } from './request'

export interface ThesisFileRef {
  file_id: string
  purpose: string
  filename: string
}

export interface ThesisDetail {
  id: string
  stage: string
  version: number
  return_reason: string | null
  allowed_actions: string[]
  anonymization: SensitiveReport
  current_version: {
    id: string
    title: string
    abstract: string
    discipline_code: string
    discipline_name: string
    keywords: string[]
    is_editable: boolean
    files: ThesisFileRef[]
  } | null
  recent_events: Array<{ action: string; from_stage: string | null; to_stage: string; reason: string | null }>
  student?: {
    name: string
    student_no: string
    supervisor_name: string | null
    degree_type?: string | null
    tenant_name: string
    college_name: string
  } | null
  batch_name?: string
  review_batch?: { id: string; name: string; end_at: string | null } | null
}

export interface DraftPayload {
  title: string
  abstract: string
  discipline_code: string
  discipline_name: string
  keywords: string[]
}

export function listTheses(scope?: TimeScope, report?: TimeScopeReporter) {
  return scope === undefined ? httpApi.get<ThesisDetail[]>('/theses') : httpApi.get<ThesisDetail[]>('/theses', scopeOptions(scope, report))
}

export function getThesis(id: string) {
  return httpApi.get<ThesisDetail>(`/theses/${id}`)
}

export function createThesis(payload: DraftPayload) {
  return httpApi.post<ThesisDetail>('/theses', payload)
}

export function patchThesis(id: string, payload: DraftPayload) {
  return httpApi.patch<ThesisDetail>(`/theses/${id}`, payload)
}

export function deleteThesis(id: string) {
  return httpApi.delete(`/theses/${id}`)
}

export function submitThesis(id: string, version: number, options?: RequestOptions) {
  return httpApi.post<ThesisDetail>(`/theses/${id}:submit`, { version }, options)
}

export function withdrawThesis(id: string, version: number, reason: string, options?: RequestOptions) {
  return httpApi.post<ThesisDetail>(`/theses/${id}:withdraw`, { version, reason }, options)
}
