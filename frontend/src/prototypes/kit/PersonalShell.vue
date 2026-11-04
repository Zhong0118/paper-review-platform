<script setup lang="ts">
/** 个人办理门户：精简顶部导航，内容围绕当前对象，居中版心。 */
import AccountMenu from './AccountMenu.vue'
import BrandMark from './BrandMark.vue'
import type { NavItem, ProtoAccount } from './types'

defineProps<{ nav: NavItem[]; account: ProtoAccount; width?: 'work' | 'reading' }>()
</script>

<template>
  <div class="personal">
    <header class="personal__bar">
      <div class="personal__inner">
        <BrandMark />
        <nav class="personal__nav" aria-label="主导航">
          <component
            :is="item.to ? 'RouterLink' : 'span'"
            v-for="item in nav"
            :key="item.label"
            :to="item.to"
            class="personal__link"
            :class="{ 'personal__link--active': item.active }"
            :aria-current="item.active ? 'page' : undefined"
            >{{ item.label }}</component
          >
        </nav>
        <AccountMenu :account="account" />
      </div>
    </header>
    <main class="personal__main" :class="`personal__main--${width ?? 'work'}`"><slot /></main>
  </div>
</template>

<style scoped>
.personal {
  min-height: 100vh;
}
.personal__bar {
  position: sticky;
  z-index: 30;
  top: 0;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.personal__inner {
  display: flex;
  height: 56px;
  max-width: 1040px;
  align-items: center;
  gap: 24px;
  margin: 0 auto;
  padding: 0 20px;
}
.personal__nav {
  display: flex;
  flex: 1;
  height: 100%;
  min-width: 0;
  gap: 4px;
  overflow-x: auto;
}
.personal__link {
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-bottom: 2px solid transparent;
  color: var(--ws-muted);
  text-decoration: none;
  white-space: nowrap;
}
.personal__link:hover {
  color: var(--ws-text);
}
.personal__link--active {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
.personal__main {
  margin: 0 auto;
  padding: 28px 20px 96px;
}
.personal__main--work {
  max-width: 1040px;
}
.personal__main--reading {
  max-width: 860px;
}
@media (max-width: 640px) {
  .personal__inner {
    gap: 12px;
    padding: 0 12px;
  }
  .personal__main {
    padding: 20px 14px 96px;
  }
}
</style>
