import { createInitialPlatformState } from './platformFixtures'
import type { PlatformState } from './platformFixtures'
import type { ExpertProfile, ExpertProfileAction, StorageLike } from './types'

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
  const isFixtureExpert = fixture !== undefined
  const qualification = ['APPROVED', 'REVIEWING', 'REJECTED'].includes(String(source.qualification))
    ? (source.qualification as ExpertProfile['qualification'])
    : 'REVIEWING'
  const serviceStatus = ['ACTIVE', 'DISABLED'].includes(String(source.serviceStatus))
    ? (source.serviceStatus as ExpertProfile['serviceStatus'])
    : 'ACTIVE'
  // 驳回/停用原因随状态一起持久化，是原因的唯一样本数据：只要存档中存在即无条件携带，
  // 不依赖 fixture（fixture 中无这两个字段，靠 fixture 兜底会让原因在重载时丢失）。
  const qualificationNote =
    typeof source.qualificationNote === 'string' ? source.qualificationNote : undefined
  const serviceNote = typeof source.serviceNote === 'string' ? source.serviceNote : undefined
  // 允许动作是资格/服务状态的实时派生（见 platformOperationService.actionsFor）。
  // 存档中的动作列表总是由服务在每次变更后写入，因此以存档为准：新建档案（expert-new-*）
  // 没有 fixture，回退到 fixture 会把动作清空；回退到陈旧 fixture 会让重载后的已变更
  // 专家保留过期的允许动作。仅当存档缺失该字段（更早版本写入的 blob）时才回退 fixture。
  const savedActions = Array.isArray(source.allowedActions)
    ? source.allowedActions.filter(
        (action): action is ExpertProfileAction =>
          action === 'UPDATE_PROFILE' || action === 'SET_SERVICE_STATUS' || action === 'REVIEW_QUALIFICATION',
      )
    : undefined
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
    ...(qualificationNote !== undefined ? { qualificationNote } : {}),
    serviceStatus,
    ...(serviceNote !== undefined ? { serviceNote } : {}),
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
    // fixture 专家首次加载（无存档动作）沿用 fixture 动作；非 fixture 专家无 fixture 可回退，
    // 而本服务始终写入完整 v1 序列化数据，存档缺失动作视为空列表而非错误。
    allowedActions:
      savedActions ?? (isFixtureExpert && fixture?.allowedActions ? fixture.allowedActions : []),
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
