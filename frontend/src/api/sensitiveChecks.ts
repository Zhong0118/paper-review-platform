import { httpApi } from './request'

export interface SensitiveFinding {
  field: string
  location: string
  matched_text: string
  kind?: 'IDENTITY' | 'SCHOOL_TERM' | 'TITLE_NOT_FOUND'
  source?: string
  page_number?: number | null
  context?: string
  severity?: 'WARN' | 'BLOCK'
  description?: string
}
export interface SensitiveReport {
  auto_conclusion: string | null
  manual_conclusion: string | null
  findings: SensitiveFinding[]
  stale?: boolean
  source_metadata?: {
    thesis_version_id: string; file_id: string; file_sha256: string; detector_version: string; terms_version: number
    input_sha256?: string; title_status: 'FOUND' | 'TITLE_NOT_FOUND' | 'NOT_CHECKED'
    uncertain: boolean; uncertain_pages: number[]; page_count: number
  } | null
}
export interface SensitiveTerm { text: string; severity: 'WARN' | 'BLOCK'; description: string }
export interface SensitiveTerms { version: number; terms: SensitiveTerm[] }
export const getSensitiveTerms = () => httpApi.get<SensitiveTerms>('/school-admin/sensitive-terms')
export const saveSensitiveTerms = (body: {expected_version: number; terms: SensitiveTerm[]}) =>
  httpApi.put<SensitiveTerms>('/school-admin/sensitive-terms', body)
export const checkSensitiveThesis = (id: string, body: {expected_version: number; file_id: string}, school = false) =>
  httpApi.post<SensitiveReport>(`${school ? '/school-review' : ''}/theses/${id}/sensitive-checks`, body)
