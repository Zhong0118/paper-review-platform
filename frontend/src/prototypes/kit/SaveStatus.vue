<script setup lang="ts">
/** 保存状态常驻显示；只有服务器确认最新内容时才说“已保存”。 */
import { computed } from 'vue'

import type { DraftState } from './draftController'

/** manual：手动保存对象（如更正稿），有修改时不承诺自动保存 */
const props = defineProps<{ state: DraftState; savedAt?: Date | null; manual?: boolean }>()
const time = (value?: Date | null) =>
  value ? value.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : ''
const text = computed(() => {
  switch (props.state) {
    case 'clean':
      return '未修改'
    case 'dirty':
      return props.manual ? '有未保存的修改' : '有修改，稍后自动保存'
    case 'saving':
      return '正在保存…'
    case 'saved':
      return `已保存 ${time(props.savedAt)}`
    case 'failed':
      return '保存失败，内容仍在本页'
    case 'conflict':
      return '内容冲突，未保存'
    case 'locked':
      return '已提交，只读'
  }
  return ''
})
</script>

<template>
  <span class="save" :class="`save--${state}`" role="status" aria-live="polite">
    <i aria-hidden="true" />{{ text }}
  </span>
</template>

<style scoped>
.save {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--ws-muted);
  font-size: 13px;
  white-space: nowrap;
}
.save i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ws-border-strong);
}
.save--dirty i {
  background: var(--ws-warning);
}
.save--saving i {
  border: 2px solid var(--ws-action);
  border-right-color: transparent;
  background: transparent;
  animation: spin 0.8s linear infinite;
}
.save--saved i {
  background: var(--ws-success);
}
.save--failed,
.save--conflict {
  color: var(--ws-danger);
  font-weight: 500;
}
.save--failed i,
.save--conflict i {
  border-radius: 1px;
  background: var(--ws-danger);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
