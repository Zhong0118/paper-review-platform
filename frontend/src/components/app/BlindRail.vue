<script setup lang="ts">
defineProps<{
  audience: string
  hiddenFrom: string
  stage?: string
}>()
</script>

<template>
  <aside class="blind-rail" aria-label="双盲信息范围">
    <span class="blind-rail__mark" aria-hidden="true">双盲</span>
    <span><b>当前可见：</b>{{ audience }}</span>
    <span class="blind-rail__divider" aria-hidden="true" />
    <span><b>身份隔离：</b>{{ hiddenFrom }}</span>
    <span v-if="stage" class="blind-rail__stage">{{ stage }}</span>
  </aside>
</template>

<style scoped>
.blind-rail {
  display: flex;
  min-height: 2.75rem;
  flex-wrap: wrap;
  gap: 0.5rem 0.875rem;
  align-items: center;
  padding: 0.625rem 0.875rem;
  border: 1px solid #d7dee4;
  border-left: 4px solid var(--color-blind-rail);
  background: var(--color-blind-rail-soft);
  color: #4b5966;
  font-size: 0.8125rem;
}

.blind-rail__mark {
  padding: 0.15rem 0.4rem;
  border-radius: 0.25rem;
  background: var(--color-blind-rail);
  color: white;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.blind-rail__divider {
  width: 1px;
  height: 1rem;
  background: #c3cdd5;
}

.blind-rail__stage {
  margin-left: auto;
  font-family: var(--font-data);
  color: #33414d;
}

@media (max-width: 640px) {
  .blind-rail__divider {
    display: none;
  }

  .blind-rail__stage {
    width: 100%;
    margin-left: 0;
  }
}
</style>
