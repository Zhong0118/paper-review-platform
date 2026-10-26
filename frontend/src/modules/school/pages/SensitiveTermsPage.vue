<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getSensitiveTerms, saveSensitiveTerms, type SensitiveTerm } from '@/api/sensitiveChecks'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
const auth = useAuthStore()
const terms = ref<SensitiveTerm[]>([]), version = ref(0), loaded = ref(false), busy = ref(false), error = ref(''), notice = ref('')
let generation = 0
async function load() {
  const request = ++generation
  busy.value = true; error.value = ''; notice.value = ''
  try {
    const result = await getSensitiveTerms()
    if (request !== generation) return
    terms.value = result.terms.map(t => ({...t})); version.value = result.version; loaded.value = true
  } catch(e) { if(request === generation) error.value = e instanceof Error ? e.message : '加载失败，请重试' }
  finally { if(request === generation) busy.value = false }
}
async function save() {
  if(busy.value || !loaded.value) return
  error.value = ''; notice.value = ''
  const values = terms.value.map(t => ({...t,text:t.text.trim()}))
  if(values.length > 200 || values.some(t => [...t.text].length < 2 || [...t.text].length > 64 || /[\u0000-\u001f]/.test(t.text))) { error.value = '最多 200 词 每词需要 2–64 个字符 不允许空白或控制字符'; return }
  if(new Set(values.map(t=>t.text)).size !== values.length) { error.value = '词条不能重复'; return }
  const request = ++generation
  busy.value = true
  try {
    const result = await saveSensitiveTerms({expected_version:version.value,terms:values})
    if(request !== generation) return
    terms.value = result.terms.map(t=>({...t})); version.value = result.version; notice.value = '词表已保存 待核验论文需要重新检测'
  } catch(e) { if(request === generation) error.value = e instanceof Error ? e.message : '保存失败 当前编辑内容已保留 请重试或重新加载' }
  finally { if(request === generation) busy.value = false }
}
watch(() => [auth.user?.id,auth.user?.tenantId,auth.accessToken], () => {
  generation++;terms.value=[];loaded.value=false;error.value='';notice.value=''
  if(auth.user?.role === 'school_reviewer') void load()
})
onBeforeUnmount(()=>{generation++})
void load()
</script>
<template>
<PortalLayout :menu-items="portalMenus('school_reviewer',false)" active-path="/school/sensitive-terms" context-label="学校管理 · 材料检测" :user-name="auth.user?.displayName ?? ''">
 <main class="terms-page"><h1>本校材料检测词表</h1><p>没有内置官方敏感词库 请按本校审核要求确认字面词条 最多 200 词 每词 2–64 个字符 不支持正则表达式</p><p>待核查允许学校填写理由后确认 阻断项需要修改材料后重新检测 已有姓名与学号检测始终保留</p>
 <header><span>词表版本 {{version}} · {{terms.length}} / 200</span><button type="button" data-reload-terms :disabled="busy" @click="load">重新加载并放弃本页编辑</button></header>
 <p v-if="busy" role="status">正在处理…</p><p v-if="error" role="alert">{{error}}</p>
 <template v-if="loaded"><fieldset :disabled="busy"><legend>本校词条</legend>
 <TransitionGroup name="term" tag="div"><div v-for="(term,index) in terms" :key="index" class="term-row">
  <label>词条 {{index+1}}<input v-model="term.text" data-term-text :aria-label="`词条 ${index+1}`" /></label>
  <label>处理级别<select v-model="term.severity"><option value="WARN">待核查</option><option value="BLOCK">阻断</option></select></label>
  <label class="description">说明<input v-model="term.description" maxlength="255" :aria-label="`词条 ${index+1} 说明`" /></label>
  <button type="button" :aria-label="`删除词条 ${index+1}`" @click="terms.splice(index,1)">删除</button>
 </div></TransitionGroup>
 <p v-if="!terms.length">尚未设置本校附加词条 身份信息检测仍然生效</p>
 <button type="button" data-add-term :disabled="terms.length >= 200" @click="terms.push({text:'',severity:'WARN',description:''})">添加词条</button>
 </fieldset><button type="button" data-save-terms :disabled="busy" @click="save">保存本校词表</button></template><p role="status">{{notice}}</p>
 </main>
</PortalLayout>
</template>
<style scoped>
.terms-page{display:grid;gap:1rem;max-width:70rem;animation:appear .2s ease}h1{font-size:1.45rem;margin:0}p{margin:0;color:#506579;font-size:.85rem;line-height:1.8}header,.term-row{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}header{justify-content:space-between}fieldset{border:1px solid #d2dfeb;border-radius:.5rem;padding:1rem}.term-row{padding:.6rem 0;border-bottom:1px solid #e5ebf1}label{display:grid;gap:.35rem;font-size:.75rem}.description{flex:1}input,select{padding:.5rem;border:1px solid #bfcedb;border-radius:.3rem;min-width:0}button{justify-self:start;border:1px solid #b8cada;border-radius:.3rem;color:#174a79;background:#f3f7fc;padding:.5rem .7rem;cursor:pointer;transition:transform .15s,background .15s}button:hover:not(:disabled){background:#e5eef9;transform:translateY(-1px)}button:active:not(:disabled){transform:scale(.97)}button:disabled{opacity:.5;cursor:default}[role=alert]{color:#9e2828}.term-enter-active,.term-leave-active,.term-move{transition:opacity .18s,transform .18s}.term-enter-from,.term-leave-to{opacity:0;transform:translateY(-4px)}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){*,.term-enter-active,.term-leave-active,.term-move{transition:none;animation:none}}
</style>
