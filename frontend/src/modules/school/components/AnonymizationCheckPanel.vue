<script setup lang="ts">
defineProps<{ pass: number; reviewRequired: number; failed: number }>()
</script>

<template>
  <aside class="check-panel" aria-label="匿名化检测概览">
    <div><span>自动通过</span><strong>{{ pass }}</strong></div>
    <div><span>需人工复核</span><strong>{{ reviewRequired }}</strong></div>
    <div><span>检测失败</span><strong>{{ failed }}</strong></div>
  </aside>
</template>

<style scoped>
.check-panel { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid #dce3e9; background: white; }
.check-panel div { padding: 0.8rem 1rem; border-right: 1px solid #e3e8ec; }
.check-panel div:last-child { border-right: 0; }
.check-panel span, .check-panel strong { display: block; }
.check-panel span { color: #74818c; font-size: 0.7rem; }
.check-panel strong { margin-top: 0.15rem; color: #263744; font-family: var(--font-data); font-size: 1.35rem; }
</style>
