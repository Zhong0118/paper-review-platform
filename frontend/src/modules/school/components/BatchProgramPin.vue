<script setup lang="ts">
import {ref,onMounted,onBeforeUnmount} from 'vue'
import {listProgramVersions,pinPrograms,type CatalogVersion} from '@/api/schoolPrograms'
import type {ReviewBatch} from '@/api/schoolOperations'
const props=defineProps<{batch:ReviewBatch}>(),emit=defineEmits<{saved:[]}>()
const versions=ref<CatalogVersion[]>([]),selected=ref(''),error=ref(''),busy=ref(false),loading=ref(true)
let active=true;onBeforeUnmount(()=>{active=false})
async function load(){loading.value=true;error.value='';try{versions.value=await listProgramVersions()}catch{error.value='目录加载失败，请重试'}finally{loading.value=false}}
onMounted(load)
async function save(){if(busy.value||!selected.value)return;busy.value=true;error.value=''
  try{await pinPrograms(props.batch.id,selected.value,props.batch.version);if(active)emit('saved')}
  catch(e){error.value=(e as {response?:{data?:{message?:string}}}).response?.data?.message || '绑定失败，请刷新批次后重试'}finally{busy.value=false}}
</script>
<template><div class="pin"><strong>本批校内专业目录</strong><p v-if="loading">正在读取目录…</p>
<p v-else-if="batch.program_catalog_id">已固定：{{versions.find(v=>v.id===batch.program_catalog_id)?.year}} 年第 {{versions.find(v=>v.id===batch.program_catalog_id)?.revision}} 版</p>
<template v-else-if="['DRAFT','OPEN'].includes(batch.status) && versions.length">
<label>选定版本 <select v-model="selected"><option value="">请选择</option><option v-for="v in versions" :key="v.id" :value="v.id">{{v.year}} 年第 {{v.revision}} 版 · {{v.source_version}} · {{v.count}} 项</option></select></label>
<p>确认后本批不再换版，未选择校码的既有草稿可继续送审。</p><button type="button" :disabled="!selected||busy" @click="save">确认固定本批目录</button></template>
<p v-else-if="!error">未绑定，沿用官方目录。请在开放期间绑定已发布的校内目录。</p>
<p v-if="error" role="alert">{{error}} <button v-if="!versions.length" @click="load">重试</button></p></div></template>
<style scoped>.pin{grid-column:1/-1;padding:1rem;border-left:3px solid #27629e;background:#f3f7fc}.pin select,.pin button{padding:.45rem}.pin button{cursor:pointer;color:#174b7a}</style>
