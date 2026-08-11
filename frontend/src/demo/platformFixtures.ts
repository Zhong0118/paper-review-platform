import type { ExpertProfile, OperationsQueueCounts, PlatformState } from './types'

export type { PlatformState }

/** 平台运营端专家库初始档案；复用派单页候选专家数据（周明远/顾远航/宋清和）。 */
export const demoExpertProfiles: ExpertProfile[] = [
  {
    id: 'expert-17',
    name: '周明远',
    unit: '东江理工大学',
    title: '教授',
    discipline: { code: '0812', name: '计算机科学与技术' },
    researchTags: ['知识图谱', '机器学习'],
    reviewableTypes: ['硕士学位论文'],
    qualification: 'REVIEWING',
    serviceStatus: 'ACTIVE',
    avoidSchools: [],
    activeTasks: 2,
    completedTasks: 46,
    overdueRate: '3%',
    avgCompletionDays: 6,
    acceptanceRate: '94%',
    onTimeRate: '97%',
    qualitySummary: '结论严谨，评语规范，多次获学校好评。',
    feeStandard: 300,
    payoutStatus: 'BOUND',
    allowedActions: ['UPDATE_PROFILE', 'SET_SERVICE_STATUS', 'REVIEW_QUALIFICATION'],
  },
  {
    id: 'expert-08',
    name: '顾远航',
    unit: '海岳大学',
    title: '副教授',
    discipline: { code: '0812', name: '计算机科学与技术' },
    researchTags: ['多模态学习', '视觉计算'],
    reviewableTypes: ['硕士学位论文'],
    qualification: 'APPROVED',
    serviceStatus: 'ACTIVE',
    avoidSchools: ['东江理工大学'],
    activeTasks: 1,
    completedTasks: 28,
    overdueRate: '5%',
    avgCompletionDays: 7,
    acceptanceRate: '91%',
    onTimeRate: '93%',
    qualitySummary: '意见具体，偶尔提交偏晚。',
    feeStandard: 300,
    payoutStatus: 'BOUND',
    allowedActions: ['UPDATE_PROFILE', 'SET_SERVICE_STATUS'],
  },
  {
    id: 'expert-31',
    name: '宋清和',
    unit: '北辰科技大学',
    title: '教授',
    discipline: { code: '0835', name: '软件工程' },
    researchTags: ['可信软件', '程序分析'],
    reviewableTypes: ['硕士学位论文'],
    qualification: 'APPROVED',
    serviceStatus: 'ACTIVE',
    avoidSchools: [],
    activeTasks: 4,
    completedTasks: 61,
    overdueRate: '4%',
    avgCompletionDays: 5,
    acceptanceRate: '88%',
    onTimeRate: '90%',
    qualitySummary: '领域权威，评阅细致，可评方向略窄。',
    feeStandard: 300,
    payoutStatus: 'BOUND',
    allowedActions: ['UPDATE_PROFILE', 'SET_SERVICE_STATUS'],
  },
]

/** 十条运营队列的演示计数；与静态运营台队列表保持一致，Task 3 起改为状态派生。 */
export const demoOperationsQueueCounts: OperationsQueueCounts = {
  PENDING_ASSIGNMENT: 6,
  PENDING_ACCEPTANCE: 4,
  IN_REVIEW: 12,
  DUE_SOON: 3,
  OVERDUE: 2,
  PENDING_REASSIGNMENT: 1,
  PENDING_SUPPLEMENT: 1,
  CORRECTION_PENDING: 3,
  SETTLEMENT_PENDING: 2,
  COMPLETED: 28,
}

export function createInitialPlatformState(): PlatformState {
  return {
    experts: structuredClone(demoExpertProfiles),
    expertTasks: [],
    correctionRequests: [],
    withdrawals: [],
  }
}
