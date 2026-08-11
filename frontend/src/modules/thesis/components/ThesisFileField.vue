<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ThesisFileMeta } from '@/demo/types'

const props = withDefaults(
  defineProps<{
    label: string
    purpose: ThesisFileMeta['purpose']
    modelValue?: ThesisFileMeta | null
    identityTokens?: string[]
  }>(),
  { modelValue: null, identityTokens: () => [] },
)
const emit = defineEmits<{ 'update:modelValue': [value: ThesisFileMeta | null] }>()

const input = ref<HTMLInputElement>()
const progress = ref(0)
const error = ref('')
let validationRun = 0
let validationTimer: number | undefined
const selected = ref<ThesisFileMeta | null>(props.modelValue)
const current = computed(() => selected.value)
const hasAnonymousRisk = computed(
  () => props.purpose === 'EXPERT_REVIEW' && current.value?.validationStatus === 'REVIEW_REQUIRED',
)

watch(
  () => props.modelValue,
  (value) => {
    selected.value = value
  },
)

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `file-${Date.now()}-${Math.random()}`
}

function cancelValidation() {
  validationRun += 1
  if (validationTimer !== undefined) window.clearTimeout(validationTimer)
  validationTimer = undefined
}

function onFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  cancelValidation()
  const currentRun = validationRun
  error.value = ''
  progress.value = 50

  validationTimer = window.setTimeout(() => {
    if (currentRun !== validationRun) return
    validationTimer = undefined
    const isPdf =
      file.type === 'application/pdf' || (!file.type && file.name.toLowerCase().endsWith('.pdf'))
    if (!isPdf) {
      progress.value = 0
      error.value = '文件校验失败，请重新选择 PDF。'
      if (input.value) input.value.value = ''
      return
    }

    const identityRisk =
      props.purpose === 'EXPERT_REVIEW' &&
      [...props.identityTokens, '致谢'].some((token) => token && file.name.includes(token))
    const meta: ThesisFileMeta = {
      id: createId(),
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/pdf',
      purpose: props.purpose,
      validationStatus: identityRisk ? 'REVIEW_REQUIRED' : 'VALID',
    }
    selected.value = meta
    emit('update:modelValue', meta)
    progress.value = 100
  }, 20)
}

function deleteFile() {
  cancelValidation()
  error.value = ''
  progress.value = 0
  if (input.value) input.value.value = ''
  selected.value = null
  emit('update:modelValue', null)
}

onBeforeUnmount(cancelValidation)
</script>

<template>
  <section class="file-field" :class="{ 'file-field--warning': hasAnonymousRisk }">
    <div class="file-field__heading">
      <div>
        <strong>{{ label }}</strong>
        <small>仅支持 PDF；这里只保存文件元数据，不保存文件正文。</small>
      </div>
      <label class="file-field__choose">
        {{ current ? '重新选择' : error ? '重新选择 PDF' : '选择 PDF' }}
        <input ref="input" type="file" accept="application/pdf,.pdf" @change="onFileChange" />
      </label>
    </div>

    <div v-if="progress > 0 && progress < 100" class="file-field__progress" data-file-progress>
      <span :style="{ width: `${progress}%` }"></span>
      正在校验 {{ progress }}%
    </div>

    <p v-if="error" class="file-field__error" role="alert">{{ error }}</p>

    <div v-if="current" class="file-field__meta">
      <span aria-hidden="true">PDF</span>
      <div>
        <b data-file-name>{{ current.name }}</b>
        <small>{{ (current.size / 1024).toFixed(1) }} KB · {{ current.mimeType }}</small>
      </div>
      <button type="button" data-action="delete-file" @click="deleteFile">删除</button>
    </div>

    <p v-if="hasAnonymousRisk" class="file-field__warning" role="alert">
      请检查文件名和正文中的身份线索；当前只检查文件名，正文尚未自动检测。
    </p>
  </section>
</template>

<style scoped>
.file-field {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 1rem;
  border: 1px solid #d7e0e7;
  background: #fbfcfd;
}

.file-field--warning {
  border-color: #d7a84b;
  background: #fffaf0;
}

.file-field__heading,
.file-field__meta {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
}

.file-field__heading div,
.file-field__meta div {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.file-field small {
  color: #71808b;
  font-size: 0.6875rem;
}

.file-field__choose {
  flex: none;
  padding: 0.45rem 0.65rem;
  border: 1px solid #aab8c4;
  background: white;
  color: #2d4d66;
  font-size: 0.75rem;
  font-weight: 650;
  cursor: pointer;
}

.file-field__choose input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.file-field__progress {
  position: relative;
  overflow: hidden;
  padding: 0.35rem 0.5rem;
  background: #e7edf2;
  color: #344b5e;
  font-size: 0.6875rem;
}

.file-field__progress span {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgb(45 111 158 / 0.2);
}

.file-field__meta {
  justify-content: start;
}

.file-field__meta > span {
  padding: 0.45rem 0.35rem;
  background: #a3342f;
  color: white;
  font-size: 0.625rem;
  font-weight: 750;
}

.file-field__meta b {
  overflow: hidden;
  max-width: 22rem;
  color: #263744;
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-field__meta button {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: #a3342f;
  cursor: pointer;
}

.file-field__error,
.file-field__warning {
  margin: 0;
  color: #a3342f;
  font-size: 0.75rem;
}
</style>
