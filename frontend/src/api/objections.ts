import { httpApi, type RequestOptions } from './request'

export interface ObjectionRow {
  id: string
  thesis_id: string
  reason: string
  request: string
  created_at: string
  status: string
  channel: string | null
  conclusion: string | null
  student_name?: string
}

export function createObjection(thesisId: string, body: { reason: string; request?: string }, options?: RequestOptions) {
  return httpApi.post<ObjectionRow>(`/my/theses/${thesisId}/objections`, body, options)
}

export function listMyObjections(thesisId: string) {
  return httpApi.get<ObjectionRow[]>(`/my/theses/${thesisId}/objections`)
}

export function listSchoolObjections() {
  return httpApi.get<ObjectionRow[]>('/school-review/objections')
}

export function startObjection(id: string) {
  return httpApi.post<ObjectionRow>(`/school-review/objections/${id}:start`)
}

export function resolveObjection(id: string, body: { channel: 'ONLINE' | 'OFFLINE'; conclusion: string }) {
  return httpApi.post<ObjectionRow>(`/school-review/objections/${id}:record-resolution`, body)
}
