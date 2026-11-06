<script setup lang="ts">
import { computed, ref } from 'vue'

type InvitationState = 'idle' | 'valid' | 'expired' | 'invalid'

const invitationCode = ref('')
const password = ref('')
const state = ref<InvitationState>('idle')
const notice = ref('')

const validationMessage = computed(() => {
  if (state.value === 'expired') return '该邀请已过期，请联系邀请方重新发送。'
  if (state.value === 'invalid') return '未识别到有效邀请，请检查邀请码。'
  return ''
})

function verifyInvitation() {
  notice.value = ''
  const code = invitationCode.value.trim().toUpperCase()
  if (code === 'BJ-2026-EXPERT') state.value = 'valid'
  else if (code === 'BJ-2025-EXPIRED') state.value = 'expired'
  else state.value = 'invalid'
}

function activateAccount() {
  notice.value = '账号激活接口尚未接入；演示环境未创建真实账号。'
}
</script>

<template>
  <section
    id="login-panel-activation"
    class="activation-panel"
    role="tabpanel"
    aria-labelledby="login-tab-activation"
  >
    <div class="activation-panel__note">
      <strong>面向受邀专家与管理人员</strong>
      <span>公开注册未开放，请使用邀请邮件或短信中的激活码。</span>
    </div>
    <form class="activation-form" @submit.prevent="verifyInvitation">
      <label>
        <span>邀请码</span>
        <input
          v-model="invitationCode"
          name="invitation-code"
          autocomplete="one-time-code"
          placeholder="请输入邀请码"
        />
      </label>
      <button
        type="submit"
        class="activation-form__secondary"
        data-action="verify-invitation"
        :disabled="!invitationCode.trim()"
      >
        验证邀请
      </button>
    </form>

    <p v-if="validationMessage" class="activation-panel__error">{{ validationMessage }}</p>

    <div v-if="state === 'valid'" class="invitation-card" aria-label="邀请信息">
      <div><span>受邀角色</span><strong>评审专家</strong></div>
      <div><span>邀请机构</span><strong>百杰校审平台</strong></div>
      <div><span>绑定账号</span><strong>z***@example.edu.cn</strong></div>
      <label>
        <span>设置登录密码</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="至少 8 位"
        />
      </label>
      <button
        type="button"
        class="activation-form__primary"
        data-action="activate-account"
        :disabled="password.length < 8"
        @click="activateAccount"
      >
        激活并登录
      </button>
    </div>
    <p v-if="notice" class="activation-panel__notice" role="status">{{ notice }}</p>
  </section>
</template>

<style scoped>
.activation-panel,
.activation-form,
.activation-form label,
.activation-form label span,
.activation-panel__note,
.invitation-card,
.invitation-card label {
  display: grid;
  gap: 0.625rem;
}

.activation-panel__note {
  margin-bottom: 1rem;
  padding: 0.875rem;
  border-left: 3px solid var(--border-strong);
  background: var(--muted);
}

.activation-panel__note strong,
.activation-form label span,
.invitation-card label span {
  color: var(--foreground);
  font-size: 0.8125rem;
  font-weight: 650;
}

.activation-panel__note span,
.activation-panel__error,
.activation-panel__notice {
  font-size: 0.75rem;
  line-height: 1.6;
}

.activation-panel__note span {
  color: var(--muted-foreground);
}

.activation-form input,
.invitation-card input {
  width: 100%;
  height: 2.5rem;
  padding: 0 0.75rem;
  border: 1px solid var(--input);
  border-radius: var(--radius);
  background: var(--background);
}

.activation-form__primary,
.activation-form__secondary {
  min-height: 2.5rem;
  border-radius: var(--radius);
  font-weight: 650;
  cursor: pointer;
}

.activation-form__primary {
  border: 1px solid var(--primary);
  background: var(--primary);
  color: white;
}

.activation-form__secondary {
  border: 1px solid var(--border-strong);
  background: white;
  color: var(--foreground);
}

.activation-form__primary:disabled,
.activation-form__secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.invitation-card {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid var(--border);
  background: var(--muted);
}

.invitation-card div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border);
}

.invitation-card div span {
  color: var(--muted-foreground);
  font-size: 0.75rem;
}

.invitation-card div strong {
  color: var(--foreground);
  font-size: 0.8125rem;
}

.activation-panel__error {
  margin: 0.875rem 0 0;
  color: var(--destructive);
}

.activation-panel__notice {
  margin: 0.875rem 0 0;
  padding: 0.625rem 0.75rem;
  background: var(--warning-soft);
  color: var(--warning);
}

input:focus-visible {
  border-color: var(--ring);
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 50%, transparent);
}
</style>
