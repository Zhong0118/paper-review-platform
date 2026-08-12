import type {
  AuditLogEntry,
  CorrectionRequest,
  DispatchStatus,
  DispatchThesisSeed,
  ExpertLedgerEntry,
  ExpertProfile,
  ExpertQualificationMaterial,
  OperationsQueueCounts,
  PlatformScenarioPreset,
  PlatformState,
  ReviewVersion,
  RoleNotification,
  WithdrawalRequest,
} from './types'

export type { PlatformState }

/** 演示批次固定费用标准（与平台运营服务 dispatchFeeStandard 一致）。 */
export const dispatchFeeStandard = 300

/**
 * 演示固定时间（与场景服务 DEMO_NOW / 平台运营服务 appendAudit 一致）：
 * 通知与审计共用同一演示时钟，不做真实时限调度。
 */
const DEMO_NOW = '2026-08-12 09:00'

/**
 * 专家端演示人格在派单场景中的任务号（与场景服务 createDemoTask 一致）：
 * 场景快照通知据此关联任务跳转。
 */
const SCENARIO_TASK_ID = 'task-e-2026-042'

/** 专家端场景快照通知：仅装载与快照一致的专家侧消息（诚实投影）。 */
export function expertScenarioNotifications(
  preset?: import('./types').ExpertScenarioPreset,
): RoleNotification[] {
  if (preset !== 'INVITED') return []
  return [
    {
      id: 'notification-expert-invited',
      recipientRole: 'expert',
      kind: 'TASK_INVITED',
      message: '收到新的评审邀请：面向复杂场景的多模态知识推理研究（HY-2026-0042），请于 8 月 26 日 18:00 前接单。',
      createdAt: DEMO_NOW,
      read: false,
      taskId: SCENARIO_TASK_ID,
    },
  ]
}

/**
 * 运营端场景快照通知：仅装载与快照状态一致的平台侧消息（诚实投影）。
 * - PENDING_REASSIGNMENT：快照含已拒绝任务 → 待改派提醒（TASK_REJECTED）；
 * - 其余派单预设：平台侧无待处理消息（通知由专家动作事件产生，见 scenarioService）；
 * - CORRECTION_PENDING：更正/提现由运营队列（PAGE-007/PAGE-020/PAGE-022）承载，不重复造消息。
 */
export function platformScenarioNotifications(
  preset?: PlatformScenarioPreset,
): RoleNotification[] {
  if (preset === 'PENDING_REASSIGNMENT') {
    return [
      {
        id: 'notification-platform-task-rejected',
        recipientRole: 'platform_reviewer',
        kind: 'TASK_REJECTED',
        message: '专家周明远拒绝接单（原因：时间不足），请及时改派其他专家。',
        createdAt: DEMO_NOW,
        read: false,
        taskId: SCENARIO_TASK_ID,
      },
    ]
  }
  return []
}

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

/**
 * 演示装载的本人费用流水种子（PAGE-014 可提现/冻结的演示基准；只追加只读）。
 * 金额合计 3 篇有效评阅 × ¥ 300，不宣称真实结算。
 * 初始加载（createInitialPlatformState）不注入种子：账户由真实业务动作投影，
 * 保证黄金路径（无场景装载直接计账）的入账断言不被种子影响。
 * 结算演示场景（CORRECTION_PENDING）额外追加与 WD-2026-0088 匹配的冻结条目，
 * 保证「可提现 + 冻结 = 入账合计 − 已付款」恒等（见 createCorrectionSettlementScenario）。
 */
export function demoLedgerSeed(): ExpertLedgerEntry[] {
  return [
    {
      id: 'ledger-seed-1',
      kind: 'REVIEW_CREDIT',
      amount: 300,
      description: '评阅收入：有效评阅任务入账（HY-2026-0042）。',
      occurredAt: '2026-08-24 16:40',
    },
    {
      id: 'ledger-seed-2',
      kind: 'REVIEW_CREDIT',
      amount: 300,
      description: '评阅收入：有效评阅任务入账（HY-2025-0031）。',
      occurredAt: '2026-08-22 10:20',
    },
    {
      id: 'ledger-seed-3',
      kind: 'REVIEW_CREDIT',
      amount: 300,
      description: '评阅收入：有效评阅任务入账（HY-2025-0027）。',
      occurredAt: '2026-08-19 15:30',
    },
  ]
}

