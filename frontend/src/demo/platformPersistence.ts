import { createInitialPlatformState } from './platformFixtures'
import type { PlatformState } from './platformFixtures'
import type { ExpertProfile, StorageLike } from './types'

/**
 * 平台演示状态使用独立持久化 key（与学生端 `baijie-demo-student:v1` 分离）。
 *
 * 决策背景：学生端 key 由 `studentPersistence.ts` 读写，该文件不在本任务提交清单内；
 * 若平台状态并入学生端 schema，将需要在提交清单之外改动持久化读取边界。
 * 独立 key 使平台 schema 可独立演进（学生端 v1 不受影响），迁移只需兼容读取
 * 平台 blob 内部的 v1 形态。同一 storage 上两个 key 并存，互不干扰。
 */
export const platformPersistenceKey = 'baijie-demo-platform:v1'

interface PersistedPlatformDemo {
  schemaVersion: 1
  platform: PlatformState
}

export interface LoadedPlatformDemo {
  platform: PlatformState
  reset: boolean
}

function normalizeExpert(value: unknown): ExpertProfile | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== 'string' || typeof source.name !== 'string') return null
  const discipline =
    source.discipline &&
    typeof source.discipline === 'object' &&
    typeof (source.discipline as Record<string, unknown>).code === 'string' &&
    typeof (source.discipline as Record<string, unknown>).name === 'string'
      ? { code: (source.discipline as Record<string, string>).code, name: (source.discipline as Record<string, string>).name }
      : { code: '', name: '' }
  const fixture = createInitialPlatformState().experts.find((item) => item.id === source.id)
  const qualification = ['APPROVED', 'REVIEWING', 'REJECTED'].includes(String(source.qualification))
    ? (source.qualification as ExpertProfile['qualification'])
    : 'REVIEWING'
  const serviceStatus = ['ACTIVE', 'DISABLED'].includes(String(source.serviceStatus))
    ? (source.serviceStatus as ExpertProfile['serviceStatus'])
    : 'ACTIVE'
  return {
    ...(fixture ?? {}),
    id: source.id,
    name: source.name,
    unit: typeof source.unit === 'string' ? source.unit : fixture?.unit ?? '',
    title: typeof source.title === 'string' ? source.title : fixture?.title ?? '',
    discipline,
    researchTags: Array.isArray(source.researchTags)
      ? source.researchTags.filter((tag): tag is string => typeof tag === 'string')
      : fixture?.researchTags ?? [],
    reviewableTypes: Array.isArray(source.reviewableTypes)
      ? source.reviewableTypes.filter((item): item is string => typeof item === 'string')
      : fixture?.reviewableTypes ?? [],
    qualification,
    ...(typeof source.qualificationNote === 'string' ? { qualificationNote: source.qualificationNote } : {}),
    serviceStatus,
    ...(typeof source.serviceNote === 'string' ? { serviceNote: source.serviceNote } : {}),
    avoidSchools: Array.isArray(source.avoidSchools)
      ? source.avoidSchools.filter((item): item is string => typeof item === 'string')
      : fixture?.avoidSchools ?? [],
    activeTasks: typeof source.activeTasks === 'number' ? source.activeTasks : fixture?.activeTasks ?? 0,
    completedTasks:
      typeof source.completedTasks === 'number' ? source.completedTasks : fixture?.completedTasks ?? 0,
    overdueRate: typeof source.overdueRate === 'string' ? source.overdueRate : fixture?.overdueRate ?? '0%',
    avgCompletionDays:
      typeof source.avgCompletionDays === 'number' ? source.avgCompletionDays : fixture?.avgCompletionDays ?? 0,
    acceptanceRate:
      typeof source.acceptanceRate === 'string' ? source.acceptanceRate : fixture?.acceptanceRate ?? '0%',
    onTimeRate: typeof source.onTimeRate === 'string' ? source.onTimeRate : fixture?.onTimeRate ?? '0%',
    qualitySummary:
      typeof source.qualitySummary === 'string' ? source.qualitySummary : fixture?.qualitySummary ?? '',
    feeStandard: typeof source.feeStandard === 'number' ? source.feeStandard : fixture?.feeStandard ?? 0,
    payoutStatus: source.payoutStatus === 'PENDING' ? 'PENDING' : 'BOUND',
    allowedActions: fixture?.allowedActions ?? [],
  }
}

export function loadPlatformDemo(storage: StorageLike): LoadedPlatformDemo {
  const raw = storage.getItem(platformPersistenceKey)
  if (!raw) {
    return { platform: createInitialPlatformState(), reset: false }
  }
  try {
    const saved = JSON.parse(raw) as PersistedPlatformDemo
    if (saved.schemaVersion !== 1 || !saved.platform || !Array.isArray(saved.platform.experts)) {
      throw new Error('unsupported')
    }
    const fixture = createInitialPlatformState()
    return {
      platform: {
        experts: saved.platform.experts
          .map(normalizeExpert)
          .filter((expert): expert is ExpertProfile => expert !== null),
        expertTasks: fixture.expertTasks,
        correctionRequests: fixture.correctionRequests,
        withdrawals: fixture.withdrawals,
      },
      reset: false,
    }
  } catch {
    return { platform: createInitialPlatformState(), reset: true }
  }
}

export function savePlatformDemo(storage: StorageLike, platform: PlatformState) {
  const data: PersistedPlatformDemo = { schemaVersion: 1, platform }
  storage.setItem(platformPersistenceKey, JSON.stringify(data))
}
