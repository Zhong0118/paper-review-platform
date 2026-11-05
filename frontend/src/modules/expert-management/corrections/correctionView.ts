/**
 * U4-7 平台更正审批的纯函数：视图分组、申请理由与处理记录、进度。
 * 平台只看申请信息（E5）：这里不读取、不整理 revision。
 */
import type { Correction, CorrectionStatus } from '@/api/corrections'

export const statusText: Record<CorrectionStatus, string> = {
  REQUESTED: '待平台审批', APPROVED: '已批准，待专家提交', REJECTED: '平台已驳回', CANCELLED: '专家已取消',
  AWAITING_SCHOOL: '待学校确认', ACTIVATED: '更正已生效', SCHOOL_REJECTED: '学校未予确认',
}
export type Tone = 'action' | 'warning' | 'neutral' | 'success'
export function statusTone(status: CorrectionStatus): Tone {
  if (status === 'REQUESTED') return 'action'
  if (status === 'ACTIVATED') return 'success'
  if (status === 'APPROVED' || status === 'AWAITING_SCHOOL') return 'warning'
  return 'neutral'
}

export type ViewKey = 'pending' | 'done' | 'all'
export const isPending = (row: Correction) => row.status === 'REQUESTED'
export const inView = (row: Correction, view: ViewKey) => view === 'all' || (view === 'pending') === isPending(row)

const noteLabels: Record<string, string> = { EXPERT_REQUEST: '专家申请', PLATFORM_DECISION: '平台审批', SCHOOL_DECISION: '学校确认' }
export const requestReason = (row: Correction) => row.notes.find((note) => note.kind === 'EXPERT_REQUEST')?.reason ?? ''
/** 申请理由之后的处理记录 */
export const laterNotes = (row: Correction) =>
  row.notes.filter((note, index) => !(note.kind === 'EXPERT_REQUEST' && row.notes.findIndex((item) => item.kind === 'EXPERT_REQUEST') === index))
    .map((note) => ({ label: noteLabels[note.kind] ?? '处理记录', reason: note.reason }))

export const steps = ['专家申请', '平台批准', '专家提交更正稿', '学校确认生效'] as const
/** 当前所处步骤：之前的步骤已完成；ended 表示在这一步终止；complete 表示全部完成 */
export function progress(status: CorrectionStatus): { step: number; ended?: string; complete?: boolean } {
  switch (status) {
    case 'REQUESTED': return { step: 1 }
    case 'APPROVED': return { step: 2 }
    case 'AWAITING_SCHOOL': return { step: 3 }
    case 'ACTIVATED': return { step: 4, complete: true }
    case 'REJECTED': return { step: 1, ended: '平台驳回了申请，原评阅结果不变。' }
    case 'CANCELLED': return { step: 1, ended: '专家取消了申请，原评阅结果不变。' }
    case 'SCHOOL_REJECTED': return { step: 3, ended: '学校未予确认，已发布的原结果继续有效。' }
  }
}

export const shortTask = (row: Correction) => row.task_id.slice(0, 8)
export function when(value: string) {
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
