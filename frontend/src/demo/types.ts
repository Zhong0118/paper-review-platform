import type { RoleCode } from '@/types/roles'

export type ThesisStage =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PREPARING'
  | 'READY_FOR_DISPATCH'
  | 'UNDER_REVIEW'
  | 'RESULT_PROCESSING'
  | 'COMPLETED'
  | 'TERMINATED'

export type DemoStage = ThesisStage

export type ReviewTaskStatus =
  | 'INVITED'
  | 'IN_REVIEW'
  | 'SUBMITTED'
  | 'REJECTED'
  | 'ACCEPT_TIMEOUT'
  | 'CANCELLED'

export type OperationsQueue =
  | 'PENDING_ASSIGNMENT'
  | 'PENDING_ACCEPTANCE'
  | 'IN_REVIEW'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'PENDING_REASSIGNMENT'
  | 'PENDING_SUPPLEMENT'
  | 'CORRECTION_PENDING'
  | 'SETTLEMENT_PENDING'
  | 'COMPLETED'

export type SchoolBillStatus = 'FROZEN' | 'CONSUMED' | 'RELEASED' | 'CANCELLED' | 'REVERSED'

export type DemoAction =
  | 'EDIT_THESIS'
  | 'DELETE_DRAFT'
  | 'SUBMIT_THESIS'
  | 'CONFIRM_ANONYMIZATION'
  | 'CONFIRM_DISPATCH'
  | 'ASSIGN_EXPERTS'
  | 'ACCEPT_TASK'
  | 'SAVE_REVIEW_DRAFT'
  | 'SUBMIT_FINAL_REVIEW'
  | 'PUBLISH_RESULT'
  | 'VIEW_THESIS'
  | 'VIEW_RESULT'
  | 'WITHDRAW_BEFORE_DISPATCH'
  | 'REQUEST_WITHDRAWAL'
  | 'SUBMIT_OBJECTION'

export interface DemoRoleContext {
  role: RoleCode
  displayName: string
  tenantName?: string
}

export interface DemoThesis {
  id: string
  anonymousId: string
  title: string
  stage: DemoStage
  taskStatus?: ReviewTaskStatus
  billStatus?: SchoolBillStatus
  roundStatus?: string
  taskProgress: string
  allowedActions: DemoAction[]
  studentName?: string
}

export type SubmissionSource = 'STUDENT' | 'SCHOOL_MANUAL' | 'SCHOOL_BATCH'

export type StudentVisibleStage =
  | 'MATERIALS'
  | 'SCHOOL_REVIEW'
  | 'EXPERT_REVIEW'
  | 'RESULT_PROCESSING'
  | 'COMPLETED'
  | 'TERMINATED'

export type StudentAction =
  | 'EDIT_THESIS'
  | 'DELETE_DRAFT'
  | 'VIEW_THESIS'
  | 'WITHDRAW_BEFORE_DISPATCH'
  | 'REQUEST_WITHDRAWAL'
  | 'VIEW_RESULT'
  | 'SUBMIT_OBJECTION'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export interface StudentEligibility {
  eligible: boolean
  status: 'ELIGIBLE' | 'SUSPENDED' | 'EXPIRED' | 'NOT_ELIGIBLE'
  reason: string
  batchId: string
  batchName: string
  deadline: string
}

export interface StudentTimelineEvent {
  id: string
  kind:
    | 'DRAFT_CREATED'
    | 'THESIS_SUBMITTED'
    | 'THESIS_WITHDRAWN'
    | 'THESIS_RETURNED'
    | 'WITHDRAWAL_REQUESTED'
    | 'EXPERT_REVIEW_STARTED'
    | 'RESULT_PROCESSING_STARTED'
    | 'RESULT_PUBLISHED'
  occurredAt: string
  message: string
}

export interface ThesisFileMeta {
  id: string
  name: string
  size: number
  mimeType: string
  purpose: 'SCHOOL_ARCHIVE' | 'EXPERT_REVIEW' | 'OBJECTION'
  validationStatus: 'VALID' | 'REVIEW_REQUIRED' | 'PENDING' | 'INVALID'
}

/** @deprecated Use ThesisFileMeta for new student material flows. */
export type StudentFileMetadata = ThesisFileMeta

