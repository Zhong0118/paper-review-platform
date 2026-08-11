import { createInitialPlatformState } from './platformFixtures'
import type { PlatformState } from './platformFixtures'
import type {
  AuditLogEntry,
  DispatchThesisSeed,
  ExpertProfile,
  ExpertProfileAction,
  ExpertTaskSummary,
  StorageLike,
} from './types'

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

function normalizeTask(value: unknown): ExpertTaskSummary | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Record<string, unknown>
  if (typeof source.id !== 'string' || typeof source.anonymousId !== 'string') return null
  const statuses: ExpertTaskSummary['status'][] = [
    'INVITED',
    'IN_REVIEW',
    'SUBMITTED',
    'REJECTED',
    'ACCEPT_TIMEOUT',
    'CANCELLED',
  ]
  const status = statuses.includes(source.status as ExpertTaskSummary['status'])
    ? (source.status as ExpertTaskSummary['status'])
    : 'INVITED'
  const discipline =
    source.discipline &&
    typeof source.discipline === 'object' &&
    typeof (source.discipline as Record<string, unknown>).code === 'string' &&
    typeof (source.discipline as Record<string, unknown>).name === 'string'
      ? {
          code: (source.discipline as Record<string, string>).code,
          name: (source.discipline as Record<string, string>).name,
        }
      : { code: '', name: '' }
  return {
    id: source.id,
    ...(typeof source.thesisId === 'string' ? { thesisId: source.thesisId } : {}),
    ...(typeof source.expertId === 'string' ? { expertId: source.expertId } : {}),
    anonymousId: source.anonymousId,
    anonymousTitle: typeof source.anonymousTitle === 'string' ? source.anonymousTitle : '',
    discipline,
    status,
    fee: typeof source.fee === 'number' ? source.fee : 0,
    dueAt: typeof source.dueAt === 'string' ? source.dueAt : '',
    overdue: source.overdue === true,
    ...(typeof source.round === 'number' ? { round: source.round } : {}),
  }
}

function normalizeDispatchTheses(value: unknown): DispatchThesisSeed[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Record<string, unknown>
    if (
      typeof source.id !== 'string' ||
      typeof source.anonymousId !== 'string' ||
      typeof source.title !== 'string'
    ) {
      return []
    }
    const statuses: DispatchThesisSeed['status'][] = [
      'PENDING_DISPATCH',
      'PENDING_ACCEPTANCE',
      'IN_REVIEW',
      'COMPLETED',
    ]
    const status = statuses.includes(source.status as DispatchThesisSeed['status'])
      ? (source.status as DispatchThesisSeed['status'])
      : 'COMPLETED'
    const discipline =
      source.discipline &&
      typeof source.discipline === 'object' &&
      typeof (source.discipline as Record<string, unknown>).code === 'string' &&
      typeof (source.discipline as Record<string, unknown>).name === 'string'
        ? {
            code: (source.discipline as Record<string, string>).code,
            name: (source.discipline as Record<string, string>).name,
          }
        : { code: '', name: '' }
    return [
      {
        id: source.id,
        anonymousId: source.anonymousId,
        title: source.title,
        tenantName: typeof source.tenantName === 'string' ? source.tenantName : '',
        discipline,
        keywords: Array.isArray(source.keywords)
          ? source.keywords.filter((item): item is string => typeof item === 'string')
          : [],
        thesisType: typeof source.thesisType === 'string' ? source.thesisType : '学术型',
        avoidRule: typeof source.avoidRule === 'string' ? source.avoidRule : '',
        schoolRequirement:
          typeof source.schoolRequirement === 'string' ? source.schoolRequirement : '',
        status,
        round: typeof source.round === 'number' ? source.round : 1,
      },
    ]
  })
}

function normalizeAuditLog(value: unknown): AuditLogEntry[] {
  if (!Array.isArray(value)) return []
  const actions: AuditLogEntry['action'][] = [
    'SEED',
    'ASSIGN',
    'REASSIGN',
    'REMIND',
    'EXTEND',
    'SET_SERVICE_STATUS',
    'REVIEW_QUALIFICATION',
  ]
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const source = entry as Record<string, unknown>
    if (
      typeof source.id !== 'string' ||
      typeof source.action !== 'string' ||
      typeof source.detail !== 'string' ||
      typeof source.operator !== 'string' ||
      typeof source.occurredAt !== 'string'
    ) {
      return []
    }
    const action = actions.includes(source.action as AuditLogEntry['action'])
      ? (source.action as AuditLogEntry['action'])
      : 'SEED'
    return [
      {
        id: source.id,
        action,
        ...(typeof source.thesisId === 'string' ? { thesisId: source.thesisId } : {}),
        ...(typeof source.expertId === 'string' ? { expertId: source.expertId } : {}),
        ...(typeof source.taskId === 'string' ? { taskId: source.taskId } : {}),
        detail: source.detail,
        operator: source.operator,
        occurredAt: source.occurredAt,
      },
    ]
  })
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
    return {
      platform: {
        experts: saved.platform.experts
          .map(normalizeExpert)
          .filter((expert): expert is ExpertProfile => expert !== null),
        expertTasks: Array.isArray(saved.platform.expertTasks)
          ? saved.platform.expertTasks
              .map(normalizeTask)
              .filter((task): task is ExpertTaskSummary => task !== null)
          : [],
        correctionRequests: [],
        withdrawals: [],
        // 旧存档（Task 1/2 写入）没有派单论文与审计字段：以当前 fixture 兜底，行为同首次加载。
        dispatchTheses: normalizeDispatchTheses(saved.platform.dispatchTheses),
        auditLog: normalizeAuditLog(saved.platform.auditLog),
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
