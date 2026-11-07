<script setup lang="ts">
import type { NavigationItem } from '@/types/roles'

defineProps<{
  items: NavigationItem[]
  activePath?: string
}>()
</script>

<template>
  <aside class="sidebar" aria-label="主导航">
    <nav>
      <RouterLink
        v-for="item in items"
        :key="item.path"
        :to="item.path"
        class="sidebar__link"
        :aria-current="item.path === activePath ? 'page' : undefined"
      >
        <span>
          <strong>{{ item.label }}</strong>
          <small v-if="item.description">{{ item.description }}</small>
        </span>
        <span v-if="item.badge !== undefined" class="sidebar__badge">{{ item.badge }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 15rem;
  min-height: calc(100vh - 4rem);
  padding: 1rem 0.75rem;
  border-right: 1px solid #dfe5ea;
  background: #f8fafb;
}

.sidebar nav {
  display: grid;
  gap: 0.25rem;
}

.sidebar__link {
  display: flex;
  min-height: 2.875rem;
  gap: 0.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.75rem;
  border-left: 3px solid transparent;
  color: #52616e;
  text-decoration: none;
  transition:
    color 120ms ease,
    background 120ms ease,
    border-color 120ms ease;
}

.sidebar__link:hover {
  background: #edf2f6;
  color: #123d6b;
}

.sidebar__link[aria-current='page'] {
  border-left-color: #1b4f8a;
  background: #e8f0f9;
  color: #123d6b;
}

.sidebar__link strong,
.sidebar__link small {
  display: block;
}

.sidebar__link strong {
  font-size: 0.875rem;
}

.sidebar__link small {
  margin-top: 0.125rem;
  color: #7b8791;
  font-size: 0.6875rem;
}

.sidebar__badge {
  min-width: 1.5rem;
  padding: 0.125rem 0.375rem;
  border-radius: 999px;
  background: #dce8f4;
  font-family: var(--font-data);
  font-size: 0.6875rem;
  text-align: center;
}

@media (max-width: 900px) {
  .sidebar {
    width: 100%;
    min-height: auto;
    overflow-x: auto;
    padding: 0.5rem;
    border-right: 0;
    border-bottom: 1px solid #dfe5ea;
  }

  .sidebar nav {
    display: flex;
    width: max-content;
  }

  .sidebar__link {
    min-width: max-content;
    border-bottom: 3px solid transparent;
    border-left: 0;
  }

  .sidebar__link[aria-current='page'] {
    border-bottom-color: #1b4f8a;
  }
}
</style>