export interface StudentThesisDetail {
  id: string
  anonymousId: string
  title: string
  abstract: string
  studentId: string
  studentName: string
  batchId: string
  batchName: string
  discipline: { code: string; name: string }
  keywords: string[]
  originalFileName: string
  anonymousFileName: string
  stage: DemoStage
  studentVisibleStage: StudentVisibleStage
  allowedActions: StudentAction[]
  timeline: StudentTimelineEvent[]
  publicReason?: string
  submissionSource: SubmissionSource
  student: Readonly<{ id: string; name: string; tenantName: string }>
  form: {
    title: string
    abstract: string
    discipline: { code: string; name: string }
    keywords: string[]
  }
  files: ThesisFileMeta[]
  updatedAt: string
}

export interface StudentThesisQuery {
  stage?: DemoStage
}

export interface StudentDraftInput {
  title: string
  abstract: string
  discipline: { code: string; name: string }
  keywords: string[]
  files: ThesisFileMeta[]
}

export interface StudentWithdrawalRequest {
  id: string
  thesisId: string
  reason: string
  requestedAt: string
}

export interface StudentResult {
  thesisId: string
  totalScore: number
  dimensions: StudentScoreDimension[]
  conclusion: string
  publishedAt: string
  results: DemoPublishedResult[]
  objection?: StudentObjection
}

export interface StudentObjectionInput {
  reason: string
  request: string
  attachments: ThesisFileMeta[]
}

export type StudentObjectionStatus = 'SUBMITTED' | 'PROCESSING' | 'RESOLVED'

export interface StudentObjection {
  id: string
  thesisId: string
  reason: string
  request: string
  attachments: ThesisFileMeta[]
  status: StudentObjectionStatus
  submittedAt: string
  processingAt?: string
  resolvedAt?: string
  publicResolution?: string
}

interface StudentNotificationBase {
  id: string
  recipientRole?: 'student' | 'school_reviewer' | 'platform_reviewer' | 'expert'
  message: string
  createdAt: string
  read: boolean
}

export type StudentNotification =
  | (StudentNotificationBase & {
      kind:
        | 'THESIS_SUBMITTED'
        | 'THESIS_WITHDRAWN'
        | 'THESIS_RETURNED'
        | 'WITHDRAWAL_REQUESTED'
        | 'EXPERT_REVIEW_STARTED'
        | 'RESULT_PUBLISHED'
        | 'OBJECTION_SUBMITTED'
        | 'OBJECTION_RECEIVED'
      thesisId: string
    })
  | (StudentNotificationBase & {
      kind: 'DEMO_DATA_RESET'
      thesisId?: never
    })

/** Task 9：运营端与专家端的角色通知（PAGE-015，与学生端通知共用展示组件与隔离模式）。 */
export interface RoleNotification {
  id: string
  recipientRole: 'platform_reviewer' | 'expert'
  kind:
    /** 派单邀请（专家待接受）。 */
    | 'TASK_INVITED'
    /** 专家已接受（平台待跟进）。 */
    | 'TASK_ACCEPTED'
    /** 专家拒绝接单（平台待改派）。 */
    | 'TASK_REJECTED'
    /** 专家接单超时（平台待改派；演示投影，不模拟真实时限调度）。 */
    | 'TASK_TIMEOUT'
    /** 平台催审提醒（专家）。 */
    | 'REVIEW_REMINDER'
    /** 更正审批结果（专家）。 */
    | 'CORRECTION_DECIDED'
    /** 提现审核/付款结果（专家）。 */
    | 'WITHDRAWAL_DECIDED'
  message: string
  createdAt: string
  read: boolean
  /** 任务类通知的关联任务（跳转 /expert/tasks 的任务详情）。 */
  taskId?: string
  /** 提现类通知的关联申请（跳转 /expert/finance 的提现记录）。 */
  withdrawalId?: string
}

export type StudentScenarioPreset =
  | 'DRAFT'
  | 'RETURNED'
  | 'SCHOOL_REVIEW'
  | 'EXPERT_REVIEW'
  | 'RESULT_PROCESSING'
  | 'COMPLETED'

export type StudentEligibilityScenario = 'ELIGIBLE' | 'SUSPENDED' | 'EXPIRED'
export type StudentFileValidationScenario = 'VALID' | 'INVALID'

