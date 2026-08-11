import { PlatformOperationError } from '@/demo/types'
import type {
  AuditLogEntry,
  CorrectionDecision,
  CorrectionRequest,
  DispatchThesisSeed,
  ExpertMatchCandidate,
  ExpertProfile,
  ExpertProfileAction,
  ExpertProfileCreateInput,
  ExpertProfilePatch,
  ExpertProfileQuery,
  ExpertQualificationAction,
  ExpertServiceStatus,
  ExpertTaskSummary,
  OperationsQueueCounts,
  PaymentResult,
  PlatformState,
  ReviewVersion,
  WithdrawalRequest,
  WithdrawalReviewDecision,
} from '@/demo/types'

/**
 * 平台运营窄化服务：专家库、运营队列与派单闭环。
 *
 * 通过依赖注入读取平台演示状态；所有写操作先经 allowedActions 校验，
 * 返回的档案投影经过深度冻结（不可变快照）。专家端动作不属于本接口。
 * 平台演示数据为本地快照：派单、改派、催审、延期只写本地投影与审计，
 * 不模拟真实时限调度，也不宣称真实通知发送。
 */
interface PlatformOperationDependencies {
  getState: () => PlatformState
  setState: (state: PlatformState) => void
  demoMode: boolean
}

const ASSIGNMENT_DUE_DAYS = 14

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

/** 演示批次固定费用标准（仅本地快照；正式结算规则以后端为准）。 */
export const dispatchFeeStandard = 300

