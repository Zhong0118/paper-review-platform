import { httpApi, type RequestOptions } from './request'
import { optionArgs } from './optionArgs'

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

export function listSchoolObjections(options?: RequestOptions) {
  return httpApi.get<ObjectionRow[]>('/school-review/objections', ...optionArgs(options))
}

export function startObjection(id: string, options?: RequestOptions) {
  const url = `/school-review/objections/${id}:start`
  return options ? httpApi.post<ObjectionRow>(url, undefined, options) : httpApi.post<ObjectionRow>(url)
}

export function resolveObjection(id: string, body: { channel: 'ONLINE' | 'OFFLINE'; conclusion: string }, options?: RequestOptions) {
  return httpApi.post<ObjectionRow>(`/school-review/objections/${id}:record-resolution`, body, ...optionArgs(options))
}
