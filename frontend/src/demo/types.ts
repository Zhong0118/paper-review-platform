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
    | 'WITHDRAWAL_REQUESTED'
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
        | 'WITHDRAWAL_REQUESTED'
        | 'RESULT_PUBLISHED'
        | 'OBJECTION_SUBMITTED'
        | 'OBJECTION_RECEIVED'
      thesisId: string
    })
  | (StudentNotificationBase & {
      kind: 'DEMO_DATA_RESET'
      thesisId?: never
    })

export type StudentScenarioPreset = DemoStage

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
  anonymousId: string
  anonymousTitle: string
  discipline: { code: string; name: string }
  status: ReviewTaskStatus
  fee: number
  dueAt: string
  overdue: boolean
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

export interface ScenarioService extends StudentPortalService {
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
  reset(): Promise<DemoScenarioSnapshot>
}
