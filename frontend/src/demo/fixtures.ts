import type {
  DemoReview,
  DemoStage,
  DemoThesisSummary,
  ReviewTaskStatus,
  SchoolAccountSummary,
  SchoolBill,
} from './types'

export interface DemoScenarioState {
  activeRole: import('@/types/roles').RoleCode
  stage: DemoStage
  review: DemoReview
  taskStatus?: ReviewTaskStatus
  schoolAccount: SchoolAccountSummary
  schoolBills: SchoolBill[]
  expertAccount: { currency: 'CNY'; availableAmount: number; pendingAmount: number }
  theses: DemoThesisSummary[]
}

export const demoIdentity = {
  tenantName: '海岳大学',
  batchName: '2026 年春季硕士论文盲审',
  studentName: '林知远',
  supervisorName: '赵文博教授',
  expertName: '周明远教授',
} as const

export const demoThesis = {
  id: 'thesis-main',
  anonymousId: 'HY-2026-0042',
  title: '面向复杂场景的多模态知识推理研究',
} as const

export const demoTheses: DemoThesisSummary[] = [
  {
    ...demoThesis,
    studentId: '20260042',
    studentName: demoIdentity.studentName,
    batchId: 'batch-2026-spring',
    batchName: demoIdentity.batchName,
    discipline: { code: '0812', name: '计算机科学与技术' },
    keywords: ['多模态推理', '知识图谱', '可信人工智能'],
    originalFileName: '林知远-硕士学位论文.pdf',
    anonymousFileName: 'HY-2026-0042-匿名版.pdf',
    submissionSource: 'STUDENT',
    stage: 'DRAFT',
    updatedAt: '2026-08-10 16:20',
    allowedActions: ['EDIT_THESIS'],
  },
  {
    id: 'thesis-0031',
    anonymousId: 'HY-2025-0031',
    title: '面向边缘环境的可信联邦学习方法研究',
    studentId: '20260042',
    studentName: demoIdentity.studentName,
    batchId: 'batch-2025-autumn',
    batchName: '2025 年秋季硕士论文盲审',
    discipline: { code: '0812', name: '计算机科学与技术' },
    keywords: ['联邦学习', '隐私计算'],
    originalFileName: '20260042-联邦学习.pdf',
    anonymousFileName: 'HY-2025-0031-匿名版.pdf',
    submissionSource: 'SCHOOL_BATCH',
    stage: 'COMPLETED',
    updatedAt: '2026-01-18 09:35',
    allowedActions: ['VIEW_RESULT'],
  },
  {
    id: 'thesis-0048',
    anonymousId: 'HY-2026-0048',
    title: '复杂系统中的知识发现与风险识别',
    studentId: '20260048',
    studentName: '陈一诺',
    batchId: 'batch-2026-spring',
    batchName: demoIdentity.batchName,
    discipline: { code: '1201', name: '管理科学与工程' },
    keywords: ['知识发现', '风险识别'],
    originalFileName: '20260048.pdf',
    anonymousFileName: 'HY-2026-0048.pdf',
    submissionSource: 'SCHOOL_MANUAL',
    stage: 'SUBMITTED',
    updatedAt: '2026-08-10 15:05',
    allowedActions: ['VIEW_THESIS'],
  },
]

export function createInitialScenarioState(): DemoScenarioState {
  return {
    activeRole: 'student',
    stage: 'DRAFT',
    review: {
      draftSaved: false,
      submitted: false,
    },
    schoolAccount: {
      currency: 'CNY',
      availableAmount: 12000,
      frozenAmount: 0,
      consumedAmount: 0,
    },
    schoolBills: [],
    expertAccount: { currency: 'CNY', availableAmount: 0, pendingAmount: 0 },
    theses: structuredClone(demoTheses),
  }
}
