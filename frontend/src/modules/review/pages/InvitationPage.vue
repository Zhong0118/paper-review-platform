<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useScenarioService } from '@/demo/serviceProvider'
import type { ExpertTaskSummary } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { menusByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const service = useScenarioService()

const task = ref<ExpertTaskSummary | null>(null)
const loading = ref(true)
const error = ref('')

const rejectReasons = ['', '方向不符', '时间不足', '利益冲突', '其他']
const rejectReason = ref('')
const rejectOtherDetail = ref('')
const rejectOpen = ref(false)
const rejectPending = ref(false)
const rejectError = ref('')
const rejectDialog = ref<HTMLElement | null>(null)
const rejectDialogOpener = ref<HTMLElement | null>(null)

// 接受二次确认
const acceptOpen = ref(false)
const acceptPending = ref(false)
const acceptError = ref('')
const acceptDialog = ref<HTMLElement | null>(null)
const acceptDialogOpener = ref<HTMLElement | null>(null)

const isOtherReason = computed(() => rejectReason.value === '其他')
// 提交原因：选择「其他」时必须以「其他：说明」提交（设计规格 §5.6 下拉+说明）。
const submittedReason = computed(() =>
  rejectReason.value === '其他' ? `其他：${rejectOtherDetail.value.trim()}` : rejectReason.value,
)

const canConfirmReject = computed(
  () =>
    !rejectPending.value &&
    rejectReason.value !== '' &&
    (rejectReason.value !== '其他' || rejectOtherDetail.value.trim() !== ''),
)

onMounted(async () => {
  try {
    const tasks = await service.listExpertTasks({ own: true })
    task.value = tasks.find((t) => t.status === 'INVITED') ?? tasks[0] ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : '邀请信息加载失败。'
  } finally {
    loading.value = false
  }
})

async function requestAccept() {
  if (!task.value) return
  acceptOpen.value = true
  acceptError.value = ''
  if (document.activeElement instanceof HTMLElement) {
    acceptDialogOpener.value = document.activeElement
  }
  await nextTick()
  acceptDialog.value?.querySelector<HTMLElement>('[data-action="confirm-accept-task"]')?.focus()
}

async function cancelAccept() {
  if (acceptPending.value) return
  acceptOpen.value = false
  acceptError.value = ''
  await nextTick()
  acceptDialogOpener.value?.focus()
  acceptDialogOpener.value = null
}

function handleAcceptKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelAccept()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    acceptDialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select, textarea, input',
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

async function confirmAccept() {
  if (!task.value || acceptPending.value) return
  acceptPending.value = true
  acceptError.value = ''
  try {
    await service.acceptExpertTask(task.value.id)
    await router.push('/expert/review')
  } catch (err) {
    acceptError.value = err instanceof Error ? err.message : '接受任务失败，请稍后重试。'
    acceptPending.value = false
  }
}

async function openRejectDialog() {
  rejectReason.value = ''
  rejectOtherDetail.value = ''
  rejectError.value = ''
  rejectOpen.value = true
  if (document.activeElement instanceof HTMLElement) {
    rejectDialogOpener.value = document.activeElement
  }
  await nextTick()
  rejectDialog.value?.querySelector<HTMLElement>('[data-reject-reason]')?.focus()
}

async function cancelReject() {
  if (rejectPending.value) return
  rejectOpen.value = false
  rejectError.value = ''
  await nextTick()
  rejectDialogOpener.value?.focus()
  rejectDialogOpener.value = null
}

function handleRejectKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void cancelReject()
    return
  }
  if (event.key !== 'Tab') return
  const focusable = Array.from(
    rejectDialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select, textarea, input',
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

async function confirmReject() {
  if (!task.value || rejectPending.value || !canConfirmReject.value) return
  rejectPending.value = true
  rejectError.value = ''
  try {
    await service.rejectExpertTask(task.value.id, submittedReason.value)
    rejectOpen.value = false
    task.value = null
  } catch (err) {
    rejectError.value = err instanceof Error ? err.message : '拒绝任务失败，请稍后重试。'
    rejectPending.value = false
  }
}
</script>

<template>
  <PortalLayout
    :menu-items="menusByRole.expert ?? []"
    active-path="/expert/tasks"
    context-label="专家端 · 双盲评阅"
    :user-name="useAuthStore().user?.displayName ?? '周明远教授'"
  >
    <div class="invite-page">
      <PageHeader
        eyebrow="PAGE-009 · REVIEW INVITATION"
        title="评审邀请"
        description="确认专业匹配、截止时间、评阅费和回避声明后决定是否接单；拒绝需选择原因并等待平台改派。"
      />
      <BlindRail
        audience="匿名概要、任务规则与本人回避声明"
        hidden-from="接单前不开放论文正文；始终不展示学生与导师身份"
        stage="接审确认"
      />

      <p v-if="error" class="invite-page__error" role="alert">{{ error }}</p>
      <p v-else-if="loading" class="invite-page__loading">正在加载邀请信息…</p>
      <p v-else-if="!task" class="invite-page__empty">
        当前没有待处理的评审邀请。可前往
        <RouterLink to="/expert/tasks">评审任务</RouterLink> 查看历史任务。
      </p>

      <section v-else class="invite-sheet">
        <div class="invite-sheet__head">
          <h2>匿名任务 {{ task.anonymousId }}</h2>
          <mark data-status="INVITED">待接受</mark>
        </div>
        <dl>
          <div>
            <dt>匿名题目</dt>
            <dd>{{ task.anonymousTitle }}</dd>
          </div>
          <div>
            <dt>匿名摘要</dt>
            <dd>{{ task.abstract }}</dd>
          </div>
          <div>
            <dt>送审方向</dt>
            <dd>{{ task.discipline.name }}</dd>
          </div>
          <div>
            <dt>匹配说明</dt>
            <dd>{{ task.matchNote }}</dd>
          </div>
          <div>
            <dt>接单截止</dt>
            <dd><time>{{ task.acceptBy }}</time></dd>
          </div>
          <div>
            <dt>评阅截止</dt>
            <dd><time>{{ task.dueAt }}</time></dd>
          </div>
          <div>
            <dt>评审费用</dt>
            <dd>
              <strong>¥ {{ task.fee.toFixed(2) }}</strong>
              <span class="invite-sheet__fee-note">{{ task.feeNote }}</span>
            </dd>
          </div>
          <div>
            <dt>评审模板</dt>
            <dd>{{ task.templateNote }}</dd>
          </div>
        </dl>

        <label class="invite-sheet__disclosure">
          <input type="checkbox" checked disabled />
          我确认不存在应回避的合作、亲属或利益关系，并遵守双盲评阅约定。
        </label>

        <p class="invite-sheet__hint">
          接受任务前不开放论文正文，接受后可进入在线评阅工作台查看匿名论文材料。
        </p>

        <p v-if="acceptError" class="invite-sheet__error" role="alert">{{ acceptError }}</p>

        <footer>
          <button
            class="invite-sheet__quiet"
            type="button"
            data-action="open-reject-dialog"
            @click="openRejectDialog"
          >
            拒绝任务
          </button>
          <button
            class="invite-sheet__primary"
            type="button"
            data-action="accept-task"
            @click="requestAccept"
          >
            接受任务并开始评阅
          </button>
        </footer>
      </section>
    </div>

    <template #modal>
      <div v-if="acceptOpen && task" class="dialog-backdrop">
        <section
          ref="acceptDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accept-dialog-title"
          @keydown="handleAcceptKeydown"
        >
          <h2 id="accept-dialog-title">确认接受评审任务？</h2>
          <p>
            接受后视同同意双盲评阅约定与回避声明：仅可见匿名版论文材料，不得向任何第三方披露评审内容，也不得联系论文作者。
          </p>
          <p>
            任务 <strong>{{ task.anonymousId }}</strong> · 评阅截止
            <time>{{ task.dueAt }}</time> · 费用
            <strong>¥ {{ task.fee.toFixed(2) }}</strong>
          </p>
          <p v-if="acceptError" class="action-dialog__error" role="alert">{{ acceptError }}</p>
          <footer>
            <button
              type="button"
              data-action="cancel-accept"
              :disabled="acceptPending"
              @click="cancelAccept"
            >
              取消
            </button>
            <button
              type="button"
              data-action="confirm-accept-task"
              :disabled="acceptPending"
              @click="confirmAccept"
            >
              {{ acceptPending ? '正在接受…' : '确认接受并进入评阅' }}
            </button>
          </footer>
        </section>
      </div>

      <div v-if="rejectOpen" class="dialog-backdrop">
        <section
          ref="rejectDialog"
          class="action-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-dialog-title"
          @keydown="handleRejectKeydown"
        >
          <h2 id="reject-dialog-title">拒绝该评审邀请？</h2>
          <p>拒绝后该任务将退回平台重新派单。为避免影响评审进度，请选择拒绝原因。</p>
          <label>
            <span>拒绝原因（必选）</span>
            <select v-model="rejectReason" data-reject-reason>
              <option v-for="reason in rejectReasons" :key="reason" :value="reason">
                {{ reason === '' ? '请选择原因' : reason }}
              </option>
            </select>
          </label>
          <label v-if="isOtherReason" class="reject-detail">
            <span>拒绝说明（必填）</span>
            <textarea
              v-model="rejectOtherDetail"
              data-reject-reason-detail
              rows="3"
              placeholder="请说明具体拒绝原因"
            />
          </label>
          <p v-if="rejectError" class="action-dialog__error" role="alert">{{ rejectError }}</p>
          <footer>
            <button
              type="button"
              data-action="cancel-reject"
              :disabled="rejectPending"
              @click="cancelReject"
            >
              取消
            </button>
            <button
              type="button"
              data-action="confirm-reject-task"
              :disabled="!canConfirmReject"
              @click="confirmReject"
            >
              {{ rejectPending ? '正在拒绝…' : '确认拒绝' }}
            </button>
          </footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.invite-page {
  display: grid;
  min-width: 0;
  gap: 1rem;
}

.invite-page__error {
  margin: 0;
  padding: 0.6rem 0.75rem;
  background: #fbeaea;
  color: #b03232;
  font-size: 0.72rem;
}

.invite-page__loading,
.invite-page__empty {
  margin: 0;
  padding: 0.6rem 0.75rem;
  color: #7c8993;
  font-size: 0.72rem;
}

.invite-page__empty a {
  color: #1b4f8a;
}

.invite-sheet {
  padding: 1.25rem;
  border: 1px solid #d8e0e6;
  background: #fff;
}

.invite-sheet__head {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.invite-sheet__head h2 {
  margin: 0;
  color: #1f2d3a;
  font-family: var(--font-display);
  font-size: 1.05rem;
}

.invite-sheet__head mark {
  padding: 0.18rem 0.4rem;
  border-radius: 0.25rem;
  background: #eef5fc;
  color: #1b4f8a;
  font-size: 0.68rem;
}

.invite-sheet dl {
  margin: 0.9rem 0 0;
}

.invite-sheet dl div {
  display: grid;
  grid-template-columns: 8rem 1fr;
  gap: 0.75rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #e5eaee;
}

.invite-sheet dt {
  color: #74818c;
  font-size: 0.72rem;
}

.invite-sheet dd {
  margin: 0;
  color: #344550;
  font-size: 0.75rem;
  line-height: 1.6;
}

.invite-sheet dd strong {
  color: #1b4f8a;
}

.invite-sheet__fee-note {
  margin-left: 0.5rem;
  color: #7c8993;
  font-size: 0.68rem;
}

.invite-sheet__disclosure {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.9rem;
  color: #4c5b67;
  font-size: 0.72rem;
}

.invite-sheet__hint {
  margin: 0.9rem 0 0;
  padding: 0.6rem 0.75rem;
  background: #f6f8fa;
  border-left: 3px solid #9db4c9;
  color: #586874;
  font-size: 0.7rem;
  line-height: 1.6;
}

.invite-sheet__error {
  margin: 0.6rem 0 0;
  color: #b03232;
  font-size: 0.7rem;
}

.invite-sheet footer {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1.1rem;
}

.invite-sheet footer button {
  padding: 0.5rem 0.875rem;
  border-radius: 0.3rem;
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;
}

.invite-sheet__quiet {
  border: 1px solid #b8c4ce;
  background: #fff;
  color: #4c5b67;
}

.invite-sheet__primary {
  border: 1px solid #1b4f8a;
  background: #1b4f8a;
  color: #fff;
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

.action-dialog p,
.action-dialog label {
  color: #4b5966;
  font-size: 0.78rem;
  line-height: 1.65;
}

.action-dialog label {
  display: grid;
  gap: 0.35rem;
}

.action-dialog select {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  background: #fff;
  color: #344550;
  font-size: 0.75rem;
}

.action-dialog .reject-detail {
  display: grid;
  gap: 0.35rem;
}

.action-dialog textarea {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid #cbd4dc;
  border-radius: 0.3rem;
  color: #344550;
  font-size: 0.75rem;
  font-family: inherit;
}

.action-dialog__error {
  color: #b03232 !important;
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

.action-dialog button[data-action='confirm-accept-task'] {
  border-color: #1b4f8a;
  background: #1b4f8a;
  color: #fff;
}

.action-dialog button[data-action='confirm-reject-task'] {
  border-color: #b03232;
  background: #b03232;
  color: #fff;
}

.action-dialog button:disabled {
  border-color: #d8dee3;
  background: #f2f4f6;
  color: #a3adb6;
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .invite-sheet dl div {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }

  .invite-sheet footer {
    flex-direction: column-reverse;
  }

  .invite-sheet footer button {
    width: 100%;
  }
}
</style>