export interface StudentPortalService {
  getStudentEligibility(): Promise<StudentEligibility>
  listStudentTheses(query?: StudentThesisQuery): Promise<StudentThesisDetail[]>
  getStudentThesis(id: string): Promise<StudentThesisDetail>
  createStudentDraft(): Promise<StudentThesisDetail>
  saveStudentDraft(id: string, input: StudentDraftInput): Promise<StudentThesisDetail>
  submitStudentThesis(id: string): Promise<StudentThesisDetail>
  deleteStudentDraft(id: string): Promise<void>
  withdrawStudentThesis(id: string, reason: string): Promise<StudentThesisDetail>
  requestStudentWithdrawal(id: string, reason: string): Promise<StudentWithdrawalRequest>
  getStudentResult(id: string): Promise<StudentResult | null>
  submitStudentObjection(id: string, input: StudentObjectionInput): Promise<StudentObjection>
  listStudentNotifications(): Promise<StudentNotification[]>
  markStudentNotificationRead(id: string): Promise<StudentNotification[]>
  markAllStudentNotificationsRead(): Promise<StudentNotification[]>
  loadStudentScenario(preset: StudentScenarioPreset): Promise<StudentThesisDetail>
  setStudentDemoEligibility(preset: StudentEligibilityScenario): Promise<StudentEligibility>
  setStudentDemoFileValidation(preset: StudentFileValidationScenario): Promise<StudentThesisDetail>
  resetStudentDemo(): Promise<void>
}

export class StudentPortalError extends Error {
  constructor(
    public readonly code:
      | 'NOT_ELIGIBLE'
      | 'ILLEGAL_ACTION'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'STATE_CONFLICT'
      | 'DEMO_MODE_DISABLED',
    message: string,
  ) {
    super(message)
    this.name = 'StudentPortalError'
  }
}

export interface DemoThesisSummary {
  id: string
  anonymousId: string
  title: string
  studentId: string
  studentName: string
  batchId: string
  batchName: string
  discipline: { code: string; name: string }
  keywords: string[]
  originalFileName: string
  anonymousFileName: string
  submissionSource: SubmissionSource
  stage: DemoStage
  updatedAt: string
  allowedActions: DemoAction[]
}

export interface StudentSubmissionInput {
  title: string
  discipline: { code: string; name: string }
  keywords: string[]
  originalFileName: string
  anonymousFileName: string
}

export interface SchoolSubmissionInput {
  studentId: string
  batchId: string
  title: string
  discipline: { code: string; name: string }
  keywords: string[]
  originalFileName: string
  anonymousFileName: string
}

export interface BatchImportRow {
  rowNumber: number
  studentId: string
  title: string
  disciplineCode: string
  fileName: string
  validationStatus: 'VALID' | 'DUPLICATE' | 'UNKNOWN_DISCIPLINE' | 'MISSING_FILE'
  reason?: string
}

export interface DemoPublishedResult {
  expertAlias: string
  score: number
  dimensionScores?: StudentScoreDimension[]
  recommendation: string
  comment: string
  submittedAt: string
  publishedAt?: string
}

export interface StudentScoreDimension {
  key:
    | 'topicValue'
    | 'literatureTheory'
    | 'methodology'
    | 'innovation'
    | 'resultsWorkload'
    | 'writingStandards'
  label: string
  score: number
  maxScore: number
}

export interface DemoReview {
  draftSaved: boolean
  submitted: boolean
  score?: number
  recommendation?: string
  scoreInput?: ReviewScoreInput
}

/** 评阅维度 key：与六维模板快照一一对应（见 `REVIEW_SCORE_TEMPLATE`）。 */
export type ReviewDimensionKey =
  | 'topicValue'
  | 'literatureTheory'
  | 'methodology'
  | 'innovation'
  | 'resultsWorkload'
  | 'writingStandards'

/**
 * 六维评阅模板维度（设计规格 §4.4，版本化快照，页面按模板数据动态渲染不得写死）。
 * `key` 即评分输入字段名（ReviewScoreInput 的同名数值字段）。
 */
export interface ReviewDimensionTemplate {
  key: ReviewDimensionKey
  label: string
  maxScore: number
  guide: string
}

/**
 * 演示批次六维模板快照（合计 100 分）。
 * 页面/服务不得写死维度与满分，一律从该模板投影读取。
 */
