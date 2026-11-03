<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getDisciplines,getDisciplineSettings,saveDisciplineSettings,type CatalogOption } from '@/api/catalogs'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import ProgramCatalogImport from '../components/ProgramCatalogImport.vue'
import CatalogMultiSelect from '@/components/app/CatalogMultiSelect.vue'
const user=useAuthStore()
const options=ref<CatalogOption[]>([]),codes=ref<string[]>([])
const version=ref(0),configured=ref(false),loading=ref(true),saving=ref(false),error=ref(''),notice=ref('')
async function load(){loading.value=true;error.value='';try{const [items,config]=await Promise.all([getDisciplines(),getDisciplineSettings()]);options.value=items;codes.value=config.configured?[...config.codes]:items.map(x=>x.code);version.value=config.version;configured.value=config.configured}catch{options.value=[];error.value='目录加载失败，请重试。'}finally{loading.value=false}}
async function save(){saving.value=true;error.value='';notice.value='';try{const result=await saveDisciplineSettings(codes.value,version.value);version.value=result.version;configured.value=true;notice.value='本校可选学科已保存，历史论文保持原值。'}catch(e){if((e as {response?:{status?:number}}).response?.status===409){await load();error.value='配置已被修改，已刷新，请重新确认后保存。'}else error.value='保存失败，请重试。'}finally{saving.value=false}}
onMounted(load)
</script>
<template>
<PortalLayout :menu-items="portalMenus('school_reviewer',false)" active-path="/school/disciplines" context-label="学校管理 · 可选学科" :user-name="user.user?.displayName ?? ''">
  <main class="school-disciplines"><h1>本校送审学科</h1><p>选择本校开放的研究生一级学科或专业学位类别。不是学校全部培养专业名录。</p>
  <p v-if="loading">正在加载…</p><p v-if="error" role="alert">{{error}} <button :disabled="saving" @click="load">重新加载</button></p>
  <template v-if="!loading && options.length"><p v-if="!configured">当前尚未限制范围，沿用全部启用学科。保存后按本页勾选项开放；清空并保存将停止开放新选项。</p><div><button type="button" :disabled="saving" @click="codes=options.map(item=>item.code)">选择全部</button> <button type="button" :disabled="saving" @click="codes=[]">清空选择</button></div><CatalogMultiSelect v-model="codes" :options="options" label="可用学科" :disabled="saving"/><button :disabled="saving" @click="save">{{saving?'保存中…':'保存本校范围'}}</button></template>
  <p v-else-if="!loading && !error">官方目录为空，请联系系统管理员导入。</p><p role="status">{{notice}}</p><ProgramCatalogImport /></main>
</PortalLayout>
</template>
<style scoped>.school-disciplines{max-width:60rem;display:grid;gap:1rem}.school-disciplines>button{justify-self:start;padding:.6rem 1rem}</style>
