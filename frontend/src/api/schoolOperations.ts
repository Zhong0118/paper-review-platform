import { httpApi, type RequestOptions } from './request'
import { optionArgs } from './optionArgs'
import type { ReviewRule } from './review'

export function getSchoolReviewRule(options?: RequestOptions) {
  return httpApi.get<ReviewRule>('/school-review/review-rule', ...optionArgs(options))
}

export interface ReviewBatch {
  accept_days?:number|null
  review_days?:number|null
  program_catalog_id?:string|null
  id: string
  code: string
  name: string
  status: 'DRAFT' | 'OPEN' | 'SUBMISSION_CLOSED' | 'ARCHIVED'
  start_at: string | null
  end_at: string | null
  rule_version: number
  version: number
  allowed_actions: Array<'EDIT' | 'OPEN' | 'CLOSE_SUBMISSIONS' | 'ARCHIVE'>
}

export interface CreateBatchInput {
  code: string
  name: string
  start_at: string | null
  end_at: string | null
}

export interface UpdateBatchInput extends Omit<CreateBatchInput, 'code'> {
  expected_version: number
}

export type MembershipType = 'STUDENT' | 'SUPERVISOR'

export interface SchoolMember {
  membership_id: string
  user_id: string
  username: string
  display_name: string
  external_id: string
  membership_type: MembershipType
  status: string
  is_active: boolean
  contact_phone: string | null
  contact_email: string | null
  updated_at: string
}

export interface CreateMemberInput {
  membership_type: MembershipType
  username: string
  display_name: string
  external_id: string
  password: string
}

export interface UpdateMemberInput {
  display_name: string
  contact_phone: string | null
  contact_email: string | null
  expected_updated_at: string
}

export interface StudentEligibility {
  id: string
  review_batch_id: string
  student_membership_id: string
  supervisor_membership_id: string | null
  student_name: string
  student_no: string
  supervisor_name: string | null
  degree_type: string | null
  status: 'ELIGIBLE' | 'SUSPENDED'
}

export interface CreateEligibilityInput {
  student_membership_id: string
  supervisor_membership_id?: string | null
  degree_type?: string | null
}

export function listBatches(options?: RequestOptions) {
  return httpApi.get<ReviewBatch[]>('/school-admin/batches', ...optionArgs(options))
}

export function createBatch(body: CreateBatchInput, options: RequestOptions) {
  return httpApi.post<ReviewBatch>('/school-admin/batches', body, options)
}

export function updateBatch(id: string, body: UpdateBatchInput, options?: RequestOptions) {
  return httpApi.patch<ReviewBatch>(`/school-admin/batches/${id}`, body, ...optionArgs(options))
}

export function openBatch(id: string, expectedVersion: number, options: RequestOptions) {
  return httpApi.post<ReviewBatch>(`/school-admin/batches/${id}:open`, { expected_version: expectedVersion }, options)
}

export function closeBatch(id: string, expectedVersion: number, options: RequestOptions) {
  return httpApi.post<ReviewBatch>(`/school-admin/batches/${id}:close-submissions`, { expected_version: expectedVersion }, options)
}

export function archiveBatch(id: string, expectedVersion: number, options: RequestOptions) {
  return httpApi.post<ReviewBatch>(`/school-admin/batches/${id}:archive`, { expected_version: expectedVersion }, options)
}

export function listMembers(membershipType?: MembershipType, options?: RequestOptions) {
  const params = membershipType ? { params: { membership_type: membershipType } } : undefined
  return options ? httpApi.get<SchoolMember[]>('/school-admin/members', { ...params, ...options }) : httpApi.get<SchoolMember[]>('/school-admin/members', params)
}

export function createMember(body: CreateMemberInput, options: RequestOptions) {
  return httpApi.post<SchoolMember>('/school-admin/members', body, options)
}

export function updateMember(id: string, body: UpdateMemberInput, options?: RequestOptions) {
  return httpApi.patch<SchoolMember>(`/school-admin/members/${id}`, body, ...optionArgs(options))
}

export function disableMember(id: string, options: RequestOptions) {
  return httpApi.post<SchoolMember>(`/school-admin/members/${id}:disable`, {}, options)
}

export function enableMember(id: string, options: RequestOptions) {
  return httpApi.post<SchoolMember>(`/school-admin/members/${id}:enable`, {}, options)
}

export function resetMemberPassword(id: string, password: string, options: RequestOptions) {
  return httpApi.post<SchoolMember>(`/school-admin/members/${id}:reset-password`, { password }, options)
}

export function listEligibilities(batchId: string, options?: RequestOptions) {
  return httpApi.get<StudentEligibility[]>(`/school-admin/batches/${batchId}/eligibilities`, ...optionArgs(options))
}

export function createEligibility(batchId: string, body: CreateEligibilityInput, options: RequestOptions) {
  return httpApi.post<StudentEligibility>(`/school-admin/batches/${batchId}/eligibilities`, body, options)
}

export function suspendEligibility(id: string, options: RequestOptions) {
  return httpApi.post<StudentEligibility>(`/school-admin/eligibilities/${id}:suspend`, {}, options)
}

export function resumeEligibility(id: string, options: RequestOptions) {
  return httpApi.post<StudentEligibility>(`/school-admin/eligibilities/${id}:resume`, {}, options)
}

export interface CloseoutItem {id:string; thesis_id:string; title:string|null; status:string}
export type BatchCloseout = Record<'unpublished'|'objections'|'corrections',CloseoutItem[]>
export const getBatchCloseout = (id:string, options?:RequestOptions) => httpApi.get<BatchCloseout>(`/school-admin/batches/${id}/closeout`, ...optionArgs(options))

export const saveDeadlines=(id:string,version:number,accept:number|null,review:number|null,options?:RequestOptions)=>
  httpApi.put<ReviewBatch>(`/school-admin/batches/${id}/deadlines`,{expected_version:version,accept_days:accept,review_days:review}, ...optionArgs(options))
