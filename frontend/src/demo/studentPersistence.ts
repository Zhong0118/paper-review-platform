import { createInitialScenarioState, type DemoScenarioState } from './fixtures'
import { createInitialStudentPortalState, type StudentPortalState } from './studentFixtures'
import type {
  DemoThesisSummary,
  StorageLike,
  StudentNotification,
  StudentObjection,
  ThesisFileMeta,
} from './types'

export const studentPersistenceKey = 'baijie-demo-student:v1'

interface PersistedStudentDemo {
  schemaVersion: 1
  scenario: DemoScenarioState
  student: StudentPortalState
}

export interface LoadedStudentDemo {
  scenario: DemoScenarioState
  student: StudentPortalState
  reset: boolean
}

function defaultFileMetadata(thesis: DemoThesisSummary): ThesisFileMeta[] {
  return [
    ...(thesis.originalFileName
      ? [
          {
            id: `file-${thesis.id}-original`,
            purpose: 'SCHOOL_ARCHIVE' as const,
            name: thesis.originalFileName,
            size: 0,
            mimeType: 'application/pdf',
            validationStatus: 'PENDING' as const,
          },
        ]
      : []),
    ...(thesis.anonymousFileName
      ? [
          {
            id: `file-${thesis.id}-anonymous`,
            purpose: 'EXPERT_REVIEW' as const,
            name: thesis.anonymousFileName,
            size: 0,
            mimeType: 'application/pdf',
            validationStatus: 'PENDING' as const,
          },
        ]
      : []),
  ]
}

function deriveFileMetadata(theses: DemoThesisSummary[]) {
  return Object.fromEntries(theses.map((thesis) => [thesis.id, defaultFileMetadata(thesis)]))
}

function normalizeFileMetadata(thesisId: string, value: unknown): ThesisFileMeta[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Record<string, unknown>
    const purpose =
      source.purpose === 'SCHOOL_ARCHIVE' ||
      source.purpose === 'EXPERT_REVIEW' ||
      source.purpose === 'OBJECTION'
        ? source.purpose
        : source.kind === 'ANONYMOUS'
          ? 'EXPERT_REVIEW'
          : 'SCHOOL_ARCHIVE'
    const name = typeof source.name === 'string' ? source.name : source.fileName
    if (typeof name !== 'string') return []
    const validationStatus = ['VALID', 'REVIEW_REQUIRED', 'PENDING', 'INVALID'].includes(
      String(source.validationStatus),
    )
      ? (source.validationStatus as ThesisFileMeta['validationStatus'])
      : 'PENDING'
    return [
      {
        id:
          typeof source.id === 'string'
            ? source.id
            : `file-${thesisId}-${purpose === 'EXPERT_REVIEW' ? 'anonymous' : purpose.toLowerCase()}${
                index > 1 ? `-${index}` : ''
              }`,
        name,
        size:
          typeof source.size === 'number'
            ? source.size
            : typeof source.sizeBytes === 'number'
              ? source.sizeBytes
              : 0,
        mimeType: typeof source.mimeType === 'string' ? source.mimeType : 'application/pdf',
        purpose,
        validationStatus,
      },
    ]
  })
}

function normalizeFileMetadataByThesis(value: unknown): Record<string, ThesisFileMeta[]> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value).map(([thesisId, files]) => [
      thesisId,
      normalizeFileMetadata(thesisId, files),
    ]),
  )
}

function normalizeObjections(value: unknown): StudentObjection[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Record<string, unknown>
    if (
      typeof source.id !== 'string' ||
      typeof source.thesisId !== 'string' ||
      typeof source.reason !== 'string' ||
      typeof source.submittedAt !== 'string'
    ) {
      return []
    }
    const status = ['SUBMITTED', 'PROCESSING', 'RESOLVED'].includes(String(source.status))
      ? (source.status as StudentObjection['status'])
      : 'SUBMITTED'
    return [
      {
        id: source.id,
        thesisId: source.thesisId,
        reason: source.reason,
        request: typeof source.request === 'string' ? source.request : '',
        attachments: normalizeFileMetadata(source.id, source.attachments).filter(
          (attachment) => attachment.purpose === 'OBJECTION',
        ),
        status,
        submittedAt: source.submittedAt,
        ...(typeof source.processingAt === 'string' ? { processingAt: source.processingAt } : {}),
        ...(typeof source.resolvedAt === 'string' ? { resolvedAt: source.resolvedAt } : {}),
        ...(typeof source.publicResolution === 'string'
          ? { publicResolution: source.publicResolution }
          : {}),
      },
    ]
  })
}

