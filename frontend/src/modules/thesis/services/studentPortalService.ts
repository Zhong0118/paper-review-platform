import type {
  DemoPublishedResult,
  DemoStage,
  DemoThesisSummary,
  StudentAction,
  StudentDraftInput,
  StudentNotification,
  StudentObjectionInput,
  StudentPortalService,
  StudentResult,
  StudentScenarioPreset,
  StudentThesisDetail,
  StudentThesisQuery,
  StudentTimelineEvent,
  ThesisFileMeta,
  StudentVisibleStage,
  StudentWithdrawalRequest,
} from '@/demo/types'
import { StudentPortalError } from '@/demo/types'
import type { StudentPortalState } from '@/demo/studentFixtures'

export function toStudentVisibleStage(stage: DemoStage): StudentVisibleStage {
  if (stage === 'DRAFT') return 'MATERIALS'
  if (['SUBMITTED', 'PREPARING', 'READY_FOR_DISPATCH'].includes(stage)) return 'SCHOOL_REVIEW'
  if (stage === 'UNDER_REVIEW') return 'EXPERT_REVIEW'
  if (stage === 'RESULT_PROCESSING') return 'RESULT_PROCESSING'
  if (stage === 'COMPLETED') return 'COMPLETED'
  return 'TERMINATED'
}

interface StudentPortalDependencies {
  getTheses: () => DemoThesisSummary[]
  replaceThesis: (thesis: DemoThesisSummary) => void
  removeThesis: (id: string) => void
  setMainStage: (stage: DemoStage) => void
  getState: () => StudentPortalState
  setState: (state: StudentPortalState) => void
  getResults: () => DemoPublishedResult[]
  demoMode: boolean
  loadScenario: (preset: StudentScenarioPreset) => void
  reset: () => void
}

function immutable<T>(value: T): T {
  const freeze = (entry: unknown): void => {
    if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) {
      Object.freeze(entry)
      Object.values(entry).forEach(freeze)
    }
  }
  const copy = structuredClone(value)
  freeze(copy)
  return copy
}

function actionsFor(thesis: DemoThesisSummary): StudentAction[] {
  if (thesis.submissionSource !== 'STUDENT') {
    return thesis.stage === 'COMPLETED' ? ['VIEW_RESULT'] : ['VIEW_THESIS']
  }
  if (thesis.stage === 'DRAFT') return ['EDIT_THESIS', 'DELETE_DRAFT']
  if (['SUBMITTED', 'PREPARING', 'READY_FOR_DISPATCH'].includes(thesis.stage)) {
    return ['VIEW_THESIS', 'WITHDRAW_BEFORE_DISPATCH']
  }
  if (thesis.stage === 'UNDER_REVIEW') return ['REQUEST_WITHDRAWAL']
  if (thesis.stage === 'COMPLETED') return ['VIEW_RESULT', 'SUBMIT_OBJECTION']
  return []
}

function persistedFileMeta(file: ThesisFileMeta): ThesisFileMeta {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    mimeType: file.mimeType,
    purpose: file.purpose,
    validationStatus: file.validationStatus,
  }
}

function normalizeKeywords(keywords: string[]) {
  return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean))]
}

function ensureKeywordLimit(keywords: string[]) {
  if (keywords.length > 5) {
    throw new StudentPortalError('INVALID_INPUT', '关键词最多填写 5 个。')
  }
}

