<script setup lang="ts">
export type LoginChannel = 'platform' | 'school' | 'activation'

defineProps<{ modelValue: LoginChannel }>()
const emit = defineEmits<{ 'update:modelValue': [value: LoginChannel] }>()

const channels: Array<{ value: LoginChannel; label: string }> = [
  { value: 'platform', label: '平台账号' },
  { value: 'school', label: '学校统一认证' },
  { value: 'activation', label: '激活受邀账号' },
]
</script>

<template>
  <div class="login-tabs" role="tablist" aria-label="登录方式">
    <button
      v-for="channel in channels"
      :id="`login-tab-${channel.value}`"
      :key="channel.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === channel.value"
      :aria-controls="`login-panel-${channel.value}`"
      :class="{ 'is-active': modelValue === channel.value }"
      :data-login-channel="channel.value"
      @click="emit('update:modelValue', channel.value)"
    >
      {{ channel.label }}
    </button>
  </div>
</template>

<style scoped>
.login-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}

.login-tabs button {
  position: relative;
  min-height: 3rem;
  padding: 0.625rem 0.35rem;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 0.8125rem;
  font-weight: 650;
  cursor: pointer;
}

.login-tabs button::after {
  position: absolute;
  right: 0.5rem;
  bottom: -1px;
  left: 0.5rem;
  height: 2px;
  background: transparent;
  content: '';
}

.login-tabs button.is-active {
  color: var(--primary);
}

.login-tabs button.is-active::after {
  background: var(--primary);
}

.login-tabs button:focus-visible {
  border-radius: var(--radius);
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ring) 60%, transparent);
}
</style>
