<script setup lang="ts">
/**
 * 专注工作空间：收起全局导航，单行任务栏 + 全高工作区。
 * 任务身份、期限、保存状态与返回常驻任务栏；正文区由页面自行分栏。
 */
import AccountMenu from './AccountMenu.vue'
import type { WorkspaceAccount } from './types'

defineProps<{ account: WorkspaceAccount }>()
</script>

<template>
  <div class="focus">
    <header class="focus__bar">
      <div class="focus__back"><slot name="back" /></div>
      <div class="focus__id"><slot name="identity" /></div>
      <div class="focus__end">
        <slot name="status" />
        <AccountMenu :account="account" compact />
      </div>
    </header>
    <div class="focus__body"><slot /></div>
  </div>
</template>

<style scoped>
.focus {
  display: grid;
  grid-template-rows: var(--ws-bar) minmax(0, 1fr);
  grid-template-columns: minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
}
.focus__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.focus__back {
  flex: none;
}
.focus__id {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 12px;
}
.focus__end {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
}
@media (max-width: 640px) {
  .focus__bar,
  .focus__id,
  .focus__end {
    gap: 8px;
  }
  .focus__bar {
    padding: 0 8px;
  }
}
.focus__body {
  min-height: 0;
}
</style>
