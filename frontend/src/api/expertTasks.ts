import { scopeOptions, type TimeScope, type TimeScopeReporter } from './timeScope'
import { httpApi } from './request'

export interface ExpertTaskRow {
  id: string
  status: string
  anonymous_id?: string
  anonymous_title?: string
  discipline_code?: string
  discipline_name?: string
  allowed_actions?: string[]
}

export interface ExpertInvitation {
  id: string
  status: string
  discipline_code: string
  discipline_name: string
  anonymous_id: string
  anonymous_title?: string
  fee: string
}

export function listExpertTasks(scope?: TimeScope, report?: TimeScopeReporter) {
  return scope === undefined ? httpApi.get<ExpertTaskRow[]>('/expert/tasks') : httpApi.get<ExpertTaskRow[]>('/expert/tasks', scopeOptions(scope, report))
}

export function getInvitation(taskId: string) {
  return httpApi.get<ExpertInvitation>(`/expert/tasks/${taskId}/invitation`)
}

export function acceptTask(taskId: string) {
  return httpApi.post(`/expert/tasks/${taskId}:accept`)
}

export function rejectTask(taskId: string, reason: string) {
  return httpApi.post(`/expert/tasks/${taskId}:reject`, { reason })
}

export interface ExpertMaterials {
  task_id: string
  files: Array<{ file_id: string; purpose: string; filename: string }>
}

export function getMaterials(taskId: string) {
  return httpApi.get<ExpertMaterials>(`/expert/tasks/${taskId}/materials`)
}
