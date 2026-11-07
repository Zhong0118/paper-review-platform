/**
 * U4-6 专家库的纯函数：视图分组、行标、能否指派的说明、标签拆分、档案差异与校验。
 * 校验与后端 ProfileFields / CreateExpertInput 一致，不另加规则。
 */
import type { ExpertOptions, ExpertProfile, ExpertRecord } from '@/api/expertOperations'

export type ExpertView = 'ready' | 'pending' | 'blocked'
export const accountActive = (row: ExpertRecord) => row.account_status === 'ACTIVE'

export function bucket(row: ExpertRecord): ExpertView {
  if (row.qualification_status === 'PENDING') return 'pending'
  return row.qualification_status === 'APPROVED' && row.service_status === 'AVAILABLE' && accountActive(row) ? 'ready' : 'blocked'
}

export function rowPill(row: ExpertRecord): { tone: 'action' | 'neutral' | 'warning'; text: string } | null {
  if (!accountActive(row)) return { tone: 'neutral', text: '账号停用' }
  if (row.qualification_status === 'PENDING') return { tone: 'action', text: '待审核' }
  if (row.qualification_status === 'REJECTED') return { tone: 'neutral', text: '资格未通过' }
  if (row.service_status === 'UNAVAILABLE') return { tone: 'warning', text: '暂停接单' }
  return null
}

/** 逐条说明原因，不合成一个“不可用” */
export function availability(row: ExpertRecord): { tone: 'success' | 'warning'; text: string } {
  const reasons: string[] = []
  if (row.qualification_status === 'PENDING') reasons.push('资格尚未审核')
  if (row.qualification_status === 'REJECTED') reasons.push('资格审核未通过')
  if (row.service_status === 'UNAVAILABLE') reasons.push('已暂停接单')
  if (!accountActive(row)) reasons.push('账号不可登录')
  if (reasons.length) return { tone: 'warning', text: `现在不能指派：${reasons.join('；')}` }
  return { tone: 'success', text: row.conflicts.length ? `可以指派；对 ${row.conflicts.length} 项回避对象的论文不可派` : '可以指派' }
}

export const qualificationText: Record<ExpertRecord['qualification_status'], string> = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' }
export const serviceText: Record<ExpertRecord['service_status'], string> = { AVAILABLE: '可接单', UNAVAILABLE: '暂停接单' }

export const splitTags = (value: string) => [...new Set(value.split(/[;；、]/).map((part) => part.trim()).filter(Boolean))]
export const joinTags = (values: string[] | null | undefined) => (values ?? []).join('；')

export interface ProfileForm {
  unit: string
  title: string
  discipline_codes: string[]
  province_name: string
  doctoral_supervisor: boolean | null
  masters_supervisor: boolean | null
  directions: string
  keywords: string
  source_url: string
  source_note: string
}

export const profileFrom = (row: ExpertRecord): ProfileForm => ({
  unit: row.unit,
  title: row.title,
  discipline_codes: [...row.discipline_codes].sort(),
  province_name: row.province_name ?? '',
  doctoral_supervisor: row.doctoral_supervisor ?? null,
  masters_supervisor: row.masters_supervisor ?? null,
  directions: joinTags(row.research_directions),
  keywords: joinTags(row.keywords),
  source_url: row.source_url ?? '',
  source_note: row.source_note ?? '',
})

export const toProfile = (form: ProfileForm): ExpertProfile => ({
  unit: form.unit.trim(),
  title: form.title.trim(),
  discipline_codes: [...form.discipline_codes].sort(),
  province_name: form.province_name || null,
  doctoral_supervisor: form.doctoral_supervisor,
  masters_supervisor: form.masters_supervisor,
  research_directions: splitTags(form.directions).sort(),
  keywords: splitTags(form.keywords).sort(),
  source_url: form.source_url.trim() || null,
  source_note: form.source_note.trim() || null,
})

