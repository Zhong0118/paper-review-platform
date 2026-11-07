<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ThesisDetail } from '@/api/theses'
import type { SensitiveFinding } from '@/api/sensitiveChecks'
import { getFileContent } from '@/api/files'
import { useAuthStore } from '@/stores/auth'
const props = defineProps<{detail: ThesisDetail; busy?: boolean; disabled?: boolean; invalidated?: boolean; school?: boolean}>()
defineEmits<{check: []}>()
const auth = useAuthStore()
const report = computed(() => props.detail.anonymization)
const source = computed(() => report.value.source_metadata)
const file = computed(() => props.detail.current_version?.files.find(f => f.purpose === 'anonymous'))
const stale = computed(() => props.invalidated || report.value.stale || !source.value ||
  source.value.file_id !== file.value?.file_id || source.value.thesis_version_id !== props.detail.current_version?.id)
const conclusion = computed(() => ({PASS:'未发现阻断项',FAIL:'发现阻断项',REVIEW_REQUIRED:'需要人工核验'}[report.value.auto_conclusion ?? ''] ?? '尚未检测'))
const groups = computed(() => {
  const result = new Map<string, {label:string; page:number|null; findings:SensitiveFinding[]}>()
  if (stale.value) return []
  const names: Record<string,string> = {filename:'文件名', metadata:'文件元数据', thesis_metadata:'登记信息', title:'标题文字核对'}
  for (const finding of report.value.findings) {
    if (finding.kind === 'TITLE_NOT_FOUND') continue
    const page = finding.page_number ?? null
    const key = page === null ? finding.source ?? finding.location : `page-${page}`
    if (!result.has(key)) result.set(key,{label: page === null ? names[key] ?? '其他来源' : `PDF 物理页 ${page}`,page,findings:[]})
    result.get(key)!.findings.push(finding)
  }
  return [...result.values()].sort((a,b)=>(a.page ?? Infinity)-(b.page ?? Infinity))
})
const hits = computed(() => groups.value.filter(g => g.page !== null).flatMap(g => g.findings))
const active = ref(-1)
function openHit(index: number) {
  const target = hits.value[index]?.page_number
  if (!target) return
  active.value = index
  void jump(target)
}
const preview = ref(''), page = ref(1), previewBusy = ref(false), error = ref('')
let generation = 0
function clearPreview() {
  generation++
  if (preview.value) URL.revokeObjectURL(preview.value)
  active.value = -1; preview.value = ''; previewBusy.value = false; error.value = ''
}
watch(() => [props.detail,props.invalidated,auth.accessToken,auth.user], clearPreview, {deep:true,flush:'sync'})
onBeforeUnmount(clearPreview)
async function jump(target: number) {
  if (stale.value || !file.value || target < 1 || target > (source.value?.page_count ?? 0)) return
  page.value = target
  if (preview.value) return
  const request = ++generation
  previewBusy.value = true; error.value = ''
  try {
    const blob = await getFileContent(file.value.file_id)
    if (request !== generation) return
    preview.value = URL.createObjectURL(blob)
  } catch (e) {
    if (request === generation) error.value = e instanceof Error ? e.message : 'PDF 加载失败，请重试'
  } finally { if (request === generation) previewBusy.value = false }
}
</script>
<template>
<section class="sensitive-panel" aria-label="匿名材料检测" data-sensitive-report>
  <header><div><h2>匿名材料检测</h2><p>页码按 PDF 物理顺序从 1 开始 与正文印刷页码可能不同</p></div>
    <button v-if="detail.stage === 'DRAFT' || (school && detail.stage === 'PREPARING')" type="button" data-run-sensitive :disabled="busy || disabled" @click="$emit('check')">{{busy ? '正在检测…' : school ? '重新检测匿名版' : '保存并检测匿名版'}}</button>
  </header>
  <div class="review-layout" :class="{split:preview}"><div>
  <Transition name="report" mode="out-in">
    <p v-if="stale" key="stale" role="status">{{report.auto_conclusion ? '检测依据已变化或旧报告缺少来源记录 请重新检测后核验' : '尚无当前材料检测报告 请上传匿名 PDF 后检测'}}</p>
    <div v-else key="current">
      <p><strong>{{conclusion}}</strong> · 本校词表版本 {{source?.terms_version}} <span v-if="report.manual_conclusion">· 人工核验 {{report.manual_conclusion === 'PASS' ? '已通过' : '已退回'}}</span></p>
      <p v-if="source?.uncertain" role="status">部分内容无法可靠提取 需要人工核验<span v-if="source.uncertain_pages.length"> · 物理页 {{source.uncertain_pages.join('、')}}</span></p>
      <p v-if="source?.title_status === 'TITLE_NOT_FOUND'" data-title-warning>前两页未找到登记标题的文字 请人工核对 这不代表论文内容不一致</p>
      <p v-else-if="source?.title_status === 'NOT_CHECKED'">标题文字尚未核对 前两页包含无法可靠提取的内容或标题为空</p>
      <p v-else>前两页找到登记标题的文字 此项不判断内容是否一致</p>
      <p v-if="!groups.length">未发现身份信息或本校词表命中 仍需人工核对材料</p>
      <TransitionGroup name="report" tag="div">
        <section v-for="group in groups" :key="group.label" class="finding-group">
          <header><h3>{{group.label}}</h3><button v-if="group.page !== null" type="button" :data-preview-page="group.page" :disabled="previewBusy" @click="openHit(hits.indexOf(group.findings[0]!))">查看此页</button></header>
          <ul><li v-for="(finding,index) in group.findings" :key="index"><strong>{{finding.severity === 'BLOCK' ? '阻断' : '待核查'}} · {{finding.matched_text}}</strong><button v-if="group.page !== null" type="button" :data-open-hit="hits.indexOf(finding)" :disabled="previewBusy" @click="openHit(hits.indexOf(finding))">定位此处</button><p class="context">{{finding.context}}</p><small v-if="finding.description">{{finding.description}}</small></li></ul>
        </section>
      </TransitionGroup>
    </div>
  </Transition>
  <p v-if="error" role="alert">{{error}}</p>
  </div><Transition name="report"><div v-if="preview" class="pdf-preview"><header><p>当前定位 PDF 物理页 {{page}} 若阅读器未自动跳转 请在阅读器内输入此页码</p><button type="button" @click="clearPreview">关闭预览</button></header><nav aria-label="逐条核查"><button type="button" data-prev-hit :disabled="active < 1" @click="openHit(active-1)">上一处</button><span role="status">第 {{active+1}} / {{hits.length}} 处 · {{hits[active]?.matched_text}}</span><button type="button" data-next-hit :disabled="active >= hits.length-1" @click="openHit(active+1)">下一处</button></nav><iframe :key="page" :src="`${preview}#page=${page}`" title="当前匿名材料 PDF" /></div></Transition></div>
