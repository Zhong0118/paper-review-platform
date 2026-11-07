<script setup lang="ts">
import {ref, watch} from 'vue'
import {getBatchCloseout,type BatchCloseout,type CloseoutItem} from '@/api/schoolOperations'
import {useAuthStore} from '@/stores/auth'
const props=defineProps<{batchId:string}>()
const labels={unpublished:'未发布论文',objections:'未结异议',corrections:'待学校确认的更正'}
const stages:Record<string,string>={DRAFT:'草稿',SUBMITTED:'已提交',PREPARING:'学校核验',READY_FOR_DISPATCH:'待送出',
 UNDER_REVIEW:'评阅中',RESULT_PROCESSING:'待发布'}
const auth=useAuthStore(), data=ref<BatchCloseout|null>(null), error=ref(false),refresh=ref(0)
watch(()=>[props.batchId,auth.user?.id,auth.user?.tenantId,refresh.value],async(_,__,onCleanup)=>{
  let current=true; onCleanup(()=>{current=false}); data.value=null;error.value=false
  try {const result=await getBatchCloseout(props.batchId);if(current)data.value=result}
  catch {if(current)error.value=true}
},{immediate:true})
function link(group:keyof BatchCloseout,row:CloseoutItem) {
  if(group==='objections')return {path:'/school/objections',query:{objection:row.id}}
  if(group==='corrections')return {path:'/school/results',query:{thesis:row.thesis_id,correction:row.id}}
  if(row.status==='RESULT_PROCESSING')return {path:'/school/results',query:{thesis:row.thesis_id}}
  return {path:'/school/preparation',query:{thesis:row.thesis_id}}
}
</script>
<template><section class="closeout" aria-label="批次收尾核对" data-closeout>
  <h3>批次收尾核对</h3><p>包含本批全部年份，已终止的论文不计入未发布。</p>
  <p v-if="error" role="alert">清单加载失败 <button type="button" @click="refresh++">重试</button></p>
  <p v-else-if="!data" role="status">正在核对本批事项…</p>
  <template v-else><div v-for="(label,key) in labels" :key="key"><h4>{{label}} · {{data[key].length}}</h4>
    <p v-if="!data[key].length">无此类待办</p>
    <ul v-else><li v-for="row in data[key]" :key="row.id"><RouterLink :to="link(key,row)">{{row.title || row.thesis_id.slice(0,8)}} · {{key==='unpublished' ? (stages[row.status] ?? row.status) : key==='corrections' ? '确认更正' : '处理异议'}}</RouterLink></li></ul>
  </div></template>
</section></template>
<style scoped>
.closeout{grid-column:1/-1;padding:1rem;background:#f4f8fc;border-left:3px solid #285782}
.closeout h3,.closeout h4,.closeout p{margin:.4rem 0}.closeout a{color:#174f82}.closeout li{margin:.35rem 0}
</style>
