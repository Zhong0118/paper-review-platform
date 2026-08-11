import type {
  StudentEligibility,
  StudentNotification,
  StudentObjection,
  StudentTimelineEvent,
  StudentWithdrawalRequest,
} from './types'

export interface StudentPortalState {
  eligibility: StudentEligibility
  notifications: StudentNotification[]
  timelines: Record<string, StudentTimelineEvent[]>
  objections: StudentObjection[]
  withdrawalRequests: StudentWithdrawalRequest[]
}

export function createInitialStudentPortalState(): StudentPortalState {
  return {
    eligibility: {
      eligible: true,
      status: 'ELIGIBLE',
      reason: '当前学籍和批次资格有效。',
      batchId: 'batch-2026-spring',
      batchName: '2026 年春季硕士论文盲审',
      deadline: '2026-05-20 18:00',
    },
    notifications: [],
    timelines: {
      'thesis-main': [
        {
          id: 'timeline-main-created',
          kind: 'DRAFT_CREATED',
          occurredAt: '2026-08-10 16:20',
          message: '已创建论文草稿。',
        },
      ],
    },
    objections: [],
    withdrawalRequests: [],
  }
}
