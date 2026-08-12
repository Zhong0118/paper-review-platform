<script setup lang="ts">
defineProps<{ hit: boolean; reason?: string }>()
</script>

<template>
  <span v-if="hit" class="conflict conflict--hit">回避命中 · {{ reason }}</span>
  <span v-else class="conflict conflict--clear">未命中回避</span>
</template>

<style scoped>
.conflict { display: inline-flex; padding: 0.18rem 0.42rem; border: 1px solid; border-radius: 999px; font-size: 0.68rem; font-weight: 650; }
.conflict--hit { border-color: #e5b6b6; background: #fceded; color: #9c2929; }
.conflict--clear { border-color: #bcd9bf; background: #edf7ee; color: #27672d; }
</style>
