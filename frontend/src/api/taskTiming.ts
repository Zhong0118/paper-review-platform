export interface TaskDeadline {
  invited_at: string | null
  accepted_at: string | null
  accept_due_at: string | null
  original_review_due_at?: string | null
  review_due_at: string | null
  overdue: boolean
}
export function beijingTime(iso?: string | null) {
  return iso
    ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : ''
}
/** 只显示日期（北京时区），与 beijingTime 同一写法；不要用 iso.slice(0, 10)，那是 UTC 日期（F1 · A7）。 */
export function beijingDate(iso?: string | null) {
  return iso ? new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''
}
export function deadlineLabel(status: string, clock?: TaskDeadline) {
  if (status !== 'INVITED' && status !== 'IN_REVIEW') return ''
  const invited = status === 'INVITED',
    value = beijingTime(invited ? clock?.accept_due_at : clock?.review_due_at)
  return (
    (invited ? '接单截止：' : '评阅截止：') +
    (value ? value + ' 北京时间' : '未配置') +
    (clock?.overdue ? ' · 已逾期' : '')
  )
}

export interface ExtensionRecord {
  id: string
  task_id: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  actionable: boolean
  requested_at: string
  original_due_at: string
  requested_due_at: string
  reason: string
  decided_at: string | null
  decision_reason: string | null
}
