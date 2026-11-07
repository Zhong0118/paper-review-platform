<script setup lang="ts">
import type { ReviewOutcome } from '@/api/results'

defineProps<{ outcome: ReviewOutcome; ruleVersion: string }>()
</script>

<template>
  <section class="outcome" data-outcome aria-label="评分档位">
    <strong>评分档位：{{ outcome.label }}</strong>
    <span>规则 {{ ruleVersion }}</span>
    <small v-if="outcome.code === 'REVISION_REQUIRED'">“修改后通过”是评分档位，不代表平台已验收修改稿。</small>
  </section>
</template>

<style scoped>
.outcome { display: flex; align-items: baseline; flex-wrap: wrap; gap: .5rem 1rem; padding: .8rem 1rem; border-left: 4px solid #1b4f8a; background: #f3f7fa; }
.outcome strong { color: #173f70; }
.outcome span, .outcome small { color: #52616e; font-size: .75rem; }
.outcome small { flex-basis: 100%; }
</style>
