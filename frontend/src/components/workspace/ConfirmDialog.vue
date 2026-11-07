<script setup lang="ts">
/**
 * 真模态确认：原生 <dialog> showModal 提供焦点限制与 Esc；关闭后浏览器把焦点还给触发元素。
 * 确认按钮禁用条件由调用方传入，确认框不能绕过缺项或服务端门禁。
 */
import { nextTick, ref, watch } from 'vue'

/** busy：请求进行中，Esc 不关闭（否则对话框消失而请求仍在进行） */
const props = defineProps<{ open: boolean; title: string; wide?: boolean; busy?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    const el = dialog.value
    if (!el) return
    if (open && !el.open) el.showModal?.()
    if (!open && el.open) el.close()
  },
  { immediate: true },
)
</script>

<template>
  <dialog ref="dialog" class="dlg" :class="{ 'dlg--wide': wide }" :aria-label="title" @cancel="busy && $event.preventDefault()" @close="emit('close')">
    <header class="dlg__head">
      <h2>{{ title }}</h2>
    </header>
    <div class="dlg__body"><slot /></div>
    <footer class="dlg__foot"><slot name="actions" /></footer>
  </dialog>
</template>

<style scoped>
/* R3-0：外观与 AlertDialog 一致（U4 计划 §19.1）——圆角 12、浮层阴影、24 内边距、页脚按钮右对齐无底色 */
.dlg {
  /* 全局 preflight 把所有元素 margin 清零，原生 dialog 会贴到左上角；这里恢复居中 */
  margin: auto;
  width: min(512px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--background);
  box-shadow: var(--shadow-float);
  color: var(--foreground);
  font-family: var(--app-font);
  font-size: var(--text-base, 14px);
}
.dlg[open] {
  display: grid;
  gap: 16px;
}
.dlg--wide {
  width: min(640px, calc(100vw - 32px));
}
.dlg::backdrop {
  background: color-mix(in srgb, var(--foreground) 30%, transparent);
}
.dlg__head h2 {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.dlg__body {
  display: grid;
  gap: 12px;
  line-height: 1.65;
}
.dlg__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
</style>
