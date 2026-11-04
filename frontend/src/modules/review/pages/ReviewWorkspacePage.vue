<script setup lang="ts">
import { beijingTime } from '@/api/taskTiming'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import StatusTag from '@/components/app/StatusTag.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import { getReviewDraft, getReviewResult, getReviewRules, saveReviewDraft, submitFinalReview, type ReviewRule, type SavedReviewDraft } from '@/api/review'
import { listExpertTasks } from '@/api/expertTasks'
import type { ExpertTaskSummary, ReviewScoreInput } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import RealAnonymousDocumentPane from '../components/RealAnonymousDocumentPane.vue'
import AnonymousDocumentPane from '../components/AnonymousDocumentPane.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import type { CheckAck } from '@/api/reviewChecks'
import RealCorrectionPanel from '@/modules/result/components/RealCorrectionPanel.vue'
import WorkspaceSplitter from '../components/WorkspaceSplitter.vue'
import ExpertDemoScenarioController from '@/modules/expert-management/components/ExpertDemoScenarioController.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useScenarioService() : null
const demoDialogOpen = ref(false)

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

const overdue = computed(() => task.value?.overdue === true)
const submitted = computed(() => task.value?.status === 'SUBMITTED')
const formLocked = computed(() => locked.value || submitted.value || submitPending.value)

async function loadDemo() {
  if (!service) return
  try {
    const tasks = await service.listExpertTasks({ own: true })
    // 本人当前在评/已提交任务：工作台一次只处理一条（单专家评审约束）。
    const current =
      tasks.find((item) => ['IN_REVIEW', 'SUBMITTED'].includes(item.status)) ??
      tasks.find((item) => item.status === 'INVITED') ??
      tasks[0]
    if (!current) {
      loadError.value = '未找到当前可评阅的任务。'
      return
    }
    task.value = current
    locked.value = current.status === 'SUBMITTED'
    // 刷新后恢复草稿：工作台在评任务（IN_REVIEW）且已保存过草稿时回填表单。
    if (current.status === 'IN_REVIEW') draft.value = (await service.getSnapshot()).review?.scoreInput ?? null
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '任务加载失败。'
  }
}

// Never store expert comments in browser storage. The queue belongs to this loaded identity/task.
let revision = 0
let attempt: ReviewScoreInput | null = null
let flight: Promise<boolean> | null = null
const latest = shallowRef<ReviewScoreInput | null>(null)
const conflict = ref(false)
const compared = shallowRef<SavedReviewDraft | null>(null)
const formKey = ref(0)
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
  autosaveVisible.value = false
  if (autosaveHideTimer !== null) clearTimeout(autosaveHideTimer)
  autosaveHideTimer = null
  saving.value = false
  pendingInput.value = null
  submitPending.value = false
  correctionOpen.value = false
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

onMounted(() => { if (demoEnabled) void loadDemo() })
// Register after dialog state is initialized (below).
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

/** 演示场景装载后整页重读服务投影：任务、草稿与提交锁定全部刷新。 */
async function reloadWorkspaceProjection() {
  await reloadCurrentTask()
  draft.value = service && task.value?.status === 'IN_REVIEW' ? (await service.getSnapshot()).review?.scoreInput ?? null : null
}

function showSaved() {
  notice.value = '草稿已保存。'
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
        notice.value = status === 422 ? '草稿校验未通过，请修改后重试保存。' : '保存未确认，当前输入已保留，请重试保存草稿。'
      }
      return false
    } finally {
      if (generation === loadGeneration) { saving.value = false; flight = null }
    }
  })()
  return flight
}

function onManualSave(input: ReviewScoreInput) {
  if (formLocked.value) return
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

// 最终提交：二次确认对话框（防重复：提交中与提交后均无再次入口）。
const submitPending = ref(false)
const submitDialog = ref<HTMLElement | null>(null)
const submitDialogOpener = ref<HTMLElement | null>(null)
const submitError = ref('')
const pendingInput = ref<ReviewScoreInput | null>(null)
const pendingAck = ref<CheckAck | undefined>()

async function requestSubmit(input: ReviewScoreInput, ack?: CheckAck) {
  if (locked.value || submitPending.value) return
  pendingInput.value = input
  pendingAck.value = ack
  submitError.value = ''
  if (document.activeElement instanceof HTMLElement) {
    submitDialogOpener.value = document.activeElement
  }
  await nextTick()
  submitDialog.value
    ?.querySelector<HTMLElement>('[data-action="confirm-submit-review"]')
    ?.focus()
}

function cancelSubmit() {
  if (submitPending.value) return
  pendingInput.value = null
  submitError.value = ''
  void nextTick().then(() => submitDialogOpener.value?.focus())
  submitDialogOpener.value = null
}

function handleSubmitKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelSubmit()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    submitDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? focusable.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === focusable.length - 1
      ? 0
      : activeIndex + 1
  event.preventDefault()
  focusable[nextIndex]?.focus()
}

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

