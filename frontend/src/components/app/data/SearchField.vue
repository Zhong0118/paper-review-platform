<script setup lang="ts">
/**
 * 搜索框：桌面起点 280px。中文输入法组合期间不更新模型（不每个键都过滤或改地址），组合结束再提交。
 */
import { Search, X } from '@lucide/vue'
import { ref } from 'vue'

const model = defineModel<string>({ default: '' })
withDefaults(defineProps<{ placeholder?: string; label: string }>(), { placeholder: '搜索' })
const composing = ref(false)
const input = ref<HTMLInputElement | null>(null)

function onInput(event: Event) {
  if (!composing.value) model.value = (event.target as HTMLInputElement).value
}
function onCompositionEnd(event: CompositionEvent) {
  composing.value = false
  model.value = (event.target as HTMLInputElement).value
}
function clear() {
  model.value = ''
  input.value?.focus()
}
</script>

<template>
  <div class="relative w-full sm:w-[280px]" data-search>
    <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    <input
      ref="input"
      type="search"
      :value="model"
      :aria-label="label"
      :placeholder="placeholder"
      class="h-9 w-full rounded-md border border-input bg-background pr-8 pl-8 text-base outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 [&::-webkit-search-cancel-button]:hidden"
      @input="onInput"
      @compositionstart="composing = true"
      @compositionend="onCompositionEnd"
      @keydown.esc="model ? clear() : undefined"
    />
    <button
      v-if="model"
      type="button"
      class="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="清除搜索"
      @click="clear"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
