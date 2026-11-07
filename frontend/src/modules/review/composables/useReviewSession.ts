/**
 * 专家评阅会话：任务装载、草稿保存队列、冲突核对、最终提交。
 * U2-2 从 ReviewWorkspacePage 原样搬出（U2 计划 §4 “保存逻辑原样复用”），
 * 旧页与新专注评阅页共用；旧页既有 spec 不改一行即通过，证明搬家前后行为一致。
 *
 * 保存队列（修复代码 D3）：单飞；回执丢失时先原样重发那次未确认的快照（attempt），
 * 再发新输入；回执 revision 必须正好 +1；422 清掉失败的那次；409 进入冲突、暂停保存。
 */
import { beijingTime } from '@/api/taskTiming'
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { getReviewDraft, getReviewResult, getReviewRules, saveReviewDraft, submitFinalReview, type ReviewRule, type SavedReviewDraft } from '@/api/review'
import { listExpertTasks } from '@/api/expertTasks'
import type { CheckAck } from '@/api/reviewChecks'
import type { ExpertTaskSummary, ReviewScoreInput, ScenarioService } from '@/demo/types'
import { useAuthStore } from '@/stores/auth'

export interface ReviewSessionOptions {
  /** demo 模式传入演示服务；真实模式为 null */
  service: ScenarioService | null
  /** 换任务或重新装载时，页面清理自己的局部状态（例如更正对话框） */
  onReset?: () => void
}

