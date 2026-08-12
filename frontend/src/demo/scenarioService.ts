import type { RoleCode } from '@/types/roles'

import { createInitialScenarioState, demoIdentity, demoStudentId, demoThesis } from './fixtures'
import { createStudentPortalService } from '@/modules/thesis/services/studentPortalService'
import { createInitialStudentPortalState, type StudentPortalState } from './studentFixtures'
import { createPlatformOperationService, dispatchFeeStandard } from '@/modules/expert-management/services/platformOperationService'
import { loadStudentDemo, saveStudentDemo } from './studentPersistence'
import { loadPlatformDemo, savePlatformDemo } from './platformPersistence'
import {
  createCorrectionSettlementScenario,
  createDispatchScenario,
  demoLedgerSeed,
  initialAuditEntries,
  type PlatformState as FixturePlatformState,
} from './platformFixtures'
import type { PlatformState } from './platformFixtures'
import { PlatformOperationError, REVIEW_SCORE_TEMPLATE } from './types'
import type {
  DemoAction,
  BatchImportRow,
  DemoRoleContext,
  DemoPublishedResult,
  DispatchThesisSeed,
  ExpertAccountSummary,
  ExpertLedgerEntry,
  ExpertScenarioPreset,
  ExpertTaskAction,
  ExpertTaskSummary,
  DemoScenarioSnapshot,
  DemoStage,
  DemoThesisSummary,
  OperationsItem,
  PlatformScenarioPreset,
  ReviewDimensionKey,
  ReviewScoreInput,
  ScenarioService,
  SchoolSubmissionInput,
  StorageLike,
  StudentPortalService,
  StudentEligibilityScenario,
  StudentFileValidationScenario,
  StudentScenarioPreset,
  StudentScoreDimension,
  WithdrawalRequest,
} from './types'

const scenarioStage: Record<StudentScenarioPreset, DemoStage> = {
  DRAFT: 'DRAFT',
  RETURNED: 'DRAFT',
  SCHOOL_REVIEW: 'SUBMITTED',
  EXPERT_REVIEW: 'UNDER_REVIEW',
  RESULT_PROCESSING: 'RESULT_PROCESSING',
  COMPLETED: 'COMPLETED',
}

const scenarioTimeline: Record<
  StudentScenarioPreset,
  StudentPortalState['timelines']['thesis-main']
> = {
  DRAFT: [
    {
      id: 'timeline-main-created',
      kind: 'DRAFT_CREATED',
      occurredAt: '2026-08-10 16:20',
      message: '已创建论文草稿。',
    },
  ],
  RETURNED: [
    {
      id: 'timeline-main-created',
      kind: 'DRAFT_CREATED',
      occurredAt: '2026-08-10 16:20',
      message: '已创建论文草稿。',
    },
    {
      id: 'timeline-main-returned',
      kind: 'THESIS_RETURNED',
      occurredAt: '2026-08-12 10:15',
      message: '学校已退回材料，请修改匿名版后重新提交。',
    },
  ],
  SCHOOL_REVIEW: [
    {
      id: 'timeline-main-created',
      kind: 'DRAFT_CREATED',
      occurredAt: '2026-08-10 16:20',
      message: '已创建论文草稿。',
    },
    {
      id: 'timeline-main-submitted',
      kind: 'THESIS_SUBMITTED',
      occurredAt: '2026-08-11 09:00',
      message: '论文已提交，等待学校审核。',
    },
  ],
  EXPERT_REVIEW: [
    {
      id: 'timeline-main-submitted',
      kind: 'THESIS_SUBMITTED',
      occurredAt: '2026-08-11 09:00',
      message: '论文已提交，等待学校审核。',
    },
    {
      id: 'timeline-main-expert-review',
      kind: 'EXPERT_REVIEW_STARTED',
      occurredAt: '2026-08-15 14:20',
      message: '论文已进入送审评阅。',
    },
  ],
  RESULT_PROCESSING: [
    {
      id: 'timeline-main-expert-review',
      kind: 'EXPERT_REVIEW_STARTED',
      occurredAt: '2026-08-15 14:20',
      message: '论文已进入送审评阅。',
    },
    {
      id: 'timeline-main-result-processing',
      kind: 'RESULT_PROCESSING_STARTED',
      occurredAt: '2026-08-24 16:40',
      message: '评阅已返回，等待学校确认发布。',
    },
  ],
  COMPLETED: [
    {
      id: 'timeline-main-result-processing',
      kind: 'RESULT_PROCESSING_STARTED',
      occurredAt: '2026-08-24 16:40',
      message: '评阅已返回，等待学校确认发布。',
    },
    {
      id: 'timeline-main-result-published',
      kind: 'RESULT_PUBLISHED',
      occurredAt: '2026-08-25 10:00',
      message: '学校已发布评审结果。',
    },
  ],
}

function scenarioNotification(preset: StudentScenarioPreset): StudentPortalState['notifications'] {
  if (preset === 'RETURNED') {
    return [
      {
        id: 'notification-main-returned',
        kind: 'THESIS_RETURNED',
        thesisId: 'thesis-main',
        message: '学校已退回材料，请修改匿名版后重新提交。',
        createdAt: '2026-08-12 10:15',
        read: false,
      },
    ]
  }
  if (preset === 'SCHOOL_REVIEW') {
    return [
      {
        id: 'notification-main-submitted',
        kind: 'THESIS_SUBMITTED',
        thesisId: 'thesis-main',
        message: '论文已提交，等待学校审核。',
        createdAt: '2026-08-11 09:00',
        read: false,
      },
    ]
  }
  if (preset === 'EXPERT_REVIEW') {
    return [
      {
        id: 'notification-main-expert-review',
        kind: 'EXPERT_REVIEW_STARTED',
        thesisId: 'thesis-main',
        message: '论文已进入送审评阅。',
        createdAt: '2026-08-15 14:20',
        read: false,
      },
    ]
  }
  if (preset === 'COMPLETED') {
    return [
      {
        id: 'notification-main-result-published',
        kind: 'RESULT_PUBLISHED',
        thesisId: 'thesis-main',
        message: '学校已发布评审结果。',
        createdAt: '2026-08-25 10:00',
        read: false,
      },
    ]
  }
  return []
}

const roleContexts: Record<RoleCode, DemoRoleContext> = {
  system_admin: { role: 'system_admin', displayName: '系统管理员' },
  school_reviewer: {
    role: 'school_reviewer',
    displayName: '王老师',
    tenantName: demoIdentity.tenantName,
  },
  platform_reviewer: { role: 'platform_reviewer', displayName: '陈岚' },
  student: {
    role: 'student',
    displayName: demoIdentity.studentName,
    tenantName: demoIdentity.tenantName,
  },
  supervisor: {
    role: 'supervisor',
    displayName: demoIdentity.supervisorName,
    tenantName: demoIdentity.tenantName,
  },
  expert: { role: 'expert', displayName: demoIdentity.expertName },
}

