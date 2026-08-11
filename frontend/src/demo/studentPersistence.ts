import { createInitialScenarioState, type DemoScenarioState } from './fixtures'
import { createInitialStudentPortalState, type StudentPortalState } from './studentFixtures'
import type { StorageLike } from './types'

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
    return {
      scenario: saved.scenario,
      student: {
        ...fixture,
        ...saved.student,
        fileMetadataByThesis: saved.student.fileMetadataByThesis ?? fixture.fileMetadataByThesis,
        resultsByThesis: saved.student.resultsByThesis ?? fixture.resultsByThesis,
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
