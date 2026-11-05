<script setup lang="ts">
/**
 * U4-6 新建专家（E7）：对象区新建态。新专家资格为“待审核”，审核通过后才能派单。
 * 密码两次输入，只在输入框里；成功即清空。幂等键按提交内容复用，内容变了换新键。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { createExpert, type ExpertOptions, type ExpertRecord } from '@/api/expertOperations'
import { apiFailure } from '@/api/failure'
import CatalogMultiSelect from '@/components/app/CatalogMultiSelect.vue'

import { newExpertErrors, type NewExpert } from './expertView'

defineProps<{ options: ExpertOptions }>()
const emit = defineEmits<{ created: [expert: ExpertRecord]; cancel: [] }>()
const draft = ref<NewExpert>({ username: '', display_name: '', password: '', again: '', unit: '', title: '', discipline_codes: [] })
const tried = ref(false)
const saving = ref(false)
const error = ref('')
let retry: { signature: string; key: string } | null = null
let alive = true
onBeforeUnmount(() => (alive = false))
const errors = computed(() => (tried.value ? newExpertErrors(draft.value) : {}))

async function submit() {
  tried.value = true
  if (saving.value || Object.keys(newExpertErrors(draft.value)).length) return
  const body = {
    username: draft.value.username.trim().toLowerCase(),
    display_name: draft.value.display_name.trim(),
    initial_password: draft.value.password,
    unit: draft.value.unit.trim(),
    title: draft.value.title.trim(),
    discipline_codes: [...draft.value.discipline_codes].sort(),
  }
  const signature = JSON.stringify(body)
  if (retry?.signature !== signature) retry = { signature, key: crypto.randomUUID() }
  saving.value = true
  error.value = ''
  try {
    const created = await createExpert(body, { idempotencyKey: retry.key, quiet: true })
    if (!alive) return
    retry = null
    draft.value.password = ''
    draft.value.again = ''
    emit('created', created)
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409 || failure.status === 422) retry = null
    error.value = failure.message
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <h2 class="wsd-obj__title">新建专家</h2>
      <p class="wsd-hint">建立专家登录账号与基本档案。新专家资格为“待审核”，审核通过且可接单后才会出现在派单候选中。</p>
    </header>
    <section class="wsd-sec">
      <div class="wsd-grid2">
        <label class="field">
          <span>姓名</span>
          <input v-model="draft.display_name" class="input" data-field="expert-name" :disabled="saving" :aria-invalid="Boolean(errors.display_name)" />
          <small v-if="errors.display_name" class="field-error">{{ errors.display_name }}</small>
        </label>
        <label class="field">
          <span>登录名</span>
          <input v-model="draft.username" class="input" data-field="expert-username" autocomplete="off" spellcheck="false" :disabled="saving" :aria-invalid="Boolean(errors.username)" />
          <small v-if="errors.username" class="field-error">{{ errors.username }}</small>
        </label>
        <label class="field">
          <span>单位</span>
          <input v-model="draft.unit" class="input" data-field="expert-unit" :disabled="saving" :aria-invalid="Boolean(errors.unit)" />
          <small v-if="errors.unit" class="field-error">{{ errors.unit }}</small>
        </label>
        <label class="field">
          <span>职称</span>
          <input v-model="draft.title" class="input" data-field="expert-title" list="expert-titles" :disabled="saving" :aria-invalid="Boolean(errors.title)" />
          <datalist id="expert-titles"><option v-for="item in options.titles" :key="item" :value="item" /></datalist>
          <small v-if="errors.title" class="field-error">{{ errors.title }}</small>
        </label>
        <label class="field">
          <span>初始密码</span>
          <input v-model="draft.password" class="input" type="password" data-field="expert-password" autocomplete="new-password" :disabled="saving" :aria-invalid="Boolean(errors.password)" />
          <small>至少 12 位，提交后不再显示，请线下告知本人</small>
        </label>
        <label class="field">
          <span>再次输入</span>
          <input v-model="draft.again" class="input" type="password" data-field="expert-password-again" autocomplete="new-password" :disabled="saving" :aria-invalid="Boolean(errors.password)" />
          <small v-if="errors.password" class="field-error">{{ errors.password }}</small>
        </label>
      </div>
      <div class="wsd-wide" data-field="expert-disciplines">
        <CatalogMultiSelect v-model="draft.discipline_codes" :options="options.disciplines" label="学科" :disabled="saving" />
        <small v-if="errors.discipline_codes" class="field-error">{{ errors.discipline_codes }}</small>
      </div>
      <p class="wsd-hint">省份、导师资格、研究方向与来源可以在建立后在档案里补充，或用“导入档案”批量更新。</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn" :disabled="saving" @click="emit('cancel')">取消</button>
        <button type="button" class="btn btn--primary" data-action="submit-expert" :disabled="saving" @click="submit">{{ saving ? '正在建立…' : '建立专家' }}</button>
      </div>
    </section>
  </div>
</template>
