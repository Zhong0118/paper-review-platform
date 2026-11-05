<script setup lang="ts">
/**
 * U4-6 导入专家档案：只更新已有专家（按登录名精确匹配），不建账号，不动资格、服务与回避。
 * 生成预览≠写入；有错误不能应用；过期只能重新预览；应用 409/404 作废预览、整批未写；
 * 其他失败保留预览，用同一把幂等键再次确认。调用方式沿用旧 ExpertImportDialog（已在 U4-9 删除）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { applyExpertImport, downloadExpertTemplate, previewExpertImport, type ExpertImportPreview } from '@/api/expertOperations'
import { apiFailure } from '@/api/failure'
import StatusPill from '@/components/workspace/StatusPill.vue'

const MAX_BYTES = 1024 * 1024
const emit = defineEmits<{ applied: [count: number] }>()
const labels: Record<string, string> = {
  unit: '单位', title: '职称', discipline_codes: '学科', province_name: '省份', doctoral_supervisor: '博导', masters_supervisor: '硕导',
  research_directions: '研究方向', keywords: '关键词', source_url: '来源链接', source_note: '来源说明',
}
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const pending = ref<ExpertImportPreview | null>(null)
const busy = ref(false)
const error = ref('')
const done = ref<number | null>(null)
const now = ref(Date.now())
let generation = 0
let key = ''
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => (timer = setInterval(() => (now.value = Date.now()), 1000)))
onBeforeUnmount(() => {
  generation++
  clearInterval(timer)
})

const expired = computed(() => Boolean(pending.value) && Date.parse(pending.value!.expires_at) <= now.value)
const changed = computed(() => (pending.value?.changes ?? []).filter((change) => Object.keys(change.diff).length))
const unchanged = computed(() => (pending.value?.changes.length ?? 0) - changed.value.length)
const until = computed(() => {
  if (!pending.value) return ''
  const at = new Date(pending.value.expires_at)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
})
function display(value: unknown, field: string) {
  if (value == null) return field.endsWith('_supervisor') ? '未知' : '清空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join('、') || '清空'
  return String(value) || '清空'
}

function choose(event: Event) {
  generation++
  pending.value = null
  error.value = ''
  done.value = null
  key = ''
  const chosen = (event.target as HTMLInputElement).files?.[0] ?? null
  if (chosen && chosen.size > MAX_BYTES) {
    file.value = null
    error.value = 'CSV 不得超过 1 MiB。'
    return
  }
  file.value = chosen
}
async function template() {
  const own = generation
  try {
    const blob = await downloadExpertTemplate()
    if (own !== generation) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'expert-profile-template.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (reason) {
    if (own === generation) error.value = `模板没有下载下来：${apiFailure(reason).message}`
  }
}
async function preview() {
  if (!file.value || busy.value) return
  const own = ++generation
  busy.value = true
  error.value = ''
  done.value = null
  pending.value = null
  try {
    const result = await previewExpertImport(file.value, { quiet: true })
    if (own !== generation) return
    pending.value = result
    now.value = Date.now()
    key = crypto.randomUUID()
  } catch (reason) {
    if (own === generation) error.value = `没有生成预览：${apiFailure(reason).message}`
  } finally {
    if (own === generation) busy.value = false
  }
}
function reset() {
  generation++
  pending.value = null
  file.value = null
  key = ''
  if (fileInput.value) fileInput.value.value = ''
}
async function apply() {
  if (!pending.value || pending.value.errors.length || expired.value || busy.value) return
  const own = generation
  busy.value = true
  error.value = ''
  try {
    const result = await applyExpertImport(pending.value.preview_id, key, { quiet: true })
    if (own !== generation) return
    done.value = result.updated_count
    reset()
    emit('applied', result.updated_count)
  } catch (reason) {
    if (own !== generation) return
    const failure = apiFailure(reason)
    if (failure.status === 409 || failure.status === 404) {
      pending.value = null
      key = ''
      error.value = `整批没有更新：${failure.message}。请重新生成预览。`
    } else error.value = `没有确认是否写入（${failure.message}）。可以再次点击应用，系统会防止重复写入。`
  } finally {
    if (own === generation) busy.value = false
  }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <h2 class="wsd-obj__title">导入专家档案</h2>
      <p class="wsd-hint">批量更新已有专家的档案字段，按登录名精确匹配；不会新建账号，也不改动资格、服务状态与回避关系。新专家请用“新建专家”。资料为人工导入、未核验，来源链接只作记录，不会自动读取。</p>
    </header>
    <div v-if="done !== null" class="wsd-banner wsd-banner--ok" role="status">
      <strong>已更新 {{ done }} 位专家的档案</strong>
      <span>有变化的档案同时更新了“最近人工维护”时间。资格、服务状态与回避关系没有变化。</span>
    </div>
    <section class="wsd-sec">
      <p class="wsd-hint">UTF-8，最多 1 MiB、500 行。列表字段用英文分号分隔，导师资格填 true、false 或留空。可空字段留空会清空已有值，请逐项核对预览。</p>
      <div class="wsd-acts">
        <label class="field file">
          <span class="sr-only">选择专家 CSV</span>
          <input ref="fileInput" class="input" type="file" accept=".csv,text/csv" data-field="import-file" :disabled="busy" @change="choose" />
        </label>
        <button type="button" class="btn btn--outline" data-action="preview-import" :disabled="!file || busy" @click="preview">{{ busy && !pending ? '正在生成预览…' : '生成预览' }}</button>
        <button type="button" class="btn btn--quiet btn--sm" data-action="download-template" :disabled="busy" @click="template">下载模板</button>
      </div>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
    </section>

    <section v-if="pending" class="wsd-sec wsd-sec--attention" aria-labelledby="ip-h" data-import-preview>
      <div class="wsd-sec__head">
        <h3 id="ip-h">预览</h3>
        <StatusPill :tone="expired || pending.errors.length ? 'danger' : 'warning'">{{ expired ? '预览已过期' : pending.errors.length ? '预览有错误，不能应用' : `预览未写入，${until} 前有效` }}</StatusPill>
      </div>
      <div v-if="expired" class="wsd-banner wsd-banner--danger" role="alert">
        <strong>这份预览已过期，整批没有更新</strong>
        <span>请重新生成预览。</span>
      </div>
      <div v-else-if="pending.errors.length" class="wsd-banner wsd-banner--danger" role="alert" data-import-errors>
        <strong>{{ pending.errors.length }} 行有错误，整份文件都不能应用</strong>
        <span v-for="item in pending.errors" :key="item.row">第 {{ item.row }} 行：{{ item.message }}</span>
        <span>修正 CSV 后重新生成预览。</span>
      </div>
      <p class="wsd-hint">{{ changed.length }} 位专家有变化，{{ unchanged }} 位与现有档案一致（将跳过）。</p>
      <div v-if="changed.length" class="wsd-twrap">
        <table class="wsd-dtable">
          <thead><tr><th scope="col">登录名</th><th scope="col">字段</th><th scope="col">现在</th><th scope="col">导入后</th></tr></thead>
          <tbody>
            <template v-for="change in changed" :key="change.expert_id">
              <tr v-for="(values, field, index) in change.diff" :key="`${change.expert_id}:${field}`">
                <td>{{ index === 0 ? change.username : '' }}</td>
                <td>{{ labels[field] || field }}</td>
                <td class="muted">{{ display(values.before, String(field)) }}</td>
                <td>{{ display(values.after, String(field)) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn" :disabled="busy" @click="reset">放弃</button>
        <button v-if="expired || pending.errors.length" type="button" class="btn btn--primary" :disabled="busy || !file" @click="preview">重新生成预览</button>
        <button v-else type="button" class="btn btn--primary" data-action="apply-import" :disabled="busy || !changed.length" @click="apply">{{ busy ? '正在应用…' : `应用到 ${changed.length} 位专家` }}</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.file {
  flex: 1 1 260px;
  max-width: 420px;
}
</style>
