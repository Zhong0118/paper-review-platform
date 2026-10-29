<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Close } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { previewExpertImport, applyExpertImport, downloadExpertTemplate, type ExpertImportPreview } from '@/api/expertOperations'
const emit = defineEmits<{ close: []; applied: [count: number] }>()
const auth = useAuthStore(), dialog = ref<HTMLDialogElement>(), file = ref<File>(), pending = ref<ExpertImportPreview>()
const busy = ref(false), error = ref(''), now = ref(Date.now())
let generation = 0, key = '', timer: ReturnType<typeof setInterval> | undefined
const expired = computed(() => !!pending.value && Date.parse(pending.value.expires_at) <= now.value)
const labels: Record<string, string> = { unit: '单位', title: '职称', discipline_codes: '学科', province_name: '省份', doctoral_supervisor: '博导', masters_supervisor: '硕导', research_directions: '研究方向', keywords: '关键词', source_url: '来源链接', source_note: '来源说明' }
function display(value: unknown, field: string) {
  if (value == null) return field.endsWith('_supervisor') ? '未知' : '清空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join('、') || '清空'
  return String(value) || '清空'
}
function close() { if (!busy.value) emit('close') }
function invalidate() { generation++; pending.value = undefined; file.value = undefined; emit('close') }
watch(() => [auth.user?.id, auth.user?.tenantId, auth.user?.role], invalidate)
onMounted(() => { dialog.value?.showModal?.(); timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => { generation++; clearInterval(timer) })
function choose(event: Event) {
  generation++; pending.value = undefined; error.value = ''; key = ''
  file.value = (event.target as HTMLInputElement).files?.[0]
  if (file.value && file.value.size > 1024 * 1024) { file.value = undefined; error.value = 'CSV不得超过1 MiB' }
}
async function template() {
  const current = generation
  try {
    const blob = await downloadExpertTemplate()
    if (current !== generation) return
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = 'expert-profile-template.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { if (current === generation) error.value = '模板下载失败 请重试' }
}
async function preview() {
  if (!file.value || busy.value) return
  const current = ++generation; busy.value = true; error.value = ''; pending.value = undefined
  try {
    const result = await previewExpertImport(file.value)
    if (current !== generation) return
    pending.value = result; now.value = Date.now(); key = crypto.randomUUID()
  } catch { if (current === generation) error.value = '预览失败 请检查UTF-8编码、模板列和500行限制后重试' }
  finally { if (current === generation) busy.value = false }
}
async function apply() {
  if (!pending.value || pending.value.errors.length || expired.value || busy.value) return
  const current = generation; busy.value = true; error.value = ''
  try {
    const result = await applyExpertImport(pending.value.preview_id, key)
    if (current === generation) emit('applied', result.updated_count)
  } catch (cause) {
    if (current !== generation) return
    const status = (cause as { response?: { status?: number } })?.response?.status
    if (status === 409 || status === 404) { pending.value = undefined; error.value = '预览失效或档案已变更 整批未更新 请重新预览' }
    else error.value = '请求未确认 可再次确认导入 系统会防止重复写入'
  } finally { if (current === generation) busy.value = false }
}
</script>
<template>
  <dialog ref="dialog" role="dialog" aria-modal="true" aria-labelledby="expert-import-title" @cancel.prevent="close">
    <header><h2 id="expert-import-title">导入专家资料</h2><button type="button" aria-label="关闭导入" :disabled="busy" @click="close"><Close width="18" /></button></header>
    <p>仅更新已有专家 按登录名精确匹配 不创建账号 不改变资格、服务状态和回避信息</p>
    <p class="hint">人工导入 / 未核验 来源链接仅作记录 不自动采集</p>
    <button type="button" :disabled="busy" @click="template">下载 CSV 模板</button>
    <p>UTF-8 · 最多 1 MiB / 500 行 列表用英文分号分隔 导师资格填 true、false 或留空</p>
    <p>空白可空字段将清空已有值 请逐项核对差异后确认</p>
    <label>选择专家 CSV<input type="file" accept=".csv,text/csv" :disabled="busy" @change="choose" /></label>
    <button type="button" data-action="preview-import" :disabled="!file || busy" @click="preview">{{ busy ? '处理中…' : '生成预览' }}</button>
    <Transition name="import"><p v-if="error" role="alert">{{ error }}</p></Transition>
    <Transition name="import"><section v-if="pending" class="preview">
      <template v-if="!expired">
        <p>预览有效至 {{ new Date(pending.expires_at).toLocaleTimeString() }}</p>
        <ul v-if="pending.errors.length" role="alert"><li v-for="e in pending.errors" :key="e.row">第 {{ e.row }} 行：{{ e.message }}</li></ul>
        <article v-for="change in pending.changes" :key="change.expert_id">
          <h3>{{ change.username }}</h3>
          <p v-if="!Object.keys(change.diff).length">无变化 将跳过更新</p>
          <dl v-else><template v-for="(values, field) in change.diff" :key="field"><dt>{{ labels[field] || field }}</dt><dd>{{ display(values.before, field) }} → {{ display(values.after, field) }}</dd></template></dl>
        </article>
      </template>
      <p v-else role="alert">预览已过期 请重新预览</p>
      <button type="button" data-action="apply-import" :disabled="busy || expired || pending.errors.length > 0" @click="apply">确认导入</button>
    </section></Transition>
    <footer><button type="button" :disabled="busy" @click="close">取消</button></footer>
  </dialog>
</template>
<style scoped>
dialog { margin: auto; border: 1px solid #dce4ef; border-radius: 16px; padding: 24px; width: min(720px, calc(100vw - 48px)); max-height: 85vh; overflow: auto; color: #0f172a; box-shadow: 0 24px 80px #0f172a26; }
dialog::backdrop { background: #0f172a77; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; } h2 { margin: 0; font-size: 20px; font-weight: 650; } h3 { margin: 8px 0; }
p { margin: 10px 0; line-height: 1.6; } .hint { color: #475569; } label { display: grid; gap: 10px; margin: 16px 0; }
button { border: 1px solid #cbd5e1; border-radius: 6px; background: white; padding: 8px 14px; color: #1e40af; cursor: pointer; transition: transform .18s, background .18s; }
button:hover { background: #eff6ff; transform: translateY(-1px); } button:active { transform: scale(.98); } button:disabled { opacity: .5; cursor: default; transform: none; }
.preview { margin: 18px 0; } article { border-top: 1px solid #e2e8f0; padding: 12px 0; } dl { display: grid; grid-template-columns: 90px 1fr; gap: 10px; } dd { margin: 0; overflow-wrap: anywhere; } [role=alert] { color: #b91c1c; }
.import-enter-active, .import-leave-active { transition: opacity .2s, transform .2s; } .import-enter-from, .import-leave-to { opacity: 0; transform: translateY(6px); }
@media (prefers-reduced-motion: reduce) { button, .import-enter-active, .import-leave-active { transition: none; } }
</style>
