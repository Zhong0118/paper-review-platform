import { httpApi } from './request'
import type { TimeScope } from './timeScope'
export type StatusFilter = 'ALL' | 'WAITING' | 'INVITED' | 'IN_REVIEW' | 'SUBMITTED'
export interface Dashboard {
  as_of: string
  time_scope: TimeScope
  time_from: string | null
  cards: { waiting_theses: number; invited_tasks: number; in_review_tasks: number; submitted_tasks: number; overdue_tasks: null }
  overdue_status: 'NOT_CONFIGURED'
  published_count?: number
  published_score_bands?: Array<{ code: string; count: number }>
}
export const schoolDashboard = (scope: TimeScope) => httpApi.get<Dashboard>('/school-review/dashboard', { params: { time_scope: scope } })
export const platformDashboard = (scope: TimeScope) => httpApi.get<Dashboard>('/platform-review/dashboard', { params: { time_scope: scope } })
