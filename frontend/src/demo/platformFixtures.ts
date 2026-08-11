import type {
  AuditLogEntry,
  DispatchStatus,
  DispatchThesisSeed,
  ExpertProfile,
  OperationsQueueCounts,
  PlatformState,
} from './types'

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
    // 海岳大学在职教师：对海岳大学送审论文自回避（校内送审回避本校专家）。
    avoidSchools: ['海岳大学'],
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

/** 平台演示的运营派单论文种子（与送审运营台 PAGE-007 一致）。 */
export const dispatchThesisSeeds: DispatchThesisSeed[] = [
  {
    id: 'thesis-main',
    anonymousId: 'HY-2026-0042',
    title: '面向复杂场景的多模态知识推理研究',
    tenantName: '海岳大学',
    discipline: { code: '0812', name: '计算机科学与技术' },
    keywords: ['多模态推理', '知识图谱', '可信人工智能'],
    thesisType: '学术型',
    avoidRule: '送审论文指导老师回避',
    schoolRequirement: '60 天内返回评审意见',
    status: 'PENDING_DISPATCH',
    round: 1,
    seeded: true,
  },
  {
    id: 'thesis-0031',
    anonymousId: 'HY-2025-0031',
    title: '面向边缘环境的可信联邦学习方法研究',
    tenantName: '海岳大学',
    discipline: { code: '0812', name: '计算机科学与技术' },
    keywords: ['联邦学习', '隐私计算'],
    thesisType: '学术型',
    avoidRule: '送审论文指导老师回避',
    schoolRequirement: '60 天内返回评审意见',
    status: 'COMPLETED',
    round: 1,
    seeded: true,
  },
]

export function createInitialPlatformState(): PlatformState {
  return {
    experts: structuredClone(demoExpertProfiles),
    expertTasks: [],
    correctionRequests: [],
    withdrawals: [],
    auditLog: [],
    dispatchTheses: structuredClone(dispatchThesisSeeds),
  }
}

export function createDispatchScenario(overrides: DispatchStatus[] = []): PlatformState {
  const base = createInitialPlatformState()
  // 派单场景专属专家：仅在运营台派单场景存在，专家库固定 3 条档案不受影响。
  const scenarioExpert: ExpertProfile = {
    id: 'expert-26',
    name: '陈知微',
    unit: '西湖工业大学',
    title: '教授',
    discipline: { code: '0812', name: '计算机科学与技术' },
    researchTags: ['多模态学习', '知识图谱'],
    reviewableTypes: ['硕士学位论文'],
    qualification: 'APPROVED',
    serviceStatus: 'ACTIVE',
    avoidSchools: [],
    activeTasks: 1,
    completedTasks: 19,
    overdueRate: '1%',
    avgCompletionDays: 4,
    acceptanceRate: '92%',
    onTimeRate: '96%',
    qualitySummary: '响应快、意见务实，适合多轮派单。',
    feeStandard: 300,
    payoutStatus: 'BOUND',
    allowedActions: ['UPDATE_PROFILE', 'SET_SERVICE_STATUS'],
  }
  const scenarioTheses = structuredClone(dispatchThesisSeeds).map((seed) => {
    const status = overrides.find((item) => item.thesisId === seed.id)
    return status ? { ...seed, ...status } : seed
  })
  return {
    ...base,
    experts: [...base.experts, scenarioExpert],
    dispatchTheses: scenarioTheses,
  }
}

export function initialAuditEntries(): AuditLogEntry[] {
  return [
    {
      id: 'audit-seed-1',
      action: 'SEED',
      thesisId: 'thesis-main',
      detail: '演示初始待派单数据。',
      operator: '系统',
      occurredAt: '2026-08-11 09:00',
    },
  ]
}