const fieldLabels: Record<keyof ExpertProfile, string> = {
  unit: '单位', title: '职称', discipline_codes: '学科', province_name: '省份', doctoral_supervisor: '博导', masters_supervisor: '硕导',
  research_directions: '研究方向', keywords: '关键词', source_url: '来源链接', source_note: '来源说明',
}
const tri = (value: boolean | null) => (value == null ? '未知' : value ? '是' : '否')
function show(key: keyof ExpertProfile, value: unknown, disciplines: ExpertOptions['disciplines']): string {
  if (key === 'doctoral_supervisor' || key === 'masters_supervisor') return tri(value as boolean | null)
  if (key === 'discipline_codes') return (value as string[]).map((code) => disciplines.find((item) => item.code === code)?.name ?? code).join('、') || '未填写'
  if (Array.isArray(value)) return value.join('、') || '未填写'
  return (value as string | null) || '未填写'
}

export function profileDiff(form: ProfileForm, row: ExpertRecord, disciplines: ExpertOptions['disciplines'] = []) {
  const mine = toProfile(form)
  const theirs = toProfile(profileFrom(row))
  return (Object.keys(fieldLabels) as (keyof ExpertProfile)[])
    .filter((key) => JSON.stringify(mine[key]) !== JSON.stringify(theirs[key]))
    .map((key) => ({ key, label: fieldLabels[key], mine: show(key, mine[key], disciplines), theirs: show(key, theirs[key], disciplines) }))
}
export const profileDirty = (form: ProfileForm, row: ExpertRecord) => profileDiff(form, row).length > 0

const tagError = (label: string, value: string) => {
  const tags = splitTags(value)
  if (tags.length > 20) return `${label}最多 20 项。`
  if (tags.some((tag) => [...tag].length < 2 || [...tag].length > 64)) return `${label}每项 2–64 个字。`
  return ''
}

export function profileErrors(form: ProfileForm): Partial<Record<keyof ProfileForm, string>> {
  const errors: Partial<Record<keyof ProfileForm, string>> = {}
  if (form.unit.trim().length > 128) errors.unit = '单位不超过 128 个字。'
  if (form.title.trim().length > 128) errors.title = '职称不超过 128 个字。'
  if (!form.discipline_codes.length) errors.discipline_codes = '至少选择 1 个学科。'
  else if (form.discipline_codes.length > 20) errors.discipline_codes = '学科最多 20 个。'
  const directions = tagError('研究方向', form.directions)
  if (directions) errors.directions = directions
  const keywords = tagError('关键词', form.keywords)
  if (keywords) errors.keywords = keywords
  const url = form.source_url.trim()
  if (url) {
    let ok = false
    try {
      const parsed = new URL(url)
      ok = ['http:', 'https:'].includes(parsed.protocol) && Boolean(parsed.hostname) && !parsed.username && !parsed.password && !/\s/.test(url)
    } catch { ok = false }
    if (!ok) errors.source_url = '来源须为不含账号密码的 http 或 https 链接。'
    else if (url.length > 2048) errors.source_url = '来源链接不超过 2048 个字符。'
  }
  if (form.source_note.trim().length > 1000) errors.source_note = '来源说明不超过 1000 个字。'
  return errors
}

export interface NewExpert { username: string; display_name: string; password: string; again: string; unit: string; title: string; discipline_codes: string[] }

export function newExpertErrors(draft: NewExpert): Partial<Record<keyof NewExpert, string>> {
  const errors: Partial<Record<keyof NewExpert, string>> = {}
  const username = draft.username.trim().toLowerCase()
  if (!username) errors.username = '请填写登录名。'
  else if (!/^[a-z0-9._-]{3,64}$/.test(username)) errors.username = '登录名为 3–64 位，只能用字母、数字和 . _ -。'
  if (!draft.display_name.trim()) errors.display_name = '请填写姓名。'
  else if (draft.display_name.trim().length > 128) errors.display_name = '姓名不超过 128 个字。'
  if (!draft.password) errors.password = '请输入初始密码。'
  else if (draft.password.length < 12) errors.password = '初始密码至少 12 位。'
  else if (draft.password.length > 128) errors.password = '初始密码不超过 128 位。'
  else if (draft.password !== draft.again) errors.password = '两次输入不一致。'
  if (draft.unit.trim().length > 128) errors.unit = '单位不超过 128 个字。'
  if (draft.title.trim().length > 128) errors.title = '职称不超过 128 个字。'
  if (!draft.discipline_codes.length) errors.discipline_codes = '至少选择 1 个学科。'
  else if (draft.discipline_codes.length > 20) errors.discipline_codes = '学科最多 20 个。'
  return errors
}
