import { httpApi, type RequestOptions } from './request'

export interface ExpertConflict {
  kind: 'TENANT_ID' | 'SUPERVISOR_NAME'
  value: string
}

export interface ExpertRecord {
  id: string
  user_id: string
  username: string
  display_name: string
  account_status: string
  unit: string
  title: string
  discipline_codes: string[]
  qualification_status: 'PENDING' | 'APPROVED' | 'REJECTED'
  service_status: 'AVAILABLE' | 'UNAVAILABLE'
  conflicts: ExpertConflict[]
  version: number
}

export interface ExpertOptions {
  schools: { id: string; name: string; status: string }[]
  disciplines: { code: string; name: string }[]
}

export interface CreateExpert {
  username: string
  display_name: string
  initial_password: string
  unit: string
  title: string
  discipline_codes: string[]
}

export const listExperts = () => httpApi.get<ExpertRecord[]>('/platform-review/experts')
export const expertOptions = () => httpApi.get<ExpertOptions>('/platform-review/expert-options')
export const createExpert = (body: CreateExpert, options: RequestOptions) => httpApi.post<ExpertRecord>('/platform-review/experts', body, options)
export const updateExpert = (id: string, body: { version: number; unit: string; title: string; discipline_codes: string[] }) => httpApi.patch<ExpertRecord>(`/platform-review/experts/${id}`, body)
export const reviewQualification = (id: string, body: { version: number; status: 'APPROVED' | 'REJECTED'; reason: string }) => httpApi.post<ExpertRecord>(`/platform-review/experts/${id}:review-qualification`, body)
export const setServiceStatus = (id: string, body: { version: number; status: 'AVAILABLE' | 'UNAVAILABLE'; reason: string }) => httpApi.post<ExpertRecord>(`/platform-review/experts/${id}:set-service-status`, body)
export const replaceConflicts = (id: string, body: { version: number; items: ExpertConflict[] }) => httpApi.put<ExpertRecord>(`/platform-review/experts/${id}/conflicts`, body)
