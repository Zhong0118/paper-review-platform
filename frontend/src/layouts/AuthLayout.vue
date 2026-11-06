<script setup lang="ts">
/**
 * 登录页外框（R3-5，U4 计划 §19.10）：左侧品牌区用主色，右侧放登录表单；窄屏品牌区收为顶部一条。
 * 颜色全部来自令牌；标题用宋体（与阅读稿同一字体），是这一页唯一的强调。
 */
import BrandMark from '@/components/app/BrandMark.vue'
</script>

<template>
  <div class="auth-layout">
    <section class="auth-layout__context" aria-label="平台介绍">
      <BrandMark subtitle="让每一次评审都可追溯、可信赖" />
      <div class="auth-layout__statement">
        <h1>身份隔离，意见抵达。</h1>
        <p>覆盖论文提交、匿名核验、专家评阅与结果发布的完整闭环。学校看不到专家是谁，专家看不到作者是谁。</p>
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
  min-height: 100svh;
  grid-template-columns: minmax(20rem, 0.85fr) minmax(24rem, 1.15fr);
  background: var(--background);
  color: var(--foreground);
  font-family: var(--app-font);
}

.auth-layout__context {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(2rem, 5vw, 4.5rem);
  background: var(--primary);
  color: var(--primary-foreground);
}

.auth-layout__context :deep(.brand) {
  color: var(--primary-foreground);
}

.auth-layout__context :deep(.brand__copy small) {
  color: color-mix(in srgb, var(--primary-foreground) 72%, transparent);
}

.auth-layout__statement {
  max-width: 30rem;
}

.auth-layout__statement h1 {
  margin: 0 0 1.25rem;
  font-family: var(--font-display);
  font-size: clamp(2.25rem, 4.6vw, 3.75rem);
  font-weight: 600;
  line-height: 1.2;
  text-wrap: balance;
}

.auth-layout__statement p {
  max-width: 28em;
  color: color-mix(in srgb, var(--primary-foreground) 78%, transparent);
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
    grid-template-rows: auto 1fr;
  }

  .auth-layout__context {
    gap: 1.25rem;
    padding: 1.5rem;
  }

  .auth-layout__statement h1 {
    margin-bottom: 0.5rem;
    font-size: 1.75rem;
  }

  /* 窄屏：表单紧跟品牌条，不在剩余高度里垂直居中 */
  .auth-layout__content {
    place-items: start center;
    padding-top: 2rem;
  }
}
</style>
