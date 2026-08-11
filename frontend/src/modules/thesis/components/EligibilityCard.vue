<script setup lang="ts">
withDefaults(
  defineProps<{
    eligible?: boolean
    batchName: string
    deadline: string
  }>(),
  { eligible: true },
)
</script>

<template>
  <article class="eligibility" :data-eligible="eligible">
    <div class="eligibility__mark" aria-hidden="true">{{ eligible ? '✓' : '!' }}</div>
    <div>
      <span>提交资格</span>
      <h2>{{ eligible ? '已取得本批次提交资格' : '暂不符合提交条件' }}</h2>
      <p>{{ batchName }} · 截止 {{ deadline }}</p>
    </div>
  </article>
</template>

<style scoped>
.eligibility {
  display: flex;
  min-height: 8rem;
  gap: 1rem;
  align-items: center;
  padding: 1.25rem;
  border: 1px solid #c9ddcc;
  background: linear-gradient(135deg, #f5fbf6, #fff);
}

.eligibility__mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  background: #2e7d32;
  color: white;
  font-size: 1.25rem;
}

.eligibility span {
  color: #66746e;
  font-size: 0.75rem;
}

.eligibility h2 {
  margin: 0.25rem 0;
  color: #234f29;
  font-family: var(--font-display);
  font-size: 1.125rem;
}

.eligibility p {
  margin: 0;
  color: #64716a;
  font-size: 0.75rem;
}
</style>
