/** U4-2 异议视图的名称与渠道文字（后端状态：SUBMITTED / PROCESSING / RESOLVED）。 */
export type ObjectionStatus = 'SUBMITTED' | 'PROCESSING' | 'RESOLVED'

export const objectionViews: { key: ObjectionStatus; label: string }[] = [
  { key: 'SUBMITTED', label: '待处理' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'RESOLVED', label: '已办结' },
]

export const channelText: Record<'ONLINE' | 'OFFLINE', string> = { ONLINE: '线上答复', OFFLINE: '线下沟通' }