export const REVIEW_SCORE_TEMPLATE: readonly ReviewDimensionTemplate[] = [
  { key: 'topicValue', label: '选题价值', maxScore: 15, guide: '问题意义与研究价值' },
  {
    key: 'literatureTheory',
    label: '文献与理论基础',
    maxScore: 15,
    guide: '综述充分性与理论依据',
  },
  {
    key: 'methodology',
    label: '研究设计与方法',
    maxScore: 20,
    guide: '方案合理性与方法严谨性',
  },
  {
    key: 'innovation',
    label: '研究内容与创新',
    maxScore: 25,
    guide: '工作量与创新贡献',
  },
  { key: 'writingStandards', label: '写作规范', maxScore: 10, guide: '结构与规范' },
  {
    key: 'resultsWorkload',
    label: '综合学术水平',
    maxScore: 15,
    guide: '整体学术水准',
  },
]

/**
 * 六维评阅输入（PAGE-010 提交载荷）。
 * `topicValue` 等数值字段对应模板维度（key 即字段名）；`evaluations` 为每维「可选评价」。
 */
export interface ReviewScoreInput {
  topicValue: number
  literatureTheory: number
  methodology: number
  innovation: number
  resultsWorkload: number
  writingStandards: number
  /** 每维可选评价（key → 评语）；缺省的维度不出现该 key。 */
  evaluations?: Partial<Record<ReviewDimensionKey, string>>
  recommendation: string
  strengths: string
  issues: string
  revisionAdvice: string
  overallComment: string
}

/** 提交前完整性/越界校验的单字段错误（服务端强制，演示实现模拟）。 */
export interface ReviewInputError {
  field: string
  message: string
}

export interface SchoolAccountSummary {
  currency: 'CNY'
  availableAmount: number
  frozenAmount: number
  consumedAmount: number
}

export interface ExpertAccountSummary {
  currency: 'CNY'
  availableAmount: number
  pendingAmount: number
}

export interface SchoolBill {
  id: string
  anonymousId: string
  amount: number
  status: SchoolBillStatus
  ruleVersion: string
  createdAt: string
  consumedAt?: string
}

/** Task 5 专家任务允许动作（由任务状态与服务端规则派生，页面按钮据此渲染）。 */
export type ExpertTaskAction = 'ACCEPT_TASK' | 'REJECT_TASK' | 'CONTINUE_REVIEW' | 'VIEW_SUBMITTED'

export interface ExpertTaskSummary {
  id: string
  thesisId?: string
  expertId?: string
  anonymousId: string
  anonymousTitle: string
  discipline: { code: string; name: string }
  status: ReviewTaskStatus
  fee: number
  dueAt: string
  overdue: boolean
  round?: number
  /** Task 5 起：接单截止（INVITED 任务显示；评阅截止与接单截止均按租户时区绝对时间展示）。 */
  acceptBy?: string
  /** 接单前材料不可见；接受后（IN_REVIEW）才可见（双盲红线）。专家端投影始终派生。 */
  materialsVisible?: boolean
  /** 匿名化摘要（接单前可展示的匿名基本信息）。 */
  abstract?: string
  /** 专业匹配说明（接单详情 PAGE-009）。 */
  matchNote?: string
  /** 评审模板说明（六维快照说明，演示文案）。 */
  templateNote?: string
  /** 评审费用说明（接单详情 PAGE-009 展示；正式结算规则以后端为准）。 */
  feeNote?: string
  /** 存在待审批更正申请时置 true（列表「需要更正」标记与辅助 Tab 依据）。 */
  correctionPending?: boolean
  /** 允许动作：状态按钮由服务端派生，页面不自行推断。专家端投影始终派生。 */
  allowedActions?: ExpertTaskAction[]
}

/** Task 5 专家任务列表查询：`own` 表示仅投影当前专家端演示人格（本人）的任务。 */
export interface ExpertTaskQuery {
  own?: boolean
}

export interface OperationsItem {
  id: string
  anonymousId: string
  title: string
  studentName: string
  tenantName: string
  queue: OperationsQueue
  taskStatus?: ReviewTaskStatus
  dueAt?: string
}

export interface DemoScenarioSnapshot {
  context: DemoRoleContext
  thesis: DemoThesis
  review?: DemoReview
}

export type ExpertQualificationStatus = 'APPROVED' | 'REVIEWING' | 'REJECTED'

export type ExpertServiceStatus = 'ACTIVE' | 'DISABLED'

export type ExpertQualificationAction = 'APPROVED' | 'REJECTED'

export type ExpertProfileAction =
  | 'UPDATE_PROFILE'
  | 'SET_SERVICE_STATUS'
  | 'REVIEW_QUALIFICATION'

