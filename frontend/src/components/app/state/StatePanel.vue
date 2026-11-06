<script setup lang="ts">
/**
 * 状态说明（v3 §11）：加载、空数据、筛选无结果、失败、不可见。失败不是“暂无数据”。
 * 原位显示，可恢复动作放在 actions 插槽；不弹 Toast 重复报错。
 */
import { CircleAlert, Inbox, LoaderCircle, Lock, SearchX } from '@lucide/vue'
import { computed } from 'vue'

const props = withDefaults(defineProps<{ kind: 'loading' | 'empty' | 'noresult' | 'error' | 'forbidden'; title: string; compact?: boolean }>(), { compact: false })
const icon = computed(() => ({ loading: LoaderCircle, empty: Inbox, noresult: SearchX, error: CircleAlert, forbidden: Lock })[props.kind])
</script>

<template>
  <div
    :class="['grid justify-items-center gap-2 text-center', compact ? 'px-4 py-8' : 'px-6 py-16']"
    :role="kind === 'error' ? 'alert' : 'status'"
    :data-state-panel="kind"
  >
    <component :is="icon" :class="['size-6', kind === 'error' ? 'text-destructive' : 'text-faint', kind === 'loading' && 'animate-spin']" aria-hidden="true" />
    <p class="text-md font-medium text-foreground">{{ title }}</p>
    <div v-if="$slots.default" class="max-w-[46ch] text-base text-muted-foreground"><slot /></div>
    <div v-if="$slots.actions" class="mt-2 flex flex-wrap justify-center gap-2"><slot name="actions" /></div>
  </div>
</template>
