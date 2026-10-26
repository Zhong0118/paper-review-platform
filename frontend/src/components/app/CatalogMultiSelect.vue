<script setup lang="ts">
import { computed, ref } from 'vue'
const props=defineProps<{modelValue:string[]; options:Array<{code:string;name:string}>; label:string; disabled?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:string[]]}>()
const query=ref('')
const filtered=computed(()=>props.options.filter(x=>`${x.code} ${x.name}`.toLowerCase().includes(query.value.trim().toLowerCase())))
const unknown=computed(()=>props.modelValue.filter(code=>!props.options.some(x=>x.code===code)))
function toggle(code:string,checked:boolean){emit('update:modelValue',checked?[...new Set([...props.modelValue,code])]:props.modelValue.filter(x=>x!==code))}
</script>
<template>
  <fieldset class="catalog-multi" :disabled="disabled">
    <legend>{{ label }}（已选 {{ modelValue.length }} 项）</legend>
    <input v-model="query" type="search" :aria-label="`搜索${label}`" placeholder="输入代码或名称搜索">
    <div class="catalog-multi__list">
      <label v-for="item in filtered" :key="item.code"><input type="checkbox" :value="item.code" :checked="modelValue.includes(item.code)" @change="toggle(item.code,($event.target as HTMLInputElement).checked)">{{ item.code }} · {{ item.name }}</label>
      <p v-if="!filtered.length">没有可选的匹配项</p>
    </div>
    <p v-for="code in unknown" :key="code">{{ code }}（历史项，当前目录未启用）<button type="button" @click="toggle(code,false)">移除</button></p>
  </fieldset>
</template>
<style scoped>
.catalog-multi{border:1px solid #cbd7df;padding:.75rem;min-width:0}.catalog-multi>input{box-sizing:border-box;width:100%;padding:.5rem}.catalog-multi__list{max-height:15rem;overflow:auto;margin-top:.5rem}.catalog-multi__list label{display:flex;align-items:center;gap:.5rem;padding:.4rem}.catalog-multi__list input{width:auto!important;min-height:0!important}
</style>