function allowedActionsFor(
  stage: DemoStage,
  role: RoleCode,
  taskStatus: import('./types').ReviewTaskStatus | undefined,
  hasFrozenBill: boolean,
): DemoAction[] {
  if (stage === 'DRAFT' && role === 'student') return ['EDIT_THESIS', 'SUBMIT_THESIS']
  if (stage === 'SUBMITTED' && role === 'school_reviewer') return ['CONFIRM_ANONYMIZATION']
  if (stage === 'READY_FOR_DISPATCH' && role === 'school_reviewer' && !hasFrozenBill)
    return ['CONFIRM_DISPATCH']
  if (stage === 'READY_FOR_DISPATCH' && role === 'platform_reviewer' && hasFrozenBill)
    return ['ASSIGN_EXPERTS']
  if (stage === 'UNDER_REVIEW' && role === 'expert' && taskStatus === 'INVITED')
    return ['ACCEPT_TASK']
  if (stage === 'UNDER_REVIEW' && role === 'expert' && taskStatus === 'IN_REVIEW')
    return ['SAVE_REVIEW_DRAFT', 'SUBMIT_FINAL_REVIEW']
  if (stage === 'RESULT_PROCESSING' && role === 'school_reviewer') return ['PUBLISH_RESULT']
  if (
    stage === 'COMPLETED' &&
    ['student', 'supervisor', 'school_reviewer', 'platform_reviewer'].includes(role)
  )
    return ['VIEW_RESULT']
  return []
}

/** 六维总分：按模板维度投影求和（模板 key 即输入字段名）。 */
function totalScore(input: ReviewScoreInput) {
  return REVIEW_SCORE_TEMPLATE.reduce((sum, dimension) => sum + (input[dimension.key] ?? 0), 0)
}

/**
 * 六维评分输入校验（提交前完整性检查）：逐维校验数值范围（越界字段级报错），
 * 并校验必填文本项。`recommendation` 必须来自受控枚举（建议通过/建议修改/不通过）。
 * 返回字段级错误列表（缺项/越界均带字段名），空列表表示完整可用。
 */
function validateReviewInput(input: ReviewScoreInput): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = []
  for (const dimension of REVIEW_SCORE_TEMPLATE) {
    const value = input[dimension.key]
    if (!Number.isFinite(value)) {
      errors.push({ field: dimension.key, message: `${dimension.label}分值必须填写。` })
      continue
    }
    if (value < 0 || value > dimension.maxScore) {
      errors.push({
        field: dimension.key,
        message: `${dimension.label}分值应在 0–${dimension.maxScore} 之间（满分 ${dimension.maxScore}）。`,
      })
    }
  }
  const textFields: Array<{ field: keyof ReviewScoreInput; label: string }> = [
    { field: 'overallComment', label: '总体评价' },
    { field: 'issues', label: '主要问题' },
    { field: 'revisionAdvice', label: '修改建议' },
  ]
  for (const item of textFields) {
    const value = input[item.field]
    if (typeof value !== 'string' || !value.trim()) {
      errors.push({ field: item.field, message: `${item.label}为必填项。` })
    }
  }
  if (!['建议通过', '建议修改', '不通过'].includes(input.recommendation)) {
    errors.push({ field: 'recommendation', message: '请选择评审结论（建议通过/建议修改/不通过）。' })
  }
  return errors
}

const defaultPublishedReview: ReviewScoreInput = {
  topicValue: 13,
  literatureTheory: 13,
  methodology: 17,
  innovation: 21,
  resultsWorkload: 13,
  writingStandards: 9,
  recommendation: '建议通过',
  strengths: '选题具有价值，研究路径完整。',
  issues: '对最新基线的比较仍需加强。',
  revisionAdvice: '补充消融实验与限制讨论。',
  overallComment: '论文结构完整，达到硕士学位论文要求。',
}

/** 维度显示名（学生端结果页沿用历史命名；专家端页面一律使用模板 label）。 */
const dimensionDisplayNames: Record<ReviewDimensionKey, string> = {
  topicValue: '选题价值',
  literatureTheory: '文献与理论',
  methodology: '研究设计',
  innovation: '研究内容与创新',
  resultsWorkload: '成果与工作量',
  writingStandards: '写作规范',
}

function scoreDimensions(input: ReviewScoreInput): StudentScoreDimension[] {
  return REVIEW_SCORE_TEMPLATE.map((dimension) => ({
    key: dimension.key,
    label: dimensionDisplayNames[dimension.key] ?? dimension.label,
    score: input[dimension.key],
    maxScore: dimension.maxScore,
  }))
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach((nested) => deepFreeze(nested))
  }
  return value
}

/** 演示时钟（与平台运营服务 appendAudit 一致）：固定时间，不做真实时限调度。 */
const DEMO_NOW = '2026-08-12 09:00'

/** 演示提现申请号/流水号序列（`WD-2026-` 前缀与运营结算工作台演示种子保持一致）。 */
function nextWithdrawalId(existing: { id: string }[]): string {
  const max = existing.reduce((latest, entry) => {
    const sequence = Number(entry.id.match(/(\d+)$/)?.[1])
    return Number.isFinite(sequence) ? Math.max(latest, sequence) : latest
  }, 88)
  return `WD-2026-${String(max + 1).padStart(4, '0')}`
}

/**
 * 追加费用流水（只追加不可覆盖，可审计投影）。
 * 入账（REVIEW_CREDIT/RELEASE/REVERSAL）为正数，冻结/付款（WITHDRAWAL/PAYMENT）为负数。
 * 该方法不冻结返回对象（返回对象由调用方继续用于聚合）；对外投影一律 deepFreeze。
 */
function appendLedgerEntry(
  platform: PlatformState,
  entry: Omit<ExpertLedgerEntry, 'id' | 'occurredAt'>,
): PlatformState {
  return {
    ...platform,
    expertLedger: [
      ...platform.expertLedger,
      {
        ...entry,
        id: `ledger-${platform.expertLedger.length + 1}`,
        occurredAt: DEMO_NOW,
      },
    ],
  }
}

/**
 * 专家账户投影（PAGE-014 我的账户）：可提现/冻结金额由费用流水汇总（只读），
 * 与历史 expertAccount 字段保持兼容。演示为 number（Decimal 语义由页面格式化两位小数）。
 *
 * 记账约定（补偿式，只追加不可覆盖）：
 * - REVIEW_CREDIT 入账 → 可提现增加；
 * - WITHDRAWAL（负）→ 冻结增加，可提现减少（扣减不覆盖既有流水）；
 * - RELEASE（驳回解冻）/ REVERSAL（付款冲正）→ 冻结减少，可提现恢复；
 * - PAYMENT 方向敏感：负（冻结期付款出账）→ 冻结减少；正（冲正后重试成功
 *   从可提现出账，见平台运营服务 recordWithdrawalPayment）→ 可提现减少。
 */
