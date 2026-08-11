<script setup lang="ts">
import { inject, nextTick, ref } from 'vue'

import { studentPortalServiceKey } from '@/demo/serviceProvider'
import type {
  StudentEligibilityScenario,
  StudentFileValidationScenario,
  StudentScenarioPreset,
} from '@/demo/types'

defineProps<{ enabled: boolean }>()

const emit = defineEmits<{
  changed: []
  'reset-dialog-change': [open: boolean]
}>()
const service = inject(studentPortalServiceKey, null)
const open = ref(false)
const pending = ref(false)
const feedback = ref('')
const error = ref('')
const resetConfirmation = ref(false)
const resetOpener = ref<HTMLButtonElement>()
const resetCancel = ref<HTMLButtonElement>()
const resetConfirm = ref<HTMLButtonElement>()

const scenarios: Array<{ value: StudentScenarioPreset; label: string }> = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'RETURNED', label: '学校退回' },
  { value: 'SCHOOL_REVIEW', label: '学校审核' },
  { value: 'EXPERT_REVIEW', label: '送审评阅' },
  { value: 'RESULT_PROCESSING', label: '结果处理' },
  { value: 'COMPLETED', label: '已完成' },
]

function message(value: unknown) {
  return value instanceof Error ? value.message : '演示场景装载失败，请重试。'
}

async function run(action: () => Promise<unknown>, successMessage: string) {
  if (pending.value) return
  if (!service) {
    error.value = '演示服务尚未注入。'
    return
  }
  pending.value = true
  error.value = ''
  feedback.value = ''
  try {
    await action()
    feedback.value = successMessage
    emit('changed')
  } catch (runError) {
    error.value = message(runError)
  } finally {
    pending.value = false
  }
}

function loadScenario(preset: StudentScenarioPreset, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.loadStudentScenario(preset), `已载入“${label}”一致快照。`)
}

function loadEligibility(preset: StudentEligibilityScenario, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setStudentDemoEligibility(preset), `资格已切换为“${label}”。`)
}

function loadFileValidation(preset: StudentFileValidationScenario, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setStudentDemoFileValidation(preset), `文件校验已切换为“${label}”。`)
}

async function confirmReset() {
  if (!service) {
    await run(async () => undefined, '')
    return
  }
  await run(() => service.resetStudentDemo(), '已恢复默认演示数据。')
  await closeResetConfirmation()
}

async function openResetConfirmation() {
  resetConfirmation.value = true
  emit('reset-dialog-change', true)
  await nextTick()
  resetCancel.value?.focus()
}

async function closeResetConfirmation() {
  if (pending.value) return
  resetConfirmation.value = false
  emit('reset-dialog-change', false)
  await nextTick()
  resetOpener.value?.focus()
}

function trapResetFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeResetConfirmation()
    return
  }
  if (event.key !== 'Tab') return
  const controls = [resetCancel.value, resetConfirm.value].filter(
    (control): control is HTMLButtonElement => Boolean(control),
  )
  if (!controls.length) return
  const current = controls.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.shiftKey ? -1 : 1
  event.preventDefault()
  controls[(current + step + controls.length) % controls.length]?.focus()
}
</script>

