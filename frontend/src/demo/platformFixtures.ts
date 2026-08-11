import type {
  AuditLogEntry,
  CorrectionRequest,
  DispatchStatus,
  DispatchThesisSeed,
  ExpertProfile,
  OperationsQueueCounts,
  PlatformState,
  ReviewVersion,
  WithdrawalRequest,
} from './types'

export type { PlatformState }

/** 演示批次固定费用标准（与平台运营服务 dispatchFeeStandard 一致）。 */
export const dispatchFeeStandard = 300

/**
 * 演示评审版本（只读快照，非真实论文内容）。专家最终提交后生成；
 * 版本号 R1 为初始版本，R2 起由更正审批「批准并生成新版本」产生。
 */
export const demoReviewVersions: ReviewVersion[] = [
  {
    id: 'review-version-r1',
    version: 'R1',
    status: 'CURRENT',
    score: 86,
    submittedAt: '2026-08-24 16:40',
    readonly: true,
  },
]

/** 演示收款信息：仅脱敏展示，完整账号永不出现在投影中（见 §8 演示数据边界）。 */
const MASKED_BANK = '招商银行（**** **** **** 1234）'

/** 更正申请演示种子（PAGE-020 数据源；本地快照，非真实论文原文）。 */
export const demoCorrectionRequests: CorrectionRequest[] = [
  {
    id: 'COR-2026-014',
    taskId: 'task-e-2026-042',
    anonymousId: 'HY-2026-0042',
    expertId: 'expert-31',
    expertName: '宋清和',
    status: 'PENDING',
    reason: '补充遗漏的实验限制说明',
    requestedAt: '2026-08-26 09:12',
    proposedDiff: '研究方法维度（20 分）由 17 分更正为 18 分；写作规范维度（10 分）由 9 分更正为 8 分。',
    evidence: '附件：实验环境补充说明（PDF，模拟校验通过）。',
    version: 'R1',
  },
]

/** 提现申请演示种子（PAGE-022 数据源；本地快照，不模拟真实支付）。 */
export const demoWithdrawals: WithdrawalRequest[] = [
  {
    id: 'WD-2026-0088',
    expertId: 'expert-17',
    expertName: '周明远',
    amount: 300,
    status: 'PENDING',
    requestedAt: '2026-08-25 10:20',
    withdrawableBasis: '已完成 46 篇有效评阅，其中 2 篇处于结算周期；当前可提现余额 ¥ 300.00。',
    freezeLedger: '冻结流水：2026-08-25 提现申请 WD-2026-0088 冻结 ¥ 300.00。',
    bankName: '招商银行',
    maskedAccount: MASKED_BANK,
    history: [
      {
        action: 'SUBMIT',
        at: '2026-08-25 10:20',
        note: '专家提交提现申请，冻结可提现余额 ¥ 300.00。',
      },
    ],
  },
]

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
    reviewVersions: structuredClone(demoReviewVersions),
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

/**
 * Task 4 演示场景：待审批更正申请 + 待审核提现。
 * 论文 thesis-main 已完成评阅（SUBMITTED），版本 R1 为只读初始版本；
 * 更正申请与提现申请为本地快照，不读取论文原始版，也不模拟真实支付。
 */
export function createCorrectionSettlementScenario(): PlatformState {
  const base = createInitialPlatformState()
  const mainThesis = structuredClone(dispatchThesisSeeds[0])
  return {
    ...base,
    expertTasks: [
      {
        id: 'task-e-2026-042',
        thesisId: 'thesis-main',
        expertId: 'expert-31',
        anonymousId: mainThesis.anonymousId,
        anonymousTitle: mainThesis.title,
        discipline: { ...mainThesis.discipline },
        status: 'SUBMITTED',
        fee: dispatchFeeStandard,
        dueAt: '2026-08-28 18:00',
        overdue: false,
        round: 1,
      },
    ],
    dispatchTheses: [{ ...mainThesis, status: 'COMPLETED' }],
    correctionRequests: structuredClone(demoCorrectionRequests),
    withdrawals: structuredClone(demoWithdrawals),
    reviewVersions: structuredClone(demoReviewVersions),
    auditLog: initialAuditEntries(),
  }
}
