<script setup lang="ts">
import BrandMark from '@/components/app/BrandMark.vue'
</script>

<template>
  <div class="auth-layout">
    <section class="auth-layout__context" aria-label="平台介绍">
      <BrandMark subtitle="让每一次评审都可追溯、可信赖" />
      <div class="auth-layout__statement">
        <p>DOUBLE-BLIND REVIEW</p>
        <h1>身份隔离，意见抵达。</h1>
        <span>覆盖论文提交、匿名核验、专家评阅与结果发布的完整闭环。</span>
      </div>
    </section>
    <main class="auth-layout__content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.auth-layout {
  display: grid;
  min-height: 100vh;
  grid-template-columns: minmax(20rem, 0.85fr) minmax(24rem, 1.15fr);
  background: var(--color-paper);
}

.auth-layout__context {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(2rem, 5vw, 5rem);
  background:
    linear-gradient(rgb(17 55 91 / 0.94), rgb(17 55 91 / 0.96)),
    repeating-linear-gradient(90deg, transparent 0 47px, rgb(255 255 255 / 0.06) 48px);
}

.auth-layout__context :deep(.brand) {
  color: white;
}

.auth-layout__context :deep(.brand__copy small) {
  color: #c9d8e7;
}

.auth-layout__statement {
  max-width: 34rem;
  color: white;
}

.auth-layout__statement p {
  font-family: var(--font-data);
  font-size: 0.6875rem;
  letter-spacing: 0.18em;
}

.auth-layout__statement h1 {
  margin: 1rem 0;
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 5vw, 4.25rem);
  font-weight: 600;
  line-height: 1.15;
}

.auth-layout__statement span {
  color: #d5e0eb;
  line-height: 1.8;
}

.auth-layout__content {
  display: grid;
  min-width: 0;
  place-items: center;
  padding: clamp(1.5rem, 4vw, 4rem);
}

@media (max-width: 800px) {
  .auth-layout {
    grid-template-columns: 1fr;
  }

  .auth-layout__context {
    min-height: 17rem;
    padding: 1.5rem;
  }
}
</style>
