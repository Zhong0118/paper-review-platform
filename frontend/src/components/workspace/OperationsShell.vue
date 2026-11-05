<script setup lang="ts">
/**
 * 处理工作空间：稳定侧栏（约 220px，可收起）+ 52px 上下文栏 + 内容。
 * 侧栏只放业务目的地；窄于 960px 时侧栏变为抽屉。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import AccountMenu from './AccountMenu.vue'
import BrandMark from './WorkspaceBrandMark.vue'
import type { NavGroup, WorkspaceAccount } from './types'

defineProps<{ nav: NavGroup[]; account: WorkspaceAccount; org: string }>()
const collapsed = ref(false)
const drawer = ref(false)
const narrow = ref(false)
let media: MediaQueryList | null = null
const sync = () => {
  narrow.value = media?.matches ?? false
  if (!narrow.value) drawer.value = false
}
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  media = window.matchMedia('(max-width: 959px)')
  sync()
  media.addEventListener('change', sync)
})
onBeforeUnmount(() => media?.removeEventListener('change', sync))
function toggleNav() {
  if (narrow.value) drawer.value = !drawer.value
  else collapsed.value = !collapsed.value
}
</script>

<template>
  <div class="ops" :class="{ 'ops--collapsed': collapsed && !narrow, 'ops--narrow': narrow, 'ops--drawer': drawer }">
    <nav class="ops__side" aria-label="主导航">
      <div class="ops__brand"><BrandMark /></div>
      <p class="ops__org">{{ org }}</p>
      <div v-for="(group, index) in nav" :key="index" class="ops__group">
        <p v-if="group.label" class="ops__group-label">{{ group.label }}</p>
        <ul>
          <li v-for="item in group.items" :key="item.label">
            <component
              :is="item.to ? 'RouterLink' : 'span'"
              :to="item.to"
              class="ops__link"
              :class="{ 'ops__link--active': item.active, 'ops__link--static': !item.to }"
              :aria-current="item.active ? 'page' : undefined"
            >
              <span>{{ item.label }}</span>
              <span v-if="item.count !== undefined" class="ops__count num">{{ item.count }}</span>
            </component>
          </li>
        </ul>
      </div>
    </nav>
    <div v-if="drawer" class="ops__scrim" @click="drawer = false" />
    <div class="ops__main">
      <header class="ops__bar">
        <button
          type="button"
          class="ops__navbtn"
          :aria-label="narrow ? '打开导航' : collapsed ? '展开侧栏' : '收起侧栏'"
          :aria-expanded="narrow ? drawer : !collapsed"
          @click="toggleNav"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.4" /></svg>
        </button>
        <div class="ops__title"><slot name="title" /></div>
        <div class="ops__context"><slot name="context" /></div>
        <AccountMenu :account="account" :compact="narrow" />
      </header>
      <main class="ops__content"><slot /></main>
    </div>
  </div>
</template>

<style scoped>
.ops {
  display: grid;
  grid-template-columns: var(--ws-sidebar) minmax(0, 1fr);
  min-height: 100vh;
  transition: grid-template-columns var(--ws-motion);
}
.ops--collapsed,
.ops--narrow {
  grid-template-columns: 0 minmax(0, 1fr);
}
.ops__side {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden auto;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.ops--collapsed .ops__side {
  visibility: hidden;
}
.ops--narrow .ops__side {
  position: fixed;
  z-index: 60;
  width: 260px;
  transform: translateX(-100%);
  transition: transform var(--ws-motion);
}
.ops--drawer .ops__side {
  transform: none;
  box-shadow: var(--ws-shadow-float);
}
.ops__scrim {
  position: fixed;
  z-index: 50;
  inset: 0;
  background: var(--ws-scrim);
}
.ops__brand {
  display: flex;
  height: var(--ws-bar);
  align-items: center;
  padding: 0 16px;
}
.ops__org {
  margin: 0 16px 12px;
  color: var(--ws-muted);
  font-size: 12px;
}
.ops__group {
  padding: 4px 8px 12px;
}
.ops__group-label {
  margin: 4px 8px 6px;
  color: var(--ws-faint);
  font-size: 12px;
}
.ops__group ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ops__link {
  display: flex;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 10px;
  border-radius: var(--ws-radius);
  color: var(--ws-text);
  text-decoration: none;
}
.ops__link:hover {
  background: var(--ws-sunken);
}
.ops__link--static {
  color: var(--ws-muted);
}
.ops__link--static:hover {
  background: transparent;
}
.ops__link--active {
  background: var(--ws-action-soft);
  color: var(--ws-action);
  font-weight: 600;
}
.ops__link--active:hover {
  background: var(--ws-action-soft);
}
.ops__count {
  min-width: 22px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--ws-sunken);
  color: var(--ws-muted);
  font-size: 12px;
  text-align: center;
}
.ops__link--active .ops__count {
  background: var(--ws-surface);
  color: var(--ws-action);
}
.ops__main {
  /* 窄屏时侧栏改为 fixed 抽屉、脱离网格，主区须固定在第 2 列，否则会落进 0 宽的第 1 列 */
  grid-column: 2;
  min-width: 0;
}
.ops__bar {
  position: sticky;
  z-index: 30;
  top: 0;
  display: flex;
  height: var(--ws-bar);
  align-items: center;
  gap: 12px;
  padding: 0 16px 0 8px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.ops__navbtn {
  display: grid;
  width: 34px;
  height: 34px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.ops__navbtn:hover {
  background: var(--ws-sunken);
}
.ops__title {
  flex: none;
  max-width: 50%;
  min-width: 0;
}
.ops__context {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}
.ops__content {
  min-width: 0;
}
</style>
