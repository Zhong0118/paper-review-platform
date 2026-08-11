import { createInitialScenarioState, type DemoScenarioState } from './fixtures'
import { createInitialStudentPortalState, type StudentPortalState } from './studentFixtures'
import type { DemoThesisSummary, StorageLike, StudentFileMetadata } from './types'

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

function defaultFileMetadata(thesis: DemoThesisSummary): StudentFileMetadata[] {
  return [
    ...(thesis.originalFileName
      ? [
          {
            kind: 'ORIGINAL' as const,
            purpose: 'SCHOOL_ARCHIVE' as const,
            fileName: thesis.originalFileName,
            sizeBytes: 0,
            mimeType: 'application/pdf',
            validationStatus: 'PENDING' as const,
          },
        ]
      : []),
    ...(thesis.anonymousFileName
      ? [
          {
            kind: 'ANONYMOUS' as const,
            purpose: 'EXPERT_REVIEW' as const,
            fileName: thesis.anonymousFileName,
            sizeBytes: 0,
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
    return {
      scenario: saved.scenario,
      student: {
        ...fixture,
        ...saved.student,
        fileMetadataByThesis: {
          ...derivedFileMetadata,
          ...(saved.student.fileMetadataByThesis ?? {}),
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