// 暂存退出：评阅中任务返回任务列表（草稿已自动保存，退出不丢失）。
function exitToTasks() {
  void router.push('/expert/tasks')
}

// 申请更正：提交后只读视图的入口；原因必填。
const correctionOpen = ref(false)
const correctionReason = ref('')
const correctionPending = ref(false)
const correctionError = ref('')
const correctionDialog = ref<HTMLElement | null>(null)
const correctionDialogOpener = ref<HTMLElement | null>(null)

async function openCorrectionDialog() {
  correctionOpen.value = true
  correctionReason.value = ''
  correctionError.value = ''
  if (document.activeElement instanceof HTMLElement) {
    correctionDialogOpener.value = document.activeElement
  }
  await nextTick()
  correctionDialog.value
    ?.querySelector<HTMLElement>('[data-action="confirm-correction"]')
    ?.focus()
}

function cancelCorrection() {
  if (correctionPending.value) return
  correctionOpen.value = false
  correctionError.value = ''
  void nextTick().then(() => correctionDialogOpener.value?.focus())
  correctionDialogOpener.value = null
}

function handleCorrectionKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelCorrection()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    correctionDialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea',
    ) ?? [],
  )
  if (focusable.length === 0) return
  const activeIndex = focusable.indexOf(document.activeElement as HTMLElement)
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? focusable.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === focusable.length - 1
      ? 0
      : activeIndex + 1
  event.preventDefault()
  focusable[nextIndex]?.focus()
}