</section>
</template>
<style scoped>
.review-layout,.pdf-preview{min-width:0}.pdf-preview nav{display:flex;align-items:center;justify-content:space-between;gap:.5rem;margin:.5rem 0}.finding-group li button{margin-left:.5rem}
@media(min-width:850px){.review-layout.split{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,3fr);gap:1rem}.pdf-preview{position:sticky;top:1rem;align-self:start}}

.sensitive-panel{border:1px solid #d7e1eb;border-radius:.5rem;padding:1rem;background:white;display:grid;gap:.6rem;animation:appear .2s ease}
header{display:flex;align-items:center;justify-content:space-between;gap:1rem}h2{font-size:1rem;margin:0}h3{font-size:.85rem;margin:.4rem 0}p{font-size:.8rem;line-height:1.7;color:#4b6074;margin:.4rem 0}button{border:1px solid #b8cada;border-radius:.3rem;color:#174a79;background:#f3f7fc;padding:.5rem .7rem;cursor:pointer;transition:transform .15s,background .15s}button:hover:not(:disabled){background:#e5eef9;transform:translateY(-1px)}button:active:not(:disabled){transform:scale(.97)}button:disabled{opacity:.5;cursor:default}.finding-group{border-top:1px solid #e4eaf0;margin-top:.7rem;padding-top:.5rem}ul{padding-left:1.2rem;font-size:.8rem}.context{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#63778b}.pdf-preview iframe{width:100%;height:65vh;border:1px solid #ccd9e5}.report-enter-active,.report-leave-active,.report-move{transition:opacity .18s,transform .18s}.report-enter-from,.report-leave-to{opacity:0;transform:translateY(-4px)}@keyframes appear{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@media(max-width:600px){header{align-items:flex-start;flex-wrap:wrap}}@media(prefers-reduced-motion:reduce){*,.report-enter-active,.report-leave-active,.report-move{transition:none;animation:none}}
</style>
