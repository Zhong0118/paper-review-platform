<script setup lang="ts">
/**
 * 工作视图切换（参考 Linear 的视图、Attio 的视图选择）：短名称＋真实计数；计数未知（加载中/失败）时不显示 0。
 * 选中态是低对比填充＋字重，不用整块品牌色。
 * select 每次点击都发（包括再点当前视图），给“已选再点＝刷新”的页面用；attrs 给单个视图挂测试或下钻钩子。
 * size="sm"：给清单栏这类窄位置用，较小、不换行，放不下时横向滚动（F1 · A2，v3 §8.1 不挤成多行）。
 * size="segmented"（G1-4）：等宽分段，计数在上、名称在下；DOM 里名称在前，朗读和文本仍是“待发布 2”。
 */
export interface ViewOption {
  value: string
  label: string
  count?: number
  attrs?: Record<string, string>
}
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ views: ViewOption[]; label: string; size?: 'default' | 'sm' | 'segmented' }>(), { size: 'default' })
const emit = defineEmits<{ select: [value: string] }>()
function pick(value: string) {
  model.value = value
  emit('select', value)
}
</script>

<template>
  <div
    v-if="size === 'segmented'"
    class="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-muted p-[3px]"
    role="group"
    :aria-label="label"
    data-view-tabs
    data-size="segmented"
  >
    <button
      v-for="view in views"
      :key="view.value"
      type="button"
      :aria-pressed="model === view.value"
      class="flex min-w-0 flex-col-reverse items-center justify-center rounded-sm px-1 py-1 text-xs leading-tight whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--border)]"
      :data-view="view.value"
      v-bind="view.attrs"
      @click="pick(view.value)"
    >
      {{ view.label }}
      <span v-if="view.count !== undefined" class="tabular text-base leading-snug font-semibold text-foreground">{{ view.count }}</span>
    </button>
  </div>
  <div
    v-else
    class="flex items-center"
    :class="size === 'sm' ? 'flex-nowrap gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap gap-1'"
    role="group"
    :aria-label="label"
    data-view-tabs
    :data-size="size"
  >
    <button
      v-for="view in views"
      :key="view.value"
      type="button"
      :aria-pressed="model === view.value"
      class="inline-flex shrink-0 items-center rounded-md whitespace-nowrap text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-foreground"
      :class="size === 'sm' ? 'h-7 gap-1 px-2 text-sm' : 'h-8 gap-1.5 px-2.5 text-base'"
      :data-view="view.value"
      v-bind="view.attrs"
      @click="pick(view.value)"
    >
      {{ view.label }}
      <span v-if="view.count !== undefined" class="tabular text-faint" :class="size === 'sm' ? 'text-xs' : 'text-sm'">{{ view.count }}</span>
    </button>
  </div>
</template>
