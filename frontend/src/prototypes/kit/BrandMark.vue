<script setup lang="ts">
/** 品牌：两条分隔竖线象征“双向盲审”的两侧隔离，克制不装饰。 */
defineProps<{ subtitle?: string }>()
</script>

<template>
  <span class="brand">
    <span class="brand__mark" aria-hidden="true"><i /><i /></span>
    <span class="brand__name">百杰校审</span>
    <span v-if="subtitle" class="brand__sub">{{ subtitle }}</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}
.brand__mark {
  display: inline-flex;
  gap: 3px;
  height: 18px;
}
.brand__mark i {
  width: 4px;
  border-radius: 1px;
  background: var(--ws-action);
}
.brand__mark i + i {
  opacity: 0.45;
}
.brand__name {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.brand__sub {
  overflow: hidden;
  color: var(--ws-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
