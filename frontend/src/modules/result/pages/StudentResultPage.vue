<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import { useStudentPortalService } from '@/demo/serviceProvider'
import { getPublishedResult } from '@/api/results'
import { createObjection, listMyObjections } from '@/api/objections'
import { listTheses } from '@/api/theses'
import { toStudentThesisDetail } from '@/api/adapters'
import type { StudentObjectionInput, StudentResult, StudentThesisDetail } from '@/demo/types'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import StudentProgressTimeline from '@/modules/thesis/components/StudentProgressTimeline.vue'
import StudentDemoScenarioController from '@/modules/thesis/components/StudentDemoScenarioController.vue'

import AnonymousResultTable from '../components/AnonymousResultTable.vue'
import StudentObjectionForm from '../components/StudentObjectionForm.vue'
import StudentObjectionTimeline from '../components/StudentObjectionTimeline.vue'
import StudentResultSelector from '../components/StudentResultSelector.vue'
import StudentScoreDimensions from '../components/StudentScoreDimensions.vue'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const service = demoEnabled ? useStudentPortalService() : null
const authStore = useAuthStore()
const route = useRoute()
const router = useRouter()

const theses = ref<StudentThesisDetail[]>([])
const selectedThesis = ref<StudentThesisDetail | null>(null)
const result = ref<StudentResult | null>(null)
const loading = ref(true)
const error = ref('')
const feedback = ref('')
const confirmationInput = ref<StudentObjectionInput | null>(null)
const submitting = ref(false)
const cancelConfirmation = ref<HTMLButtonElement>()
const confirmSubmission = ref<HTMLButtonElement>()
const overlayOpener = ref<HTMLElement | null>(null)
const pageRoot = ref<HTMLElement>()
const demoDialogOpen = ref(false)

const selectedThesisId = computed(() => selectedThesis.value?.id ?? '')
const latestPublicEvent = computed(() => selectedThesis.value?.timeline.at(-1))
const unresolvedObjection = computed(
  () =>
    result.value?.objection && ['SUBMITTED', 'PROCESSING'].includes(result.value.objection.status),
)
const canCreateObjection = computed(
  () =>
    Boolean(result.value) &&
    selectedThesis.value?.allowedActions.includes('SUBMIT_OBJECTION') &&
    !unresolvedObjection.value,
)

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : '页面加载失败，请重试。'
}

async function loadSelected(id: string) {
  error.value = ''
  feedback.value = ''
  try {
    const [thesis, publishedResult] = await Promise.all([
      demoEnabled && service ? service.getStudentThesis(id) : listTheses().then((items) => toStudentThesisDetail(items.find((item) => item.id === id) ?? items[0])),
      demoEnabled && service
        ? service.getStudentResult(id)
        : getPublishedResult(id)
            .then(async (data) => {
              const objections = await listMyObjections(id).catch(() => [])
              const latest = objections[0]
              return {
              thesisId: data.thesis_id,
              totalScore: data.total,
              conclusion: data.items[0]?.recommendation ?? '',
              publishedAt: '',
              dimensions: [],
              results: data.items.map((item) => ({
                expertAlias: item.alias,
                score: item.total,
                recommendation: item.recommendation,
                comment: item.overall_comment,
                submittedAt: '',
              })),
              objection: latest
                ? {
                    id: latest.id,
                    thesisId: id,
                    reason: latest.reason,
                    request: latest.request,
                    attachments: [],
                    status: latest.status as 'SUBMITTED' | 'PROCESSING' | 'RESOLVED',
                    submittedAt: '',
                    publicResolution: latest.conclusion ?? undefined,
                  }
                : undefined,
            }
            })
            .catch(() => null),
    ])
    selectedThesis.value = thesis
    result.value = publishedResult
  } catch (loadError) {
    error.value = errorMessage(loadError)
  }
}

async function loadPage() {
  loading.value = true
  error.value = ''
  try {
    theses.value =
      demoEnabled && service
        ? await service.listStudentTheses()
        : (await listTheses()).map(toStudentThesisDetail)
    const queryId = typeof route.query.thesisId === 'string' ? route.query.thesisId : ''
    const selected = theses.value.find((thesis) => thesis.id === queryId) ?? theses.value[0]
    if (!selected) {
      selectedThesis.value = null
      result.value = null
      return
    }
    if (queryId !== selected.id) {
      await router.replace({ path: route.path, query: { ...route.query, thesisId: selected.id } })
    }
    await loadSelected(selected.id)
  } catch (loadError) {
    error.value = errorMessage(loadError)
  } finally {
    loading.value = false
  }
}

