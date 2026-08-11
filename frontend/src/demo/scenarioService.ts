import type { RoleCode } from '@/types/roles'

import { createInitialScenarioState, demoIdentity, demoThesis } from './fixtures'
import { createStudentPortalService } from '@/modules/thesis/services/studentPortalService'
import { createInitialStudentPortalState } from './studentFixtures'
import { loadStudentDemo, saveStudentDemo } from './studentPersistence'
import type {
  DemoAction,
  BatchImportRow,
  DemoRoleContext,
  DemoPublishedResult,
  ExpertTaskSummary,
  DemoScenarioSnapshot,
  DemoStage,
  DemoThesisSummary,
  OperationsItem,
  ReviewScoreInput,
  ScenarioService,
  SchoolSubmissionInput,
  StorageLike,
  StudentPortalService,
  StudentScenarioPreset,
} from './types'

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

function totalScore(input: ReviewScoreInput) {
  return (
    input.topicValue +
    input.literatureTheory +
    input.methodology +
    input.innovation +
    input.resultsWorkload +
    input.writingStandards
  )
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach((nested) => deepFreeze(nested))
  }
  return value
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
  let state = loaded.scenario
  let studentState = loaded.student

  const persist = () => saveStudentDemo(storage, state, studentState)
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

  const currentReviewResults = (): DemoPublishedResult[] =>
    state.review.submitted
      ? [
          {
            expertAlias: '专家 A',
            score: state.review.score ?? 0,
            recommendation: state.review.recommendation ?? '',
            comment: state.review.scoreInput?.overallComment ?? '',
            submittedAt: '2026-08-24 16:40',
          },
        ]
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
    loadScenario: (preset: StudentScenarioPreset) => {
      state = {
        ...state,
        stage: preset,
        taskStatus: preset === 'UNDER_REVIEW' ? 'IN_REVIEW' : state.taskStatus,
        review:
          preset === 'COMPLETED'
            ? {
                draftSaved: true,
                submitted: true,
                score: 86,
                recommendation: '建议通过',
                scoreInput: state.review.scoreInput,
              }
            : state.review,
      }
      persist()
    },
    reset: () => {
      state = createInitialScenarioState()
      studentState = createInitialStudentPortalState()
      persist()
    },
  })

  return {
    ...studentPortal,
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
      state = { ...state, stage: 'UNDER_REVIEW', taskStatus: 'INVITED' }
      return snapshot()
    },
    acceptTask: async () => {
      state = { ...state, taskStatus: 'IN_REVIEW' }
      return snapshot()
    },
    saveReviewDraft: async (input?: ReviewScoreInput) => {
      state = {
        ...state,
        review: { ...state.review, draftSaved: true, ...(input ? { scoreInput: input } : {}) },
      }
      return snapshot()
    },
    submitFinalReview: async (input: ReviewScoreInput) => {
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
        expertAccount: {
          ...state.expertAccount,
          availableAmount: state.expertAccount.availableAmount + 300,
        },
      }
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
    listExpertTasks: async () => {
      const tasks: ExpertTaskSummary[] = state.taskStatus
        ? [
            {
              id: 'task-e-2026-042',
              anonymousId: demoThesis.anonymousId,
              anonymousTitle: '多模态知识推理方向匿名论文',
              discipline: { code: '0812', name: '计算机科学与技术' },
              status: state.taskStatus,
              fee: 300,
              dueAt: '2026-08-28 18:00',
              overdue: false,
            },
          ]
        : []
      return deepFreeze(structuredClone(tasks))
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
    getExpertAccount: async () => deepFreeze(structuredClone(state.expertAccount)),
    reset: async () => {
      state = createInitialScenarioState()
      studentState = createInitialStudentPortalState()
      persist()
      return snapshot()
    },
  }
}
