<script setup lang="ts">
import { useRoute } from 'vue-router'

import PageHeader from '@/components/app/PageHeader.vue'

const route = useRoute()
</script>

<template>
  <section class="pending-page">
    <PageHeader
      :eyebrow="String(route.meta.pageId)"
      :title="String(route.name ?? '业务页面')"
      description="页面路由和角色边界已经建立，业务内容将在对应编码批次中接入。"
    />
    <div class="pending-page__sheet">
      <span>DESIGN IN PROGRESS</span>
      <p>当前页面已纳入甲方演示链路。</p>
    </div>
  </section>
</template>

<style scoped>
.pending-page {
  display: grid;
  gap: 1.5rem;
  padding: clamp(1rem, 2.5vw, 2.5rem);
}

.pending-page__sheet {
  min-height: 20rem;
  padding: 2rem;
  border: 1px dashed #b8c4ce;
  background: var(--color-paper);
}

.pending-page__sheet span {
  color: #697784;
  font-family: var(--font-data);
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
}

.pending-page__sheet p {
  color: #33414d;
  font-family: var(--font-display);
  font-size: 1.25rem;
}
</style>
