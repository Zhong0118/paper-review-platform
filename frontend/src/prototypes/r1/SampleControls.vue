<script setup lang="ts">
/** 样板状态切换（只在原型里出现，虚线框标明不是产品界面） */
const model = defineModel<string>({ required: true })
defineProps<{ states: { value: string; label: string }[] }>()
</script>

<template>
  <div class="fixed bottom-[72px] left-1/2 z-40 sm:bottom-3 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg whitespace-nowrap border border-dashed border-border-strong bg-background/95 px-2 py-1 text-sm shadow-float" role="group" aria-label="样板状态（非产品界面）" data-sample-controls>
    <span class="shrink-0 px-1 text-xs text-faint">样板状态</span>
    <button
      v-for="s in states"
      :key="s.value"
      type="button"
      :aria-pressed="model === s.value"
      class="h-7 shrink-0 rounded-md px-2 text-muted-foreground hover:bg-muted aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
      @click="model = s.value"
    >
      {{ s.label }}
    </button>
  </div>
</template>
