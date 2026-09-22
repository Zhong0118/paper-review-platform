import { httpApi, type RequestOptions } from './request'
import type { ThesisDetail } from './theses'

export function listSchoolTheses() {
  return httpApi.get<ThesisDetail[]>('/school-review/theses')
}

export function getSchoolThesis(id: string) {
  return httpApi.get<ThesisDetail>(`/school-review/theses/${id}`)
}

export function confirmAnonymization(
  id: string,
  body: { decision: 'PASS' | 'REJECT'; version: number; reason?: string },
  options?: RequestOptions,
) {
  return httpApi.post<ThesisDetail>(`/school-review/theses/${id}:confirm-anonymization`, body, options)
}

export function terminateThesis(id: string, body: { version: number; reason: string }, options?: RequestOptions) {
  return httpApi.post<ThesisDetail>(`/school-review/theses/${id}:terminate`, body, options)
}
