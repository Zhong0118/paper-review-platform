<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowUp, ArrowDown, Close as X, Plus } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { getFileContent } from '@/api/files'
import { generatePdfTransform, applyPdfTransform, cancelPdfTransform, uploadTransformSource,
  type PdfPurpose, type PdfOperation, type PdfTransform } from '@/api/pdfTransforms'
const props=defineProps<{thesisId:string;version:number;contentRevision:string;files:{file_id:string;purpose:string;filename:string}[]}>()
const emit=defineEmits<{close:[];applied:[]}>()
const auth=useAuthStore(), dialog=ref<HTMLDialogElement>()
const purpose=ref<PdfPurpose>('anonymous'), operation=ref<PdfOperation>('EXTRACT')
const sources=ref<{id:string;name:string;pages:string}[]>([])
const busy=ref(false), error=ref(''), ready=ref<PdfTransform>(), preview=ref('')
let generation=0, requestSignature='', requestKey=''
const editable=computed(()=>!busy.value&&!ready.value)
function resetSources(){
 sources.value=props.files.filter(f=>f.purpose===purpose.value).map(f=>({id:f.file_id,name:f.filename,pages:''}))
 error.value=''
}
watch(purpose,resetSources,{immediate:true})
onMounted(async()=>{await nextTick();dialog.value?.showModal()})
function clear(){generation++;if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';ready.value=undefined}
onBeforeUnmount(clear)
watch(()=>[props.thesisId,props.version,props.contentRevision,auth.user?.id,auth.user?.tenantId,auth.user?.role],()=>{clear();emit('close')})
function pages(text:string){
 const values:number[]=[]
 for(const piece of text.split(/[,，]/)){
  const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(piece)
  if(!match)throw new Error('请填写有效页码 如 2,1 或 1-3')
  const start=Number(match[1]),end=match[2]?Number(match[2]):start
  if(start<1||end<start||end>1000||values.length+end-start+1>1000)throw new Error('页码须在 1 到 1000 之间')
  for(let i=start;i<=end;i++)values.push(i)
 }
 if(new Set(values).size!==values.length)throw new Error('页码不能重复')
 return values
}
function move(index:number,delta:number){
 const target=index+delta
 if(target<0||target>=sources.value.length)return
 const rows=[...sources.value];[rows[index],rows[target]]=[rows[target]!,rows[index]!];sources.value=rows
}
async function add(event:Event){
 const input=event.target as HTMLInputElement,file=input.files?.[0];input.value=''
 if(!file||!editable.value)return
 const current=++generation;busy.value=true;error.value=''
 try{
  if(!auth.accessToken)throw new Error('请重新登录')
  if(sources.value.length>=10)throw new Error('最多选择 10 个来源文件')
  const id=await uploadTransformSource(props.thesisId,purpose.value,file,auth.accessToken)
  if(current===generation)sources.value.push({id,name:file.name,pages:''})
 }catch(e){if(current===generation)error.value=e instanceof Error?e.message:'上传失败'}
 finally{if(current===generation)busy.value=false}
}
async function generate(){
 if(!editable.value)return
 const current=++generation;busy.value=true;error.value=''
 try{
  if(!sources.value.length)throw new Error('请先上传来源 PDF')
  if(operation.value!=='MERGE'&&sources.value.length!==1)throw new Error('提取和删页每次只处理一个来源文件')
  const body={expected_version:props.version,purpose:purpose.value,operation:operation.value,
    sources:sources.value.map(s=>({file_id:s.id,pages:pages(s.pages)}))}
  const signature=JSON.stringify(body)
  if(signature!==requestSignature){requestSignature=signature;requestKey=crypto.randomUUID()}
  const product=await generatePdfTransform(props.thesisId,body,requestKey)
  if(current!==generation)return
  if(product.status==='CANCELLED')throw new Error('该操作已取消 请调整页码后重新生成')
  ready.value=product
  const blob=await getFileContent(product.new_file_id)
  if(current===generation)preview.value=URL.createObjectURL(blob)
 }catch(e){if(current===generation)error.value=e instanceof Error?e.message:'生成失败 请重试'}
 finally{if(current===generation)busy.value=false}
}
async function retryPreview(){
 if(!ready.value||busy.value)return
 const current=++generation;busy.value=true;error.value=''
 try{const blob=await getFileContent(ready.value.new_file_id);if(current===generation)preview.value=URL.createObjectURL(blob)}
 catch(e){if(current===generation)error.value=e instanceof Error?e.message:'预览失败'}
 finally{if(current===generation)busy.value=false}
}
async function apply(){
 if(!ready.value||!preview.value||busy.value)return
 const current=++generation;busy.value=true;error.value=''
 try{await applyPdfTransform(ready.value.operation_id,props.version,props.contentRevision);if(current===generation)emit('applied')}
 catch(e){if(current===generation)error.value=e instanceof Error?e.message:'应用失败 请刷新草稿后重试'}
 finally{if(current===generation)busy.value=false}
}
async function close(){
 if(busy.value)return
 if(ready.value){
  busy.value=true
  try{await cancelPdfTransform(ready.value.operation_id,props.version)}
  catch(e){error.value=e instanceof Error?e.message:'取消失败 请重试';return}
  finally{busy.value=false}
 }
 emit('close')
}
</script>
<template>
<dialog ref="dialog" aria-labelledby="pdf-transform-heading" @cancel.prevent="close">
 <header><h2 id="pdf-transform-heading">处理 PDF 材料</h2><button type="button" aria-label="关闭 PDF 处理" :disabled="busy" @click="close"><X :size="18" /></button></header>
 <p>先生成并预览 再确认替换当前材料 原文件会保留</p>
 <fieldset :disabled="!editable"><div class="choices">
  <label>材料用途<select v-model="purpose" data-pdf-purpose><option value="anonymous">匿名版论文</option><option value="original">原始论文</option></select></label>
  <label>处理方式<select v-model="operation" data-pdf-operation><option value="EXTRACT">提取页码 生成一个片段</option><option value="MERGE">合并所选页面</option><option value="DELETE_PAGES">删除所选页面</option></select></label>
 </div>
 <p>{{operation==='DELETE_PAGES'?'填写要删除的页码 不能删除全部页面':'按来源列表和填写的页码顺序输出 如 2,1,3-5'}} · 页码从 1 开始</p>
 <TransitionGroup name="pdf" tag="div" class="sources">
  <div v-for="(source,index) in sources" :key="source.id" class="source">
   <span>{{index+1}} · {{source.name}}</span><label>页码<input v-model="source.pages" data-pages placeholder="例如 1-3,5" /></label>
   <div class="source-actions"><button type="button" aria-label="上移来源" :disabled="index===0" @click="move(index,-1)"><ArrowUp :size="16"/></button><button type="button" aria-label="下移来源" :disabled="index===sources.length-1" @click="move(index,1)"><ArrowDown :size="16"/></button><button type="button" aria-label="移除来源" @click="sources.splice(index,1)"><X :size="16"/></button></div>
  </div>
 </TransitionGroup>
 <label class="upload"><Plus :size="16"/>添加同用途 PDF<input data-add-pdf type="file" accept="application/pdf,.pdf" :disabled="sources.length>=10" @change="add" /></label>
 <p>最多 10 个来源 输出不超过 1000 页 不支持加密、表单、附件、链接或批注等主动内容</p>
 </fieldset>
 <Transition name="pdf"><p v-if="error" role="alert">{{error}}</p></Transition>
 <button v-if="!ready" data-generate-pdf type="button" :disabled="busy" @click="generate">{{busy?'正在处理…':'生成并预览'}}</button>
 <Transition name="pdf"><section v-if="ready" class="product">
  <p>已生成 {{ready.page_count}} 页 确认前当前材料保持不变</p>
  <iframe v-if="preview" :src="preview" title="待确认 PDF 成品" />
  <button v-else type="button" :disabled="busy" @click="retryPreview">重试预览</button>
  <p>应用后请重新执行匿名检测 本次转换不保证材料已匿名</p>
  <button data-apply-pdf type="button" :disabled="busy||!preview" @click="apply">确认应用到当前材料</button>
 </section></Transition>
</dialog>
</template>
<style scoped>
dialog{border:1px solid #d6e0ea;border-radius:.7rem;width:min(900px,92vw);max-height:90vh;padding:1.4rem;color:#213649;background:white;animation:enter .2s ease}dialog::backdrop{background:#13253966;backdrop-filter:blur(3px)}header,.choices,.source-actions{display:flex;align-items:center;justify-content:space-between;gap:.6rem}h2{font-size:1.15rem;margin:0}p{font-size:.82rem;color:#5b6d7d;line-height:1.7}fieldset{border:0;padding:0;margin:1rem 0}label{display:grid;gap:.4rem;font-size:.85rem}.choices>label{flex:1}input,select{padding:.55rem;border:1px solid #b9cbdc;border-radius:.3rem;background:white;color:#263b50;min-width:0}.sources{display:grid;gap:.6rem;margin:1rem 0}.source{border:1px solid #dbe4ed;background:#f7faff;padding:.7rem;display:grid;grid-template-columns:1fr 1fr auto;align-items:center;gap:.8rem}.source span{overflow-wrap:anywhere;font-size:.85rem}.upload{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}.upload input{max-width:100%}button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:1px solid #b6cce0;background:#f0f6fe;color:#18568b;border-radius:.35rem;padding:.55rem .8rem;cursor:pointer;transition:background .15s,transform .15s}button:hover:not(:disabled){background:#dfedfc;transform:translateY(-1px)}button:active:not(:disabled){transform:scale(.97)}svg{width:1rem;height:1rem;flex-shrink:0}button:disabled{opacity:.5;cursor:default}iframe{width:100%;height:52vh;border:1px solid #c5d5e4}.product{display:grid;gap:.5rem}[role=alert]{color:#a32631}.pdf-enter-active,.pdf-leave-active,.pdf-move{transition:opacity .18s,transform .18s}.pdf-enter-from,.pdf-leave-to{opacity:0;transform:translateY(5px)}@keyframes enter{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media(max-width:650px){.choices{display:grid}.source{grid-template-columns:1fr}.source-actions{justify-content:flex-start}}@media(prefers-reduced-motion:reduce){*,.pdf-enter-active,.pdf-leave-active,.pdf-move{animation:none;transition:none}}
</style>
