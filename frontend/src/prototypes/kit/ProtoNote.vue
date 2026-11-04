<script setup lang="ts">
/** 原型注：说明所依据的合同、修复同步状态或设计取舍。不是产品文案，U2 不迁移。 */
import { useProtoNotes } from './useProtoState'

defineProps<{ contract?: string }>()
const show = useProtoNotes()
</script>

<template>
  <aside v-if="show" class="proto-note" role="note">
    <strong>原型注<template v-if="contract">｜{{ contract }}</template></strong>
    <span><slot /></span>
  </aside>
</template>

<style scoped>
.proto-note {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  padding: 6px 10px;
  border: 1px dashed #9aa4b2;
  border-radius: 6px;
  background: repeating-linear-gradient(135deg, #fafbfc 0 8px, #f3f5f8 8px 16px);
  color: #47505c;
  font-size: 12px;
  line-height: 1.5;
}
.proto-note strong {
  color: #2d3540;
  font-weight: 600;
}
</style>
