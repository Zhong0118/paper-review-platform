/**
 * U4-8 学校管理的纯函数：状态文案、筛选、表单校验与请求体。
 * 校验规则与后端一致（见 U4 计划 §15）；密码只在表单里，不进任何签名或文案。
 */
import type { InstitutionOption } from '@/api/catalogs'
import type { CreateReviewerInput, CreateTenantInput, TenantSummary } from '@/api/systemOperations'

export type TenantStatus = TenantSummary['status']
export const statusText: Record<TenantStatus, string> = { ACTIVE: '正常', SUSPENDED: '已暂停' }
export const statusTone = (status: TenantStatus) => (status === 'ACTIVE' ? 'success' : 'warning')

export const isStatus = (value: unknown): value is TenantStatus => value === 'ACTIVE' || value === 'SUSPENDED'

export function matchTenant(tenant: TenantSummary, keyword: string, status: TenantStatus | '') {
  const q = keyword.trim().toLowerCase()
  if (status && tenant.status !== status) return false
  return !q || tenant.name.toLowerCase().includes(q) || tenant.code.toLowerCase().includes(q)
}

export const dateText = (iso: string) => iso.slice(0, 10)

const CODE = /^[a-z0-9-]{2,32}$/
const USERNAME = /^[a-z0-9._-]{3,64}$/
export const normalCode = (code: string) => code.trim().toLowerCase()

export function passwordError(password: string, again: string) {
  if (!password) return '请输入密码。'
  if (password.length < 12) return '至少 12 位。'
  if (password.length > 128) return '不超过 128 位。'
  return password === again ? '' : '两次输入不一致。'
}

function textError(value: string, max: number, label: string) {
  const text = value.trim()
  if (!text) return `请填写${label}。`
  return text.length > max ? `${label}不超过 ${max} 个字。` : ''
}

export interface ReviewerDraft {
  display_name: string
  username: string
  external_id: string
  password: string
  again: string
}
export const emptyReviewer = (): ReviewerDraft => ({ display_name: '', username: '', external_id: '', password: '', again: '' })

export function reviewerErrors(draft: ReviewerDraft) {
  const errors: Partial<Record<keyof ReviewerDraft, string>> = {}
  const name = textError(draft.display_name, 128, '姓名')
  if (name) errors.display_name = name
  if (!draft.username.trim()) errors.username = '请填写登录名。'
  else if (!USERNAME.test(draft.username.trim().toLowerCase())) errors.username = '3–64 位小写字母、数字或 . _ -。'
  const staff = textError(draft.external_id, 64, '工号')
  if (staff) errors.external_id = staff
  const password = passwordError(draft.password, draft.again)
  if (password) errors.password = password
  return errors
}

export const toReviewerInput = (draft: ReviewerDraft): CreateReviewerInput => ({
  username: draft.username.trim().toLowerCase(),
  display_name: draft.display_name.trim(),
  external_id: draft.external_id.trim(),
  password: draft.password,
})

export interface TenantDraft {
  code: string
  org_id: string
  org_name: string
  reviewer: ReviewerDraft
}
export const emptyTenant = (): TenantDraft => ({ code: '', org_id: '', org_name: '', reviewer: emptyReviewer() })

export type TenantErrors = Partial<Record<'institution' | 'code' | 'org_id' | 'org_name', string>> & { reviewer?: ReturnType<typeof reviewerErrors> }

export function tenantErrors(draft: TenantDraft, institution: InstitutionOption | null): TenantErrors {
  const errors: TenantErrors = {}
  if (!institution) errors.institution = '请从官方名录中选择一所院校。'
  if (!CODE.test(normalCode(draft.code))) errors.code = '2–32 位小写字母、数字或短横线。'
  const orgId = textError(draft.org_id, 64, '根组织编号')
  if (orgId) errors.org_id = orgId
  const orgName = textError(draft.org_name, 128, '根组织名称')
  if (orgName) errors.org_name = orgName
  const reviewer = reviewerErrors(draft.reviewer)
  if (Object.keys(reviewer).length) errors.reviewer = reviewer
  return errors
}

export const toTenantInput = (draft: TenantDraft, institution: InstitutionOption): CreateTenantInput => ({
  institution_code: institution.code,
  code: normalCode(draft.code),
  name: institution.name,
  organization: { external_id: draft.org_id.trim(), name: draft.org_name.trim() },
  reviewer: toReviewerInput(draft.reviewer),
})

export const codeOwner = (tenants: TenantSummary[], code: string) => tenants.find((tenant) => tenant.code === normalCode(code)) ?? null
