<script setup lang="ts">
import type { NavigationItem } from '@/types/roles'

import AppHeader from '@/components/app/AppHeader.vue'
import AppSidebar from '@/components/app/AppSidebar.vue'

const props = defineProps<{
  variant: 'school' | 'platform' | 'system'
  menuItems: NavigationItem[]
  activePath?: string
  userName?: string
}>()

const contextLabels = {
  school: '学校管理端',
  platform: '百杰运营端',
  system: '系统管理端',
}
</script>

<template>
  <div class="admin-layout" :data-variant="variant">
    <AppHeader :context-label="contextLabels[props.variant]" :user-name="userName">
      <template #actions><slot name="header-actions" /></template>
    </AppHeader>
    <div class="admin-layout__body">
      <AppSidebar :items="menuItems" :active-path="activePath" />
      <main class="admin-layout__content" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin-layout {
  width: 100%;
  min-height: 100vh;
  background: var(--color-page);
}

.admin-layout__body {
  display: flex;
  min-height: calc(100vh - 4rem);
}

.admin-layout__content {
  width: 100%;
  min-width: 0;
  padding: clamp(1rem, 2vw, 2rem);
}

@media (max-width: 900px) {
  .admin-layout__body {
    flex-direction: column;
  }
}
</style>