/** 平台运营可见的专家档案投影。 */
export interface ExpertProfile {
  id: string
  name: string
  /** 联系方式（专家本人维护；演示文案，不宣称真实消息能力）。 */
  contact: string
  unit: string
  title: string
  discipline: { code: string; name: string }
  researchTags: string[]
  reviewableTypes: string[]
  qualification: ExpertQualificationStatus
  qualificationNote?: string
  serviceStatus: ExpertServiceStatus
  serviceNote?: string
  avoidSchools: string[]
  /** 本人回避声明补充（专家本人查看/填写；演示投影）。 */
  avoidStatement?: string
  /** 资格材料投影（演示只存文件名/类型/有效期/状态/原因，不读取正文）。 */
  qualificationMaterials?: ExpertQualificationMaterial[]
  activeTasks: number
  completedTasks: number
  overdueRate: string
  avgCompletionDays: number
  acceptanceRate: string
  onTimeRate: string
  qualitySummary: string
  feeStandard: number
  payoutStatus: 'BOUND' | 'PENDING'
  allowedActions: ExpertProfileAction[]
}

/** 资格材料投影（PAGE-021）：演示只保存元数据，不读取文件正文（见设计 §8）。 */
export interface ExpertQualificationMaterial {
  id: string
  fileName: string
  fileType: string
  validUntil: string
  status: ExpertQualificationStatus
  /** 驳回原因（审核驳回时平台填写；本人只读查看）。 */
  rejectReason?: string
  submittedAt: string
}

/** 专家端本人资料投影（PAGE-021）：仅本人可编辑字段，不含平台运营维护字段。 */
export interface ExpertSelfProfile {
  id: string
  name: string
  contact: string
  unit: string
  title: string
  discipline: { code: string; name: string }
  researchTags: string[]
  reviewableTypes: string[]
  qualification: ExpertQualificationStatus
  qualificationNote?: string
  qualificationMaterials: ExpertQualificationMaterial[]
  avoidStatement: string
}

export interface ExpertProfileQuery {
  qualification?: ExpertQualificationStatus
  serviceStatus?: ExpertServiceStatus
}

export interface ExpertProfileCreateInput {
  name: string
  unit: string
  title: string
  discipline: { code: string; name: string }
  researchTags: string[]
  avoidSchools: string[]
}

export type ExpertProfilePatch = Partial<
  Pick<ExpertProfile, 'researchTags' | 'avoidSchools' | 'feeStandard'>
>

/** Task 3 派单匹配的候选投影；本轮仅保留契约。 */
export interface ExpertMatchCandidate {
  id: string
  name: string
  unit: string
  title: string
  discipline: { code: string; name: string }
  fields: string[]
  keywordHits: string[]
  conflictHit: boolean
  conflictReason?: string
  selectable: boolean
  activeTasks: number
  acceptanceRate: string
  onTimeRate: string
  avgCompletionDays: number
  feeStandard: number
  /** 可解释匹配原因：关键词命中 + 历史质量（供运营人工判断）。 */
  matchReason: string
}

/** Task 3 运营派单论文投影（PAGE-007 待派列表与详情面板数据源）。 */
export interface DispatchThesisSeed {
  id: string
  anonymousId: string
  title: string
  tenantName: string
  discipline: { code: string; name: string }
  keywords: string[]
  thesisType: string
  avoidRule: string
  schoolRequirement: string
  status: 'PENDING_DISPATCH' | 'PENDING_ACCEPTANCE' | 'IN_REVIEW' | 'COMPLETED'
  round: number
  seeded?: boolean
}

/** 演示场景装载的派单状态覆盖（见 platformFixtures.createDispatchScenario）。 */
export interface DispatchStatus {
  thesisId: string
  status: 'PENDING_DISPATCH' | 'PENDING_ACCEPTANCE' | 'IN_REVIEW' | 'COMPLETED'
}

/** 平台关键操作审计投影（演示记录到本地）。 */
export interface AuditLogEntry {
  id: string
  action:
    | 'SEED'
    | 'ASSIGN'
    | 'REASSIGN'
    | 'REMIND'
    | 'EXTEND'
    | 'SET_SERVICE_STATUS'
    | 'REVIEW_QUALIFICATION'
    | 'CORRECTION_DECIDED'
    | 'WITHDRAWAL_REVIEWED'
    | 'PAYMENT_RECORDED'
    /** Task 5：专家拒绝接单（触发运营改派队列）。 */
    | 'REJECT'
    /** Task 7：专家本人保存资料（PAGE-021，写审计）。 */
    | 'PROFILE_UPDATED'
  thesisId?: string
  expertId?: string
  taskId?: string
  detail: string
  operator: string
  occurredAt: string
}