async function confirmCorrection() {
  if (!task.value || correctionPending.value) return
  correctionPending.value = true
  correctionError.value = ''
  try {
    if (demoEnabled && service) {
      await service.requestCorrection(task.value.id, correctionReason.value.trim())
      correctionOpen.value = false
      notice.value = '更正申请已提交，等待平台审批；原评阅版本仍保留。'
    } else {
      notice.value = '评阅更正申请尚未接入真实接口。'
    }
  } catch (err) {
    correctionError.value = err instanceof Error ? err.message : '更正申请提交失败。'
  } finally {
    correctionPending.value = false
  }
}
watch([() => route.query.task_id, () => auth.user?.id, () => auth.user?.tenantId, () => auth.user?.role], () => { if (!demoEnabled) void loadRealTask() }, { immediate: true, flush: 'sync' })
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('expert', demoEnabled)"
    active-path="/expert/review"
    context-label="专家端 · 双盲评阅"
    :user-name="useAuthStore().user?.displayName ?? '周明远教授'"
    :background-locked="Boolean(pendingInput) || Boolean(correctionOpen) || demoDialogOpen"
  >
    <div class="workspace-page">
      <ExpertDemoScenarioController
        :enabled="demoEnabled"
        @changed="reloadWorkspaceProjection"
        @reset-dialog-change="demoDialogOpen = $event"
      />
      <PageHeader
        eyebrow="PAGE-010 · REVIEW WORKSPACE"
        title="在线评阅"
        description="左侧阅读匿名论文，右侧填写六维评分与评语；逾期任务仍可保存与提交，提交后整页只读。"
      >
        <template #actions>
          <StatusTag v-if="task" :status="task.status" :overdue="overdue" />
        </template>
      </PageHeader>
      <p v-if="task" class="task-context">{{ task.anonymousId }} · {{ task.anonymousTitle }}</p>
      <p v-if="!demoEnabled && task?.dueAt" data-review-deadline>评阅截止：{{ task.dueAt }}（北京时间）</p>
      <p v-if="!demoEnabled && rule" data-review-rule>评审规则 {{ rule.version }} · {{ rule.dimensions.length }} 维 · {{ rule.dimensions.reduce((sum, item) => sum + item.max_score, 0) }} 分</p>
      <BlindRail
        :audience="submitted ? '本人正式评阅意见' : '匿名版论文材料与本人评阅意见'"
        hidden-from="作者、导师身份、其他专家意见与论文原始版"
        :stage="!task ? '未选择任务' : submitted ? '已提交 · 只读' : '评阅中'"
      />
      <p v-if="overdue" class="overdue-warning" data-overdue-warning role="alert">
        {{ demoEnabled ? '本任务已逾期，逾期标记不会因保存或提交自动取消；请尽快完成评阅并提交。' : '本任务已超过评阅截止时间，仍可保存草稿或提交正式意见。' }}
      </p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <Transition name="draft-version"><section v-if="conflict" class="draft-version" aria-label="核对草稿版本">
        <button type="button" data-action="compare-review-draft" @click="compareDraft">查看服务器草稿</button>
        <template v-if="compared">
          <p>服务器版本 {{ compared.revision }} · 请与下方当前输入逐项核对</p>
          <dl class="compared-draft">
            <template v-for="dimension in rule?.dimensions" :key="dimension.key">
              <dt>{{ dimension.label }}</dt><dd>{{ compared[dimension.key] }}　{{ compared.evaluations?.[dimension.key] }}</dd>
            </template>
            <dt>评审结论</dt><dd>{{ compared.recommendation }}</dd>
            <dt>总体评价</dt><dd>{{ compared.overallComment }}</dd>
            <dt>主要优点</dt><dd>{{ compared.strengths }}</dd>
            <dt>主要问题</dt><dd>{{ compared.issues }}</dd>
            <dt>修改建议</dt><dd>{{ compared.revisionAdvice }}</dd>
          </dl>
          <button type="button" data-action="save-compared-review" @click="resolveConflict(true)">已核对，用当前输入保存</button>
          <button type="button" @click="resolveConflict(false)">放弃当前输入，采用服务器版本</button>
        </template>
      </section></Transition>
      <p v-if="loadError" class="load-error" role="alert">{{ loadError }}
        <button v-if="!demoEnabled && route.query.task_id" type="button" data-action="retry-review-rules" @click="loadRealTask">重新加载</button>
        <RouterLink to="/expert/tasks">返回任务列表</RouterLink>
      </p>
      <p v-if="autosaveVisible" class="autosave-indicator" data-autosave role="status">
        {{ demoEnabled ? '已自动保存草稿（本地演示存储）' : '草稿已保存至服务器' }}
      </p>

      <WorkspaceSplitter>
        <template #document>
          <AnonymousDocumentPane v-if="demoEnabled" :task="task" />
          <RealAnonymousDocumentPane v-else-if="task?.status === 'IN_REVIEW'" :key="task.id" :task-id="task.id" />
          <p v-else-if="submitted">评阅已提交，论文读取权限已结束；右侧为本人正式意见。</p>
        </template>
        <template #form>
          <ReviewFormPane
            v-if="task && (demoEnabled || rule)"
            :key="`${task.id}:${formKey}`"
            :check-target="demoEnabled ? undefined : { kind: 'task', id: task.id }"
            @edited="edited"
            :dimensions="demoEnabled ? undefined : rule?.dimensions"
            :locked="formLocked"
            :saving="saving"
            :draft="draft"
            @save="onManualSave"
            @autosave="flushDraft"
            @submit="requestSubmit"
            @exit="exitToTasks"
          />
        </template>
      </WorkspaceSplitter>

      <RealCorrectionPanel v-if="!demoEnabled && submitted && task" :key="task.id" mode="expert" :task-id="task.id" :dimensions="rule?.dimensions" />

      <section v-if="submitted && task" class="post-submit">
        <h3>提交完成</h3>
        <p v-if="demoEnabled">最终意见已提交并锁定，只能查看，不能再次编辑。如发现评分或评语有误，可申请更正；提交后原版本保留，更正需平台审批。</p>
        <p v-else>以下为本人正式提交的评阅意见，只能查看，不能再次编辑。</p>
        <button
          type="button"
          v-if="demoEnabled"
          data-action="open-correction-dialog"
          :disabled="task.correctionPending"
          @click="openCorrectionDialog"
        >
          {{ task.correctionPending ? '更正申请处理中' : '申请更正' }}
        </button>
      </section>
    </div>

    <template #modal>
      <!-- 最终提交二次确认 -->
      <div v-if="pendingInput && !locked" class="dialog-backdrop">
        <section
          ref="submitDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-dialog-title"
          @keydown="handleSubmitKeydown"
        >
          <h2 id="submit-dialog-title">确认最终提交评阅意见？</h2>
          <p>
            提交后评阅意见即时生效并整页锁定，不能再次编辑。请确认六维评分、总体评价与评审结论均已完整填写。
          </p>
          <p v-if="submitError" class="action-dialog__error" role="alert">{{ submitError }}</p>
          <footer>
            <button
              type="button"
              data-action="cancel-submit-review"
              :disabled="submitPending"
              @click="cancelSubmit"
            >
              取消
            </button>
            <button
              type="button"
              data-action="confirm-submit-review"
              :disabled="submitPending"
              @click="confirmSubmit"
            >
              {{ submitPending ? '正在提交…' : '确认最终提交' }}
            </button>
          </footer>
        </section>
      </div>

      <!-- 申请更正对话框（原因必填） -->
      <div v-if="correctionOpen" class="dialog-backdrop">
        <section
          ref="correctionDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correction-dialog-title"
          @keydown="handleCorrectionKeydown"
        >
          <h2 id="correction-dialog-title">申请更正</h2>
          <p>
            更正申请提交后进入平台审批，原评阅版本保留；批准后将生成新版本，已发布结果不会自动回滚（演示投影）。
          </p>
          <label class="reason-field">
            <span>更正原因（必填）</span>
            <textarea
              v-model="correctionReason"
              name="correctionReason"
              rows="4"
              placeholder="请说明需要更正的内容与依据"
            />
          </label>
          <p v-if="correctionError" class="action-dialog__error" role="alert">
            {{ correctionError }}
          </p>
          <footer>
            <button
              type="button"
              data-action="cancel-correction"
              :disabled="correctionPending"
              @click="cancelCorrection"
            >
              取消
            </button>
            <button
              type="button"
              data-action="confirm-correction"
              :disabled="correctionPending || !correctionReason.trim()"
              @click="confirmCorrection"
            >
              {{ correctionPending ? '正在提交…' : '提交更正申请' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.draft-version { display: grid; gap: .6rem; justify-items: start; }
.draft-version-enter-active, .draft-version-leave-active, .draft-version button { transition: opacity .18s, transform .18s; }
.draft-version-enter-from, .draft-version-leave-to { opacity: 0; transform: translateY(-3px); }
.draft-version button:hover { transform: scale(1.02); }
.draft-version button:active { transform: scale(.98); }
.compared-draft dd { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (prefers-reduced-motion: reduce) {
  .draft-version-enter-active, .draft-version-leave-active, .draft-version button { transition: none; }
}
.workspace-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.overdue-warning {
  margin: 0;
  padding: 0.7rem 0.85rem;
  border: 1px solid #e6b3b3;
  border-left: 4px solid #c0392b;
  background: #fdf0ef;
  color: #a3271c;
  font-size: 0.75rem;
  line-height: 1.6;
}

.notice {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #edf7ee;
  color: #28642d;
  font-size: 0.72rem;
}

.autosave-indicator {
  margin: 0;
  padding: 0.5rem 0.75rem;
  color: #6a7782;
  font-size: 0.68rem;
  text-align: right;
}

.load-error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.post-submit {
  display: grid;
  gap: 0.6rem;
  padding: 1rem;
  border: 1px solid #d8e0e6;
  border-left: 4px solid #28642d;
  background: #f4faf5;
}

.post-submit h3 {
  margin: 0;
  color: #1f4d24;
  font-family: var(--font-display);
  font-size: 0.95rem;
}

.post-submit p {
  margin: 0;
  color: #4b5966;
  font-size: 0.75rem;
  line-height: 1.65;
}

.post-submit button {
  justify-self: start;
  padding: 0.5rem 0.875rem;
  border: 1px solid #1b4f8a;
  border-radius: 0.3rem;
  background: #1b4f8a;
  color: white;
  font-weight: 650;
  cursor: pointer;
}

.post-submit button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}

.dialog-backdrop {
  position: fixed;
  z-index: 70;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: color-mix(in srgb, #0d2b47 50%, transparent);
}

.action-dialog {
  display: grid;
  width: min(30rem, 100%);
  gap: 1rem;
  padding: 1.25rem;
  border-radius: 0.5rem;
  background: #fff;
  box-shadow: 0 0.5rem 2rem rgb(13 43 71 / 35%);
}

.action-dialog h2,
.action-dialog p {
  margin: 0;
}

.action-dialog h2 {
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.action-dialog p {
  color: #4b5966;
  font-size: 0.78rem;
  line-height: 1.65;
}

.action-dialog__error {
  color: #b03232 !important;
}

.reason-field {
  display: grid;
  gap: 0.35rem;
}

.reason-field span {
  color: #4b5965;
  font-size: 0.72rem;
  font-weight: 650;
}

.reason-field textarea {
  width: 100%;
  padding: 0.65rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  background: #fbfcfe;
  resize: vertical;
  line-height: 1.6;
}

.action-dialog footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.action-dialog button {
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--color-border);
  border-radius: 0.3rem;
  background: #fff;
  color: #3a4a58;
  font-weight: 650;
  cursor: pointer;
}

.action-dialog button[data-action='confirm-submit-review'],
.action-dialog button[data-action='confirm-correction'] {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}

.action-dialog button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}
</style>
