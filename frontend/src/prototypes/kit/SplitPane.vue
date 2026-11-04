<script setup lang="ts">
/**
 * 可调分栏：拖动或键盘（←/→ 每次 2%，Home/End 到边界）调整；右侧保证最小可读宽度。
 * 两侧独立滚动。窄屏由调用页改为分段切换，不在此压缩。
 */
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ initial?: number; minStart?: number; minEnd?: number; label?: string; stacked?: boolean }>(), {
  initial: 0.62,
  minStart: 360,
  minEnd: 380,
  label: '调整阅读区与输入区宽度',
})
const ratio = ref(props.initial)
const root = ref<HTMLElement | null>(null)
const percent = computed(() => Math.round(ratio.value * 100))

function clamp(next: number) {
  const width = root.value?.clientWidth ?? 1200
  const min = props.minStart / width
  const max = 1 - props.minEnd / width
  ratio.value = Math.min(Math.max(next, min), Math.max(min, max))
}
function onKey(event: KeyboardEvent) {
  const step = 0.02
  if (event.key === 'ArrowLeft') clamp(ratio.value - step)
  else if (event.key === 'ArrowRight') clamp(ratio.value + step)
  else if (event.key === 'Home') clamp(0)
  else if (event.key === 'End') clamp(1)
  else return
  event.preventDefault()
}
function onPointerDown(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  const move = (e: PointerEvent) => {
    const rect = root.value?.getBoundingClientRect()
    if (rect) clamp((e.clientX - rect.left) / rect.width)
  }
  const up = () => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', up)
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', up)
}
</script>

<template>
  <div ref="root" class="split" :class="{ 'split--stacked': stacked }" :style="stacked ? undefined : { gridTemplateColumns: `${percent}fr 9px ${100 - percent}fr` }">
    <section class="split__pane"><slot name="start" /></section>
    <div
      v-if="!stacked"
      class="split__handle"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent"
      @keydown="onKey"
      @pointerdown="onPointerDown"
    ><i /></div>
    <section class="split__pane"><slot name="end" /></section>
  </div>
</template>

<style scoped>
.split {
  display: grid;
  height: 100%;
  min-height: 0;
}
.split--stacked {
  grid-template-columns: minmax(0, 1fr);
}
.split--stacked .split__pane:has(> [style*='display: none']) {
  display: none;
}
.split__pane {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.split__handle {
  position: relative;
  display: grid;
  place-items: center;
  border-inline: 1px solid var(--ws-border);
  background: var(--ws-sunken);
  cursor: col-resize;
  touch-action: none;
}
.split__handle i {
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: var(--ws-border-strong);
}
.split__handle:hover i,
.split__handle:focus-visible i {
  background: var(--ws-action);
}
</style>
