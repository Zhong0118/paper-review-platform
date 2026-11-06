<script setup lang="ts">
import { GripVertical } from '@lucide/vue'
import { nextTick, ref, useId } from 'vue'
import type { useColumnPreferences } from '@/composables/useColumnPreferences'

const props = defineProps<{ preferences: ReturnType<typeof useColumnPreferences>; label: string }>()
const open = ref(false), trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const panelId = useId()
let dragged: string | null = null
async function move(id: string, index: number) {
  props.preferences.move(id, index)
  await nextTick()
  Array.from(panel.value?.querySelectorAll<HTMLElement>('[data-column-option]') ?? [])
    .find(el => el.dataset.columnOption === id)?.focus()
}
function startDrag(event: DragEvent, id: string) {
  dragged = id
  event.dataTransfer?.setData('text/plain', id)
}
function drop(index: number) {
  if (dragged) void move(dragged, index)
  dragged = null
}
async function close() {
  open.value = false
  await nextTick()
  trigger.value?.focus()
}
</script>

<template>
  <div class="column-preferences">
    <button ref="trigger" type="button" data-column-settings :aria-expanded="open" :aria-controls="panelId" @click="open = !open">设置显示列</button>
    <Transition name="column-panel">
      <section v-if="open" :id="panelId" ref="panel" class="column-panel" data-column-panel :aria-label="`${label}列设置`" @keydown.esc.stop="close">
        <header><strong>{{ label }}列设置</strong><button type="button" @click="close">关闭</button></header>
        <p>拖动或使用上下移调整顺序 必要列始终显示 操作列固定在最后</p>
        <TransitionGroup name="column-option" tag="ul">
          <li v-for="(column, index) in preferences.orderedColumns.value" :key="column.id" :data-column-option="column.id" tabindex="0"
            @dragover.prevent @drop.prevent="drop(index)"
            @keydown.up.prevent="move(column.id, index - 1)" @keydown.down.prevent="move(column.id, index + 1)">
            <span :draggable="column.id !== 'actions'" :data-column-drag="column.id" class="drag-handle" aria-hidden="true" @dragstart="startDrag($event, column.id)" @dragend="dragged = null"><GripVertical /></span>
            <label><input type="checkbox" :data-column-toggle="column.id" :checked="preferences.visibleColumns.value.some(c => c.id === column.id)" :disabled="column.required || column.id === 'actions'" @change="preferences.setVisible(column.id, ($event.target as HTMLInputElement).checked)">{{ column.label }}</label>
            <button type="button" :disabled="index === 0 || column.id === 'actions'" :aria-label="`上移${column.label}`" @click="move(column.id, index - 1)">上移</button>
            <button type="button" :disabled="column.id === 'actions' || index >= preferences.orderedColumns.value.length - 2" :aria-label="`下移${column.label}`" @click="move(column.id, index + 1)">下移</button>
          </li>
        </TransitionGroup>
        <p v-if="preferences.storageError.value" role="status">浏览器未能保存设置 当前选择仅在本次页面有效</p>
        <button type="button" data-reset-columns @click="preferences.reset">恢复默认列</button>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.column-preferences { margin: .6rem 0; font-size: .75rem; }
button { border: 1px solid #cbd8e3; border-radius: .3rem; background: white; color: #1b4f8a; padding: .35rem .65rem; cursor: pointer; transition: transform .15s, background .15s; }
button:hover:not(:disabled) { background: #edf4fc; transform: translateY(-1px); }
button:active:not(:disabled) { transform: scale(.97); }
button:disabled { opacity: .45; cursor: default; }
.column-panel { max-width: 32rem; margin-top: .5rem; padding: .8rem; background: white; border: 1px solid #cbd8e3; border-radius: .4rem; }
header, li { display: flex; align-items: center; gap: .5rem; }
header { justify-content: space-between; }
p { color: #617181; line-height: 1.6; }
ul { padding: 0; list-style: none; }
li { padding: .4rem 0; border-bottom: 1px solid #edf1f4; transition: background .15s; }
li:focus { outline: 2px solid #6192cc; outline-offset: 2px; }
label { display: flex; align-items: center; flex: 1; gap: .4rem; }
.drag-handle svg { width: 1rem; height: 1rem; }
.drag-handle { cursor: grab; color: #617181; padding: .3rem; }
.column-panel-enter-active, .column-panel-leave-active, .column-option-move { transition: opacity .18s, transform .18s; }
.column-panel-enter-from, .column-panel-leave-to { opacity: 0; transform: translateY(-.4rem); }
@media (prefers-reduced-motion: reduce) { *, .column-panel-enter-active, .column-panel-leave-active, .column-option-move { transition: none; } }
</style>
