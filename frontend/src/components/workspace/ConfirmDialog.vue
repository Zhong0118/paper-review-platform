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
.dlg {
  /* 全局 preflight 把所有元素 margin 清零，原生 dialog 会贴到左上角；这里恢复居中 */
  margin: auto;
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  padding: 0;
  border: 1px solid var(--ws-border);
  border-radius: 10px;
  box-shadow: var(--ws-shadow-float);
  color: var(--ws-text);
  font-family: var(--ws-font);
  font-size: 14px;
}
.dlg--wide {
  width: min(640px, calc(100vw - 32px));
}
.dlg::backdrop {
  background: var(--ws-scrim);
}
.dlg__head {
  padding: 16px 20px 0;
}
.dlg__head h2 {
  font-size: 17px;
  font-weight: 600;
}
.dlg__body {
  display: grid;
  gap: 12px;
  padding: 12px 20px 16px;
  line-height: 1.65;
}
.dlg__foot {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-page);
  border-radius: 0 0 10px 10px;
}
</style>
