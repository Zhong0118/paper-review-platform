<script setup lang="ts">
withDefaults(
  defineProps<{
    compact?: boolean
    subtitle?: string
  }>(),
  {
    compact: false,
    subtitle: '论文双盲评审管理平台',
  },
)
</script>

<template>
  <div class="brand" :class="{ 'brand--compact': compact }" aria-label="百杰论文盲审平台">
    <span class="brand__seal" aria-hidden="true">审</span>
    <span class="brand__copy">
      <strong>百杰盲审</strong>
      <small v-if="!compact">{{ subtitle }}</small>
    </span>
  </div>
</template>

<style scoped>
.brand {
  display: inline-flex;
  gap: 0.75rem;
  align-items: center;
  color: #123d6b;
}

.brand__seal {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 1px solid #1b4f8a;
  border-radius: 0.625rem 0.25rem 0.625rem 0.25rem;
  background: #1b4f8a;
  color: white;
  font-family: var(--font-display);
  font-size: 1.125rem;
  box-shadow: inset 0 0 0 3px rgb(255 255 255 / 0.16);
}

.brand__copy {
  display: grid;
  gap: 0.0625rem;
}

.brand__copy strong {
  font-family: var(--font-display);
  font-size: 1.125rem;
  letter-spacing: 0.08em;
}

.brand__copy small {
  color: #697784;
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
}

.brand--compact .brand__seal {
  width: 2rem;
  height: 2rem;
}
</style>
