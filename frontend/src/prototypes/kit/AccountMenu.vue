<script setup lang="ts">
/**
 * 账户菜单（WAI-ARIA menu button）：只读本人信息 + 退出登录。
 * 不提供切换角色、头像上传或假邮箱；原型里“退出登录”只回到原型索引。
 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'

import type { ProtoAccount } from './types'

const props = defineProps<{ account: ProtoAccount; compact?: boolean }>()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const firstItem = ref<HTMLButtonElement | null>(null)
const router = useRouter()

async function toggle() {
  open.value = !open.value
  if (open.value) {
    await nextTick()
    firstItem.value?.focus()
  }
}
function close(returnFocus = true) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}
function onDocClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close(false)
}
document.addEventListener('click', onDocClick)
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function signOut() {
  close(false)
  void router.replace('/prototype')
}
const initial = props.account.name.slice(-1)
</script>

<template>
  <div ref="root" class="acct" @keydown.esc="close()">
    <button
      ref="trigger"
      type="button"
      class="acct__btn"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="`账户：${account.name}，${account.role}`"
      @click="toggle"
    >
      <span class="acct__avatar" aria-hidden="true">{{ initial }}</span>
      <span v-if="!compact" class="acct__who">
        <span>{{ account.name }}</span>
        <small>{{ account.role }}</small>
      </span>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
    </button>
    <div v-if="open" class="acct__menu" role="menu" aria-label="账户">
      <dl class="acct__info">
        <dt>姓名</dt><dd>{{ account.name }}</dd>
        <dt>用户名</dt><dd>{{ account.username }}</dd>
        <dt>当前身份</dt><dd>{{ account.role }}</dd>
        <dt>所属</dt><dd>{{ account.org }}</dd>
      </dl>
      <button ref="firstItem" type="button" role="menuitem" class="acct__item" @click="signOut">退出登录</button>
    </div>
  </div>
</template>

<style scoped>
.acct {
  position: relative;
}
.acct__btn {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-height: 36px;
  padding: 2px 8px 2px 2px;
  border: 1px solid transparent;
  border-radius: 18px;
  background: transparent;
  cursor: pointer;
}
.acct__btn:hover {
  border-color: var(--ws-border);
  background: var(--ws-surface);
}
.acct__avatar {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 50%;
  background: var(--ws-action-soft);
  color: var(--ws-action);
  font-size: 13px;
  font-weight: 600;
}
.acct__who {
  display: grid;
  text-align: left;
  line-height: 1.2;
}
.acct__who small {
  color: var(--ws-muted);
  font-size: 12px;
}
.acct__menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  right: 0;
  width: 248px;
  padding: 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
  box-shadow: var(--ws-shadow-float);
}
.acct__info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 0 0 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ws-border);
  font-size: 13px;
}
.acct__info dt {
  color: var(--ws-muted);
}
.acct__info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.acct__item {
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.acct__item:hover,
.acct__item:focus-visible {
  background: var(--ws-sunken);
}
</style>