async function selectThesis(id: string) {
  if (!id || id === selectedThesisId.value) return
  await router.replace({ path: route.path, query: { ...route.query, thesisId: id } })
  await loadSelected(id)
}

function requestObjectionConfirmation(input: StudentObjectionInput) {
  overlayOpener.value =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  confirmationInput.value = input
  void nextTick(() => cancelConfirmation.value?.focus())
}

async function closeConfirmation() {
  confirmationInput.value = null
  await nextTick()
  const focusTarget =
    pageRoot.value?.querySelector<HTMLElement>('[data-objection-status]') ??
    (overlayOpener.value?.isConnected ? overlayOpener.value : null)
  focusTarget?.focus()
  overlayOpener.value = null
}

function trapConfirmationFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeConfirmation()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [cancelConfirmation.value, confirmSubmission.value].filter(
    (control): control is HTMLButtonElement => Boolean(control),
  )
  if (!controls.length) return
  event.preventDefault()
  const current = controls.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.shiftKey ? -1 : 1
  controls[(current + step + controls.length) % controls.length]?.focus()
}

async function confirmObjection() {
  if (!confirmationInput.value || !selectedThesis.value || submitting.value) return
  submitting.value = true
  feedback.value = ''
  const thesisId = selectedThesis.value.id
  try {
    if (demoEnabled && service) {
      await service.submitStudentObjection(thesisId, confirmationInput.value)
      await loadSelected(thesisId)
      feedback.value = '异议已提交，学校受理后会更新处理状态。'
    } else {
      await createObjection(thesisId, {
        reason: confirmationInput.value.reason,
        request: confirmationInput.value.request,
      }, { idempotencyKey: crypto.randomUUID() })
      await loadSelected(thesisId)
      feedback.value = '异议已提交，学校受理后会更新处理状态。'
    }
  } catch (submitError) {
    feedback.value = errorMessage(submitError)
  } finally {
    submitting.value = false
    await closeConfirmation()
  }
}

watch(
  () => route.query.thesisId,
  (value) => {
    if (typeof value === 'string' && value !== selectedThesisId.value) void loadSelected(value)
  },
)

onMounted(() => void loadPage())
</script>