export type PlatformScenarioPreset =
  | 'PENDING_DISPATCH'
  | 'PENDING_ACCEPTANCE'
  | 'IN_REVIEW'
  | 'PENDING_REASSIGNMENT'
  | 'DUE_SOON'
  | 'OVERDUE'
  | 'COMPLETED'
  /** Task 4：待审批更正申请与待审核提现的结算演示快照。 */
  | 'CORRECTION_PENDING'

/** Task 5 专家端演示场景预设（PAGE-008 任务列表装载）。 */
export type ExpertScenarioPreset =
  | 'INVITED'
  | 'IN_REVIEW'
  | 'OVERDUE'
  | 'SUBMITTED'
  | 'CORRECTION_PENDING'
  | 'REJECTED'

/** Task 4 更正申请的投影（PAGE-020）。 */
export interface CorrectionRequest {
  id: string
  taskId: string
  anonymousId: string
  expertId: string
  expertName: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  reason: string
  requestedAt: string
  /** 拟更正差异（演示投影，非真实论文原文）。 */
  proposedDiff: string
  /** 证据与依据（演示投影）。 */
  evidence: string
  /** 审核意见（必填，驳回必须；批准亦需意见）。 */
  decisionReason?: string
  /** 原评阅版本号（如 R1），批准后生成新版本。 */
  version: string
  /** 批准后生成的新版本 ID；批准前不存在。 */
  newVersionId?: string
  /** 新版本链接（新版本号），批准后建立版本关系。 */
  oldVersionId?: string
  /** 原结果已发布时的影响范围提示（演示文案）。 */
  impactWarning?: string
}

/** 评阅版本历史投影：新旧版本均保留且只读，版本链记录新旧关系。 */
export interface ReviewVersion {
  id: string
  version: string
  status: 'CURRENT' | 'SUPERSEDED'
  score: number
  submittedAt: string
  readonly: true
  /** 版本链：被哪个新版本替换（仅旧版本存在）。 */
  nextVersionId?: string
}

export type CorrectionDecision = 'APPROVED' | 'REJECTED'

/** Task 4 提现申请的投影（PAGE-022）。 */
export interface WithdrawalRequest {
  id: string
  expertId: string
  expertName: string
  amount: number
  status: 'PENDING' | 'REVIEWING' | 'PAID' | 'REJECTED' | 'REVERSED'
  requestedAt: string
  /** 审核意见（驳回必须；审核通过亦需意见）。 */
  reason?: string
  /** 可提现依据（演示投影）。 */
  withdrawableBasis: string
  /** 冻结流水摘要（演示投影）。 */
  freezeLedger: string
  /** 收款银行名（脱敏展示，不出现完整账号）。 */
  bankName: string
  /** 脱敏账号（如 6222*******1234），完整账号永不出现在投影中。 */
  maskedAccount: string
  /** 线下付款凭证号（回填成功时写入，幂等校验依据）。 */
  voucherNo?: string
  /** 线下付款时间（回填成功时写入；演示固定时间，不模拟真实支付）。 */
  paidAt?: string
  /** 付款失败等处理备注（演示投影）。 */
  paymentNote?: string
  /** 历史处理记录（只追加）。 */
  history: WithdrawalHistoryEntry[]
}

/** 提现处理历史条目（演示投影，只追加不可覆盖）。 */
export interface WithdrawalHistoryEntry {
  action: 'SUBMIT' | 'APPROVE' | 'REJECT' | 'PAYMENT_SUCCESS' | 'PAYMENT_FAILED' | 'REVERSE'
  at: string
  note: string
}

export type WithdrawalReviewDecision = 'APPROVE' | 'REJECT'
export type PaymentResult = 'SUCCESS' | 'FAILED'

/** Task 8 专家端费用流水条目（只追加不可覆盖，可审计投影）。 */
export type ExpertLedgerKind = 'REVIEW_CREDIT' | 'WITHDRAWAL' | 'RELEASE' | 'PAYMENT' | 'REVERSAL'

