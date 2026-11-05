<script setup lang="ts">
/**
 * U4-3 新建批次：代码与名称必填，起止时间可空（后端允许）；新批次是草稿。
 * 幂等键按提交内容复用：同一份内容失败后重试用同一把键。代码重复时标在代码字段上。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { apiFailure } from '@/api/failure'
import { createBatch, type ReviewBatch } from '@/api/schoolOperations'

import { toIso } from './batchForm'

const emit = defineEmits<{ created: [batch: ReviewBatch]; cancel: [] }>()
const form = ref({ code: '', name: '', startAt: '', endAt: '' })
const tried = ref(false)
const saving = ref(false)
const error = ref('')
const codeTaken = ref('')
let retry: { signature: string; key: string } | null = null
let alive = true
onBeforeUnmount(() => (alive = false))

const errors = computed(() => {
  if (!tried.value) return {}
  const e: Record<string, string> = {}
  if (!form.value.code.trim()) e.code = '请填写批次代码。'
  else if (form.value.code.trim().length > 32) e.code = '批次代码不超过 32 个字符。'
  if (!form.value.name.trim()) e.name = '请填写名称。'
  else if (form.value.name.trim().length > 128) e.name = '名称不超过 128 个字。'
  if (form.value.startAt && form.value.endAt && new Date(form.value.startAt) >= new Date(form.value.endAt)) e.endAt = '结束时间须晚于开始时间。'
  return e
})

async function submit() {
  tried.value = true
  codeTaken.value = ''
  if (saving.value || Object.keys(errors.value).length) return
  const body = { code: form.value.code.trim(), name: form.value.name.trim(), start_at: toIso(form.value.startAt), end_at: toIso(form.value.endAt) }
  const signature = JSON.stringify(body)
  if (retry?.signature !== signature) retry = { signature, key: crypto.randomUUID() }
  saving.value = true
  error.value = ''
  try {
    const created = await createBatch(body, { idempotencyKey: retry.key, quiet: true })
    if (!alive) return
    retry = null
    emit('created', created)
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.code === 'RESOURCE_CONFLICT') {
      retry = null
      codeTaken.value = failure.message || '批次代码已存在'
    } else error.value = failure.message
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <h2 class="wsd-obj__title">新建批次</h2>
      <p class="wsd-hint">新批次是草稿。期限与校内专业目录可以稍后补，开放前确认即可。</p>
    </header>
    <section class="wsd-sec">
      <div class="wsd-grid2">
        <label class="field">
          <span>批次代码</span>
          <input v-model="form.code" class="input" data-field="batch-code" autocomplete="off" placeholder="例如 2027-AUT" :disabled="saving" :aria-invalid="Boolean(errors.code || codeTaken)" />
          <small v-if="errors.code || codeTaken" class="field-error">{{ errors.code || codeTaken }}</small>
        </label>
        <label class="field">
          <span>名称</span>
          <input v-model="form.name" class="input" data-field="batch-name" placeholder="例如 2027 年秋季学位论文送审" :disabled="saving" :aria-invalid="Boolean(errors.name)" />
          <small v-if="errors.name" class="field-error">{{ errors.name }}</small>
        </label>
        <label class="field"><span>开始时间（可稍后填写）</span><input v-model="form.startAt" type="datetime-local" class="input" data-field="start-at" :disabled="saving" /></label>
        <label class="field">
          <span>结束时间（可稍后填写）</span>
          <input v-model="form.endAt" type="datetime-local" class="input" data-field="end-at" :disabled="saving" :aria-invalid="Boolean(errors.endAt)" />
          <small v-if="errors.endAt" class="field-error">{{ errors.endAt }}</small>
        </label>
      </div>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn" :disabled="saving" @click="emit('cancel')">取消</button>
        <button type="button" class="btn btn--primary" data-action="submit-batch" :disabled="saving" @click="submit">{{ saving ? '正在建立…' : '建立草稿批次' }}</button>
      </div>
    </section>
  </div>
</template>
