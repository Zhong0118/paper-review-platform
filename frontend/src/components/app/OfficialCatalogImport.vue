<script setup lang="ts">
import { ref } from 'vue'
import { previewCatalogImport,applyCatalogImport,type ImportPreview } from '@/api/catalogs'
const preview=ref<ImportPreview|null>(null),busy=ref(false),error=ref(''),notice=ref('')
const emit=defineEmits<{imported:[]}>()
async function inspect(){busy.value=true;error.value='';notice.value='';preview.value=null;try{preview.value=await previewCatalogImport()}catch{error.value='官方目录预览失败，请重试。'}finally{busy.value=false}}
async function apply(){if(!preview.value)return;busy.value=true;error.value='';try{await applyCatalogImport(preview.value.fingerprint);preview.value=null;notice.value='官方目录已导入，不会自动创建入驻学校。';emit('imported')}catch{preview.value=null;error.value='导入未完成或预览已过期，请重新预览。'}finally{busy.value=false}}
</script>
<template><section class="official-import"><h2>官方基础目录</h2><p>研究生目录 2022 · 全国高校名单 2026。先预览再导入，不依赖外网实时查询。</p><button type="button" :disabled="busy" @click="inspect">预览官方目录导入</button><p v-if="error" role="alert">{{error}}</p><p role="status">{{notice}}</p><div v-if="preview"><p>学科：新增 {{preview.disciplines.added}}，更新 {{preview.disciplines.changed}}，未变 {{preview.disciplines.unchanged}}</p><p>院校：新增 {{preview.institutions.added}}，更新 {{preview.institutions.changed}}，未变 {{preview.institutions.unchanged}}</p><ul><li v-for="source in preview.sources" :key="source.url"><a :href="source.url" target="_blank" rel="noopener noreferrer">{{source.name}}（{{source.version}}）</a></li></ul><button type="button" :disabled="busy" @click="apply">确认导入当前预览</button></div></section></template>
<style scoped>.official-import{border:1px solid #cbd7df;padding:1rem;margin:1rem 0}.official-import button{padding:.5rem .8rem}</style>
