<script setup lang="ts">
import type { StudentScoreDimension } from '@/demo/types'

defineProps<{ dimensions: StudentScoreDimension[] }>()
</script>

<template>
  <section class="score-dimensions" aria-labelledby="score-dimensions-title">
    <header>
      <span>ASSESSMENT DIMENSIONS</span>
      <h2 id="score-dimensions-title">六维评分</h2>
    </header>
    <div class="score-dimensions__grid">
      <article v-for="dimension in dimensions" :key="dimension.key" data-score-dimension>
        <span>{{ dimension.label }}</span>
        <strong>{{ dimension.score.toFixed(1) }}</strong>
        <small>/ {{ dimension.maxScore }}</small>
      </article>
    </div>
  </section>
</template>

<style scoped>
.score-dimensions {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
}

.score-dimensions > header {
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--color-border);
}

.score-dimensions header span {
  color: var(--color-text-secondary);
  font-family: var(--font-data);
  font-size: 0.625rem;
  letter-spacing: 0.08em;
}

.score-dimensions h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-display);
  font-size: 1rem;
}

.score-dimensions__grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.score-dimensions article {
  min-width: 0;
  padding: 1rem;
  border-right: 1px solid var(--color-border);
}

.score-dimensions article:last-child {
  border-right: 0;
}

.score-dimensions article span,
.score-dimensions article strong,
.score-dimensions article small {
  display: block;
}

.score-dimensions article span,
.score-dimensions article small {
  color: var(--color-text-secondary);
  font-size: 0.6875rem;
}

.score-dimensions article strong {
  margin-top: 0.3rem;
  color: var(--color-primary);
  font-family: var(--font-data);
  font-size: 1.35rem;
}

@media (max-width: 800px) {
  .score-dimensions__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .score-dimensions article {
    border-bottom: 1px solid var(--color-border);
  }
}
</style>
