import type {
  DemoPublishedResult,
  StudentEligibility,
  StudentFileMetadata,
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
  fileMetadataByThesis: Record<string, StudentFileMetadata[]>
  resultsByThesis: Record<string, DemoPublishedResult[]>
  nextDraftSequence: number
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
    fileMetadataByThesis: {
      'thesis-main': [
        {
          kind: 'ORIGINAL',
          purpose: 'SCHOOL_ARCHIVE',
          fileName: '林知远-硕士学位论文.pdf',
          sizeBytes: 3145728,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
        {
          kind: 'ANONYMOUS',
          purpose: 'EXPERT_REVIEW',
          fileName: 'HY-2026-0042-匿名版.pdf',
          sizeBytes: 2988441,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
      ],
      'thesis-0031': [
        {
          kind: 'ORIGINAL',
          purpose: 'SCHOOL_ARCHIVE',
          fileName: '20260042-联邦学习.pdf',
          sizeBytes: 2675510,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
        {
          kind: 'ANONYMOUS',
          purpose: 'EXPERT_REVIEW',
          fileName: 'HY-2025-0031-匿名版.pdf',
          sizeBytes: 2516582,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
      ],
    },
    resultsByThesis: {
      'thesis-0031': [
        {
          expertAlias: '专家 B',
          score: 82,
          recommendation: '建议通过',
          comment: '历史论文评阅结果。',
          submittedAt: '2026-01-18 09:35',
        },
      ],
    },
    nextDraftSequence: 49,
  }
}
