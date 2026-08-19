<script setup lang="ts">
defineProps<{ waiting: number; reviewing: number; completed: number; overdue: number }>()
</script>

<template>
  <section class="progress-summary" aria-label="评审任务统计">
    <div><span>待平台派单</span><strong>{{ waiting }}</strong></div>
    <div><span>评阅中</span><strong>{{ reviewing }}</strong></div>
    <div><span>已完成</span><strong>{{ completed }}</strong></div>
    <div class="is-alert"><span>已逾期</span><strong>{{ overdue }}</strong></div>
  </section>
</template>

<style scoped>
.progress-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid #dce3e9; background: white; }
.progress-summary div { padding: 0.9rem 1rem; border-right: 1px solid #e3e8ec; }
.progress-summary div:last-child { border-right: 0; }
.progress-summary span, .progress-summary strong { display: block; }
.progress-summary span { color: #74818c; font-size: 0.7rem; }
.progress-summary strong { margin-top: 0.15rem; color: #263744; font-family: var(--font-data); font-size: 1.5rem; }
.progress-summary .is-alert strong { color: #a33c13; }
@media (max-width: 620px) { .progress-summary { grid-template-columns: repeat(2, 1fr); } }
</style>