export function useReviewSession({ service, onReset }: ReviewSessionOptions) {
  const route = useRoute()
  const auth = useAuthStore()
  const demoEnabled = Boolean(service)

  const task = ref<ExpertTaskSummary | null>(null)
  const locked = ref(true)
  const saving = ref(false)
  const notice = ref('')
  const loadError = ref('')
  /** 已保存草稿（刷新后由服务读回并回填表单；服务投影在 expert 视角下可见）。 */
  const draft = ref<ReviewScoreInput | null>(null)
  const rule = ref<ReviewRule | null>(null)
  /** 自动保存指示（演示：保存动作成功后显示，2.4s 后淡出）。 */
  const autosaveVisible = ref(false)
  let autosaveHideTimer: ReturnType<typeof setTimeout> | null = null

  // 最终提交状态（防重复：提交中与提交后均无再次入口）。
  const submitPending = ref(false)
  const submitError = ref('')
  const pendingInput = ref<ReviewScoreInput | null>(null)
  const pendingAck = ref<CheckAck | undefined>()

  // Never store expert comments in browser storage. The queue belongs to this loaded identity/task.
  let revision = 0
  let attempt: ReviewScoreInput | null = null
  let flight: Promise<boolean> | null = null
  const latest = shallowRef<ReviewScoreInput | null>(null)
  const conflict = ref(false)
  const compared = shallowRef<SavedReviewDraft | null>(null)
  const formKey = ref(0)
  /** 最近一次服务器确认保存的时间（只在确认后更新） */
  const savedAt = ref<Date | null>(null)
  /** 最近一次保存未确认（不含冲突）；下一次保存开始时清除。只供显示，不参与队列判断 */
  const saveFailed = ref(false)
  let submitKey: { signature: string; key: string } | null = null

  function unpackDraft(saved: SavedReviewDraft) {
    if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
      throw new Error('服务器未返回有效的草稿版本，请重新加载')
    const { revision: version, ...fields } = saved
    revision = version
    return version ? fields as ReviewScoreInput : null
  }

  let loadGeneration = 0
  async function loadRealTask() {
    const generation = ++loadGeneration
    flight = null
    attempt = null
    latest.value = null
    conflict.value = false
    compared.value = null
    submitKey = null
    revision = 0
    task.value = null
    draft.value = null
    rule.value = null
    locked.value = true
    loadError.value = ''
    notice.value = ''
    savedAt.value = null
    saveFailed.value = false
    autosaveVisible.value = false
    if (autosaveHideTimer !== null) clearTimeout(autosaveHideTimer)
    autosaveHideTimer = null
    saving.value = false
    pendingInput.value = null
    submitPending.value = false
    onReset?.()
    const id = route.query.task_id
    if (typeof id !== 'string' || !id) {
      loadError.value = '请从任务列表选择要评阅的任务。'
      return
    }
    try {
      const rows = await listExpertTasks()
      if (generation !== loadGeneration) return
      const current = rows.find(row => row.id === id)
      if (!current || !['IN_REVIEW', 'SUBMITTED'].includes(current.status)) {
        throw new Error('任务不存在或当前不可评阅，请返回任务列表。')
      }
      const [loadedRule, saved] = await Promise.all([
        getReviewRules(id),
        current.status === 'SUBMITTED' ? getReviewResult(id) : getReviewDraft(id),
      ])
      if (generation !== loadGeneration) return
      rule.value = loadedRule
      draft.value = current.status === 'SUBMITTED' ? saved as ReviewScoreInput : unpackDraft(saved as SavedReviewDraft)
      task.value = {
        id: current.id, status: current.status,
        anonymousId: current.anonymous_id ?? current.id.slice(0, 8),
        anonymousTitle: current.anonymous_title ?? '匿名论文',
        discipline: { code: current.discipline_code ?? '', name: current.discipline_name ?? '' },
        fee: 0, dueAt: beijingTime(current.deadline?.review_due_at), overdue: current.deadline?.overdue ?? false,
        allowedActions: current.allowed_actions ?? [],
      } as ExpertTaskSummary
      locked.value = current.status !== 'IN_REVIEW'
    } catch (err) {
      if (generation === loadGeneration) {
        loadError.value = err instanceof Error ? err.message : '任务加载失败。'
      }
    }
  }

  onBeforeUnmount(() => {
    loadGeneration++
    if (autosaveHideTimer !== null) {
      clearTimeout(autosaveHideTimer)
      autosaveHideTimer = null
    }
  })

  /** 从服务端投影重新载入当前任务（提交后刷新状态，页面反映最新流转）。 */
  async function reloadCurrentTask() {
    if (!service) { await loadRealTask(); return }
    const tasks = await service.listExpertTasks({ own: true })
    const current = tasks.find((item) => item.id === task.value?.id) ?? tasks[0] ?? null
    task.value = current
    locked.value = current?.status === 'SUBMITTED'
  }

  function showSaved() {
    notice.value = '草稿已保存。'
    savedAt.value = new Date()
    autosaveVisible.value = true
    if (autosaveHideTimer !== null) clearTimeout(autosaveHideTimer)
    autosaveHideTimer = setTimeout(() => { autosaveVisible.value = false }, 2400)
  }

  function edited(input: ReviewScoreInput) {
    pendingInput.value = null
    pendingAck.value = undefined
    latest.value = input
    autosaveVisible.value = false
    if (!conflict.value) notice.value = '有未保存的修改'
  }

  function markConflict(err: unknown) {
    if ((err as { response?: { data?: {code?: string} } } | null)?.response?.data?.code !== 'VERSION_CONFLICT') return false
    conflict.value = true
    compared.value = null
    notice.value = '另一窗口已更新草稿，当前输入已保留。请核对服务器版本后再保存。'
    return true
  }

  function flushDraft(): Promise<boolean> {
    if (conflict.value) return Promise.resolve(false)
    if (flight) return flight
    const id = task.value?.id
    if (!id || !latest.value) return Promise.resolve(true)
    const generation = loadGeneration
    saving.value = true
    saveFailed.value = false
    notice.value = '正在保存草稿'
    flight = (async () => {
      try {
        while (latest.value && generation === loadGeneration) {
          // A timeout may hide a committed write. Replay that exact snapshot before newer edits.
          const input: ReviewScoreInput = attempt ?? latest.value
          attempt = input
          if (service) await service.saveReviewDraft(input)
          else {
            const receipt = await saveReviewDraft(id, input, revision)
            if (generation !== loadGeneration) return false
            if (receipt?.revision !== revision + 1) throw new Error('未收到有效的草稿保存回执')
            revision = receipt.revision
          }
          if (generation !== loadGeneration) return false
          attempt = null
          if (latest.value === input) latest.value = null
        }
        if (generation !== loadGeneration) return false
        showSaved()
        return true
      } catch (err) {
        if (generation === loadGeneration && !markConflict(err)) {
          const status = (err as { response?: { status?: number } } | null)?.response?.status
          // A definite validation rejection did not commit. Retry the corrected form, not invalid input.
          if (status === 422) attempt = null
          saveFailed.value = true
          notice.value = status === 422 ? '草稿校验未通过，请修改后重试保存。' : '保存未确认，当前输入已保留，请重试保存草稿。'
        }
        return false
      } finally {
        if (generation === loadGeneration) { saving.value = false; flight = null }
      }
    })()
    return flight
  }

  function onManualSave(input: ReviewScoreInput, formLocked: boolean) {
    if (formLocked) return
    if (!latest.value) latest.value = input
    void flushDraft()
  }

  async function compareDraft() {
    if (!task.value || !conflict.value) return
    const generation = loadGeneration
    try {
      const saved = await getReviewDraft(task.value.id)
      if (generation === loadGeneration) compared.value = saved
    } catch {
      if (generation === loadGeneration) notice.value = '未能读取服务器草稿，请重试核对。'
    }
  }

  function resolveConflict(keepLocal: boolean) {
    if (!compared.value || !conflict.value) return
    const remote = unpackDraft(compared.value)
    attempt = null
    compared.value = null
    conflict.value = false
    if (keepLocal) void flushDraft()
    else {
      latest.value = null
      draft.value = remote
      formKey.value++
      notice.value = '已采用服务器草稿'
    }
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (latest.value || submitPending.value) { event.preventDefault(); event.returnValue = '' }
  }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
  function guardLeave() { return submitPending.value ? false : flushDraft() }
  onBeforeRouteLeave(guardLeave)
  onBeforeRouteUpdate((to, from) => to.query.task_id === from.query.task_id || guardLeave())

  async function confirmSubmit() {
    const input = pendingInput.value
    const id = task.value?.id
    const generation = loadGeneration
    if (!input || !id || locked.value || submitPending.value) return
    submitPending.value = true
    submitError.value = ''
    try {
      if (!await flushDraft() || generation !== loadGeneration) {
        if (generation === loadGeneration) {
          submitPending.value = false
          pendingInput.value = null
        }
        return
      }
      if (service) await service.submitFinalReview(input)
      else {
        const signature = JSON.stringify([input, pendingAck.value, revision])
        if (submitKey?.signature !== signature) submitKey = { signature, key: crypto.randomUUID() }
        await submitFinalReview(id, input, pendingAck.value, revision, submitKey.key)
      }
      if (generation !== loadGeneration) return
      const refreshGeneration = loadGeneration + (demoEnabled ? 0 : 1)
      await reloadCurrentTask()
      if (loadGeneration !== refreshGeneration || task.value?.id !== id) return
      pendingInput.value = null
      submitPending.value = false
      notice.value = '最终意见已提交并锁定。'
    } catch (err) {
      if (generation === loadGeneration) {
        if (!demoEnabled && markConflict(err)) { latest.value = input; pendingInput.value = null }
        submitError.value = err instanceof Error ? err.message : '最终提交失败，请稍后重试。'
        submitPending.value = false
      }
    }
  }

  watch([() => route.query.task_id, () => auth.user?.id, () => auth.user?.tenantId, () => auth.user?.role], () => { if (!demoEnabled) void loadRealTask() }, { immediate: true, flush: 'sync' })

  return {
    task, locked, saving, notice, loadError, draft, rule, autosaveVisible, savedAt, saveFailed,
    latest, conflict, compared, formKey,
    submitPending, submitError, pendingInput, pendingAck,
    loadRealTask, reloadCurrentTask, edited, flushDraft, onManualSave, compareDraft, resolveConflict, confirmSubmit,
  }
}
