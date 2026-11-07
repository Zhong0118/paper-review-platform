/**
 * U4-4 成员与资格的纯函数：资格状态、联系方式差异、新建与密码校验。
 * 校验与后端 schema 一致（CreateTenantUserInput、UpdateMemberInput、ResetPasswordInput），不另加规则。
 */
import type { ReviewBatch, SchoolMember, StudentEligibility } from '@/api/schoolOperations'

export const currentBatch = (batch: ReviewBatch | undefined) => batch?.status === 'DRAFT' || batch?.status === 'OPEN'

/** none：草稿/开放批次里没有资格；suspended：有资格但都已暂停；eligible：至少一份有效 */
export function eligibilityState(memberId: string, rows: StudentEligibility[], batches: ReviewBatch[]): 'none' | 'suspended' | 'eligible' {
  const byId = new Map(batches.map((batch) => [batch.id, batch]))
  const current = rows.filter((row) => row.student_membership_id === memberId && currentBatch(byId.get(row.review_batch_id)))
  if (!current.length) return 'none'
  return current.some((row) => row.status === 'ELIGIBLE') ? 'eligible' : 'suspended'
}

/** 可以为这位学生建立资格的批次：草稿或开放，且本批还没有他的资格 */
export function batchesForNewEligibility(memberId: string, rows: StudentEligibility[], batches: ReviewBatch[]): ReviewBatch[] {
  const taken = new Set(rows.filter((row) => row.student_membership_id === memberId).map((row) => row.review_batch_id))
  return batches.filter((batch) => currentBatch(batch) && !taken.has(batch.id))
}

export interface ContactForm { name: string; phone: string; email: string }
export const contactFrom = (member: SchoolMember): ContactForm => ({ name: member.display_name, phone: member.contact_phone ?? '', email: member.contact_email ?? '' })
const contactLabels: Record<keyof ContactForm, string> = { name: '姓名', phone: '电话', email: '邮箱' }

export function contactDirty(form: ContactForm, member: SchoolMember): boolean {
  const server = contactFrom(member)
  return (Object.keys(server) as (keyof ContactForm)[]).some((key) => form[key].trim() !== server[key].trim())
}

export function contactDiff(form: ContactForm, member: SchoolMember) {
  const server = contactFrom(member)
  return (Object.keys(server) as (keyof ContactForm)[])
    .filter((key) => form[key].trim() !== server[key].trim())
    .map((key) => ({ key, label: contactLabels[key], mine: form[key].trim() || '未填写', theirs: server[key].trim() || '未填写' }))
}

export function contactErrors(form: ContactForm): Partial<Record<keyof ContactForm, string>> {
  const errors: Partial<Record<keyof ContactForm, string>> = {}
  if (!form.name.trim()) errors.name = '请填写姓名。'
  else if (form.name.trim().length > 128) errors.name = '姓名不超过 128 个字。'
  if (form.phone.trim().length > 32) errors.phone = '电话不超过 32 个字符。'
  if (form.email.trim().length > 128) errors.email = '邮箱不超过 128 个字符。'
  return errors
}

export function passwordError(first: string, second: string): string {
  if (!first) return '请输入密码。'
  if (first.length < 12) return '密码至少 12 位。'
  if (first.length > 128) return '密码不超过 128 位。'
  if (first !== second) return '两次输入不一致。'
  return ''
}

export interface NewMember { type: 'STUDENT' | 'SUPERVISOR'; name: string; externalId: string; username: string; password: string; again: string }

export function newMemberErrors(draft: NewMember): Partial<Record<'name' | 'externalId' | 'username' | 'password', string>> {
  const errors: Partial<Record<'name' | 'externalId' | 'username' | 'password', string>> = {}
  const idLabel = draft.type === 'STUDENT' ? '学号' : '工号'
  if (!draft.name.trim()) errors.name = '请填写姓名。'
  else if (draft.name.trim().length > 128) errors.name = '姓名不超过 128 个字。'
  if (!draft.externalId.trim()) errors.externalId = `请填写${idLabel}。`
  else if (draft.externalId.trim().length > 64) errors.externalId = `${idLabel}不超过 64 个字符。`
  const username = draft.username.trim().toLowerCase()
  if (!username) errors.username = '请填写登录账号。'
  else if (!/^[a-z0-9._-]{3,64}$/.test(username)) errors.username = '登录账号为 3–64 位，只能用字母、数字和 . _ -。'
  const pw = passwordError(draft.password, draft.again)
  if (pw) errors.password = pw
  return errors
}

export const idLabel = (type: SchoolMember['membership_type']) => (type === 'STUDENT' ? '学号' : '工号')