function projectExpertAccount(platform: PlatformState): ExpertAccountSummary {
  let available = 0
  let frozen = 0
  for (const entry of platform.expertLedger) {
    const abs = Math.abs(entry.amount)
    if (entry.kind === 'WITHDRAWAL') {
      available -= abs
      frozen += abs
    } else if (entry.kind === 'PAYMENT') {
      if (entry.amount < 0) frozen -= abs
      else available -= abs
    } else if (entry.kind === 'RELEASE' || entry.kind === 'REVERSAL') {
      frozen -= abs
      available += abs
    } else {
      available += entry.amount // REVIEW_CREDIT
    }
  }
  return { currency: 'CNY', availableAmount: available, pendingAmount: frozen }
}

/** 专家端演示人格：任务仅投影本人（expert-17 周明远，与专家端页面身份一致）。 */
export const EXPERT_PERSONA_ID = 'expert-17'

/** 接单截止：演示时钟 2026-08-12 09:00 起 14 天（与运营派单 ASSIGNMENT_DUE_DAYS 一致）。 */
const ACCEPT_BY = '2026-08-26 18:00'

/** 评审费用含说明（接单详情 PAGE-009；演示文案，不宣称真实结算）。 */
const FEE_NOTE = '最终意见有效提交后进入结算'

/** 六维评审模板说明（与设计 §4.4 演示批次快照一致，页面动态渲染）。 */
const TEMPLATE_NOTE =
  '六维评审模板（合计 100 分）：选题价值 15、文献与理论基础 15、研究设计与方法 20、研究内容与创新 25、写作规范 10、综合学术水平 15；另含总体评价、主要问题、修改建议与评审结论。'

/** 匿名化摘要（接单前可见的匿名基本信息，不读取论文正文）。 */
const ANONYMOUS_ABSTRACT =
  '匿名化摘要：面向复杂场景的多模态知识推理研究。作者与学校身份已匿名化，接单前不展示论文正文。'

/** 场景装载用的演示任务（固定演示时间，不做真实时限调度）。 */
function createDemoTask(
  status: 'INVITED' | 'IN_REVIEW' | 'REJECTED' | 'SUBMITTED',
  overrides: Partial<ExpertTaskSummary> = {},
): ExpertTaskSummary {
  return {
    id: 'task-e-2026-042',
    thesisId: 'thesis-main',
    expertId: EXPERT_PERSONA_ID,
    anonymousId: 'HY-2026-0042',
    anonymousTitle: '面向复杂场景的多模态知识推理研究',
    discipline: { code: '0812', name: '计算机科学与技术' },
    status,
    fee: dispatchFeeStandard,
    dueAt: status === 'IN_REVIEW' ? '2026-08-28 18:00' : '2026-08-26 18:00',
    overdue: false,
    round: 1,
    acceptBy: ACCEPT_BY,
    abstract: ANONYMOUS_ABSTRACT,
    matchNote: '学科匹配：计算机科学与技术；关键词命中：多模态推理、知识图谱。',
    templateNote: TEMPLATE_NOTE,
    feeNote: FEE_NOTE,
    materialsVisible: false,
    allowedActions: expertTaskActionsFor(status),
    ...overrides,
  }
}

/** 允许动作由任务状态派生（服务端规则；页面按钮据此渲染，不自行推断）。 */
function expertTaskActionsFor(status: ExpertTaskSummary['status']): ExpertTaskAction[] {
  if (status === 'INVITED') return ['ACCEPT_TASK', 'REJECT_TASK']
  if (status === 'IN_REVIEW') return ['CONTINUE_REVIEW']
  // 最终提交为终态：只读查看；有更正申请时列表附加「需要更正」标记（不影响动作）。
  if (status === 'SUBMITTED') return ['VIEW_SUBMITTED']
  return []
}

/** 专家任务投影（PAGE-008 列表与接单详情数据源）：补全派生字段，保持不可变快照。 */
function projectExpertTask(task: ExpertTaskSummary): ExpertTaskSummary {
  const overdue =
    task.overdue ||
    (['INVITED', 'IN_REVIEW'].includes(task.status) &&
      task.dueAt !== undefined &&
      task.dueAt < '2026-08-12 09:00')
  return {
    ...task,
    overdue,
    acceptBy: task.acceptBy ?? ACCEPT_BY,
    abstract: task.abstract ?? ANONYMOUS_ABSTRACT,
    matchNote: task.matchNote ?? '学科匹配：计算机科学与技术；关键词命中：多模态推理、知识图谱。',
    templateNote: task.templateNote ?? TEMPLATE_NOTE,
    feeNote: task.feeNote ?? FEE_NOTE,
    // 接单前（INVITED）匿名材料不可见；接受后（IN_REVIEW）与最终提交后（SUBMITTED）可见。
    // 已提交任务在专家端只读展示匿名材料与本人已提交意见（「已完成 → 查看」视图）。
    materialsVisible:
      task.materialsVisible === true || ['IN_REVIEW', 'SUBMITTED'].includes(task.status),
    // 允许动作始终按当前状态派生：与请求时刻的存档无关，避免残留过期动作。
    allowedActions: expertTaskActionsFor(task.status),
  }
}

/**
 * 演示装载的本人费用流水种子（幂等）：流水非空（已有历史/已装载种子）时不覆盖。
 * 结算演示场景（CORRECTION_PENDING）自带完整流水（含匹配的 WITHDRAWAL 冻结条目），
 * 其余场景注入 3 条历史入账基准（可提现 ¥ 900.00）。
 * 种子定义在 platformFixtures（与结算场景共享同一数据源），避免循环依赖。
 */
function applyExpertLedgerSeeds(platform: PlatformState): PlatformState {
  if (platform.expertLedger.length > 0) return platform
  return { ...platform, expertLedger: demoLedgerSeed() }
}

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

