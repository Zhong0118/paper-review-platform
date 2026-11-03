<script setup lang="ts">
import {ref,watch} from 'vue'
import {previewPrograms,publishPrograms,type CatalogPreview,type ImportInput} from '@/api/schoolPrograms'
import {useAuthStore} from '@/stores/auth'
const auth=useAuthStore()
const year=ref(new Date().getFullYear()),source=ref(''),edition=ref(''),file=ref<File|null>(null)
const preview=ref<CatalogPreview|null>(null),busy=ref(false),error=ref(''),notice=ref('')
let payload:ImportInput|null=null,epoch=0
watch(()=>[year.value,source.value,edition.value,file.value,auth.user?.id,auth.user?.tenantId],()=>{
  epoch++;preview.value=null;payload=null;notice.value='';error.value=''
},{flush:'sync'})
function failure(e:unknown){return (e as {response?:{data?:{message?:string}}}).response?.data?.message || '操作未完成，请重试'}
async function inspect(){
  const f=file.value;if(!f||busy.value)return
  error.value='';notice.value='';preview.value=null;payload=null
  if(f.size>512000){error.value='CSV 不得超过 512 KB';return}
  const own=epoch;busy.value=true
  try{
    const body={year:year.value,source:source.value,source_version:edition.value,csv:new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer())}
    if(own!==epoch)return
    const result=await previewPrograms(body)
    if(own===epoch){payload=body;preview.value=result}
  }catch(e){if(own===epoch)error.value=e instanceof TypeError?'请使用 UTF-8 编码的 CSV':failure(e)}
  finally{busy.value=false}
}
async function publish(){
  if(!payload||!preview.value?.fingerprint||busy.value)return
  const own=epoch;busy.value=true;error.value=''
  try{
    const result=await publishPrograms(payload,preview.value.fingerprint)
    if(own===epoch){notice.value=`已发布 ${result.year} 年第 ${result.revision} 版，共 ${result.count} 项；请在批次页绑定。`;preview.value=null;payload=null}
  }catch(e){if(own===epoch){error.value=failure(e);preview.value=null;payload=null}}
  finally{busy.value=false}
}
</script>
<template><section class="program-import"><h2>校内专业目录</h2>
<p>按校方正式文件导入。同一年度内保留未出现在文件中的条目；停用须显式填写。发布新版本不会更换已绑定批次。</p>
<a href="/school-program-template.csv" download>下载 CSV 表头模板</a>
<div class="fields"><label>目录年度<input type="number" v-model.number="year" min="1900" max="2199"></label>
<label>校方出处<input v-model="source" maxlength="512" placeholder="正式文件名或官方链接"></label>
<label>来源版本<input v-model="edition" maxlength="80" placeholder="如 2026 年修订版"></label>
<label>校方 CSV 文件<input type="file" accept=".csv,text/csv" @change="file=($event.target as HTMLInputElement).files?.[0]??null"></label></div>
<p>以文本保留代码前导零。状态填“启用”或“停用”；同年同码有歧义时先与校方核对。</p>
<button type="button" :disabled="busy||!file||!source.trim()||!edition.trim()" @click="inspect">预览校内目录</button>
<Transition><div v-if="preview"><h3>{{year}} 年 · 拟发布第 {{preview.revision}} 版</h3>
<p>保留未列出的 {{preview.retained}} 项</p><ul v-if="preview.errors.length" role="alert"><li v-for="(e,i) in preview.errors" :key="i">{{e}}</li></ul>
<div class="scroll"><table v-if="preview.changes.length"><thead><tr><th>变动</th><th>校码</th><th>原映射</th><th>拟生效映射</th></tr></thead><tbody><tr v-for="item in preview.changes" :key="item.code"><td>{{item.action}}</td><td>{{item.code}}</td>
<td>{{item.before ? item.before.name+' / '+item.before.official_code+' / '+(item.before.active?'启用':'停用') : '无'}}</td>
<td>{{item.after.name}} / {{item.after.official_code}} {{item.after.official_name}} / {{item.after.active?'启用':'停用'}}</td></tr></tbody></table></div>
<button v-if="preview.fingerprint" type="button" :disabled="busy" @click="publish">确认发布该版本</button></div></Transition>
<p v-if="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p></section></template>
<style scoped>
.program-import{padding:1.15rem;border:1px solid #ccd9e5;background:white;color:#142e46}.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.75rem;margin:1rem 0}.fields label{display:grid;gap:.3rem}.fields input,button{padding:.5rem;border:1px solid #b6c8da;border-radius:.3rem}button{color:#144d80;background:#eff6ff;transition:transform .15s}button:hover:not(:disabled){transform:translateY(-1px)}.scroll{max-height:20rem;overflow:auto}td,th{padding:.4rem;text-align:left}.v-enter-active,.v-leave-active{transition:opacity .15s}.v-enter-from,.v-leave-to{opacity:0}
</style>