<template>
  <PortalLayout
    :menu-items="portalMenus('student', demoEnabled)"
    active-path="/student/results"
    context-label="学生端 · 海岳大学"
    :user-name="authStore.user?.displayName ?? '林知远'"
    :background-locked="Boolean(confirmationInput) || demoDialogOpen"
  >
    <div ref="pageRoot" class="student-result-page">
      <PageHeader
        eyebrow="PAGE-012 · STUDENT RESULT"
        title="评审结果与异议"
        description="按本人论文查看公开进度和已发布结果；专家真实身份、联系方式和内部处理记录始终隐藏。"
      />
      <BlindRail
        audience="本人论文的公开进度、匿名评阅结果与异议状态"
        hidden-from="专家姓名、联系方式和内部处理记录"
        stage="结果查看"
      />

      <p v-if="feedback" class="student-result-page__feedback" role="status">{{ feedback }}</p>
      <section v-if="loading" class="student-result-page__state">正在加载本人论文…</section>
      <section v-else-if="error" class="student-result-page__state" role="alert">
        <p>{{ error }}</p>
        <button type="button" data-action="reload-results" @click="loadPage">重新加载</button>
      </section>
      <section v-else-if="!selectedThesis" class="student-result-page__state">
        暂无本人论文记录。
      </section>

      <template v-else>
        <StudentResultSelector
          :theses="theses"
          :model-value="selectedThesis.id"
          @update:model-value="selectThesis"
        />
        <StudentProgressTimeline :thesis="selectedThesis" />

        <template v-if="!result">
          <section class="student-result-page__unpublished">
            <h2>结果尚未发布</h2>
            <p>评阅或学校汇总仍在进行，请等待学校统一发布。</p>
            <div v-if="latestPublicEvent" data-latest-public-event>
              <span>最近公开事件</span>
              <strong>{{ latestPublicEvent.message }}</strong>
              <time>{{ latestPublicEvent.occurredAt }}</time>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="student-result-page__summary">
            <div data-result-total>
              <span>综合总分</span>
              <strong>{{ result.totalScore.toFixed(1) }}</strong>
            </div>
            <div>
              <span>汇总结论</span>
              <strong>{{ result.conclusion }}</strong>
            </div>
            <div>
              <span>发布时间</span>
              <strong>{{ result.publishedAt }}</strong>
            </div>
          </section>

          <StudentScoreDimensions :dimensions="result.dimensions" />
          <AnonymousResultTable :rows="result.results" />
          <StudentObjectionTimeline v-if="result.objection" :objection="result.objection" />
          <StudentObjectionForm
            v-if="canCreateObjection"
            :pending="submitting"
            :allow-attachments="demoEnabled"
            @request-submit="requestObjectionConfirmation"
          />
        </template>
      </template>
    </div>

    <StudentDemoScenarioController
      :enabled="demoEnabled"
      @changed="loadPage"
      @reset-dialog-change="demoDialogOpen = $event"
    />

    <template #modal>
      <div v-if="confirmationInput" class="student-result-page__modal-backdrop">
        <section
          class="student-result-page__dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="objection-confirmation-title"
          @keydown="trapConfirmationFocus"
        >
          <span>FINAL CONFIRMATION</span>
          <h2 id="objection-confirmation-title">确认提交异议？</h2>
          <p>提交后不可撤回。同一论文只允许存在一个未解决异议。</p>
          <div>
            <button ref="cancelConfirmation" type="button" @click="closeConfirmation">
              继续检查
            </button>
            <button
              ref="confirmSubmission"
              type="button"
              data-action="confirm-objection"
              :disabled="submitting"
              @click="confirmObjection"
            >
              {{ submitting ? '正在提交…' : '确认提交' }}
            </button>
          </div>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.student-result-page {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.student-result-page__feedback,
.student-result-page__state,
.student-result-page__unpublished {
  margin: 0;
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.student-result-page__feedback {
  border-color: #9ec3a1;
  color: var(--color-success);
}

.student-result-page__state,
.student-result-page__unpublished {
  text-align: center;
}

.student-result-page__state button {
  padding: 0.5rem 0.75rem;
}

.student-result-page__unpublished h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.1rem;
}

.student-result-page__unpublished > p {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.student-result-page__unpublished div {
  display: grid;
  gap: 0.25rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.student-result-page__unpublished span,
.student-result-page__unpublished time {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.student-result-page__summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.student-result-page__summary div {
  min-width: 0;
  padding: 1rem;
  border-right: 1px solid var(--color-border);
}

.student-result-page__summary div:last-child {
  border-right: 0;
}

.student-result-page__summary span,
.student-result-page__summary strong {
  display: block;
}

.student-result-page__summary span {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.student-result-page__summary strong {
  margin-top: 0.25rem;
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: 1.05rem;
}

.student-result-page__summary [data-result-total] strong {
  color: var(--color-primary);
  font-family: var(--font-data);
  font-size: 1.65rem;
}

.student-result-page__modal-backdrop {
  position: fixed;
  z-index: 100;
  display: grid;
  place-items: center;
  inset: 0;
  padding: 1rem;
  background: rgb(18 36 51 / 0.56);
}

.student-result-page__dialog {
  width: min(100%, 30rem);
  padding: 1.25rem;
  border: 1px solid #aab8c4;
  background: white;
  box-shadow: var(--shadow-md);
}

.student-result-page__dialog > span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.student-result-page__dialog h2 {
  margin: 0.25rem 0;
  font-family: var(--font-display);
}

.student-result-page__dialog p {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
}

.student-result-page__dialog div {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.student-result-page__dialog button {
  padding: 0.55rem 0.75rem;
  border: 1px solid #aab8c4;
  background: white;
  color: var(--color-text-primary);
  font-weight: 700;
}

.student-result-page__dialog [data-action='confirm-objection'] {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: white;
}

@media (max-width: 640px) {
  .student-result-page__summary {
    grid-template-columns: 1fr;
  }

  .student-result-page__summary div {
    border-right: 0;
    border-bottom: 1px solid var(--color-border);
  }
}
</style>
