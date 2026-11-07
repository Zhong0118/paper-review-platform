<script setup lang="ts">
defineProps<{
  title: string
  taskCode: string
}>()
</script>

<template>
  <div class="review-layout">
    <header class="review-layout__header">
      <div>
        <span>{{ taskCode }}</span>
        <h1>{{ title }}</h1>
      </div>
      <div class="review-layout__actions"><slot name="actions" /></div>
    </header>
    <aside class="review-layout__rail" aria-label="双盲提示">
      评阅材料仅包含匿名论文信息；请勿在评语中填写可识别个人身份的内容。
    </aside>
    <main class="review-layout__workspace">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.review-layout {
  display: grid;
  width: 100%;
  min-height: 100vh;
  grid-template-rows: auto auto 1fr;
  background: #e9eef2;
}

.review-layout__header {
  display: flex;
  min-height: 4.25rem;
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid #d5dde4;
  background: white;
}

.review-layout__header span {
  color: #687682;
  font-family: var(--font-data);
  font-size: 0.6875rem;
}

.review-layout__header h1 {
  margin: 0.125rem 0 0;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.review-layout__rail {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #c7d0d8;
  background: #5b6b7a;
  color: white;
  font-size: 0.75rem;
}

.review-layout__workspace {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
