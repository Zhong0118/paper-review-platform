<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import StatusTag from '@/components/app/StatusTag.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { ExpertTaskSummary, ReviewScoreInput } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import AnonymousDocumentPane from '../components/AnonymousDocumentPane.vue'
import ReviewFormPane from '../components/ReviewFormPane.vue'
import WorkspaceSplitter from '../components/WorkspaceSplitter.vue'
import ExpertDemoScenarioController from '@/modules/expert-management/components/ExpertDemoScenarioController.vue'

const router = useRouter()
const service = useScenarioService()
/** 演示场景控制器：仅 VITE_DEMO_MODE=true 时渲染入口（见 Task 10）。 */
const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const demoDialogOpen = ref(false)

const task = ref<ExpertTaskSummary | null>(null)
const locked = ref(false)
const saving = ref(false)
const notice = ref('')
const loadError = ref('')
/** 已保存草稿（刷新后由服务读回并回填表单；服务投影在 expert 视角下可见）。 */
const draft = ref<ReviewScoreInput | null>(null)
/** 自动保存指示（演示：保存动作成功后显示，2.4s 后淡出）。 */
const autosaveVisible = ref(false)
let autosaveHideTimer: ReturnType<typeof setTimeout> | null = null

const overdue = computed(() => task.value?.overdue === true)
const submitted = computed(() => task.value?.status === 'SUBMITTED')
const formLocked = computed(() => locked.value || submitted.value)

onMounted(async () => {
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
    if (current.status === 'IN_REVIEW' && (await service.getSnapshot()).review?.scoreInput) {
      draft.value = (await service.getSnapshot()).review?.scoreInput ?? null
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '任务加载失败。'
  }
})

onBeforeUnmount(() => {
  if (autosaveHideTimer !== null) {
    clearTimeout(autosaveHideTimer)
    autosaveHideTimer = null
  }
})

/** 从服务端投影重新载入当前任务（提交后刷新状态，页面反映最新流转）。 */
async function reloadCurrentTask() {
  const tasks = await service.listExpertTasks({ own: true })
  const current = tasks.find((item) => item.id === task.value?.id) ?? tasks[0] ?? null
  task.value = current
  locked.value = current?.status === 'SUBMITTED'
}

/** 演示场景装载后整页重读服务投影：任务、草稿与提交锁定全部刷新。 */
async function reloadWorkspaceProjection() {
  await reloadCurrentTask()
  if (task.value?.status === 'IN_REVIEW') {
    draft.value = (await service.getSnapshot()).review?.scoreInput ?? null
  } else {
    draft.value = null
  }
}

async function save(input: ReviewScoreInput) {
  saving.value = true
  try {
    await service.saveReviewDraft(input)
    notice.value = '草稿已保存。'
    autosaveVisible.value = true
    if (autosaveHideTimer !== null) clearTimeout(autosaveHideTimer)
    autosaveHideTimer = setTimeout(() => {
      autosaveVisible.value = false
      autosaveHideTimer = null
    }, 2400)
  } catch (err) {
    notice.value = err instanceof Error ? err.message : '草稿保存失败。'
  } finally {
    saving.value = false
  }
}

/** 输入变化自动保存（表单侧防抖）；手动「保存草稿」按钮仍保留（立即保存）。 */
function onFormChange(input: ReviewScoreInput) {
  void save(input)
}

function onManualSave(input: ReviewScoreInput) {
  void save(input)
}

// 最终提交：二次确认对话框（防重复：提交中与提交后均无再次入口）。
const submitPending = ref(false)
const submitDialog = ref<HTMLElement | null>(null)
const submitDialogOpener = ref<HTMLElement | null>(null)
const submitError = ref('')
const pendingInput = ref<ReviewScoreInput | null>(null)

async function requestSubmit(input: ReviewScoreInput) {
  if (locked.value || submitPending.value) return
  pendingInput.value = input
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
  if (!input || locked.value || submitPending.value) return
  submitPending.value = true
  submitError.value = ''
  try {
    await service.submitFinalReview(input)
    await reloadCurrentTask()
    pendingInput.value = null
    notice.value = '最终意见已提交并锁定。'
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : '最终提交失败，请稍后重试。'
    submitPending.value = false
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
    await service.requestCorrection(task.value.id, correctionReason.value.trim())
    correctionOpen.value = false
    notice.value = '更正申请已提交，等待平台审批；原评阅版本仍保留。'
  } catch (err) {
    correctionError.value = err instanceof Error ? err.message : '更正申请提交失败。'
    correctionPending.value = false
  }
}
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.expert ?? []"
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
          <StatusTag :status="task?.status ?? 'IN_REVIEW'" :overdue="overdue" />
        </template>
      </PageHeader>
      <BlindRail
        audience="匿名题目、匿名摘要、匿名版论文材料与本人评阅意见"
        hidden-from="作者、导师身份、其他专家意见与论文原始版"
        :stage="submitted ? '已提交 · 只读' : '评阅中'"
      />
      <p v-if="overdue" class="overdue-warning" data-overdue-warning role="alert">
        本任务已逾期，逾期标记不会因保存或提交自动取消；请尽快完成评阅并提交。
      </p>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <p v-if="loadError" class="load-error" role="alert">{{ loadError }}</p>
      <p v-if="autosaveVisible" class="autosave-indicator" data-autosave role="status">
        已自动保存草稿（本地演示存储）
      </p>

      <WorkspaceSplitter>
        <template #document>
          <AnonymousDocumentPane :task="task" />
        </template>
        <template #form>
          <ReviewFormPane
            v-if="task"
            :locked="formLocked"
            :saving="saving"
            :draft="draft"
            @save="onManualSave"
            @autosave="onFormChange"
            @submit="requestSubmit"
            @exit="exitToTasks"
          />
        </template>
      </WorkspaceSplitter>

      <section v-if="submitted && task" class="post-submit">
        <h3>提交完成</h3>
        <p>最终意见已提交并锁定，只能查看，不能再次编辑。如发现评分或评语有误，可申请更正；提交后原版本保留，更正需平台审批。</p>
        <button
          type="button"
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
