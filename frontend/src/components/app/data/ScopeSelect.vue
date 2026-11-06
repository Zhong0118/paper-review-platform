<script setup lang="ts">
/**
 * 时间范围（U4 计划 §19.2）：各页统一的原生 <select>，键盘与手机都用系统选择器。
 * 外观按令牌（与 shadcn 输入框同高同边框），`data-time-scope` 是测试与页面共用的钩子。
 */
import { ChevronDown } from '@lucide/vue'

defineProps<{ modelValue: string; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="relative inline-flex items-center">
    <span class="sr-only">论文范围</span>
    <select
      :value="modelValue"
      :disabled="disabled"
      class="h-(--control-h) appearance-none rounded-md border border-input bg-background pr-8 pl-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      data-time-scope
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="past_year">近一年（按论文创建日）</option>
      <option value="all">全部年份</option>
    </select>
    <ChevronDown class="pointer-events-none absolute right-2.5 size-4 text-muted-foreground" aria-hidden="true" />
  </label>
</template>
