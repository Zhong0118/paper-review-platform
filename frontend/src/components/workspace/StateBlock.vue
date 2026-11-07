<script setup lang="ts">
/**
 * 统一数据区状态（规格 §10.3；R3-0 起与 StatePanel 同一外观，U4 计划 §19.1）：
 * 加载、空集合、筛选无匹配、失败、不可见、冲突、未配置。失败与冲突用 role=alert；其余为 status。
 * 不显示 0 或“暂无”冒充失败。
 */
import { CircleAlert, Inbox, LoaderCircle, Lock, RefreshCcw, SearchX, Settings2 } from '@lucide/vue'

export type BlockKind = 'loading' | 'empty' | 'nomatch' | 'error' | 'forbidden' | 'conflict' | 'unconfigured'
const props = defineProps<{ kind: BlockKind; title: string; compact?: boolean }>()
const alerting = props.kind === 'error' || props.kind === 'conflict'
const ICON = { loading: LoaderCircle, empty: Inbox, nomatch: SearchX, error: CircleAlert, forbidden: Lock, conflict: RefreshCcw, unconfigured: Settings2 }
const TONE = { error: 'text-destructive', conflict: 'text-destructive', unconfigured: 'text-warning' } as Partial<Record<BlockKind, string>>
</script>

<template>
  <div
    class="block grid justify-items-center gap-2 text-center"
    :class="[`block--${kind}`, compact ? 'block--compact px-4 py-8' : 'px-6 py-16']"
    :role="alerting ? 'alert' : 'status'"
    :data-state-panel="kind"
  >
    <component :is="ICON[props.kind]" :class="['size-6', TONE[props.kind] ?? 'text-faint', kind === 'loading' && 'animate-spin']" aria-hidden="true" />
    <p class="text-md font-medium text-foreground">{{ title }}</p>
    <div v-if="$slots.default" class="grid max-w-[46ch] gap-1 text-base text-muted-foreground"><slot /></div>
    <div v-if="$slots.actions" class="mt-2 flex flex-wrap justify-center gap-2"><slot name="actions" /></div>
  </div>
</template>
