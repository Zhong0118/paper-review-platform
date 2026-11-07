<script setup lang="ts">
/**
 * 工具栏（v3 §8.1）：固定层级——工作视图｜显示设置与页级动作 → 搜索与主要筛选 → 已选条件。
 * 空间足够时视图与工具同行；窄时按行换，不挤碎。已选条件可逐个移除，也可一次清除。
 */
import { X } from '@lucide/vue'

import { Button } from '@/components/ui/button'

export interface FilterChip {
  key: string
  label: string
}
defineProps<{ chips?: FilterChip[] }>()
const emit = defineEmits<{ remove: [key: string]; clear: [] }>()
</script>

<template>
  <div class="grid gap-3" data-filter-bar>
    <div v-if="$slots.views || $slots.display || $slots.actions" class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="min-w-0"><slot name="views" /></div>
      <div class="ml-auto flex items-center gap-2"><slot name="display" /><slot name="actions" /></div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <slot name="search" />
      <slot name="filters" />
      <template v-if="chips?.length">
        <span class="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
        <ul class="flex flex-wrap items-center gap-1.5" aria-label="已应用的筛选">
          <li v-for="chip in chips" :key="chip.key">
            <span class="inline-flex h-7 items-center gap-1 rounded-md border bg-muted/60 pr-1 pl-2 text-sm">
              <span class="max-w-[220px] truncate" :title="chip.label">{{ chip.label }}</span>
              <button
                type="button"
                class="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground"
                :aria-label="`移除筛选：${chip.label}`"
                @click="emit('remove', chip.key)"
              >
                <X class="size-3.5" />
              </button>
            </span>
          </li>
        </ul>
        <Button variant="ghost" size="sm" class="text-muted-foreground" @click="emit('clear')">清除筛选</Button>
      </template>
    </div>
  </div>
</template>
