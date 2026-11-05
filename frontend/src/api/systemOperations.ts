import { optionArgs } from './optionArgs'
import { httpApi, type RequestOptions } from './request'

export interface TenantSummary {
  id: string
  code: string
  name: string
  status: 'ACTIVE' | 'SUSPENDED'
  root_organization: { id: string; external_id: string; name: string }
  reviewer_count: number
  created_at: string
  allowed_actions: Array<'SUSPEND' | 'RESUME'>
}

export interface SchoolReviewer {
  membership_id: string
  user_id: string
  username: string
  display_name: string
  external_id: string
  status: string
  is_active: boolean
}

export interface CreateReviewerInput {
  username: string
  display_name: string
  external_id: string
  password: string
}

export interface CreateTenantInput {
  institution_code?: string
  code: string
  name: string
  organization: { external_id: string; name: string }
  reviewer: CreateReviewerInput
}

export function listTenants(options?: RequestOptions) {
  return httpApi.get<TenantSummary[]>('/system/tenants', ...optionArgs(options))
}

export function createTenant(body: CreateTenantInput, options: RequestOptions) {
  return httpApi.post<TenantSummary>('/system/tenants', body, options)
}

export function suspendTenant(id: string, options: RequestOptions) {
  return httpApi.post<TenantSummary>(`/system/tenants/${id}:suspend`, {}, options)
}

export function resumeTenant(id: string, options: RequestOptions) {
  return httpApi.post<TenantSummary>(`/system/tenants/${id}:resume`, {}, options)
}

export function listReviewers(tenantId: string, options?: RequestOptions) {
  return httpApi.get<SchoolReviewer[]>(`/system/tenants/${tenantId}/reviewers`, ...optionArgs(options))
}

export function createReviewer(tenantId: string, body: CreateReviewerInput, options: RequestOptions) {
  return httpApi.post<SchoolReviewer>(`/system/tenants/${tenantId}/reviewers`, body, options)
}

export function disableReviewer(tenantId: string, userId: string, options: RequestOptions) {
  return httpApi.post<SchoolReviewer>(`/system/tenants/${tenantId}/reviewers/${userId}:disable`, {}, options)
}

export function enableReviewer(tenantId: string, userId: string, options: RequestOptions) {
  return httpApi.post<SchoolReviewer>(`/system/tenants/${tenantId}/reviewers/${userId}:enable`, {}, options)
}

export function resetReviewerPassword(tenantId: string, userId: string, password: string, options: RequestOptions) {
  return httpApi.post<SchoolReviewer>(`/system/tenants/${tenantId}/reviewers/${userId}:reset-password`, { password }, options)
}