export function createScenarioService(
  options: { storage?: StorageLike; demoMode?: boolean } = {},
): ScenarioService {
  const storage = options.storage ?? createMemoryStorage()
  const loaded = loadStudentDemo(storage)
  const loadedPlatform = loadPlatformDemo(storage)
  let state = loaded.scenario
  let studentState = loaded.student
  let platformState = loadedPlatform.platform

  const persist = () => saveStudentDemo(storage, state, studentState)
  const persistPlatform = () => savePlatformDemo(storage, platformState)

  /** 平台状态中属于专家端演示人格（本人）的任务；接单/拒绝仅在其上校验与更新。 */
  const platformTasksForPersona = () =>
    platformState.expertTasks.filter((task) => task.expertId === EXPERT_PERSONA_ID)

  /** 专家端接单（INVITED→IN_REVIEW）：仅本人任务；接受后匿名材料可见。 */
  const acceptExpertTask = async (taskId: string): Promise<ExpertTaskSummary> => {
    const personaTask = platformTasksForPersona().find((task) => task.id === taskId)
    if (!personaTask) {
      // 任务存在但不属于本人：他人任务禁止操作（双盲红线）。
      if (platformState.expertTasks.some((task) => task.id === taskId)) {
        throw new PlatformOperationError('FORBIDDEN', '他人任务不可操作。')
      }
      throw new PlatformOperationError('NOT_FOUND', '未找到该专家任务。')
    }
    if (personaTask.status !== 'INVITED') {
      throw new PlatformOperationError(
        'STATE_CONFLICT',
        personaTask.status === 'IN_REVIEW'
          ? '该任务已在评阅中，请直接进入工作台。'
          : '该任务已过期或已处理，不能再次接单。',
      )
    }
    const updated: ExpertTaskSummary = {
      ...personaTask,
      status: 'IN_REVIEW',
      materialsVisible: true,
    }
    platformState = {
      ...platformState,
      expertTasks: platformState.expertTasks.map((task) =>
        task.id === taskId ? updated : task,
      ),
    }
    persistPlatform()
    return projectExpertTask(updated)
  }

  /** 专家端拒绝（INVITED→REJECTED）：原因必填；「其他」需附带说明；拒绝后等待平台改派（本地演示投影）。 */
  const rejectExpertTask = async (taskId: string, reason: string): Promise<ExpertTaskSummary> => {
    if (!reason.trim()) {
      throw new PlatformOperationError('INVALID_INPUT', '拒绝原因不能为空。')
    }
    // 选择「其他」时说明必填（原因以「其他：」前缀提交，见设计规格 §5.6 下拉+说明）。
    if (reason.startsWith('其他') && !reason.includes('：')) {
      throw new PlatformOperationError('INVALID_INPUT', '选择「其他」时请填写拒绝说明。')
    }
    const personaTask = platformTasksForPersona().find((task) => task.id === taskId)
    if (!personaTask) {
      if (platformState.expertTasks.some((task) => task.id === taskId)) {
        throw new PlatformOperationError('FORBIDDEN', '他人任务不可操作。')
      }
      throw new PlatformOperationError('NOT_FOUND', '未找到该专家任务。')
    }
    if (personaTask.status !== 'INVITED') {
      throw new PlatformOperationError('STATE_CONFLICT', '仅待接受任务可以拒绝。')
    }
    const updated: ExpertTaskSummary = { ...personaTask, status: 'REJECTED' }
    platformState = {
      ...platformState,
      expertTasks: platformState.expertTasks.map((task) =>
        task.id === taskId ? updated : task,
      ),
      auditLog: [
        {
          id: `audit-expert-reject-${Date.now()}`,
          action: 'REJECT',
          thesisId: personaTask.thesisId,
          expertId: personaTask.expertId,
          taskId,
          detail: `专家拒绝接单（原因：${reason.trim()}），等待平台改派。`,
          operator: '周明远',
          occurredAt: '2026-08-12 09:00',
        },
        ...platformState.auditLog,
      ],
    }
    persistPlatform()
    return projectExpertTask(updated)
  }

  if (loaded.reset) {
    studentState = {
      ...studentState,
      notifications: [
        {
          id: 'notification-demo-data-reset',
          kind: 'DEMO_DATA_RESET',
          message: '演示数据已重置。',
          createdAt: '2026-08-11 09:00',
          read: false,
        },
      ],
    }
    persist()
  }
  if (loadedPlatform.reset) {
    persistPlatform()
  }

  const currentReviewResults = (): DemoPublishedResult[] =>
    state.review.submitted
      ? (() => {
          const input = state.review.scoreInput ?? defaultPublishedReview
          return [
            {
              expertAlias: '专家 A',
              score: state.review.score ?? 0,
              recommendation: state.review.recommendation ?? '',
              comment: input.overallComment,
              dimensionScores: scoreDimensions(input),
              submittedAt: '2026-08-24 16:40',
              publishedAt: '2026-08-25 10:00',
            },
          ]
        })()
      : []

  const listAllTheses = (): DemoThesisSummary[] =>
    state.theses.map((item) => {
      if (item.id !== demoThesis.id) return { ...item }
      return {
        ...item,
        stage: state.stage,
        allowedActions:
          state.stage === 'DRAFT'
            ? ['EDIT_THESIS']
            : state.stage === 'COMPLETED'
              ? ['VIEW_RESULT']
              : ['VIEW_THESIS'],
      }
    })

  const snapshot = async (): Promise<DemoScenarioSnapshot> => {
    persist()
    const role = state.activeRole
    const canSeeStudent = [
      'student',
      'supervisor',
      'school_reviewer',
      'platform_reviewer',
    ].includes(role)
    const reviewVisible = ['expert', 'school_reviewer', 'platform_reviewer'].includes(role)
    const taskProgress = state.taskStatus === 'SUBMITTED' ? '1/1' : '0/1'
    const activeBill = state.schoolBills.find((bill) => bill.anonymousId === demoThesis.anonymousId)

    const projection: DemoScenarioSnapshot = {
      context: { ...roleContexts[role] },
      thesis: {
        ...demoThesis,
        stage: state.stage,
        ...(state.taskStatus ? { taskStatus: state.taskStatus } : {}),
        ...(activeBill ? { billStatus: activeBill.status } : {}),
        roundStatus: demoIdentity.batchName,
        taskProgress,
        allowedActions: allowedActionsFor(
          state.stage,
          role,
          state.taskStatus,
          activeBill?.status === 'FROZEN',
        ),
        ...(canSeeStudent ? { studentName: demoIdentity.studentName } : {}),
      },
      ...(reviewVisible ? { review: { ...state.review } } : {}),
    }

    return deepFreeze(structuredClone(projection))
  }

  const moveTo = async (stage: DemoStage) => {
    state = { ...state, stage }
    return snapshot()
  }

  const studentPortal: StudentPortalService = createStudentPortalService({
    getTheses: listAllTheses,
    replaceThesis: (thesis) => {
      state = {
        ...state,
        theses: state.theses
          .map((item) => (item.id === thesis.id ? thesis : item))
          .concat(state.theses.some((item) => item.id === thesis.id) ? [] : [thesis]),
      }
      persist()
    },
    removeThesis: (id) => {
      state = { ...state, theses: state.theses.filter((item) => item.id !== id) }
      persist()
    },
    setMainStage: (stage) => {
      state = { ...state, stage }
      persist()
    },
    getState: () => studentState,
    setState: (nextState) => {
      studentState = nextState
      persist()
    },
    getResults: currentReviewResults,
    currentStudentId: demoStudentId,
    demoMode: options.demoMode ?? true,
    loadScenario: (preset: StudentScenarioPreset) => {
      const stage = scenarioStage[preset]
      const taskStatus =
        preset === 'EXPERT_REVIEW'
          ? ('IN_REVIEW' as const)
          : ['RESULT_PROCESSING', 'COMPLETED'].includes(preset)
            ? ('SUBMITTED' as const)
            : undefined
      const review =
        preset === 'RESULT_PROCESSING' || preset === 'COMPLETED'
          ? {
              draftSaved: true,
              submitted: true,
              score: 86,
              recommendation: '建议通过',
              scoreInput: defaultPublishedReview,
            }
          : { draftSaved: false, submitted: false }
      const initialScenario = createInitialScenarioState()
      state = {
        ...initialScenario,
        activeRole: state.activeRole,
        stage,
        review,
        ...(taskStatus ? { taskStatus } : {}),
      }
      const initialStudent = createInitialStudentPortalState()
      studentState = {
        ...initialStudent,
        notifications: scenarioNotification(preset),
        timelines: {
          ...initialStudent.timelines,
          'thesis-main': structuredClone(scenarioTimeline[preset]),
        },
        publicReasonsByThesis:
          preset === 'RETURNED'
            ? { 'thesis-main': '匿名版仍包含可识别身份信息，请修改后重新提交。' }
            : {},
        objections: [],
        withdrawalRequests: [],
        resultsByThesis: {
          ...initialStudent.resultsByThesis,
          ...(preset === 'COMPLETED' ? { 'thesis-main': currentReviewResults() } : {}),
        },
      }
      persist()
    },
    setEligibilityScenario: (preset: StudentEligibilityScenario) => {
      const eligible = preset === 'ELIGIBLE'
      const reason =
        preset === 'ELIGIBLE'
          ? '当前学籍和批次资格有效。'
          : preset === 'SUSPENDED'
            ? '学校已暂停本批次提交资格。'
            : '当前批次已过提交截止时间。'
      studentState = {
        ...studentState,
        eligibility: { ...studentState.eligibility, eligible, status: preset, reason },
      }
      persist()
    },
    setFileValidationScenario: (preset: StudentFileValidationScenario) => {
      const fixtureFiles = createInitialStudentPortalState().fileMetadataByThesis['thesis-main']
      const savedFiles = studentState.fileMetadataByThesis['thesis-main'] ?? []
      const currentFiles = savedFiles.length > 0 ? savedFiles : structuredClone(fixtureFiles)
      studentState = {
        ...studentState,
        fileMetadataByThesis: {
          ...studentState.fileMetadataByThesis,
          'thesis-main': currentFiles.map((file) => ({
            ...file,
            validationStatus: preset,
          })),
        },
      }
      persist()
    },
    reset: () => {
      storage.removeItem?.('baijie-demo-student:v1')
      state = createInitialScenarioState()
      studentState = createInitialStudentPortalState()
      persist()
    },
  })

  const platformOperation = createPlatformOperationService({
    getState: () => platformState,
    setState: (nextState) => {
      platformState = nextState
      persistPlatform()
      // 平台派单变化同步回在读论文（学生端视角），保持两条状态源一致。
      syncThesisStageToDispatch('thesis-main')
    },
    demoMode: options.demoMode ?? true,
    appendLedgerEntry,
  })

  /** 学生在读的论文（thesis-main）与平台派单投影同步：待派→待接受→评阅中。 */
  const syncThesisStageToDispatch = (thesisId: string) => {
    const thesis = state.theses.find((item) => item.id === thesisId)
    if (!thesis) return
    // 同论文可能存在多条历史任务（如改派后旧任务 CANCELLED）：取截止最早的在评任务。
    const task = [...platformState.expertTasks]
      .filter((item) => item.thesisId === thesisId)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]
    const dispatch = platformState.dispatchTheses.find((item) => item.id === thesisId)
    if (!dispatch || !task) return
    const stage: DemoStage =
      dispatch.status === 'COMPLETED' ? 'COMPLETED' : 'UNDER_REVIEW'
    const taskStatus =
      task.status === 'INVITED' || task.status === 'IN_REVIEW'
        ? task.status
        : dispatch.status === 'COMPLETED'
          ? // 平台任务真实进入 SUBMITTED（提交终审）才视为完成；否则保持学生端原状态。
            task.status === 'SUBMITTED'
            ? 'SUBMITTED'
            : undefined
          : undefined
    if (thesis.stage === stage && state.taskStatus === taskStatus) return
    // 学生端已进入结果处理/完成时，不把平台滞后状态投影回去（避免阶段回退）。
    if (state.stage === 'RESULT_PROCESSING' || state.stage === 'COMPLETED') return
    state = { ...state, stage, ...(taskStatus ? { taskStatus } : {}) }
    persist()
  }

  /** 平台派单投影（thesis-main）与在读论文状态同步，保证学生端流程兼容。 */
  const syncDispatchToThesisStage = (thesisId: string) => {
    const thesis = state.theses.find((item) => item.id === thesisId)
    if (!thesis) return
    const stage = state.stage
    const taskStatus = state.taskStatus
    if (stage === 'UNDER_REVIEW' && taskStatus === 'INVITED') {
      platformState = {
        ...platformState,
        dispatchTheses: platformState.dispatchTheses.map((item) =>
          item.id === thesisId ? { ...item, status: 'PENDING_ACCEPTANCE' as const } : item,
        ),
      }
      persistPlatform()
    }
  }

  return {
    ...studentPortal,
    ...platformOperation,
    listSchoolNotifications: async () =>
      deepFreeze(
        structuredClone(
          studentState.notifications.filter((item) => item.recipientRole === 'school_reviewer'),
        ),
      ),
    loginAs: async (role: RoleCode) => {
      state = { ...state, activeRole: role }
      return snapshot()
    },
    submitThesis: () => moveTo('SUBMITTED'),
    confirmAnonymization: () => moveTo('READY_FOR_DISPATCH'),
    confirmDispatch: async () => {
      if (!state.schoolBills.some((bill) => bill.anonymousId === demoThesis.anonymousId)) {
        state = {
          ...state,
          schoolAccount: {
            ...state.schoolAccount,
            availableAmount: state.schoolAccount.availableAmount - 300,
            frozenAmount: state.schoolAccount.frozenAmount + 300,
          },
          schoolBills: [
            ...state.schoolBills,
            {
              id: 'bill-hy-2026-0042',
              anonymousId: demoThesis.anonymousId,
              amount: 300,
              status: 'FROZEN',
              ruleVersion: 'DEMO-2026-SPRING-v1',
              createdAt: '2026-08-10 19:10',
            },
          ],
        }
      }
      return snapshot()
    },
    assignExperts: async () => {
      const thesis = state.theses.find((item) => item.id === demoThesis.id)
      if (!thesis) {
        throw new Error('未找到在读论文，无法完成指派。')
      }
      // 同步到平台派单投影：与学生端流程共用同一篇 thesis-main，保证队列与计数一致。
      const task = platformState.expertTasks.find(
        (item) => item.thesisId === demoThesis.id && ['INVITED', 'IN_REVIEW'].includes(item.status),
      )
      if (!task) {
        // 学生端流程兼容：指派给专家端演示人格（expert-17 周明远），保证专家端
        // 接单闭环与学生端流程共用同一篇 thesis-main。此入口是演示流程叙述简化，
        // 跳过资格校验；平台运营台（PAGE-007）候选表仍按规则排除 REVIEWING 专家。
        const persona = platformState.experts.find((item) => item.id === EXPERT_PERSONA_ID)
        if (persona) {
          await platformOperation.assignExpertToThesis(demoThesis.id, persona.id)
        }
      }
      syncDispatchToThesisStage(demoThesis.id)
      state = { ...state, stage: 'UNDER_REVIEW', taskStatus: 'INVITED' }
      return snapshot()
    },
    acceptTask: async () => {
      // 学生端流程（Task 2 及更早）兼容入口：接受 thesis-main 当前在评任务并同步学生端阶段。
      // 与 submitFinalReview 的传播方式一致（按论文而非专家人格匹配）；专家页面的
      // acceptExpertTask 才执行「仅本人任务」守卫。
      const current = platformState.expertTasks.find(
        (task) =>
          task.thesisId === demoThesis.id && ['INVITED', 'IN_REVIEW'].includes(task.status),
      )
      if (!current) {
        throw new Error('未找到本人待接受任务，无法完成接单。')
      }
      let accepted = current
      if (current.status === 'INVITED') {
        accepted = { ...current, status: 'IN_REVIEW', materialsVisible: true }
        platformState = {
          ...platformState,
          expertTasks: platformState.expertTasks.map((task) =>
            task.id === current.id ? accepted : task,
          ),
        }
        persistPlatform()
      }
      state = { ...state, taskStatus: accepted.status as import('./types').ReviewTaskStatus }
      persist()
      return snapshot()
    },
    getSnapshot: async () => snapshot(),
    saveReviewDraft: async (input?: ReviewScoreInput) => {
      // 草稿保存同样按模板做字段级完整性检查：服务端强制，页面只读视图不提供草稿入口。
      if (input) {
        const draftErrors = validateReviewInput(input)
        if (draftErrors.length > 0) {
          throw new PlatformOperationError(
            'INVALID_INPUT',
            draftErrors.map((item) => item.message).join('；'),
          )
        }
      }
      state = {
        ...state,
        review: { ...state.review, draftSaved: true, ...(input ? { scoreInput: input } : {}) },
      }
      return snapshot()
    },
    submitFinalReview: async (input: ReviewScoreInput) => {
      // 提交前完整性检查：六维越界/缺项与必填文本均字段级报错，不产生任何状态写入。
      const reviewErrors = validateReviewInput(input)
      if (reviewErrors.length > 0) {
        throw new PlatformOperationError(
          'INVALID_INPUT',
          reviewErrors.map((item) => item.message).join('；'),
        )
      }
      // 最终提交防重复（服务端强制，评审要求）：论文级已提交（快照 taskStatus 为
      // SUBMITTED）即视为终态，重复提交直接返回当前快照（幂等空操作），不重复计账、
      // 不追加评阅版本、不重复扣减学校账户。
      if (state.taskStatus === 'SUBMITTED') {
        return snapshot()
      }
      // 专家任务层（acceptExpertTask / rejectExpertTask）已按「仅本人任务」守卫；
      // 此处为论文级最终评阅闭环（兼容 Task 6 之前的学生端流程测试）：无论平台层是否
      // 派单给专家人格，一律完成论文级终审提交，不重复计账。
      state = {
        ...state,
        stage: 'RESULT_PROCESSING',
        taskStatus: 'SUBMITTED',
        review: {
          draftSaved: true,
          submitted: true,
          score: totalScore(input),
          recommendation: input.recommendation,
          scoreInput: { ...input },
        },
        schoolAccount: {
          ...state.schoolAccount,
          frozenAmount: state.schoolAccount.frozenAmount - 300,
          consumedAmount: state.schoolAccount.consumedAmount + 300,
        },
        schoolBills: state.schoolBills.map((bill) =>
          bill.anonymousId === demoThesis.anonymousId
            ? { ...bill, status: 'CONSUMED' as const, consumedAt: '2026-08-24 16:40' }
            : bill,
        ),
        // 专家账户（PAGE-014）自 Task 8 起由费用流水投影（projectExpertAccount）汇总，
        // 不再维护 state.expertAccount 字段（仅保留历史兼容投影，见 fixtures.ts）。
      }
      // 专家提交终审：论文派单投影保持 PENDING_ACCEPTANCE，队列按任务状态派生为「待结算」。
      // 已提交任务保持匿名材料可见：专家端「已完成 → 查看」只读视图仍展示匿名版材料与本人已提交意见。
      // 费用流水（Task 8）：有效评阅入账 +300，只追加不可覆盖（防重复由上方 taskStatus 守卫保证）。
      platformState = appendLedgerEntry(platformState, {
        kind: 'REVIEW_CREDIT',
        amount: 300,
        description: '评阅收入：有效评阅任务入账（每篇有效评阅 ¥ 300.00）。',
        withdrawalId: undefined,
      })
      platformState = {
        ...platformState,
        expertTasks: platformState.expertTasks.map((task) =>
          task.thesisId === demoThesis.id && ['INVITED', 'IN_REVIEW'].includes(task.status)
            ? { ...task, status: 'SUBMITTED' as const, materialsVisible: true }
            : task,
        ),
        // 终审提交生成当前只读评阅版本 R1（版本历史投影，非真实论文内容）。
        // 演示场景装载时已存在 R1 则不再重复追加。
        reviewVersions: platformState.reviewVersions.some((version) => version.version === 'R1')
          ? platformState.reviewVersions
          : [
              ...platformState.reviewVersions,
              {
                id: 'review-version-r1',
                version: 'R1',
                status: 'CURRENT' as const,
                score: totalScore(input),
                submittedAt: '2026-08-24 16:40',
                readonly: true as const,
              },
            ],
      }
      persistPlatform()
      persist()
      return snapshot()
    },
    publishResult: () => moveTo('COMPLETED'),
    listSchoolTheses: async () => deepFreeze(structuredClone(listAllTheses())),
    submitThesisAsSchool: async (input: SchoolSubmissionInput) => {
      const sequence = state.theses.length + 40
      const created: DemoThesisSummary = {
        id: `thesis-${String(sequence).padStart(4, '0')}`,
        anonymousId: `HY-2026-${String(sequence).padStart(4, '0')}`,
        title: input.title,
        studentId: input.studentId,
        studentName: input.studentId === '20260042' ? demoIdentity.studentName : '已同步学生',
        batchId: input.batchId,
        batchName: input.batchId === 'batch-2026-spring' ? demoIdentity.batchName : '已选送审批次',
        discipline: { ...input.discipline },
        keywords: [...new Set(input.keywords.map((keyword) => keyword.trim()).filter(Boolean))],
        originalFileName: input.originalFileName,
        anonymousFileName: input.anonymousFileName,
        submissionSource: 'SCHOOL_MANUAL',
        stage: 'SUBMITTED',
        updatedAt: '2026-08-10 18:56',
        allowedActions: ['VIEW_THESIS'],
      }
      state = { ...state, theses: [...state.theses, created] }
      persist()
      return deepFreeze(structuredClone(created))
    },
    previewBatchImport: async () => {
      const rows: BatchImportRow[] = [
        {
          rowNumber: 2,
          studentId: '20260051',
          title: '面向教育场景的知识追踪研究',
          disciplineCode: '0812',
          fileName: '20260051.pdf',
          validationStatus: 'VALID',
        },
        {
          rowNumber: 3,
          studentId: '20260042',
          title: demoThesis.title,
          disciplineCode: '0812',
          fileName: '20260042.pdf',
          validationStatus: 'DUPLICATE',
          reason: '该学生在本批次已有同名论文',
        },
        {
          rowNumber: 4,
          studentId: '20260052',
          title: '交叉学科协同创新机制研究',
          disciplineCode: '9999',
          fileName: '20260052.pdf',
          validationStatus: 'UNKNOWN_DISCIPLINE',
          reason: '专业代码不在学校目录中',
        },
        {
          rowNumber: 5,
          studentId: '20260053',
          title: '区域数字治理能力评价研究',
          disciplineCode: '1204',
          fileName: '',
          validationStatus: 'MISSING_FILE',
          reason: '未找到与学号对应的论文文件',
        },
      ]
      return deepFreeze(structuredClone(rows))
    },
    listPublishedResults: async () => {
      if (state.stage !== 'COMPLETED' || !state.review.submitted) return []
      return deepFreeze(structuredClone(currentReviewResults()))
    },
    listReviewResults: async () => deepFreeze(structuredClone(currentReviewResults())),
    listExpertTasks: async (query?: import('./types').ExpertTaskQuery) => {
      // 平台派生任务为权威数据源；仅当平台尚无 thesis-main 的在评任务时，
      // 以学生端任务状态补充演示任务，保证学生端流程（Task 2 及更早）兼容。
      // 已完成论文（stage COMPLETED）同样返回任务，专家端「已完成」列表依赖它。
      // `own`（专家端任务列表传入）：仅本人任务——专家端投影只包含专家端演示人格
      // 的任务，运营派单给其他专家的任务在专家端不可见（他人任务对本人 FORBIDDEN）。
      const pendingCorrections = new Set(
        platformState.correctionRequests
          .filter((request) => request.status === 'PENDING')
          .map((request) => request.taskId),
      )
      const platformTasks: ExpertTaskSummary[] = platformState.expertTasks
        .filter((task) => (query?.own ? task.expertId === EXPERT_PERSONA_ID : true))
        .map((task) => projectExpertTask(task))
      // 学生端流程兼容回退：仅当平台尚无本人 thesis-main 在评任务、且查询为本人视图时补充。
      // 回退任务动作仍由状态派生：学生端任务状态为 INVITED 时出现可接受任务（学生端 acceptTask 路径），
      // 非 INVITED 时无接受入口，避免死胡同（状态已进入评阅/提交，专家端不再接单）。
      const hasOwnMainTask = platformTasks.some(
        (task) =>
          task.thesisId === demoThesis.id &&
          task.expertId === EXPERT_PERSONA_ID &&
          ['INVITED', 'IN_REVIEW', 'SUBMITTED'].includes(task.status),
      )
      if (state.taskStatus && !hasOwnMainTask && query?.own) {
        platformTasks.push(
          projectExpertTask({
            id: 'task-e-2026-042',
            thesisId: demoThesis.id,
            expertId: EXPERT_PERSONA_ID,
            anonymousId: demoThesis.anonymousId,
            anonymousTitle: '多模态知识推理方向匿名论文',
            discipline: { code: '0812', name: '计算机科学与技术' },
            status: state.taskStatus,
            fee: dispatchFeeStandard,
            dueAt: '2026-08-28 18:00',
            overdue: false,
            round: 1,
            materialsVisible: false,
            allowedActions: [],
          }),
        )
      }
      // 有更正申请的任务在投影上附加「需要更正」标记（页面据此渲染辅助 Tab 与列表标记）：
      // 仅限本人任务（任务与更正申请均需 expertId 匹配），他人任务的申请不误标。
      return deepFreeze(
        structuredClone(
          platformTasks.map((task) =>
            pendingCorrections.has(task.id) &&
            platformState.correctionRequests.some(
              (request) =>
                request.taskId === task.id &&
                request.expertId === task.expertId &&
                request.status === 'PENDING',
            )
              ? { ...task, correctionPending: true as const }
              : task,
          ),
        ),
      )
    },
    listOperationsItems: async () => {
      const queue: OperationsItem['queue'] =
        state.stage === 'READY_FOR_DISPATCH'
          ? 'PENDING_ASSIGNMENT'
          : state.taskStatus === 'INVITED'
            ? 'PENDING_ACCEPTANCE'
            : state.taskStatus === 'IN_REVIEW'
              ? 'IN_REVIEW'
              : 'COMPLETED'
      const items: OperationsItem[] = [
        {
          id: demoThesis.id,
          anonymousId: demoThesis.anonymousId,
          title: demoThesis.title,
          studentName: demoIdentity.studentName,
          tenantName: demoIdentity.tenantName,
          queue,
          ...(state.taskStatus ? { taskStatus: state.taskStatus } : {}),
          dueAt: '2026-08-28 18:00',
        },
      ]
      return deepFreeze(structuredClone(items))
    },
    getSchoolAccount: async () => deepFreeze(structuredClone(state.schoolAccount)),
    getSchoolBills: async () => deepFreeze(structuredClone(state.schoolBills)),
    // 专家账户由费用流水汇总投影（只读）：可提现 = 入账合计，冻结 = 未解除的提现合计。
    getExpertAccount: async () => deepFreeze(projectExpertAccount(platformState)),
    // 本人费用流水（只追加不可覆盖）：返回不可变快照，调用方无法改写已入账条目。
    listExpertLedger: async () =>
      deepFreeze(structuredClone(platformState.expertLedger)),
    // 专家端提交提现申请（PAGE-014）：金额 ≤ 可提现必填；幂等防重复；生成运营可审的申请。
    submitWithdrawal: async (amount: number): Promise<WithdrawalRequest> => {
      // 金额以分取整（Decimal 语义，页面格式化两位小数；服务端兜底边界）
      const roundedAmount = Math.round(amount * 100) / 100
      // 金额必填且为正数（页面必填校验，服务端兜底）
      if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
        throw new PlatformOperationError('INVALID_INPUT', '提现金额必须为正数。')
      }
      // 账户为纯函数投影（同步），无需跨 await 检查：不存在余额快照竞态窗口
      const current = projectExpertAccount(platformState)
      // 金额 ≤ 可提现（设计 §5.9；超过即拒绝，不改动任何状态）
      if (roundedAmount > current.availableAmount) {
        throw new PlatformOperationError('INVALID_INPUT', '提现金额不能超过可提现余额。')
      }
      // 幂等防重复（最终提交/提现均需二次确认并防重复）：仅拦截本人待审核申请
      // （评审修复：不因他人待审核申请而阻塞本人提现，红线「专家仅访问本人申请」）。
      if (
        platformState.withdrawals.some(
          (item) => item.expertId === EXPERT_PERSONA_ID && item.status === 'PENDING',
        )
      ) {
        throw new PlatformOperationError(
          'STATE_CONFLICT',
          '已存在待审核的提现申请，请等待平台处理后再提交新申请。',
        )
      }
      const withdrawalId = `WD-2026-${String(nextWithdrawalId(platformState.withdrawals)).padStart(4, '0')}`
      // 只追加：扣减不覆盖既有流水，新增一条 WITHDRAWAL 冻结条目（金额为负）。
      platformState = appendLedgerEntry(platformState, {
        kind: 'WITHDRAWAL',
        amount: -roundedAmount,
        description: `提现申请：冻结 ¥ ${roundedAmount.toFixed(2)}，等待平台审核。`,
        withdrawalId,
      })
      // 生成运营结算工作台（PAGE-022）可审的提现申请（SUBMITTED，见设计 §4.5）。
      const request: WithdrawalRequest = {
        id: withdrawalId,
        expertId: EXPERT_PERSONA_ID,
        expertName: '周明远',
        amount: roundedAmount,
        status: 'PENDING',
        requestedAt: DEMO_NOW,
        withdrawableBasis: `已完成有效评阅入账合计 ¥ ${current.availableAmount.toFixed(2)}，本次申请 ¥ ${roundedAmount.toFixed(2)}。`,
        freezeLedger: `冻结流水：提现申请冻结 ¥ ${roundedAmount.toFixed(2)}（等待平台审核）。`,
        bankName: '招商银行',
        maskedAccount: '招商银行（**** **** **** 1234）',
        history: [
          {
            action: 'SUBMIT',
            at: DEMO_NOW,
            note: `专家提交提现申请 ¥ ${roundedAmount.toFixed(2)}，冻结可提现余额。`,
          },
        ],
      }
      platformState = {
        ...platformState,
        withdrawals: [...platformState.withdrawals, request],
      }
      persistPlatform()
      return deepFreeze(structuredClone(request))
    },
    acceptExpertTask,
    rejectExpertTask,
    loadPlatformScenario: async (preset: PlatformScenarioPreset) => {
      // 演示时钟固定 2026-08-12 09:00（与平台服务一致），时限派生以此为准。
      const NOW = new Date('2026-08-12T09:00:00')
      const at = (day: number, hour = 18, minute = 0) =>
        `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      if (preset === 'CORRECTION_PENDING') {
        // Task 4 结算演示场景：待审批更正申请 + 待审核提现（本地快照）。
        platformState = applyExpertLedgerSeeds(createCorrectionSettlementScenario())
        persistPlatform()
        syncThesisStageToDispatch('thesis-main')
        return
      }
      const status: 'PENDING_DISPATCH' | 'PENDING_ACCEPTANCE' | 'IN_REVIEW' | 'COMPLETED' =
        preset === 'PENDING_REASSIGNMENT'
          ? 'PENDING_ACCEPTANCE'
          : preset === 'DUE_SOON' || preset === 'OVERDUE'
            ? 'IN_REVIEW'
            : preset
      const scenario: FixturePlatformState = createDispatchScenario([
        { thesisId: 'thesis-main', status },
      ])
      const task =
        status === 'PENDING_ACCEPTANCE'
          ? [
              createDemoTask(
                preset === 'PENDING_REASSIGNMENT' ? 'REJECTED' : 'INVITED',
              ),
            ]
          : status === 'IN_REVIEW'
            ? [
                createDemoTask('IN_REVIEW', {
                  // 逾期：截止早于演示时钟；临期：3 天内（isDueSoon 上限）。
                  ...(preset === 'OVERDUE'
                    ? { dueAt: at(10), overdue: true }
                    : preset === 'DUE_SOON'
                      ? { dueAt: at(14, 21) }
                      : {}),
                }),
              ]
            : status === 'COMPLETED'
              ? [createDemoTask('SUBMITTED', { dueAt: at(28) })]
              : []
      platformState = applyExpertLedgerSeeds({
        ...scenario,
        expertTasks: task,
        auditLog: initialAuditEntries(),
      })
      persistPlatform()
      syncThesisStageToDispatch('thesis-main')
    },
    loadExpertScenario: async (preset: ExpertScenarioPreset) => {
      // 专家端演示场景：原子替换本人任务与匿名材料投影（演示装载，不模拟真实时限调度）。
      const NOW = new Date('2026-08-12T09:00:00')
      const at = (day: number, hour = 18, minute = 0) =>
        `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      const taskForPreset = (): ExpertTaskSummary[] => {
        if (preset === 'CORRECTION_PENDING') {
          return [
            createDemoTask('SUBMITTED', { dueAt: at(28), materialsVisible: true }),
          ]
        }
        if (preset === 'REJECTED') {
          return [createDemoTask('REJECTED', { dueAt: at(26) })]
        }
        if (preset === 'OVERDUE') {
          return [createDemoTask('IN_REVIEW', { dueAt: at(10), overdue: true })]
        }
        if (preset === 'IN_REVIEW') {
          return [createDemoTask('IN_REVIEW', { dueAt: at(28) })]
        }
        if (preset === 'SUBMITTED') {
          return [createDemoTask('SUBMITTED', { dueAt: at(28), materialsVisible: true })]
        }
        return [createDemoTask('INVITED', { dueAt: at(26) })]
      }
      const dispatchStatus: DispatchThesisSeed['status'] =
        preset === 'CORRECTION_PENDING' || preset === 'SUBMITTED' ? 'COMPLETED' : 'PENDING_ACCEPTANCE'
      const scenario: FixturePlatformState =
        preset === 'CORRECTION_PENDING'
          ? createCorrectionSettlementScenario()
          : createDispatchScenario([{ thesisId: 'thesis-main', status: dispatchStatus }])
      platformState = applyExpertLedgerSeeds({
        ...scenario,
        expertTasks: taskForPreset(),
        auditLog: initialAuditEntries(),
      })
      persistPlatform()
      syncThesisStageToDispatch('thesis-main')
    },
    reset: async () => {
      storage.removeItem?.('baijie-demo-student:v1')
      storage.removeItem?.('baijie-demo-platform:v1')
      state = createInitialScenarioState()
      studentState = createInitialStudentPortalState()
      platformState = loadPlatformDemo(storage).platform
      persist()
      persistPlatform()
      return snapshot()
    },
  }
}
