<script setup lang="ts">
import type { NavigationItem } from '@/types/roles'

import { useAuthStore } from '@/stores/auth'
import AppHeader from '@/components/app/AppHeader.vue'

const props = withDefaults(
  defineProps<{
    menuItems: NavigationItem[]
    activePath?: string
    contextLabel?: string
    userName?: string
    backgroundLocked?: boolean
  }>(),
  { backgroundLocked: false },
)

const demoEnabled=import.meta.env.VITE_DEMO_MODE==='true'
const auth=demoEnabled ? undefined : useAuthStore()

function blockBackgroundInteraction(event: Event) {
  if (!props.backgroundLocked) return
  event.preventDefault()
  event.stopPropagation()
  if (event.type === 'focusin' && event.target instanceof HTMLElement) event.target.blur()
}
</script>

<template>
  <div class="portal-layout">
    <div
      class="portal-layout__background"
      :inert="backgroundLocked || undefined"
      :aria-hidden="backgroundLocked ? 'true' : undefined"
      @click.capture="blockBackgroundInteraction"
      @focusin.capture="blockBackgroundInteraction"
      @keydown.capture="blockBackgroundInteraction"
    >
      <AppHeader :context-label="contextLabel" :user-name="demoEnabled ? userName : (auth?.user?.displayName || '身份未取得')" />
      <nav class="portal-layout__nav" aria-label="主导航">
        <RouterLink
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :aria-current="item.path === activePath ? 'page' : undefined"
        >
          {{ item.label }}
        </RouterLink>
      </nav>
      <main class="portal-layout__content">
        <slot />
      </main>
    </div>
    <slot name="modal" />
  </div>
</template>

<style scoped>
.portal-layout {
  width: 100%;
  min-height: 100vh;
  background: var(--color-page);
}

.portal-layout__background {
  min-height: 100vh;
}

.portal-layout__nav {
  display: flex;
  gap: 1.25rem;
  overflow-x: auto;
  padding: 0 1.25rem;
  border-bottom: 1px solid #dfe5ea;
  background: white;
}

.portal-layout__nav a {
  padding: 0.875rem 0.25rem 0.75rem;
  border-bottom: 3px solid transparent;
  color: #5c6975;
  font-size: 0.8125rem;
  text-decoration: none;
  white-space: nowrap;
}

.portal-layout__nav a[aria-current='page'] {
  border-bottom-color: #1b4f8a;
  color: #123d6b;
  font-weight: 700;
}

.portal-layout__content {
  width: 100%;
  padding: clamp(1rem, 2.5vw, 2.5rem);
}
</style>