export function createStudentPortalService(deps: StudentPortalDependencies): StudentPortalService {
  const findThesis = (id: string) => {
    const thesis = deps.getTheses().find((item) => item.id === id)
    if (!thesis) throw new StudentPortalError('NOT_FOUND', '未找到该论文记录。')
    if (thesis.studentId !== '20260042') {
      throw new StudentPortalError('FORBIDDEN', '无权访问其他学生的论文记录。')
    }
    return thesis
  }
  const ensureAction = (thesis: DemoThesisSummary, action: StudentAction) => {
    if (!actionsFor(thesis).includes(action)) {
      throw new StudentPortalError('ILLEGAL_ACTION', '当前论文状态不允许执行此操作。')
    }
  }
  const detail = (thesis: DemoThesisSummary): StudentThesisDetail => {
    const state = deps.getState()
    return immutable({
      id: thesis.id,
      anonymousId: thesis.anonymousId,
      title: thesis.title,
      abstract: state.abstractsByThesis[thesis.id] ?? '',
      studentId: thesis.studentId,
      studentName: thesis.studentName,
      batchId: thesis.batchId,
      batchName: thesis.batchName,
      discipline: thesis.discipline,
      keywords: thesis.keywords,
      originalFileName: thesis.originalFileName,
      anonymousFileName: thesis.anonymousFileName,
      stage: thesis.stage,
      studentVisibleStage: toStudentVisibleStage(thesis.stage),
      allowedActions: actionsFor(thesis),
      timeline: state.timelines[thesis.id] ?? [],
      submissionSource: thesis.submissionSource,
      student: { id: thesis.studentId, name: thesis.studentName, tenantName: '海岳大学' },
      form: {
        title: thesis.title,
        abstract: state.abstractsByThesis[thesis.id] ?? '',
        discipline: thesis.discipline,
        keywords: thesis.keywords,
      },
      files: state.fileMetadataByThesis[thesis.id] ?? [],
      updatedAt: thesis.updatedAt,
    })
  }
  const addTimeline = (thesisId: string, event: StudentTimelineEvent) => {
    const state = deps.getState()
    deps.setState({
      ...state,
      timelines: { ...state.timelines, [thesisId]: [...(state.timelines[thesisId] ?? []), event] },
    })
  }
  const notify = (notification: StudentNotification) => {
    const state = deps.getState()
    deps.setState({ ...state, notifications: [notification, ...state.notifications] })
  }
  const timestamp = '2026-08-11 09:00'

  return {
    listStudentTheses: async (query?: StudentThesisQuery) =>
      immutable(
        deps
          .getTheses()
          .filter((thesis) => thesis.studentId === '20260042')
          .filter((thesis) => !query?.stage || thesis.stage === query.stage)
          .map(detail),
      ),
    getStudentThesis: async (id) => detail(findThesis(id)),
    createStudentDraft: async () => {
      const state = deps.getState()
      const eligibility = state.eligibility
      if (!eligibility.eligible || eligibility.status !== 'ELIGIBLE') {
        throw new StudentPortalError('NOT_ELIGIBLE', eligibility.reason)
      }
      const sequence = String(state.nextDraftSequence).padStart(4, '0')
      const thesis: DemoThesisSummary = {
        id: `thesis-draft-${sequence}`,
        anonymousId: `HY-2026-${sequence}`,
        title: '',
        studentId: '20260042',
        studentName: '林知远',
        batchId: eligibility.batchId,
        batchName: eligibility.batchName,
        discipline: { code: '', name: '' },
        keywords: [],
        originalFileName: '',
        anonymousFileName: '',
        submissionSource: 'STUDENT',
        stage: 'DRAFT',
        updatedAt: timestamp,
        allowedActions: ['EDIT_THESIS'],
      }
      deps.setState({ ...state, nextDraftSequence: state.nextDraftSequence + 1 })
      deps.replaceThesis(thesis)
      addTimeline(thesis.id, {
        id: `timeline-${thesis.id}-created`,
        kind: 'DRAFT_CREATED',
        occurredAt: timestamp,
        message: '已创建论文草稿。',
      })
      return detail(thesis)
    },
    saveStudentDraft: async (id: string, input: StudentDraftInput) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'EDIT_THESIS')
      const keywords = normalizeKeywords(input.keywords)
      ensureKeywordLimit(keywords)
      const originalFile = input.files.find((file) => file.purpose === 'SCHOOL_ARCHIVE')
      const anonymousFile = input.files.find((file) => file.purpose === 'EXPERT_REVIEW')
      const updated = {
        ...thesis,
        title: input.title,
        discipline: { ...input.discipline },
        keywords,
        originalFileName: originalFile?.name ?? '',
        anonymousFileName: anonymousFile?.name ?? '',
        updatedAt: timestamp,
      }
      deps.replaceThesis(updated)
      const state = deps.getState()
      deps.setState({
        ...state,
        abstractsByThesis: { ...state.abstractsByThesis, [id]: input.abstract },
        fileMetadataByThesis: {
          ...state.fileMetadataByThesis,
          [id]: input.files.map(persistedFileMeta),
        },
      })
      return detail(updated)
    },
    submitStudentThesis: async (id: string) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'EDIT_THESIS')
      const state = deps.getState()
      const files = state.fileMetadataByThesis[id] ?? []
      const keywords = normalizeKeywords(thesis.keywords)
      ensureKeywordLimit(keywords)
      const hasOriginal = files.some(
        (file) => file.purpose === 'SCHOOL_ARCHIVE' && file.validationStatus === 'VALID',
      )
      const hasAnonymous = files.some(
        (file) =>
          file.purpose === 'EXPERT_REVIEW' &&
          ['VALID', 'REVIEW_REQUIRED'].includes(file.validationStatus),
      )
      if (
        !thesis.title.trim() ||
        !(state.abstractsByThesis[id] ?? '').trim() ||
        !thesis.discipline.code ||
        keywords.length === 0 ||
        !hasOriginal ||
        !hasAnonymous
      ) {
        throw new StudentPortalError('ILLEGAL_ACTION', '论文材料不完整或文件尚未通过校验。')
      }
      const updated = { ...thesis, stage: 'SUBMITTED' as const, updatedAt: timestamp }
      deps.replaceThesis(updated)
      if (id === 'thesis-main') deps.setMainStage('SUBMITTED')
      addTimeline(id, {
        id: `timeline-${id}-submitted`,
        kind: 'THESIS_SUBMITTED',
        occurredAt: timestamp,
        message: '论文已提交，等待学校审核。',
      })
      notify({
        id: `notification-${id}-submitted`,
        kind: 'THESIS_SUBMITTED',
        message: '论文已提交，等待学校审核。',
        createdAt: timestamp,
        read: false,
      })
      return detail({ ...updated, stage: 'SUBMITTED' })
    },
    deleteStudentDraft: async (id: string) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'DELETE_DRAFT')
      const state = deps.getState()
      const { [id]: _removedFiles, ...fileMetadataByThesis } = state.fileMetadataByThesis
      const { [id]: _removedAbstract, ...abstractsByThesis } = state.abstractsByThesis
      const { [id]: _removedTimeline, ...timelines } = state.timelines
      deps.setState({ ...state, abstractsByThesis, fileMetadataByThesis, timelines })
      deps.removeThesis(id)
    },
    withdrawStudentThesis: async (id: string, reason: string) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'WITHDRAW_BEFORE_DISPATCH')
      const updated = { ...thesis, stage: 'DRAFT' as const, updatedAt: timestamp }
      deps.replaceThesis(updated)
      if (id === 'thesis-main') deps.setMainStage('DRAFT')
      addTimeline(id, {
        id: `timeline-${id}-withdrawn`,
        kind: 'THESIS_WITHDRAWN',
        occurredAt: timestamp,
        message: `已撤回论文：${reason}`,
      })
      notify({
        id: `notification-${id}-withdrawn`,
        kind: 'THESIS_WITHDRAWN',
        message: `论文已撤回：${reason}`,
        createdAt: timestamp,
        read: false,
      })
      return detail({ ...updated, stage: 'DRAFT' })
    },
    requestStudentWithdrawal: async (id: string, reason: string) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'REQUEST_WITHDRAWAL')
      const request: StudentWithdrawalRequest = {
        id: `withdrawal-${id}-${deps.getState().withdrawalRequests.length + 1}`,
        thesisId: id,
        reason,
        requestedAt: timestamp,
      }
      const state = deps.getState()
      deps.setState({ ...state, withdrawalRequests: [...state.withdrawalRequests, request] })
      addTimeline(id, {
        id: `timeline-${id}-withdrawal-requested`,
        kind: 'WITHDRAWAL_REQUESTED',
        occurredAt: timestamp,
        message: `已提交撤回申请：${reason}`,
      })
      notify({
        id: `notification-${id}-withdrawal-requested`,
        kind: 'WITHDRAWAL_REQUESTED',
        message: '已提交撤回申请，等待处理。',
        createdAt: timestamp,
        read: false,
      })
      return immutable(request)
    },
    getStudentResult: async (id: string): Promise<StudentResult | null> => {
      const thesis = findThesis(id)
      if (thesis.stage !== 'COMPLETED') return null
      const results =
        deps.getState().resultsByThesis[id] ?? (id === 'thesis-main' ? deps.getResults() : [])
      return immutable({ thesisId: id, results })
    },
    submitStudentObjection: async (id: string, input: StudentObjectionInput) => {
      const thesis = findThesis(id)
      ensureAction(thesis, 'SUBMIT_OBJECTION')
      const objection = {
        id: `objection-${id}-${deps.getState().objections.length + 1}`,
        thesisId: id,
        reason: input.reason,
        submittedAt: timestamp,
      }
      const state = deps.getState()
      deps.setState({ ...state, objections: [...state.objections, objection] })
      notify({
        id: `notification-${id}-objection`,
        kind: 'OBJECTION_SUBMITTED',
        message: '异议已提交，等待处理。',
        createdAt: timestamp,
        read: false,
      })
      return immutable(objection)
    },
    listStudentNotifications: async () => immutable(deps.getState().notifications),
    markStudentNotificationRead: async (id: string) => {
      const state = deps.getState()
      deps.setState({
        ...state,
        notifications: state.notifications.map((item) =>
          item.id === id ? { ...item, read: true } : item,
        ),
      })
      return immutable(deps.getState().notifications)
    },
    markAllStudentNotificationsRead: async () => {
      const state = deps.getState()
      deps.setState({
        ...state,
        notifications: state.notifications.map((item) => ({ ...item, read: true })),
      })
      return immutable(deps.getState().notifications)
    },
    loadStudentScenario: async (preset: StudentScenarioPreset) => {
      if (!deps.demoMode) {
        throw new StudentPortalError('DEMO_MODE_DISABLED', '演示模式未启用，无法装载学生场景。')
      }
      deps.loadScenario(preset)
      if (preset === 'COMPLETED') {
        const state = deps.getState()
        deps.setState({
          ...state,
          resultsByThesis: { ...state.resultsByThesis, 'thesis-main': deps.getResults() },
        })
      }
      return detail(findThesis('thesis-main'))
    },
    resetStudentDemo: async () => deps.reset(),
  }
}
