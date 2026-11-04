<script setup lang="ts" generic="S extends string">
/**
 * 原型外框：.ws 令牌根节点 + 左下角浮动的原型控制（状态切换、原型注开关、返回索引）。
 * 浮动是为了不占版面，保证首屏位置的测量与真实布局一致。
 */
import { ref } from 'vue'

import './tokens.css'
import { provideProtoNotes, type ProtoStateOption } from './useProtoState'

defineProps<{ name: string; states?: readonly ProtoStateOption<S>[] }>()
const state = defineModel<S>('state')
const notes = provideProtoNotes()
const open = ref(false)
</script>

<template>
  <div class="ws">
    <slot />
    <div class="proto-ctl" :class="{ 'proto-ctl--closed': !open }" aria-label="原型控制">
      <button type="button" class="proto-ctl__toggle" :aria-expanded="open" @click="open = !open">
        原型｜虚构数据
      </button>
      <template v-if="open">
        <span class="proto-ctl__name">{{ name }}</span>
        <label v-if="states?.length" class="proto-ctl__field">
          <span>状态</span>
          <select v-model="state">
            <option v-for="option in states" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label class="proto-ctl__field"><input v-model="notes" type="checkbox" /> 原型注</label>
        <RouterLink to="/prototype" class="proto-ctl__link">全部原型</RouterLink>
      </template>
    </div>
  </div>
</template>

<style scoped>
.proto-ctl {
  position: fixed;
  z-index: 90;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  max-width: calc(100vw - 24px);
  padding: 6px 10px;
  border-radius: 8px;
  background: #26303c;
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
  color: #e7ecf2;
  font-size: 12px;
}
.proto-ctl--closed {
  padding: 4px 6px;
}
.proto-ctl__toggle {
  padding: 2px 6px;
  border: 1px solid #56616f;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.proto-ctl__name {
  color: #b8c2cf;
}
.proto-ctl__field {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.proto-ctl__field select {
  max-width: 200px;
  padding: 2px 4px;
  border: 0;
  border-radius: 4px;
  background: #f1f4f8;
  color: #17202a;
  font-size: 12px;
}
.proto-ctl__link {
  color: #b9d3f0;
}
/* 手机上避开各页底部操作栏 */
@media (max-width: 640px) {
  .proto-ctl {
    bottom: 88px;
  }
}
</style>
