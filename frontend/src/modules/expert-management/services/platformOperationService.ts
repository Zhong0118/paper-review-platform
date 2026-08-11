import { PlatformOperationError } from '@/demo/types'
import type {
  ExpertMatchCandidate,
  ExpertProfile,
  ExpertProfileAction,
  ExpertProfileCreateInput,
  ExpertProfilePatch,
  ExpertProfileQuery,
  ExpertQualificationAction,
  ExpertServiceStatus,
  OperationsQueueCounts,
  PlatformState,
} from '@/demo/types'
import { demoOperationsQueueCounts } from '@/demo/platformFixtures'

/**
 * 平台运营窄化服务：专家库与运营队列投影。
 *
 * 通过依赖注入读取平台演示状态；所有写操作先经 allowedActions 校验，
 * 返回的档案投影经过深度冻结（不可变快照）。专家端动作不属于本接口。
 */
interface PlatformOperationDependencies {
  getState: () => PlatformState
  setState: (state: PlatformState) => void
  demoMode: boolean
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

function actionsFor(
  qualification: ExpertProfile['qualification'],
  serviceStatus: ExpertProfile['serviceStatus'],
): ExpertProfileAction[] {
  const actions: ExpertProfileAction[] = ['UPDATE_PROFILE']
  if (serviceStatus === 'ACTIVE') actions.push('SET_SERVICE_STATUS')
  if (qualification !== 'APPROVED') actions.push('REVIEW_QUALIFICATION')
  return actions
}

function normalizeResearchTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

export function createPlatformOperationService(
  deps: PlatformOperationDependencies,
): Pick<
  import('@/demo/types').PlatformOperationService,
  'listExpertProfiles' | 'createExpertProfile' | 'updateExpertProfile' | 'setExpertServiceStatus' | 'reviewExpertQualification' | 'listExpertMatches' | 'listOperationsQueues'
> {
  const ensureDemoMode = () => {
    if (!deps.demoMode) {
      throw new PlatformOperationError('DEMO_MODE_DISABLED', '演示模式未启用，无法访问平台运营数据。')
    }
  }
  const findExpert = (id: string) => {
    const expert = deps.getState().experts.find((item) => item.id === id)
    if (!expert) throw new PlatformOperationError('NOT_FOUND', '未找到该专家档案。')
    return expert
  }
  const ensureAction = (expert: ExpertProfile, action: ExpertProfileAction) => {
    if (!expert.allowedActions.includes(action)) {
      throw new PlatformOperationError('ILLEGAL_ACTION', '当前专家档案状态不允许执行此操作。')
    }
  }
  const ensureReason = (reason: string) => {
    if (!reason.trim()) throw new PlatformOperationError('INVALID_INPUT', '操作原因不能为空。')
  }
  const patchExpert = (id: string, patch: Partial<ExpertProfile>) => {
    const state = deps.getState()
    const experts = state.experts.map((expert) => {
      if (expert.id !== id) return expert
      const updated = { ...expert, ...patch }
      return {
        ...updated,
        // 允许动作随资格与服务状态实时派生，避免状态变更后残留过期动作。
        allowedActions: actionsFor(updated.qualification, updated.serviceStatus),
      }
    })
    deps.setState({ ...state, experts })
    return findExpert(id)
  }
  /** 只允许窄化补丁内的字段，跨出边界视为非法输入。 */
  const assertKnownPatchKeys = (patch: ExpertProfilePatch) => {
    const allowed = new Set(['researchTags', 'avoidSchools', 'feeStandard'])
    const foreign = Object.keys(patch).filter((key) => !allowed.has(key))
    if (foreign.length > 0) {
      throw new PlatformOperationError('INVALID_INPUT', `不允许修改字段：${foreign.join('、')}。`)
    }
  }

  return {
    listExpertProfiles: async (query?: ExpertProfileQuery) => {
      ensureDemoMode()
      const experts = deps
        .getState()
        .experts.filter(
          (expert) =>
            (!query?.qualification || expert.qualification === query.qualification) &&
            (!query?.serviceStatus || expert.serviceStatus === query.serviceStatus),
        )
      return immutable(experts)
    },
    createExpertProfile: async (input: ExpertProfileCreateInput) => {
      ensureDemoMode()
      const researchTags = normalizeResearchTags(input.researchTags)
      if (!input.name.trim() || !input.unit.trim() || !input.title.trim()) {
        throw new PlatformOperationError('INVALID_INPUT', '专家姓名、单位和职称均为必填项。')
      }
      if (!input.discipline.code || !input.discipline.name) {
        throw new PlatformOperationError('INVALID_INPUT', '学科方向必须来自受控目录。')
      }
      if (researchTags.length > 8) {
        throw new PlatformOperationError('INVALID_INPUT', '擅长方向最多填写 8 个。')
      }
      const state = deps.getState()
      const id = `expert-new-${state.experts.length + 1}`
      const expert: ExpertProfile = {
        id,
        name: input.name.trim(),
        unit: input.unit.trim(),
        title: input.title.trim(),
        discipline: { ...input.discipline },
        researchTags,
        reviewableTypes: ['硕士学位论文'],
        qualification: 'REVIEWING',
        serviceStatus: 'ACTIVE',
        avoidSchools: [...new Set(input.avoidSchools.map((school) => school.trim()).filter(Boolean))],
        activeTasks: 0,
        completedTasks: 0,
        overdueRate: '0%',
        avgCompletionDays: 0,
        acceptanceRate: '0%',
        onTimeRate: '0%',
        qualitySummary: '新入库专家，暂无评阅历史。',
        feeStandard: 300,
        payoutStatus: 'PENDING',
        allowedActions: ['UPDATE_PROFILE', 'SET_SERVICE_STATUS', 'REVIEW_QUALIFICATION'],
      }
      deps.setState({ ...state, experts: [...state.experts, expert] })
      return immutable(expert)
    },
    updateExpertProfile: async (id: string, patch: ExpertProfilePatch) => {
      ensureDemoMode()
      const expert = findExpert(id)
      ensureAction(expert, 'UPDATE_PROFILE')
      assertKnownPatchKeys(patch)
      const updates: Partial<ExpertProfile> = {}
      if (patch.researchTags !== undefined) {
        const researchTags = normalizeResearchTags(patch.researchTags)
        if (researchTags.length > 8) {
          throw new PlatformOperationError('INVALID_INPUT', '擅长方向最多填写 8 个。')
        }
        updates.researchTags = researchTags
      }
      if (patch.avoidSchools !== undefined) {
        updates.avoidSchools = [...new Set(patch.avoidSchools.map((school) => school.trim()).filter(Boolean))]
      }
      if (patch.feeStandard !== undefined) {
        if (!Number.isFinite(patch.feeStandard) || patch.feeStandard <= 0) {
          throw new PlatformOperationError('INVALID_INPUT', '费用标准必须为正数。')
        }
        updates.feeStandard = patch.feeStandard
      }
      return immutable(patchExpert(id, updates))
    },
    setExpertServiceStatus: async (id: string, status: ExpertServiceStatus, reason: string) => {
      ensureDemoMode()
      const expert = findExpert(id)
      ensureAction(expert, 'SET_SERVICE_STATUS')
      ensureReason(reason)
      if (expert.serviceStatus === status) {
        throw new PlatformOperationError('STATE_CONFLICT', `该专家当前已是${status === 'ACTIVE' ? '启用' : '停用'}状态。`)
      }
      const updated = patchExpert(id, { serviceStatus: status, serviceNote: reason.trim() })
      return immutable(updated)
    },
    reviewExpertQualification: async (id: string, decision: ExpertQualificationAction, reason: string) => {
      ensureDemoMode()
      const expert = findExpert(id)
      ensureAction(expert, 'REVIEW_QUALIFICATION')
      if (decision === 'REJECTED') ensureReason(reason)
      if (expert.qualification === decision) {
        throw new PlatformOperationError('STATE_CONFLICT', '该专家资格已处于此审核结果。')
      }
      const updated = patchExpert(id, {
        qualification: decision,
        ...(decision === 'REJECTED' ? { qualificationNote: reason.trim() } : { qualificationNote: undefined }),
      })
      return immutable(updated)
    },
    listExpertMatches: async () => {
      ensureDemoMode()
      // Task 3 实现候选匹配；本轮返回空候选。
      const candidates: ExpertMatchCandidate[] = []
      return immutable(candidates)
    },
    listOperationsQueues: async (): Promise<OperationsQueueCounts> => {
      ensureDemoMode()
      // 演示计数快照；Task 3 起由平台状态派生。
      return immutable(demoOperationsQueueCounts)
    },
  }
}
