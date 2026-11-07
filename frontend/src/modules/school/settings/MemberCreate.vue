<script setup lang="ts">
/**
 * U4-4 新建成员（学生或导师）。初始密码只在输入框里出现，提交后清空，不回显。
 * 幂等键按提交内容复用；重复时原样显示服务端说明。
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { apiFailure } from '@/api/failure'
import { createMember, type SchoolMember } from '@/api/schoolOperations'

import { idLabel, newMemberErrors, type NewMember } from './memberView'

const props = defineProps<{ initialType: SchoolMember['membership_type'] }>()
const emit = defineEmits<{ created: [member: SchoolMember]; cancel: [] }>()
const draft = ref<NewMember>({ type: props.initialType, name: '', externalId: '', username: '', password: '', again: '' })
const tried = ref(false)
const saving = ref(false)
const error = ref('')
let retry: { signature: string; key: string } | null = null
let alive = true
onBeforeUnmount(() => (alive = false))
const errors = computed(() => (tried.value ? newMemberErrors(draft.value) : {}))

async function submit() {
  tried.value = true
  if (saving.value || Object.keys(newMemberErrors(draft.value)).length) return
  const body = {
    membership_type: draft.value.type,
    username: draft.value.username.trim().toLowerCase(),
    display_name: draft.value.name.trim(),
    external_id: draft.value.externalId.trim(),
    password: draft.value.password,
  }
  const signature = JSON.stringify(body)
  if (retry?.signature !== signature) retry = { signature, key: crypto.randomUUID() }
  saving.value = true
  error.value = ''
  try {
    const created = await createMember(body, { idempotencyKey: retry.key, quiet: true })
    if (!alive) return
    retry = null
    draft.value.password = ''
    draft.value.again = ''
    emit('created', created)
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) retry = null
    error.value = failure.message
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head"><h2 class="wsd-obj__title">新建成员</h2></header>
    <section class="wsd-sec">
      <fieldset class="fs">
        <legend>类型</legend>
        <div class="wsd-choices">
          <label class="wsd-choice"><input v-model="draft.type" type="radio" name="member-type" value="STUDENT" :disabled="saving" /> 学生</label>
          <label class="wsd-choice"><input v-model="draft.type" type="radio" name="member-type" value="SUPERVISOR" :disabled="saving" /> 导师</label>
        </div>
      </fieldset>
      <div class="wsd-grid2">
        <label class="field">
          <span>姓名</span>
          <input v-model="draft.name" class="input" data-field="member-name" :disabled="saving" :aria-invalid="Boolean(errors.name)" />
          <small v-if="errors.name" class="field-error">{{ errors.name }}</small>
        </label>
        <label class="field">
          <span>{{ idLabel(draft.type) }}</span>
          <input v-model="draft.externalId" class="input" data-field="member-id" :disabled="saving" :aria-invalid="Boolean(errors.externalId)" />
          <small v-if="errors.externalId" class="field-error">{{ errors.externalId }}</small>
        </label>
        <label class="field wsd-wide">
          <span>登录账号</span>
          <input v-model="draft.username" class="input" data-field="member-username" autocomplete="off" spellcheck="false" :disabled="saving" :aria-invalid="Boolean(errors.username)" />
          <small v-if="errors.username" class="field-error">{{ errors.username }}</small>
          <small v-else>3–64 位小写字母、数字或 . _ -</small>
        </label>
        <label class="field">
          <span>初始密码</span>
          <input v-model="draft.password" class="input" type="password" data-field="password" autocomplete="new-password" :disabled="saving" :aria-invalid="Boolean(errors.password)" />
          <small>至少 12 位，提交后不再显示</small>
        </label>
        <label class="field">
          <span>再次输入</span>
          <input v-model="draft.again" class="input" type="password" data-field="password-again" autocomplete="new-password" :disabled="saving" :aria-invalid="Boolean(errors.password)" />
          <small v-if="errors.password" class="field-error">{{ errors.password }}</small>
        </label>
      </div>
      <p v-if="draft.type === 'STUDENT'" class="wsd-hint">建立账号后，还要在成员详情里为某个批次建立送审资格，学生才能新建论文。</p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn" :disabled="saving" @click="emit('cancel')">取消</button>
        <button type="button" class="btn btn--primary" data-action="submit-member" :disabled="saving" @click="submit">{{ saving ? '正在建立…' : '建立账号' }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.fs {
  margin: 0;
  padding: 0;
  border: 0;
}
.fs legend {
  margin-bottom: 6px;
  padding: 0;
  font-size: 13px;
  font-weight: 500;
}
</style>
