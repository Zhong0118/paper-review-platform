<script setup lang="ts">
/**
 * 工作视图切换（参考 Linear 的视图、Attio 的视图选择）：短名称＋真实计数；计数未知（加载中/失败）时不显示 0。
 * 选中态是低对比填充＋字重，不用整块品牌色。
 * select 每次点击都发（包括再点当前视图），给“已选再点＝刷新”的页面用；attrs 给单个视图挂测试或下钻钩子。
 * size="sm"：给清单栏这类窄位置用，较小、不换行，放不下时横向滚动（F1 · A2，v3 §8.1 不挤成多行）。
 */
export interface ViewOption {
  value: string
  label: string
  count?: number
  attrs?: Record<string, string>
}
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ views: ViewOption[]; label: string; size?: 'default' | 'sm' }>(), { size: 'default' })
const emit = defineEmits<{ select: [value: string] }>()
function pick(value: string) {
  model.value = value
  emit('select', value)
}
</script>

<template>
  <div
    class="flex items-center"
    :class="size === 'sm' ? 'flex-nowrap gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden' : 'flex-wrap gap-1'"
    role="group"
    :aria-label="label"
    data-view-tabs
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
