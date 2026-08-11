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
  recipientRole?: 'student' | 'school_reviewer'
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

export interface ReviewScoreInput {
  topicValue: number
  literatureTheory: number
  methodology: number
  innovation: number
  resultsWorkload: number
  writingStandards: number
  recommendation: string
  strengths: string
  issues: string
  revisionAdvice: string
  overallComment: string
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
  /** Task 4：待审批更正申请 + 待审核提现的结算演示快照。 */
  | 'CORRECTION_PENDING'

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
  /** 专家端发起更正申请（演示：供审批投影装载，见专家端任务流程）。 */
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
}

/** 平台演示持久化负载（独立 key `baijie-demo-platform:v1`，见 platformPersistence.ts）。 */
export interface PlatformState {
  experts: ExpertProfile[]
  expertTasks: ExpertTaskSummary[]
  /** 评阅更正申请（PAGE-020 数据源，演示投影）。 */
  correctionRequests: CorrectionRequest[]
  /** 专家提现申请（PAGE-022 数据源，演示投影）。 */
  withdrawals: WithdrawalRequest[]
  /** Task 3 起：运营派单论文投影（本地演示快照）。 */
  dispatchTheses: DispatchThesisSeed[]
  /** Task 3 起：关键操作审计（演示投影）。 */
  auditLog: AuditLogEntry[]
  /** Task 4 起：评阅版本历史（新旧版本均保留，只读）。 */
  reviewVersions: ReviewVersion[]
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
  submitFinalReview(input: ReviewScoreInput): Promise<DemoScenarioSnapshot>
  publishResult(): Promise<DemoScenarioSnapshot>
  listSchoolTheses(): Promise<DemoThesisSummary[]>
  submitThesisAsSchool(input: SchoolSubmissionInput): Promise<DemoThesisSummary>
  previewBatchImport(): Promise<BatchImportRow[]>
  listPublishedResults(): Promise<DemoPublishedResult[]>
  listReviewResults(): Promise<DemoPublishedResult[]>
  listExpertTasks(): Promise<ExpertTaskSummary[]>
  listOperationsItems(): Promise<OperationsItem[]>
  getSchoolAccount(): Promise<SchoolAccountSummary>
  getSchoolBills(): Promise<SchoolBill[]>
  getExpertAccount(): Promise<ExpertAccountSummary>
  loadPlatformScenario(preset: PlatformScenarioPreset): Promise<void>
  reset(): Promise<DemoScenarioSnapshot>
}
