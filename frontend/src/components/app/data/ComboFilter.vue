<script setup lang="ts">
/**
 * 可搜索的单选筛选（v3 §8.1 Combobox）：学科、省份、学校、专业等长列表。
 * 选项只来自调用方（服务端限定），不能自由输入新值。覆盖加载、错误重试、无选项、无匹配、长标签、清除、禁用。
 */
import { Check, ChevronDown } from '@lucide/vue'
import { computed, ref } from 'vue'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface ComboOption {
  value: string
  label: string
  hint?: string
}

const model = defineModel<string | null>({ default: null })
const props = withDefaults(
  defineProps<{
    label: string
    options: ComboOption[]
    placeholder?: string
    searchPlaceholder?: string
    loading?: boolean
    error?: string
    disabled?: boolean
    width?: string
  }>(),
  { placeholder: '', searchPlaceholder: '搜索', loading: false, error: '', disabled: false, width: 'w-[200px]' },
)
const emit = defineEmits<{ retry: [] }>()
const open = ref(false)
const current = computed(() => props.options.find((option) => option.value === model.value) ?? null)

function pick(value: string) {
  model.value = value === model.value ? null : value
  open.value = false
}
function clear() {
  model.value = null
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :aria-expanded="open"
        :aria-label="current ? `${label}：${current.label}` : label"
        :disabled="disabled"
        :class="[width, 'justify-between gap-1.5 px-3 font-normal', current ? 'text-foreground' : 'text-muted-foreground']"
        data-combo
      >
        <span class="truncate">{{ current ? current.label : placeholder || label }}</span>
        <ChevronDown class="size-4 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent class="w-[300px] p-0" align="start">
      <Command>
        <CommandInput :placeholder="searchPlaceholder" />
        <CommandList>
          <div v-if="loading" class="px-3 py-6 text-center text-sm text-muted-foreground" role="status">正在读取选项…</div>
          <div v-else-if="error" class="grid gap-2 px-3 py-4 text-sm" role="alert">
            <span class="text-destructive">{{ error }}</span>
            <Button size="sm" variant="outline" class="justify-self-start" @click="emit('retry')">重试</Button>
          </div>
          <div v-else-if="!options.length" class="px-3 py-6 text-center text-sm text-muted-foreground">没有可选项</div>
          <template v-else>
            <CommandEmpty>没有匹配的{{ label }}</CommandEmpty>
            <CommandGroup>
              <CommandItem v-for="option in options" :key="option.value" :value="`${option.label} ${option.hint ?? ''}`" class="items-start" @select="pick(option.value)">
                <Check :class="['mt-0.5 size-4 shrink-0', option.value === model ? 'opacity-100' : 'opacity-0']" />
                <span class="min-w-0 flex-1 break-words">{{ option.label }}</span>
                <span v-if="option.hint" class="tabular shrink-0 text-xs text-muted-foreground">{{ option.hint }}</span>
              </CommandItem>
            </CommandGroup>
            <template v-if="current">
              <CommandSeparator />
              <CommandGroup>
                <CommandItem value="__clear__" class="text-muted-foreground" @select="clear">清除{{ label }}筛选</CommandItem>
              </CommandGroup>
            </template>
          </template>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