/** 费用流水条目：金额带符号（入账正数、冻结/付款负数）；REVIEW_CREDIT 由有效评阅入账生成。 */
export interface ExpertLedgerEntry {
  id: string
  kind: ExpertLedgerKind
  /** 带符号金额：REVIEW_CREDIT/RELEASE/REVERSAL 为正，WITHDRAWAL/PAYMENT 为负。 */
  amount: number
  /** 流水说明（页面直接展示，演示文案）。 */
  description: string
  occurredAt: string
  /** 关联提现申请（WITHDRAWAL/RELEASE/PAYMENT 条目必带）。 */
  withdrawalId?: string
}

/** 十条运营队列的计数投影。 */
export interface OperationsQueueCounts extends Record<OperationsQueue, number> {}

export interface PlatformOperationService {
  listExpertProfiles(query?: ExpertProfileQuery): Promise<ExpertProfile[]>
  createExpertProfile(input: ExpertProfileCreateInput): Promise<ExpertProfile>
  updateExpertProfile(id: string, patch: ExpertProfilePatch): Promise<ExpertProfile>
  setExpertServiceStatus(
    id: string,
    status: ExpertServiceStatus,
    reason: string,
  ): Promise<ExpertProfile>
  reviewExpertQualification(
    id: string,
    decision: ExpertQualificationAction,
    reason: string,
  ): Promise<ExpertProfile>
  listExpertMatches(thesisId: string): Promise<ExpertMatchCandidate[]>
  listOperationsQueues(): Promise<OperationsQueueCounts>
  listDispatchTheses(): Promise<DispatchThesisSeed[]>
  assignExpertToThesis(thesisId: string, expertId: string): Promise<ExpertTaskSummary | null>
  reassignExpertTask(taskId: string, expertId: string, reason: string): Promise<ExpertTaskSummary>
  remindExpertTask(taskId: string): Promise<ExpertTaskSummary>
  extendExpertTask(taskId: string, days: number): Promise<ExpertTaskSummary>
  listPlatformAuditLog(): Promise<AuditLogEntry[]>
  /** Task 4 更正审批（PAGE-020）：列表与审批；批准生成新版本，旧版本只读保留。 */
  listCorrectionRequests(): Promise<CorrectionRequest[]>
  /** 专家端发起更正申请（演示：申请专家与差异由演示装载提供）。 */
  requestCorrection(taskId: string, reason: string): Promise<CorrectionRequest>
  decideCorrection(
    id: string,
    decision: CorrectionDecision,
    reason: string,
  ): Promise<CorrectionRequest>
  /** 评阅版本历史：新旧版本均保留且只读。 */
  listReviewVersions(taskId: string): Promise<ReviewVersion[]>
  /** Task 4 结算处理（PAGE-022）：提现列表、审核与线下付款回填。 */
  listWithdrawals(): Promise<WithdrawalRequest[]>
  reviewWithdrawal(
    id: string,
    decision: WithdrawalReviewDecision,
    reason: string,
  ): Promise<WithdrawalRequest>
  recordWithdrawalPayment(
    id: string,
    result: PaymentResult,
    voucher: string,
  ): Promise<WithdrawalRequest>
  /** Task 7 专家端本人资料投影（PAGE-021）：仅本人字段，不含运营维护字段。 */
  getExpertProfile(): Promise<ExpertSelfProfile>
  /** Task 7 专家本人保存资料（姓名只读；Tags≤8 去重；学科受控目录；变更写审计）。 */
  saveExpertProfile(input: ExpertProfileSaveInput): Promise<ExpertSelfProfile>
  /** Task 8 专家端本人费用流水（PAGE-014，只追加只读可审计投影）。 */
  listExpertLedger(): Promise<ExpertLedgerEntry[]>
  /** Task 8 专家端提交提现申请（≤ 可提现必填；幂等防重复；生成运营可审的 WithdrawalRequest）。 */
  submitWithdrawal(amount: number): Promise<WithdrawalRequest>
  /** Task 9：按 recipientRole 隔离的两角色通知（platform_reviewer/expert，不可变快照）。 */
  listRoleNotifications(role: 'platform_reviewer' | 'expert'): Promise<RoleNotification[]>
  /** Task 9：标记本角色单条通知已读（只影响该角色自己的通知）。 */
  markRoleNotificationRead(
    role: 'platform_reviewer' | 'expert',
    id: string,
  ): Promise<RoleNotification[]>
  /** Task 9：标记本角色全部通知已读（不影响其他角色与学校通知）。 */
  markAllRoleNotificationsRead(role: 'platform_reviewer' | 'expert'): Promise<RoleNotification[]>
}

