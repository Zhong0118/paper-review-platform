<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId } from 'vue'

import type { StudentObjectionInput, ThesisFileMeta } from '@/demo/types'

const props = withDefaults(defineProps<{ pending?: boolean }>(), { pending: false })
const emit = defineEmits<{ 'request-submit': [input: StudentObjectionInput] }>()

const reason = ref('')
const request = ref('')
const attachment = ref<ThesisFileMeta | null>(null)
const reasonError = ref('')
const requestError = ref('')
const progress = ref(0)
const input = ref<HTMLInputElement>()
const reasonField = ref<HTMLTextAreaElement>()
const requestField = ref<HTMLTextAreaElement>()
const errorId = useId()
const reasonErrorId = `${errorId}-reason`
const requestErrorId = `${errorId}-request`
let validationRun = 0
let validationTimer: number | undefined

const attachmentFailed = computed(() => attachment.value?.validationStatus === 'INVALID')
const submissionDisabled = computed(
  () => props.pending || attachmentFailed.value || attachment.value?.validationStatus === 'PENDING',
)

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `objection-file-${Date.now()}-${Math.random()}`
}

function cancelValidation() {
  validationRun += 1
  if (validationTimer !== undefined) window.clearTimeout(validationTimer)
  validationTimer = undefined
}

function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  cancelValidation()
  const currentRun = validationRun
  progress.value = 50
  attachment.value = {
    id: createId(),
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/pdf',
    purpose: 'OBJECTION',
    validationStatus: 'PENDING',
  }

  validationTimer = window.setTimeout(() => {
    if (currentRun !== validationRun || !attachment.value) return
    validationTimer = undefined
    const validPdf =
      file.type === 'application/pdf' || (!file.type && file.name.toLowerCase().endsWith('.pdf'))
    attachment.value = {
      ...attachment.value,
      validationStatus: validPdf ? 'VALID' : 'INVALID',
    }
    progress.value = validPdf ? 100 : 0
  }, 20)
}

function requestSubmission() {
  if (submissionDisabled.value) return
  reasonError.value = reason.value.trim() ? '' : '请填写异议理由。'
  requestError.value = request.value.trim() ? '' : '请填写处理诉求。'
  if (reasonError.value) {
    void nextTick(() => reasonField.value?.focus())
    return
  }
  if (requestError.value) {
    void nextTick(() => requestField.value?.focus())
    return
  }
  emit('request-submit', {
    reason: reason.value.trim(),
    request: request.value.trim(),
    attachments: attachment.value?.validationStatus === 'VALID' ? [{ ...attachment.value }] : [],
  })
}

function reset() {
  cancelValidation()
  reason.value = ''
  request.value = ''
  attachment.value = null
  progress.value = 0
  reasonError.value = ''
  requestError.value = ''
  if (input.value) input.value.value = ''
}

defineExpose({ reset })
onBeforeUnmount(cancelValidation)
</script>

<template>
  <form data-objection-form class="objection-form" @submit.prevent="requestSubmission">
    <header>
      <span>OBJECTION REGISTRATION</span>
      <h2>异议登记</h2>
      <p>异议提交后不可撤回，学校将按公开流程受理并反馈结论。</p>
    </header>

    <div class="objection-form__fields">
      <label>
        <span>异议理由 <b>*</b></span>
        <textarea
          ref="reasonField"
          v-model="reason"
          name="reason"
          rows="4"
          :aria-invalid="reasonError ? 'true' : undefined"
          :aria-describedby="reasonError ? reasonErrorId : undefined"
          @input="reasonError = ''"
        ></textarea>
        <p
          v-if="reasonError"
          :id="reasonErrorId"
          class="objection-form__error"
          data-error-for="reason"
          role="alert"
        >
          {{ reasonError }}
        </p>
      </label>
      <label>
        <span>处理诉求 <b>*</b></span>
        <textarea
          ref="requestField"
          v-model="request"
          name="request"
          rows="4"
          :aria-invalid="requestError ? 'true' : undefined"
          :aria-describedby="requestError ? requestErrorId : undefined"
          @input="requestError = ''"
        ></textarea>
        <p
          v-if="requestError"
          :id="requestErrorId"
          class="objection-form__error"
          data-error-for="request"
          role="alert"
        >
          {{ requestError }}
        </p>
      </label>
    </div>

    <div class="objection-form__attachment">
      <div>
        <strong>异议附件（选填）</strong>
        <small>仅保存 PDF 的文件名、大小、MIME 类型和模拟校验状态。</small>
      </div>
      <label class="objection-form__choose">
        {{ attachment ? '重新选择附件' : '选择附件' }}
        <input ref="input" type="file" accept="application/pdf,.pdf" @change="chooseFile" />
      </label>
    </div>

    <p v-if="progress > 0 && progress < 100" data-objection-upload-progress>
      正在校验 {{ progress }}%
    </p>
    <p
      v-if="attachment"
      class="objection-form__file"
      :data-file-status="attachment.validationStatus"
    >
      <span>{{ attachment.name }}</span>
      <b v-if="attachmentFailed">上传失败</b>
      <b v-else-if="attachment.validationStatus === 'VALID'">校验通过</b>
      <b v-else>校验中</b>
    </p>
    <footer>
      <button type="submit" data-action="submit-objection" :disabled="submissionDisabled">
        {{ pending ? '正在提交…' : '提交异议' }}
      </button>
    </footer>
  </form>
</template>

<style scoped>
.objection-form {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.objection-form > header,
.objection-form__fields,
.objection-form__attachment,
.objection-form > footer,
.objection-form > p {
  margin: 0;
  padding: 0.875rem 1rem;
}

.objection-form > header {
  border-bottom: 1px solid var(--color-border);
}

.objection-form header span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.objection-form h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.objection-form header p,
.objection-form small {
  margin: 0.35rem 0 0;
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.objection-form__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.objection-form__fields label,
.objection-form__fields label > span {
  display: grid;
  gap: 0.375rem;
}

.objection-form__fields label > span {
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
}

.objection-form__fields b,
.objection-form__error,
.objection-form__file b {
  color: var(--color-danger);
}

.objection-form textarea {
  min-width: 0;
  padding: 0.625rem 0.75rem;
  border: 1px solid #b9c5ce;
  border-radius: var(--radius-sm);
  font: inherit;
  resize: vertical;
}

.objection-form__attachment,
.objection-form__file {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--color-border);
}

.objection-form__attachment div {
  display: grid;
}

.objection-form__choose {
  flex: none;
  padding: 0.45rem 0.65rem;
  border: 1px solid #aab8c4;
  color: var(--color-primary-active);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}

.objection-form__choose input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.objection-form__file b {
  font-size: 0.75rem;
}

.objection-form__file[data-file-status='VALID'] b {
  color: var(--color-success);
}

.objection-form > footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--color-border);
}

.objection-form button {
  padding: 0.625rem 1rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--color-primary);
  color: white;
  font-weight: 700;
  cursor: pointer;
}

.objection-form button:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

@media (max-width: 640px) {
  .objection-form__fields {
    grid-template-columns: 1fr;
  }

  .objection-form__attachment,
  .objection-form__file {
    align-items: start;
    flex-direction: column;
  }
}
</style>
