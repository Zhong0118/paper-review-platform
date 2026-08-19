<script setup lang="ts">
defineProps<{ average: number; conclusion: string; published?: boolean }>()
</script>
<template><section class="result-summary"><div><span>综合平均分</span><strong>{{ average.toFixed(1) }}</strong></div><div><span>汇总结论</span><strong>{{ conclusion }}</strong></div><div><span>发布状态</span><strong>{{ published ? '已发布' : '待学校发布' }}</strong></div></section></template>
<style scoped>.result-summary{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dce3e9;background:white}.result-summary div{padding:1rem;border-right:1px solid #e3e8ec}.result-summary div:last-child{border-right:0}.result-summary span,.result-summary strong{display:block}.result-summary span{color:#74818c;font-size:.7rem}.result-summary strong{margin-top:.2rem;color:#263744;font-family:var(--font-display);font-size:1.15rem}.result-summary div:first-child strong{color:#1b4f8a;font-family:var(--font-data);font-size:1.65rem}</style>
