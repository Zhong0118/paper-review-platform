<script setup lang="ts">
import type { TimeScope, TimeScopeMeta } from '@/api/timeScope'
defineProps<{ modelValue: TimeScope; meta?: TimeScopeMeta | null; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
function date(value: string) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(value)) }
</script>
<template>
  <section class="time-scope">
    <label>论文与评阅列表范围
      <select :value="modelValue" :disabled="disabled" data-time-scope @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option value="all">全部</option><option value="past_year">近一年</option>
      </select>
    </label>
    <p>日期依据：论文创建日（北京时间）。<template v-if="modelValue === 'past_year' && meta?.from">从 {{ date(meta.from) }} 00:00 至本次查询时间。</template></p>
    <p v-if="modelValue === 'past_year'" role="note">较早建立论文的未结任务可能未显示，可切换全部。</p>
  </section>
</template>
<style scoped>
.time-scope { display: grid; gap: .4rem; padding: .8rem 1rem; background: #f4f7fa; border: 1px solid #dce3e9; }
label { display: flex; gap: .8rem; align-items: center; font-size: .85rem; } select { padding: .35rem .7rem; } p { margin: 0; font-size: .75rem; color: #53636f; }
</style>
