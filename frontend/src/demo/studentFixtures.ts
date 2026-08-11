import type {
  DemoPublishedResult,
  StudentEligibility,
  ThesisFileMeta,
  StudentNotification,
  StudentObjection,
  StudentTimelineEvent,
  StudentWithdrawalRequest,
} from './types'

export interface StudentPortalState {
  eligibility: StudentEligibility
  notifications: StudentNotification[]
  timelines: Record<string, StudentTimelineEvent[]>
  publicReasonsByThesis: Record<string, string>
  objections: StudentObjection[]
  withdrawalRequests: StudentWithdrawalRequest[]
  abstractsByThesis: Record<string, string>
  fileMetadataByThesis: Record<string, ThesisFileMeta[]>
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
    publicReasonsByThesis: {},
    objections: [],
    withdrawalRequests: [],
    abstractsByThesis: {
      'thesis-main': '研究面向复杂场景中的多模态知识推理方法与可信机制。',
      'thesis-0031': '研究面向边缘环境的可信联邦学习方法。',
    },
    fileMetadataByThesis: {
      'thesis-main': [
        {
          id: 'file-thesis-main-original',
          purpose: 'SCHOOL_ARCHIVE',
          name: '林知远-硕士学位论文.pdf',
          size: 3145728,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
        {
          id: 'file-thesis-main-anonymous',
          purpose: 'EXPERT_REVIEW',
          name: 'HY-2026-0042-匿名版.pdf',
          size: 2988441,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
      ],
      'thesis-0031': [
        {
          id: 'file-thesis-0031-original',
          purpose: 'SCHOOL_ARCHIVE',
          name: '20260042-联邦学习.pdf',
          size: 2675510,
          mimeType: 'application/pdf',
          validationStatus: 'VALID',
        },
        {
          id: 'file-thesis-0031-anonymous',
          purpose: 'EXPERT_REVIEW',
          name: 'HY-2025-0031-匿名版.pdf',
          size: 2516582,
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
