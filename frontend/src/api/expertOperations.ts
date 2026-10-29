import http, { httpApi, type RequestOptions } from './request'

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
  province_name: string | null
  doctoral_supervisor: boolean | null
  masters_supervisor: boolean | null
  research_directions: string[]
  keywords: string[]
  source_url: string | null
  source_note: string | null
  source_checked_at: string | null
  qualification_status: 'PENDING' | 'APPROVED' | 'REJECTED'
  service_status: 'AVAILABLE' | 'UNAVAILABLE'
  conflicts: ExpertConflict[]
  version: number
}

export interface ExpertOptions {
  provinces: string[]
  titles: string[]
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

export const listExperts = (params: Record<string, string> = {}) => httpApi.get<ExpertRecord[]>('/platform-review/experts', { params })
export const expertOptions = () => httpApi.get<ExpertOptions>('/platform-review/expert-options')
export const createExpert = (body: CreateExpert, options: RequestOptions) => httpApi.post<ExpertRecord>('/platform-review/experts', body, options)
export const updateExpert = (id: string, body: ExpertProfile & { version: number }) => httpApi.patch<ExpertRecord>(`/platform-review/experts/${id}`, body)
export const reviewQualification = (id: string, body: { version: number; status: 'APPROVED' | 'REJECTED'; reason: string }) => httpApi.post<ExpertRecord>(`/platform-review/experts/${id}:review-qualification`, body)
export const setServiceStatus = (id: string, body: { version: number; status: 'AVAILABLE' | 'UNAVAILABLE'; reason: string }) => httpApi.post<ExpertRecord>(`/platform-review/experts/${id}:set-service-status`, body)
export const replaceConflicts = (id: string, body: { version: number; items: ExpertConflict[] }) => httpApi.put<ExpertRecord>(`/platform-review/experts/${id}/conflicts`, body)

export type ExpertProfile = Pick<ExpertRecord, 'unit' | 'title' | 'discipline_codes' | 'province_name' | 'doctoral_supervisor' | 'masters_supervisor' | 'research_directions' | 'keywords' | 'source_url' | 'source_note'>
export interface ExpertImportPreview {
  preview_id: string
  expires_at: string
  changes: { expert_id: string; username: string; version: number; diff: Record<string, { before: unknown; after: unknown }> }[]
  errors: { row: number; message: string }[]
}
export const previewExpertImport = (file: File) => {
  const body = new FormData(); body.append('file', file)
  return httpApi.post<ExpertImportPreview>('/platform-review/experts/import:preview', body)
}
export const applyExpertImport = (preview_id: string, key: string) => httpApi.post<{ preview_id: string; updated_count: number }>('/platform-review/experts/import:apply', { preview_id }, { idempotencyKey: key })
export const downloadExpertTemplate = async () => (await http.get<Blob>('/platform-review/experts/import-template', { responseType: 'blob' })).data