/** 专家端本人资料保存输入（姓名只读，服务端忽略任何改名尝试）。 */
export interface ExpertProfileSaveInput {
  name?: string
  contact?: string
  unit?: string
  title?: string
  discipline?: { code: string; name: string }
  researchTags?: string[]
  reviewableTypes?: string[]
  avoidStatement?: string
}

/** 平台演示持久化负载（独立 key `baijie-demo-platform:v1`，见 platformPersistence.ts）。 */
export interface PlatformState {
  experts: ExpertProfile[]
  expertTasks: ExpertTaskSummary[]
  /** 评阅更正申请（PAGE-020 数据源，演示投影）。 */
  correctionRequests: CorrectionRequest[]
  /** 专家提现申请（PAGE-022 数据源，演示投影）。 */
  withdrawals: WithdrawalRequest[]
  /** Task 8 起：专家费用流水（只追加不可覆盖，可审计投影；REVIEW_CREDIT 由最终提交计账）。 */
  expertLedger: ExpertLedgerEntry[]
  /** Task 3 起：运营派单论文投影（本地演示快照）。 */
  dispatchTheses: DispatchThesisSeed[]
  /** Task 3 起：关键操作审计（演示投影）。 */
  auditLog: AuditLogEntry[]
  /** Task 4 起：评阅版本历史（新旧版本均保留，只读）。 */
  reviewVersions: ReviewVersion[]
  /** Task 9 起：两角色（platform_reviewer/expert）角色通知（PAGE-015 数据源）。 */
  notifications: RoleNotification[]
}

export class PlatformOperationError extends Error {
  constructor(
    public readonly code:
      | 'ILLEGAL_ACTION'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'INVALID_INPUT'
      | 'STATE_CONFLICT'
      | 'VERSION_CONFLICT'
      | 'DEMO_MODE_DISABLED',
    message: string,
  ) {
    super(message)
    this.name = 'PlatformOperationError'
  }
}

export interface ScenarioService extends StudentPortalService, PlatformOperationService {
  listSchoolNotifications(): Promise<StudentNotification[]>
  loginAs(role: RoleCode): Promise<DemoScenarioSnapshot>
  submitThesis(input?: StudentSubmissionInput): Promise<DemoScenarioSnapshot>
  confirmAnonymization(): Promise<DemoScenarioSnapshot>
  confirmDispatch(): Promise<DemoScenarioSnapshot>
  assignExperts(): Promise<DemoScenarioSnapshot>
  acceptTask(): Promise<DemoScenarioSnapshot>
  saveReviewDraft(input?: ReviewScoreInput): Promise<DemoScenarioSnapshot>
  /** 读回当前角色视角快照（草稿恢复等场景：工作台刷新后读回本人已保存草稿）。 */
  getSnapshot(): Promise<DemoScenarioSnapshot>
  submitFinalReview(input: ReviewScoreInput): Promise<DemoScenarioSnapshot>
  publishResult(): Promise<DemoScenarioSnapshot>
  listSchoolTheses(): Promise<DemoThesisSummary[]>
  submitThesisAsSchool(input: SchoolSubmissionInput): Promise<DemoThesisSummary>
  previewBatchImport(): Promise<BatchImportRow[]>
  listPublishedResults(): Promise<DemoPublishedResult[]>
  listReviewResults(): Promise<DemoPublishedResult[]>
  listExpertTasks(query?: ExpertTaskQuery): Promise<ExpertTaskSummary[]>
  listOperationsItems(): Promise<OperationsItem[]>
  getSchoolAccount(): Promise<SchoolAccountSummary>
  getSchoolBills(): Promise<SchoolBill[]>
  getExpertAccount(): Promise<ExpertAccountSummary>
  /** Task 5 专家端接单（INVITED→IN_REVIEW，仅本人任务；接受后匿名材料可见）。 */
  acceptExpertTask(taskId: string): Promise<ExpertTaskSummary>
  /** Task 5 专家端拒绝（INVITED→REJECTED，原因必填；触发运营改派提示，不模拟真实通知）。 */
  rejectExpertTask(taskId: string, reason: string): Promise<ExpertTaskSummary>
  /** Task 5 专家端演示场景装载（任务列表/接单详情/逾期/已完成/需要更正/已拒绝）。 */
  loadExpertScenario(preset: ExpertScenarioPreset): Promise<void>
  loadPlatformScenario(preset: PlatformScenarioPreset): Promise<void>
  reset(): Promise<DemoScenarioSnapshot>
}