function addDays(dateText: string, days: number) {
  const date = new Date(dateText.replace(' ', 'T'))
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function createPlatformOperationService(
  deps: PlatformOperationDependencies,
): Pick<
  import('@/demo/types').PlatformOperationService,
  | 'listExpertProfiles'
  | 'createExpertProfile'
  | 'updateExpertProfile'
  | 'setExpertServiceStatus'
  | 'reviewExpertQualification'
  | 'listExpertMatches'
  | 'listOperationsQueues'
  | 'listDispatchTheses'
  | 'assignExpertToThesis'
  | 'reassignExpertTask'
  | 'remindExpertTask'
  | 'extendExpertTask'
  | 'listPlatformAuditLog'
  | 'listCorrectionRequests'
  | 'requestCorrection'
  | 'decideCorrection'
  | 'listReviewVersions'
  | 'listWithdrawals'
  | 'reviewWithdrawal'
  | 'recordWithdrawalPayment'
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

  const findThesis = (thesisId: string) => {
    const thesis = deps.getState().dispatchTheses.find((item) => item.id === thesisId)
    if (!thesis) throw new PlatformOperationError('NOT_FOUND', '未找到该送审论文。')
    return thesis
  }

  const findTask = (taskId: string) => {
    const task = deps.getState().expertTasks.find((item) => item.id === taskId)
    if (!task) throw new PlatformOperationError('NOT_FOUND', '未找到该专家任务。')
    return task
  }

  const currentTaskFor = (thesisId: string) =>
    deps
      .getState()
      .expertTasks.find(
        (task) =>
          task.thesisId === thesisId && ['INVITED', 'IN_REVIEW'].includes(task.status),
      )

  const isConflictHit = (expert: ExpertProfile, thesis: DispatchThesisSeed) =>
    thesis.tenantName !== '' && expert.avoidSchools.includes(thesis.tenantName)

  /** 候选匹配 = 学科命中 + 关键词命中 + 历史质量（可解释）；回避命中禁选。 */
  const buildCandidates = (thesis: DispatchThesisSeed): ExpertMatchCandidate[] =>
    deps
      .getState()
      .experts.filter((expert) => expert.qualification === 'APPROVED')
      .map((expert) => {
        const conflictHit = isConflictHit(expert, thesis)
        const keywordHits = thesis.keywords.filter((keyword) =>
          expert.researchTags.some(
            (tag) => tag.includes(keyword) || keyword.includes(tag),
          ),
        )
        const disciplineMatched = expert.discipline.code === thesis.discipline.code
        return {
          id: expert.id,
          name: expert.name,
          unit: expert.unit,
          title: expert.title,
          discipline: { ...expert.discipline },
          fields: [...expert.researchTags],
          keywordHits,
          conflictHit,
          conflictReason: conflictHit
            ? `${thesis.tenantName} 与该作者存在合作记录，命中回避规则`
            : undefined,
          selectable: !conflictHit && expert.serviceStatus === 'ACTIVE',
          activeTasks: expert.activeTasks,
          acceptanceRate: expert.acceptanceRate,
          onTimeRate: expert.onTimeRate,
          avgCompletionDays: expert.avgCompletionDays,
          feeStandard: expert.feeStandard,
          // 可解释匹配原因：关键词命中 + 历史质量，供运营人工判断。
          matchReason: [
            disciplineMatched ? `学科匹配：${expert.discipline.name}` : `方向相关：${expert.discipline.name}`,
            keywordHits.length > 0 ? `关键词命中：${keywordHits.join('、')}` : '关键词无直接命中',
            `历史完成 ${expert.completedTasks} 篇，平均 ${expert.avgCompletionDays} 天`,
          ].join('；'),
        }
      })
      // 可指派候选在前（负载少的优先），回避命中/停用排后，便于运营快速选择。
      .sort(
        (a, b) =>
          Number(b.selectable) - Number(a.selectable) ||
          a.activeTasks - b.activeTasks ||
          a.avgCompletionDays - b.avgCompletionDays,
      )

  const appendAudit = (
    state: PlatformState,
    entry: Omit<AuditLogEntry, 'id' | 'occurredAt'>,
  ): PlatformState => ({
    ...state,
    auditLog: [
      {
        ...entry,
        id: `audit-${Date.now()}-${state.auditLog.length + 1}`,
        occurredAt: '2026-08-12 09:00',
      },
      ...state.auditLog,
    ],
  })

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
      deps.setState(
        appendAudit(deps.getState(), {
          action: 'SET_SERVICE_STATUS',
          expertId: id,
          detail: `${status === 'DISABLED' ? '停用' : '启用'}：${reason.trim()}`,
          operator: '陈岚',
        }),
      )
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
      deps.setState(
        appendAudit(deps.getState(), {
          action: 'REVIEW_QUALIFICATION',
          expertId: id,
          detail: `资格${decision === 'APPROVED' ? '通过' : '驳回'}：${reason.trim()}`,
          operator: '陈岚',
        }),
      )
      return immutable(updated)
    },
    listExpertMatches: async (thesisId: string) => {
      ensureDemoMode()
      const thesis = findThesis(thesisId)
      return immutable(buildCandidates(thesis))
    },
    listDispatchTheses: async () => {
      ensureDemoMode()
      return immutable(deps.getState().dispatchTheses)
    },
    assignExpertToThesis: async (thesisId: string, expertId: string) => {
      ensureDemoMode()
      const state = deps.getState()
      const thesis = findThesis(thesisId)
      const expert = findExpert(expertId)
      // 版本冲突优先：同一论文只保留一条在评任务（并发双指派/重复提交都不允许覆盖）。
      if (currentTaskFor(thesisId)) {
        throw new PlatformOperationError(
          'VERSION_CONFLICT',
          '该论文已有在评任务，不能重复指派（版本冲突）。',
        )
      }
      if (thesis.status !== 'PENDING_DISPATCH') {
        throw new PlatformOperationError('STATE_CONFLICT', '该论文已指派，请勿重复操作。')
      }
      if (isConflictHit(expert, thesis)) {
        throw new PlatformOperationError('STATE_CONFLICT', '该专家命中回避规则，禁止指派。')
      }
      if (expert.serviceStatus !== 'ACTIVE') {
        throw new PlatformOperationError('STATE_CONFLICT', '该专家已停用，不可指派新任务。')
      }
      const task: ExpertTaskSummary = {
        id: `task-e-2026-${String(state.expertTasks.length + 1).padStart(3, '0')}`,
        thesisId,
        expertId,
        anonymousId: thesis.anonymousId,
        anonymousTitle: thesis.title,
        discipline: { ...thesis.discipline },
        status: 'INVITED',
        fee: dispatchFeeStandard,
        dueAt: addDays('2026-08-12 09:00', ASSIGNMENT_DUE_DAYS),
        overdue: false,
        round: thesis.round,
      }
      const next = {
        ...state,
        expertTasks: [...state.expertTasks, task],
        dispatchTheses: state.dispatchTheses.map((item) =>
          item.id === thesisId ? { ...item, status: 'PENDING_ACCEPTANCE' as const } : item,
        ),
      }
      deps.setState(
        appendAudit(next, {
          action: 'ASSIGN',
          thesisId,
          expertId,
          taskId: task.id,
          detail: `指派 ${expert.name}（第 ${thesis.round} 轮）`,
          operator: '陈岚',
        }),
      )
      return immutable(task)
    },
    reassignExpertTask: async (taskId: string, expertId: string, reason: string) => {
      ensureDemoMode()
      ensureReason(reason)
      const state = deps.getState()
      const oldTask = findTask(taskId)
      if (!oldTask.thesisId) {
        throw new PlatformOperationError('ILLEGAL_ACTION', '仅平台派生的任务支持改派。')
      }
      if (['SUBMITTED', 'ACCEPT_TIMEOUT', 'CANCELLED'].includes(oldTask.status)) {
        throw new PlatformOperationError(
          'STATE_CONFLICT',
          '任务已处于终态，不能改派。请申请补审或等待结果。',
        )
      }
      const thesis = findThesis(oldTask.thesisId)
      const replacement = findExpert(expertId)
      if (isConflictHit(replacement, thesis)) {
        throw new PlatformOperationError('STATE_CONFLICT', '替代专家命中回避规则，禁止改派。')
      }
      if (replacement.serviceStatus !== 'ACTIVE') {
        throw new PlatformOperationError('STATE_CONFLICT', '替代专家已停用，不可改派。')
      }
      const newTask: ExpertTaskSummary = {
        ...oldTask,
        id: `task-e-2026-${String(state.expertTasks.length + 1).padStart(3, '0')}`,
        status: 'INVITED',
        overdue: false,
        dueAt: addDays('2026-08-12 09:00', ASSIGNMENT_DUE_DAYS),
        expertId,
      }
      const next = {
        ...state,
        expertTasks: [
          ...state.expertTasks.map((task) =>
            task.id === taskId ? { ...task, status: 'CANCELLED' as const } : task,
          ),
          newTask,
        ],
      }
      deps.setState(
        appendAudit(next, {
          action: 'REASSIGN',
          thesisId: oldTask.thesisId,
          expertId,
          taskId: newTask.id,
          detail: `改派至 ${replacement.name}（原因：${reason.trim()}）`,
          operator: '陈岚',
        }),
      )
      return immutable(newTask)
    },
    remindExpertTask: async (taskId: string) => {
      ensureDemoMode()
      const task = findTask(taskId)
      if (!['INVITED', 'IN_REVIEW'].includes(task.status)) {
        throw new PlatformOperationError(
          'STATE_CONFLICT',
          '仅待接受或评阅中的任务可以催审。',
        )
      }
      deps.setState(
        appendAudit(deps.getState(), {
          action: 'REMIND',
          taskId,
          thesisId: task.thesisId,
          detail: `催审提醒（${task.status === 'INVITED' ? '待接受' : '评阅中'}）`,
          operator: '陈岚',
        }),
      )
      return immutable({ ...task })
    },
    extendExpertTask: async (taskId: string, days: number) => {
      ensureDemoMode()
      if (!Number.isInteger(days) || days <= 0 || days > 30) {
        throw new PlatformOperationError('INVALID_INPUT', '延期天数必须为 1–30 的整数。')
      }
      const task = findTask(taskId)
      if (!['INVITED', 'IN_REVIEW'].includes(task.status)) {
        throw new PlatformOperationError(
          'STATE_CONFLICT',
          '仅待接受或评阅中的任务可以延期。',
        )
      }
      const updated = { ...task, dueAt: addDays(task.dueAt, days) }
      deps.setState({
        ...deps.getState(),
        expertTasks: deps
          .getState()
          .expertTasks.map((item) => (item.id === taskId ? updated : item)),
      })
      deps.setState(
        appendAudit(deps.getState(), {
          action: 'EXTEND',
          taskId,
          thesisId: task.thesisId,
          detail: `延期 ${days} 天`,
          operator: '陈岚',
        }),
      )
      return immutable(updated)
    },
    listPlatformAuditLog: async () => {
      ensureDemoMode()
      return immutable(deps.getState().auditLog)
    },
    listOperationsQueues: async (): Promise<OperationsQueueCounts> => {
      ensureDemoMode()
      const { dispatchTheses, expertTasks } = deps.getState()
      const counts: OperationsQueueCounts = {
        PENDING_ASSIGNMENT: 0,
        PENDING_ACCEPTANCE: 0,
        IN_REVIEW: 0,
        DUE_SOON: 0,
        OVERDUE: 0,
        PENDING_REASSIGNMENT: 0,
        PENDING_SUPPLEMENT: 0,
        CORRECTION_PENDING: 0,
        SETTLEMENT_PENDING: 0,
        COMPLETED: 0,
      }
      for (const thesis of dispatchTheses) {
        if (thesis.status === 'PENDING_DISPATCH') counts.PENDING_ASSIGNMENT += 1
        if (thesis.status === 'COMPLETED') counts.COMPLETED += 1
      }
      for (const task of expertTasks) {
        const thesis = task.thesisId
          ? dispatchTheses.find((item) => item.id === task.thesisId)
          : undefined
        if (thesis && thesis.status === 'COMPLETED') {
          counts.COMPLETED += 1
          continue
        }
        if (task.status === 'INVITED') counts.PENDING_ACCEPTANCE += 1
        else if (task.status === 'IN_REVIEW') {
          counts.IN_REVIEW += 1
          if (task.overdue) counts.OVERDUE += 1
          else if (thesis && isDueSoon(task)) counts.DUE_SOON += 1
        } else if (task.status === 'REJECTED') counts.PENDING_REASSIGNMENT += 1
        else if (task.status === 'ACCEPT_TIMEOUT') counts.PENDING_SUPPLEMENT += 1
        else if (task.status === 'SUBMITTED') counts.SETTLEMENT_PENDING += 1
      }
      return immutable(counts)
    },

    listCorrectionRequests: async () => {
      ensureDemoMode()
      const requests = deps.getState().correctionRequests.map((request) => {
        if (request.impactWarning) return request
        // 原结果已发布（论文 COMPLETED）：提示影响范围（演示文案，不宣称自动回滚）。
        const thesis = deps.getState().dispatchTheses.find(
          (item) => item.anonymousId === request.anonymousId,
        )
        if (thesis?.status === 'COMPLETED') {
          return {
            ...request,
            impactWarning:
              '原评审结果已发布给学校与学生。批准更正后将生成新版本，已发布结果不会自动回滚，需平台人工同步通知学校与学生后发布新版本。',
          }
        }
        return request
      })
      return immutable(requests)
    },

    /** 专家端发起更正申请（演示投影：申请专家与差异由演示装载提供）。 */
    requestCorrection: async (taskId: string, reason: string) => {
      ensureDemoMode()
      const state = deps.getState()
      const task = state.expertTasks.find((item) => item.id === taskId)
      if (!task) {
        throw new PlatformOperationError('NOT_FOUND', '未找到该评阅任务。')
      }
      if (!reason.trim()) {
        throw new PlatformOperationError('INVALID_INPUT', '更正原因不能为空。')
      }
      // 更正申请后原版本保留：仅追加申请投影，不改动既有评阅版本；同任务重复申请去重。
      const existing = state.correctionRequests.find(
        (item) => item.taskId === taskId && item.status === 'PENDING',
      )
      if (existing) return immutable(existing)
      const request: CorrectionRequest = {
        id: `COR-2026-${String(state.correctionRequests.length + 1).padStart(3, '0')}`,
        taskId,
        anonymousId: task.anonymousId,
        expertId: task.expertId ?? 'expert-31',
        expertName: '宋清和',
        status: 'PENDING',
        reason: reason.trim(),
        requestedAt: '2026-08-26 09:12',
        proposedDiff: '研究方法维度（20 分）由 17 分更正为 18 分。',
        evidence: '附件：更正说明与支撑材料（模拟校验通过）。',
        version: 'R1',
      }
      deps.setState({
        ...state,
        correctionRequests: [...state.correctionRequests, request],
      })
      return immutable(request)
    },

    decideCorrection: async (
      id: string,
      decision: CorrectionDecision,
      reason: string,
    ) => {
      ensureDemoMode()
      if (!reason.trim()) {
        throw new PlatformOperationError('INVALID_INPUT', '审核意见不能为空。')
      }
      const state = deps.getState()
      const request = state.correctionRequests.find((item) => item.id === id)
      if (!request) throw new PlatformOperationError('NOT_FOUND', '未找到该更正申请。')
      if (request.status !== 'PENDING') {
        throw new PlatformOperationError('STATE_CONFLICT', '该更正申请已审核，不能重复审批。')
      }
      if (decision === 'APPROVED') {
        // 批准更正：生成新评阅版本（演示投影，非真实论文内容），旧版本只读保留并建立版本关系。
        const latest = state.reviewVersions.length
          ? Math.max(
              ...state.reviewVersions.map((item) =>
                Number(item.version.replace(/^R/, '')),
              ),
            )
          : 1
        const newVersionId = `review-version-r${latest + 1}`
        const newVersion: ReviewVersion = {
          id: newVersionId,
          version: `R${latest + 1}`,
          status: 'CURRENT',
          score: 87,
          submittedAt: '2026-08-27 10:30',
          readonly: true,
        }
        const previous = state.reviewVersions.map((item) => ({ ...item }))
        const nextState: PlatformState = {
          ...state,
          correctionRequests: state.correctionRequests.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: 'APPROVED',
                  decisionReason: reason.trim(),
                  newVersionId,
                  oldVersionId: previous.at(-1)?.id ?? 'review-version-r1',
                }
              : item,
          ),
          reviewVersions: [
            // 旧版本被新版本替换：保留只读并链接新版本。
            ...previous.map((item) =>
              item.id === previous.at(-1)?.id
                ? { ...item, status: 'SUPERSEDED' as const, nextVersionId: newVersionId }
                : item,
            ),
            newVersion,
          ],
        }
        deps.setState(
          appendAudit(nextState, {
            action: 'CORRECTION_DECIDED',
            thesisId: request.anonymousId,
            taskId: request.taskId,
            expertId: request.expertId,
            detail: `批准更正（${reason.trim()}）：生成新版本 R${latest + 1}，旧版本只读保留。`,
            operator: '陈岚',
          }),
        )
        return immutable(
          nextState.correctionRequests.find((item) => item.id === id) as CorrectionRequest,
        )
      }
      const nextState: PlatformState = {
        ...state,
        correctionRequests: state.correctionRequests.map((item) =>
          item.id === id ? { ...item, status: 'REJECTED', decisionReason: reason.trim() } : item,
        ),
      }
      deps.setState(
        appendAudit(nextState, {
          action: 'CORRECTION_DECIDED',
          thesisId: request.anonymousId,
          taskId: request.taskId,
          expertId: request.expertId,
          detail: `驳回更正（${reason.trim()}）：保留原评阅版本。`,
          operator: '陈岚',
        }),
      )
      return immutable(
        nextState.correctionRequests.find((item) => item.id === id) as CorrectionRequest,
      )
    },

    listReviewVersions: async (_taskId: string) => {
      ensureDemoMode()
      // 版本历史按新到旧投影（页面「版本历史」默认展示最新）；新旧版本均只读。
      // 旧持久化快照可能没有版本记录：回退到 R1 投影，保证详情页版本历史非空。
      const versions = deps.getState().reviewVersions
      const projected =
        versions.length > 0
          ? versions
          : [
              {
                id: 'review-version-r1',
                version: 'R1',
                status: 'CURRENT' as const,
                score: 0,
                submittedAt: '2026-08-24 16:40',
                readonly: true as const,
              },
            ]
      return immutable([...projected].reverse())
    },

    listWithdrawals: async () => {
      ensureDemoMode()
      return immutable(deps.getState().withdrawals)
    },

    reviewWithdrawal: async (
      id: string,
      decision: WithdrawalReviewDecision,
      reason: string,
    ) => {
      ensureDemoMode()
      if (!reason.trim()) {
        throw new PlatformOperationError('INVALID_INPUT', '审核意见不能为空。')
      }
      const state = deps.getState()
      const withdrawal = state.withdrawals.find((item) => item.id === id)
      if (!withdrawal) throw new PlatformOperationError('NOT_FOUND', '未找到该提现申请。')
      if (withdrawal.status !== 'PENDING') {
        throw new PlatformOperationError('STATE_CONFLICT', '该提现申请已审核，不能重复审核。')
      }
      const reviewed: WithdrawalRequest = {
        ...withdrawal,
        status: decision === 'APPROVE' ? 'REVIEWING' : 'REJECTED',
        reason: reason.trim(),
        history: [
          ...withdrawal.history,
          {
            action: decision === 'APPROVE' ? 'APPROVE' : 'REJECT',
            at: '2026-08-26 10:00',
            note:
              decision === 'APPROVE'
                ? `审核通过（${reason.trim()}）：进入线下付款。`
                : `审核驳回（${reason.trim()}）：解除冻结。`,
          },
        ],
      }
      const nextState: PlatformState = {
        ...state,
        withdrawals: state.withdrawals.map((item) => (item.id === id ? reviewed : item)),
      }
      deps.setState(
        appendAudit(nextState, {
          action: 'WITHDRAWAL_REVIEWED',
          expertId: withdrawal.expertId,
          detail: `提现${decision === 'APPROVE' ? '通过' : '驳回'}（${reason.trim()}）：${decision === 'APPROVE' ? '进入线下付款' : '解除冻结'}。`,
          operator: '陈岚',
        }),
      )
      return immutable(reviewed)
    },

    recordWithdrawalPayment: async (
      id: string,
      result: PaymentResult,
      voucher: string,
    ) => {
      ensureDemoMode()
      if (!voucher.trim()) {
        throw new PlatformOperationError('INVALID_INPUT', '线下付款凭证号不能为空。')
      }
      const state = deps.getState()
      const withdrawal = state.withdrawals.find((item) => item.id === id)
      if (!withdrawal) throw new PlatformOperationError('NOT_FOUND', '未找到该提现申请。')
      if (withdrawal.status === 'PAID') {
        // 幂等：已付款的申请重复回填不重复计账，原凭证号保留。
        return immutable(withdrawal)
      }
      if (withdrawal.status !== 'REVIEWING') {
        throw new PlatformOperationError(
          'STATE_CONFLICT',
          '仅审核通过的提现申请可以回填付款结果。',
        )
      }
      const recorded: WithdrawalRequest = {
        ...withdrawal,
        ...(result === 'SUCCESS'
          ? {
              status: 'PAID',
              voucherNo: voucher.trim(),
              paymentNote: undefined,
              history: [
                ...withdrawal.history,
                {
                  action: 'PAYMENT_SUCCESS',
                  at: '2026-08-26 11:00',
                  note: `线下付款成功（凭证号 ${voucher.trim()}）。`,
                },
              ],
            }
          : {
              status: 'REVIEWING',
              paymentNote: `线下付款失败（凭证号 ${voucher.trim()}），保持待付款状态，请重新线下付款后再次回填。`,
              history: [
                ...withdrawal.history,
                {
                  action: 'PAYMENT_FAILED',
                  at: '2026-08-26 11:00',
                  note: `线下付款失败（凭证号 ${voucher.trim()}）。`,
                },
              ],
            }),
      }
      const nextState: PlatformState = {
        ...state,
        withdrawals: state.withdrawals.map((item) => (item.id === id ? recorded : item)),
      }
      deps.setState(
        appendAudit(nextState, {
          action: 'PAYMENT_RECORDED',
          expertId: withdrawal.expertId,
          detail:
            result === 'SUCCESS'
              ? `线下付款回填成功（凭证号 ${voucher.trim()}）。`
              : `线下付款回填失败（凭证号 ${voucher.trim()}），保持待付款。`,
          operator: '陈岚',
        }),
      )
      return immutable(recorded)
    },
  }
}

/** 评阅中且临近截止（≤3 天）判定；`overdue` 是布尔时限属性，不是独立状态。 */
export function isDueSoon(task: ExpertTaskSummary) {
  const due = new Date(task.dueAt.replace(' ', 'T')).getTime()
  const now = new Date('2026-08-12T09:00:00').getTime()
  const remainingDays = (due - now) / 86_400_000
  return remainingDays > 0 && remainingDays <= 3
}
