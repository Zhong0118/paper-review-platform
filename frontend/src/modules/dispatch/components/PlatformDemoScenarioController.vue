<script setup lang="ts">
import { inject, nextTick, ref } from 'vue'

import { scenarioServiceKey } from '@/demo/serviceProvider'
import type { PlatformDemoBalanceScenario, PlatformScenarioPreset } from '@/demo/types'

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

const scenarios: Array<{ value: PlatformScenarioPreset; label: string }> = [
  { value: 'PENDING_DISPATCH', label: '待派单' },
  { value: 'PENDING_ACCEPTANCE', label: '待接受' },
  { value: 'IN_REVIEW', label: '评阅中' },
  { value: 'DUE_SOON', label: '即将逾期' },
  { value: 'OVERDUE', label: '已逾期' },
  { value: 'PENDING_REASSIGNMENT', label: '已拒绝待改派' },
  { value: 'CORRECTION_PENDING', label: '更正处理中' },
  { value: 'COMPLETED', label: '已完成' },
]

const eligibility: Array<{ value: 'APPROVED' | 'REVIEWING' | 'REJECTED'; label: string }> = [
  { value: 'APPROVED', label: '通过' },
  { value: 'REVIEWING', label: '审核中' },
  { value: 'REJECTED', label: '驳回' },
]

const balances: Array<{ value: PlatformDemoBalanceScenario; label: string }> = [
  { value: 'FULL', label: '可提现 900' },
  { value: 'FROZEN', label: '冻结 300' },
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

function loadScenario(preset: PlatformScenarioPreset, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.loadPlatformScenario(preset), `已载入“${label}”一致快照。`)
}

function loadEligibility(value: 'APPROVED' | 'REVIEWING' | 'REJECTED', label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setPlatformDemoEligibility(value), `专家库资格已切换为“${label}”。`)
}

function loadBalance(value: PlatformDemoBalanceScenario, label: string) {
  if (!service) return void run(async () => undefined, '')
  void run(() => service.setPlatformDemoBalance(value), `余额已切换为“${label}”。`)
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
  <aside v-if="enabled" class="platform-demo" aria-label="运营端演示场景控制器">
    <button
      class="platform-demo__trigger"
      type="button"
      data-action="toggle-demo-scenarios"
      :aria-expanded="open"
      aria-controls="platform-demo-panel"
      @click="open = !open"
    >
      演示场景
    </button>

    <section v-if="open" id="platform-demo-panel" class="platform-demo__panel">
      <header>
        <span>DEMO CONTROLS</span>
        <h2>运营端场景</h2>
        <p>仅用于演示，不代表本人拥有该操作权限。</p>
      </header>

      <fieldset :disabled="pending">
        <legend>主线运营快照</legend>
        <div class="platform-demo__options">
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
        <legend>专家库资格状态</legend>
        <div class="platform-demo__options">
          <button
            v-for="item in eligibility"
            :key="item.value"
            type="button"
            :data-eligibility="item.value"
            @click="loadEligibility(item.value, item.label)"
          >
            {{ item.label }}
          </button>
        </div>
      </fieldset>

      <fieldset :disabled="pending">
        <legend>专家余额额度</legend>
        <div class="platform-demo__options">
          <button
            v-for="item in balances"
            :key="item.value"
            type="button"
            :data-balance="item.value"
            @click="loadBalance(item.value, item.label)"
          >
            {{ item.label }}
          </button>
        </div>
      </fieldset>

      <p v-if="feedback" class="platform-demo__feedback" role="status">{{ feedback }}</p>
      <p v-if="error" class="platform-demo__error" role="alert">{{ error }}</p>
      <button
        ref="resetOpener"
        class="platform-demo__reset"
        type="button"
        data-action="reset-platform-demo"
        :disabled="pending"
        @click="openResetConfirmation"
      >
        一键恢复默认数据
      </button>

      <Teleport to="body">
        <section
          v-if="resetConfirmation"
          class="platform-demo__dialog"
          data-platform-demo-reset-dialog
          role="dialog"
          aria-modal="true"
          aria-labelledby="platform-demo-reset-title"
          @keydown="trapResetFocus"
        >
          <h3 id="platform-demo-reset-title">确认恢复默认演示数据？</h3>
          <p>已保存的本地演示状态将被清除，并重新装载固定示例数据。</p>
          <div>
            <button
              ref="resetCancel"
              type="button"
              data-action="cancel-reset-platform-demo"
              @click="closeResetConfirmation"
            >
              取消
            </button>
            <button
              ref="resetConfirm"
              type="button"
              data-action="confirm-reset-platform-demo"
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
.platform-demo {
  position: fixed;
  z-index: 65;
  right: 1rem;
  bottom: 1rem;
  display: grid;
  justify-items: end;
  gap: 0.5rem;
}

.platform-demo button,
.platform-demo__dialog button {
  min-height: 2.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-weight: 700;
  cursor: pointer;
}

.platform-demo button:disabled,
.platform-demo__dialog button:disabled {
  cursor: wait;
  opacity: 0.6;
}

.platform-demo__trigger {
  padding: 0.55rem 0.85rem;
  border-color: var(--color-primary) !important;
  background: var(--color-primary) !important;
  color: var(--color-bg) !important;
  box-shadow: var(--shadow-md);
}

.platform-demo__panel {
  position: relative;
  width: min(22rem, calc(100vw - 2rem));
  max-height: min(38rem, calc(100vh - 5rem));
  overflow-y: auto;
  padding: 1rem;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  box-shadow: var(--shadow-md);
}

.platform-demo__panel header > span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.platform-demo__panel h2,
.platform-demo__panel h3,
.platform-demo__panel p {
  margin: 0;
}

.platform-demo__panel h2 {
  margin-top: 0.2rem;
  font-family: var(--font-display);
  font-size: 1rem;
}

.platform-demo__panel header p,
.platform-demo__dialog p {
  margin-top: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  line-height: 1.55;
}

.platform-demo fieldset {
  margin: 0.85rem 0 0;
  padding: 0;
  border: 0;
}

.platform-demo legend {
  margin-bottom: 0.35rem;
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
  font-weight: 700;
}

.platform-demo__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
}

.platform-demo__options button {
  padding: 0.35rem;
  font-size: 0.6875rem;
}

.platform-demo__feedback,
.platform-demo__error {
  margin-top: 0.75rem !important;
  padding: 0.55rem;
  border-left: 3px solid var(--color-success);
  background: var(--color-fill);
  font-size: 0.6875rem;
}

.platform-demo__error {
  border-left-color: var(--color-danger);
  color: var(--color-danger);
}

.platform-demo__reset {
  width: 100%;
  margin-top: 0.75rem;
}

.platform-demo__dialog {
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

.platform-demo__dialog h3 {
  font-family: var(--font-display);
  font-size: 0.9rem;
}

.platform-demo__dialog div {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.platform-demo__dialog button {
  padding: 0.4rem 0.65rem;
}

@media (max-width: 480px) {
  .platform-demo {
    right: 0.75rem;
    bottom: 0.75rem;
  }
}
</style>
