<script setup lang="ts">
import BrandMark from './BrandMark.vue'

const props = withDefaults(
  defineProps<{
    contextLabel?: string
    userName?: string
    demoMode?: boolean
  }>(),
  {
    contextLabel: '',
    userName: '演示用户',
    demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
  },
)
</script>

<template>
  <header class="app-header">
    <BrandMark compact />
    <span v-if="contextLabel" class="app-header__context">{{ contextLabel }}</span>
    <div class="app-header__actions">
      <slot name="actions" />
      <RouterLink
        v-if="props.demoMode"
        class="app-header__switch"
        data-action="switch-demo-role"
        to="/login"
      >
        切换演示角色
      </RouterLink>
      <span class="app-header__user">{{ userName }}</span>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  min-height: 4rem;
  gap: 1rem;
  align-items: center;
  padding: 0 1.25rem;
  border-bottom: 1px solid #dfe5ea;
  background: rgb(255 255 255 / 0.94);
  backdrop-filter: blur(10px);
}

.app-header__context {
  padding-left: 1rem;
  border-left: 1px solid #dce3e9;
  color: #596875;
  font-size: 0.8125rem;
}

.app-header__actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-left: auto;
}

.app-header__user {
  color: #33414d;
  font-size: 0.8125rem;
  font-weight: 600;
}

.app-header__switch {
  padding: 0.3rem 0.55rem;
  border: 1px solid #c3ced7;
  border-radius: 0.3rem;
  color: #31526e;
  font-size: 0.7rem;
  text-decoration: none;
}
</style>