function normalizeNotifications(
  value: unknown,
  theses: DemoThesisSummary[],
): StudentNotification[] {
  if (!Array.isArray(value)) return []
  const businessKinds = new Set<StudentNotification['kind']>([
    'THESIS_SUBMITTED',
    'THESIS_WITHDRAWN',
    'WITHDRAWAL_REQUESTED',
    'RESULT_PUBLISHED',
    'OBJECTION_SUBMITTED',
    'OBJECTION_RECEIVED',
  ])

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Record<string, unknown>
    if (
      typeof source.id !== 'string' ||
      typeof source.kind !== 'string' ||
      typeof source.message !== 'string' ||
      typeof source.createdAt !== 'string' ||
      typeof source.read !== 'boolean'
    ) {
      return []
    }
    const notificationId = source.id
    const recipientRole = ['student', 'school_reviewer'].includes(String(source.recipientRole))
      ? (source.recipientRole as 'student' | 'school_reviewer')
      : undefined
    const base = {
      id: notificationId,
      message: source.message,
      createdAt: source.createdAt,
      read: source.read,
      ...(recipientRole ? { recipientRole } : {}),
    }
    if (source.kind === 'DEMO_DATA_RESET') {
      return [{ ...base, kind: 'DEMO_DATA_RESET' as const }]
    }
    if (!businessKinds.has(source.kind as StudentNotification['kind'])) return []
    const thesisId =
      typeof source.thesisId === 'string'
        ? source.thesisId
        : theses.find((thesis) => notificationId.startsWith(`notification-${thesis.id}-`))?.id
    if (!thesisId) return []
    return [
      {
        ...base,
        kind: source.kind as Exclude<StudentNotification['kind'], 'DEMO_DATA_RESET'>,
        thesisId,
      } as StudentNotification,
    ]
  })
}

function deriveNextDraftSequence(theses: DemoThesisSummary[]) {
  const usedSequences = theses.flatMap((thesis) =>
    [thesis.id, thesis.anonymousId]
      .map((value) => Number(value.match(/(\d+)$/)?.[1]))
      .filter(Number.isFinite),
  )
  return Math.max(48, ...usedSequences) + 1
}

export function loadStudentDemo(storage: StorageLike): LoadedStudentDemo {
  const raw = storage.getItem(studentPersistenceKey)
  if (!raw) {
    return {
      scenario: createInitialScenarioState(),
      student: createInitialStudentPortalState(),
      reset: false,
    }
  }

  try {
    const saved = JSON.parse(raw) as PersistedStudentDemo
    if (saved.schemaVersion !== 1 || !saved.scenario || !saved.student)
      throw new Error('unsupported')
    const fixture = createInitialStudentPortalState()
    const derivedFileMetadata = deriveFileMetadata(saved.scenario.theses)
    const savedFileMetadata = normalizeFileMetadataByThesis(saved.student.fileMetadataByThesis)
    return {
      scenario: saved.scenario,
      student: {
        ...fixture,
        ...saved.student,
        notifications: normalizeNotifications(saved.student.notifications, saved.scenario.theses),
        objections: normalizeObjections(saved.student.objections),
        abstractsByThesis: saved.student.abstractsByThesis ?? fixture.abstractsByThesis,
        fileMetadataByThesis: {
          ...derivedFileMetadata,
          ...savedFileMetadata,
        },
        resultsByThesis: saved.student.resultsByThesis ?? fixture.resultsByThesis,
        nextDraftSequence:
          saved.student.nextDraftSequence ?? deriveNextDraftSequence(saved.scenario.theses),
      },
      reset: false,
    }
  } catch {
    return {
      scenario: createInitialScenarioState(),
      student: createInitialStudentPortalState(),
      reset: true,
    }
  }
}

export function saveStudentDemo(
  storage: StorageLike,
  scenario: DemoScenarioState,
  student: StudentPortalState,
) {
  const data: PersistedStudentDemo = { schemaVersion: 1, scenario, student }
  storage.setItem(studentPersistenceKey, JSON.stringify(data))
}
