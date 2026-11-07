<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { searchInstitutions,type InstitutionOption } from '@/api/catalogs'
const props=defineProps<{modelValue?:InstitutionOption|null}>()
const emit=defineEmits<{'update:modelValue':[value:InstitutionOption|null]}>()
const query=ref(''),rows=ref<InstitutionOption[]>([]),busy=ref(false),error=ref(''),searched=ref(false)
let generation=0
function changed(){generation++;busy.value=false;rows.value=[];searched.value=false;error.value='';emit('update:modelValue',null)}
async function search(){const mine=++generation;busy.value=true;error.value='';rows.value=[];try{const result=await searchInstitutions(query.value);if(mine===generation){rows.value=result;searched.value=true}}catch{if(mine===generation)error.value='院校查询失败，请重试。'}finally{if(mine===generation)busy.value=false}}
onBeforeUnmount(()=>generation++)
</script>
<template><fieldset><legend>官方院校</legend><input v-model="query" type="search" aria-label="院校名称或学校标识码" placeholder="输入名称或10位学校标识码" @input="changed" @keydown.enter.prevent="search"><button type="button" :disabled="busy" @click="search">{{busy?'查询中…':'查询院校'}}</button><p v-if="error" role="alert">{{error}}</p><p v-if="modelValue">已选：{{modelValue.code}} · {{modelValue.name}}</p><div class="institution-options"><button v-for="item in rows" :key="item.code" type="button" :aria-pressed="props.modelValue?.code===item.code" @click="emit('update:modelValue',item)">{{item.code}} · {{item.name}} · {{item.province}} {{item.level || '成人高校'}}</button></div><p v-if="searched && !rows.length">未找到院校，请检查关键词或先导入官方目录。</p><p v-if="rows.length===100">最多展示100项，请缩小查询范围。</p></fieldset></template>
<style scoped>fieldset{border:1px solid #cbd7df;padding:.7rem}.institution-options{max-height:12rem;overflow:auto}.institution-options button{display:block;width:100%;padding:.5rem;text-align:left}</style>