/** 提现申请演示种子（PAGE-022 数据源；本地快照，不模拟真实支付）。 */
export const demoWithdrawals: WithdrawalRequest[] = [  {
    id: 'WD-2026-0088',
    expertId: 'expert-17',
    expertName: '周明远',
    amount: 300,
    status: 'PENDING',
    requestedAt: '2026-08-25 10:20',
    // 依据金额与费用流水投影一致（Task 8 评审修复）：入账 900 中已冻结 300，可提现 600。
    withdrawableBasis: '已完成 46 篇有效评阅，其中 2 篇处于结算周期；当前可提现余额 ¥ 600.00（含本次冻结 ¥ 300.00）。',
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

/** 演示专家本人联系方式（仅本地演示投影，不宣称真实消息能力）。 */
const DEMO_CONTACT = 'demo-contact@baijie-review.local'

/**
 * 周明远（expert-17）资格材料演示种子（PAGE-021）：仅存元数据，
 * 不读取文件正文（见设计 §8 演示数据边界）。初始资格 REVIEWING。
 */
const demoMaterialsForPersona: ExpertQualificationMaterial[] = [
  {
    id: 'material-persona-title',
    fileName: '职称证明.pdf',
    fileType: 'PDF',
    validUntil: '2028-06-30',
    status: 'REVIEWING',
    submittedAt: '2026-08-01 09:05',
  },
]

/** 平台运营端专家库初始档案；复用派单页候选专家数据（周明远/顾远航/宋清和）。 */
export const demoExpertProfiles: ExpertProfile[] = [
  {
    id: 'expert-17',
    name: '周明远',
    contact: DEMO_CONTACT,
    unit: '东江理工大学',
    title: '教授',
    discipline: { code: '0812', name: '计算机科学与技术' },
    researchTags: ['知识图谱', '机器学习'],
    reviewableTypes: ['硕士学位论文'],
    qualification: 'REVIEWING',
    serviceStatus: 'ACTIVE',
    avoidSchools: [],
    qualificationMaterials: structuredClone(demoMaterialsForPersona),
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
    contact: DEMO_CONTACT,
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
    contact: DEMO_CONTACT,
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
    // 费用流水：演示加载不含预置条目，入账由最终提交/提现等业务动作只追加生成。
    expertLedger: [],
    auditLog: [],
    dispatchTheses: structuredClone(dispatchThesisSeeds),
    reviewVersions: structuredClone(demoReviewVersions),
    // 角色通知：初始为空，由业务动作/场景装载生成（见 scenarioService 通知事件）。
    notifications: [],
  }
}

export function createDispatchScenario(overrides: DispatchStatus[] = []): PlatformState {
  const base = createInitialPlatformState()
  // 派单场景专属专家：仅在运营台派单场景存在，专家库固定 3 条档案不受影响。
  const scenarioExpert: ExpertProfile = {
    id: 'expert-26',
    name: '陈知微',
    contact: DEMO_CONTACT,
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
    // 费用流水与提现申请一一对应（Task 8 评审修复）：WD-2026-0088 必须有匹配的
    // WITHDRAWAL 冻结条目，否则账户投影「可提现 + 冻结 = 入账 − 付款」失衡、
    // 运营审核/付款会让冻结金额变为负数。此场景为「已提交提现申请」的快照：
    // 可提现 ¥ 600.00（900 入账 − 300 冻结）、冻结 ¥ 300.00。
    expertLedger: [
      ...demoLedgerSeed(),
      {
        id: 'ledger-seed-4',
        kind: 'WITHDRAWAL',
        amount: -300,
        description: '提现申请：冻结 ¥ 300.00，等待平台审核。',
        occurredAt: '2026-08-25 10:20',
        withdrawalId: 'WD-2026-0088',
      },
    ],
    reviewVersions: structuredClone(demoReviewVersions),
    auditLog: initialAuditEntries(),
  }
}
