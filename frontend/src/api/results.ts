import { httpApi, type RequestOptions } from './request'

export interface PublishedItem {
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
  summary_total: number | null
  items: PublishedItem[]
  published: boolean
}

export function getSchoolResults(thesisId: string) {
  return httpApi.get<SchoolResults>(`/school-review/theses/${thesisId}/results`)
}

export function publishThesis(thesisId: string, version: number, options?: RequestOptions) {
  return httpApi.post(`/school-review/theses/${thesisId}:publish`, { version }, options)
}

export function getPublishedResult(thesisId: string) {
  return httpApi.get<{ thesis_id: string; total: number; items: PublishedItem[] }>(
    `/my/theses/${thesisId}/published-result`,
  )
}


export interface SupervisedPublishedThesis {
  id: string
  title: string
  student_name: string
}

export function listSupervisedPublishedTheses() {
  return httpApi.get<SupervisedPublishedThesis[]>('/supervisor/theses/published')
}
