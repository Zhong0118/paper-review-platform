<script setup lang="ts">
import { inject, nextTick, ref } from 'vue'

import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { ExpertDemoTemplateScenario, ExpertScenarioPreset } from '@/demo/types'

defineProps<{ enabled: boolean }>()

const emit = defineEmits<{
  changed: []
  'reset-dialog-change': [open: boolean]
}>()
const service = inject(scenarioServiceKey, null)
const open = ref(false)
const pending = ref(false)
const feedback = ref('')
const error = ref('')
const resetConfirmation = ref(false)
const resetOpener = ref<HTMLButtonElement>()
const resetCancel = ref<HTMLButtonElement>()
const resetConfirm = ref<HTMLButtonElement>()

const scenarios: Array<{ value: ExpertScenarioPreset; label: string }> = [
  { value: 'INVITED', label: '待接受' },
  { value: 'IN_REVIEW', label: '评阅中' },
  { value: 'OVERDUE', label: '逾期评阅中' },
  { value: 'SUBMITTED', label: '已提交（只读）' },
  { value: 'CORRECTION_PENDING', label: '需要更正' },
  { value: 'REJECTED', label: '已拒绝' },
]

const templates: Array<{ value: ExpertDemoTemplateScenario; label: string }> = [
  { value: 'STANDARD', label: '标准版' },
  { value: 'INNOVATION_WEIGHTED', label: '创新加权版' },
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

function loadScenario(preset: ExpertScenarioPreset, label: string) {
  if (!service) return void run(async () => undefined, '')
  // ensureRole：装载专家快照同时对齐专家视角（activeRole），
  // 否则评阅草稿投影始终按默认 student 角色隐藏，刷新恢复草稿失效。
  void run(
    () => service.loadExpertScenario(preset, { ensureRole: true }),
    `已载入“${label}”一致快照。`,
  )
}

function loadTemplate(value: ExpertDemoTemplateScenario, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setExpertDemoTemplate(value), `六维模板已切换为“${label}”。`)
}

function loadFileValidation(value: 'VALID' | 'INVALID', label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setExpertDemoFileValidation(value), `文件校验已切换为“${label}”。`)
}

async function confirmReset() {
  if (!service) {
    await run(async () => undefined, '')
    return
  }
  await run(() => service.reset(), '已恢复默认演示数据。')
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
  <aside v-if="enabled" class="expert-demo" aria-label="专家端演示场景控制器">
    <button
      class="expert-demo__trigger"
      type="button"
      data-action="toggle-demo-scenarios"
      :aria-expanded="open"
      aria-controls="expert-demo-panel"
      @click="open = !open"
    >
      演示场景
    </button>

    <section v-if="open" id="expert-demo-panel" class="expert-demo__panel">
      <header>
        <span>DEMO CONTROLS</span>
        <h2>专家端场景</h2>
        <p>仅用于演示，不代表本人拥有该操作权限。</p>
      </header>

      <fieldset :disabled="pending">
        <legend>主线任务快照</legend>
        <div class="expert-demo__options">
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
        <legend>六维模板切换</legend>
        <div class="expert-demo__options">
          <button
            v-for="item in templates"
            :key="item.value"
            type="button"
            :data-template="item.value"
            @click="loadTemplate(item.value, item.label)"
          >
            {{ item.label }}
          </button>
        </div>
      </fieldset>

      <fieldset :disabled="pending">
        <legend>文件校验状态</legend>
        <div class="expert-demo__options">
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

      <p v-if="feedback" class="expert-demo__feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="expert-demo__error" role="alert">{{ error }}</p>
      <button
        ref="resetOpener"
        class="expert-demo__reset"
        type="button"
        data-action="reset-expert-demo"
        :disabled="pending"
        @click="openResetConfirmation"
      >
        一键恢复默认数据
      </button>

      <Teleport to="body">
        <section
          v-if="resetConfirmation"
          class="expert-demo__dialog"
          data-expert-demo-reset-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="expert-demo-reset-title"
          @keydown="trapResetFocus"
        >
          <h3 id="expert-demo-reset-title">确认恢复默认演示数据？</h3>
          <p>已保存的本地演示状态将被清除，并重新装载固定示例数据。</p>
          <div>
            <button
              ref="resetCancel"
              type="button"
              data-action="cancel-reset-expert-demo"
              @click="closeResetConfirmation"
            >
              取消
            </button>
            <button
              ref="resetConfirm"
              type="button"
              data-action="confirm-reset-expert-demo"
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
.expert-demo {
  position: fixed;
  z-index: 65;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  justify-items: end;
  gap: 0.5rem;
}

.expert-demo button,
.expert-demo__dialog button {
  min-height: 2.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-weight: 700;
  cursor: pointer;
}

.expert-demo button:disabled,
.expert-demo__dialog button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.expert-demo__trigger {
  padding: 0.55rem 0.85rem;
  border-color: var(--color-primary) !important;
  background: var(--color-primary) !important;
  color: var(--color-bg) !important;
  box-shadow: var(--shadow-md);
}

.expert-demo__panel {
  position: relative;
  width: min(22rem, calc(100vw - 2rem));
  max-height: min(38rem, calc(100vh - 5rem));
  overflow-y: auto;
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.expert-demo__panel header > span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.expert-demo__panel h2,
.expert-demo__panel h3,
.expert-demo__panel p {
  margin: 0;
}

.expert-demo__panel h2 {
  margin-top: 0.2rem;
  font-family: var(--font-display);
  font-size: 1rem;
}

.expert-demo__panel header p,
.expert-demo__dialog p {
  margin-top: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  line-height: 1.55;
}

.expert-demo fieldset {
  margin: 0.85rem 0 0;
  padding: 0;
  border: 0;
}

.expert-demo legend {
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.expert-demo__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
}

.expert-demo__options button {
  padding: 0.35rem;
  font-size: 0.6875rem;
}

.expert-demo__feedback,
.expert-demo__error {
  margin-top: 0.75rem !important;
  padding: 0.55rem;
  border-left: 3px solid var(--color-success);
  background: var(--color-fill);
  font-size: 0.6875rem;
}

.expert-demo__error {
  border-left-color: var(--color-danger);
  color: var(--color-danger);
}

.expert-demo__reset {
  width: 100%;
  margin-top: 0.75rem;
}

.expert-demo__dialog {
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

.expert-demo__dialog h3 {
  font-family: var(--font-display);
  font-size: 0.9rem;
}

.expert-demo__dialog div {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.expert-demo__dialog button {
  padding: 0.4rem 0.65rem;
}

@media (max-width: 480px) {
  .expert-demo {
    right: 0.75rem;
    bottom: 0.75rem;
  }
}
</style>