<template>
  <aside v-if="enabled" class="student-demo" aria-label="学生演示场景控制器">
    <button
      class="student-demo__trigger"
      type="button"
      data-action="toggle-demo-scenarios"
      :aria-expanded="open"
      aria-controls="student-demo-panel"
      @click="open = !open"
    >
      演示场景
    </button>

    <section v-if="open" id="student-demo-panel" class="student-demo__panel">
      <header>
        <span>DEMO CONTROLS</span>
        <h2>学生端场景</h2>
        <p>仅用于演示，不代表学生拥有该操作权限。</p>
      </header>

      <fieldset :disabled="pending">
        <legend>主线论文快照</legend>
        <div class="student-demo__options">
          <button
            v-for="scenario in scenarios"
            :key="scenario.value"
            type="button"
            :data-scenario="scenario.value"
            @click="loadScenario(scenario.value, scenario.label)"
          >
            {{ scenario.label }}
          </button>
        </div>
      </fieldset>

      <fieldset :disabled="pending">
        <legend>提交资格</legend>
        <div class="student-demo__options">
          <button
            type="button"
            data-eligibility="ELIGIBLE"
            @click="loadEligibility('ELIGIBLE', '有效')"
          >
            有效
          </button>
          <button
            type="button"
            data-eligibility="SUSPENDED"
            @click="loadEligibility('SUSPENDED', '暂停')"
          >
            暂停
          </button>
          <button
            type="button"
            data-eligibility="EXPIRED"
            @click="loadEligibility('EXPIRED', '已过期')"
          >
            已过期
          </button>
        </div>
      </fieldset>

      <fieldset :disabled="pending">
        <legend>文件校验</legend>
        <div class="student-demo__options">
          <button
            type="button"
            data-file-validation="VALID"
            @click="loadFileValidation('VALID', '成功')"
          >
            成功
          </button>
          <button
            type="button"
            data-file-validation="INVALID"
            @click="loadFileValidation('INVALID', '失败')"
          >
            失败
          </button>
        </div>
      </fieldset>

      <p v-if="feedback" class="student-demo__feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="student-demo__error" role="alert">{{ error }}</p>
      <button
        ref="resetOpener"
        class="student-demo__reset"
        type="button"
        data-action="reset-student-demo"
        :disabled="pending"
        @click="openResetConfirmation"
      >
        一键恢复默认数据
      </button>

      <Teleport to="body">
        <section
          v-if="resetConfirmation"
          class="student-demo__dialog"
          data-student-demo-reset-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-demo-reset-title"
          @keydown="trapResetFocus"
        >
          <h3 id="student-demo-reset-title">确认恢复默认演示数据？</h3>
          <p>已保存的本地演示状态将被清除，并重新装载固定示例数据。</p>
          <div>
            <button
              ref="resetCancel"
              type="button"
              data-action="cancel-reset-student-demo"
              @click="closeResetConfirmation"
            >
              取消
            </button>
            <button
              ref="resetConfirm"
              type="button"
              data-action="confirm-reset-student-demo"
              :disabled="pending"
              @click="confirmReset"
            >
              确认恢复
            </button>
          </div>
        </section>
      </Teleport>
    </section>
  </aside>
</template>

<style scoped>
.student-demo {
  position: fixed;
  z-index: 65;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  justify-items: end;
  gap: 0.5rem;
}

.student-demo button,
.student-demo__dialog button {
  min-height: 2.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-weight: 700;
  cursor: pointer;
}

.student-demo button:disabled,
.student-demo__dialog button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.student-demo__trigger {
  padding: 0.55rem 0.85rem;
  border-color: var(--color-primary) !important;
  background: var(--color-primary) !important;
  color: var(--color-bg) !important;
  box-shadow: var(--shadow-md);
}

.student-demo__panel {
  position: relative;
  width: min(22rem, calc(100vw - 2rem));
  max-height: min(38rem, calc(100vh - 5rem));
  overflow-y: auto;
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.student-demo__panel header > span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.student-demo__panel h2,
.student-demo__panel h3,
.student-demo__panel p {
  margin: 0;
}

.student-demo__panel h2 {
  margin-top: 0.2rem;
  font-family: var(--font-display);
  font-size: 1rem;
}

.student-demo__panel header p,
.student-demo__dialog p {
  margin-top: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  line-height: 1.55;
}

.student-demo fieldset {
  margin: 0.85rem 0 0;
  padding: 0;
  border: 0;
}

.student-demo legend {
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.student-demo__options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.student-demo__options button {
  padding: 0.35rem;
  font-size: 0.6875rem;
}

.student-demo__feedback,
.student-demo__error {
  margin-top: 0.75rem !important;
  padding: 0.55rem;
  border-left: 3px solid var(--color-success);
  background: var(--color-fill);
  font-size: 0.6875rem;
}

.student-demo__error {
  border-left-color: var(--color-danger);
  color: var(--color-danger);
}

.student-demo__reset {
  width: 100%;
  margin-top: 0.75rem;
}

.student-demo__dialog {
  position: fixed;
  z-index: 75;
  right: 1rem;
  bottom: 1rem;
  width: min(22rem, calc(100vw - 2rem));
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  box-shadow: var(--shadow-lg);
}

.student-demo__dialog h3 {
  font-family: var(--font-display);
  font-size: 0.9rem;
}

.student-demo__dialog div {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.student-demo__dialog button {
  padding: 0.4rem 0.65rem;
}

@media (max-width: 480px) {
  .student-demo {
    right: 0.75rem;
    bottom: 0.75rem;
  }
}
</style>
