<script setup lang="ts">
/**
 * U4-5 校内专业对照：已发布版本 + CSV 导入。生成预览≠写入；有错误不能发布；发布前确认。
 * 预览后改动任一输入即作废预览；发布时后端重新核对，指纹不符 409，只能重新预览。
 * 发布新版本不会更换已绑定的批次（批次只能绑定一次）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { apiFailure } from '@/api/failure'
import { listProgramVersions, previewPrograms, publishPrograms, type CatalogPreview, type CatalogVersion, type ImportInput } from '@/api/schoolPrograms'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'

import { previewStats } from './disciplineView'

const MAX_BYTES = 512_000
let alive = true
onBeforeUnmount(() => (alive = false))

const versions = ref<CatalogVersion[]>([])
const versionsLoading = ref(true)
const versionsError = ref('')
async function loadVersions() {
  versionsLoading.value = true
  versionsError.value = ''
  try {
    const rows = await listProgramVersions({ quiet: true })
    if (alive) versions.value = rows
  } catch (reason) {
    if (alive) versionsError.value = apiFailure(reason).message
  } finally {
    if (alive) versionsLoading.value = false
  }
}
void loadVersions()
const latestOfYear = (row: CatalogVersion) => !versions.value.some((other) => other.year === row.year && other.revision > row.revision)
const date = (value: string) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

const form = ref({ year: new Date().getFullYear(), source: '', edition: '' })
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const preview = ref<CatalogPreview | null>(null)
let payload: ImportInput | null = null
const previewYear = ref(0)
let epoch = 0
const busy = ref(false)
const error = ref('')
const flash = ref('')
const publishOpen = ref(false)
watch([() => form.value.year, () => form.value.source, () => form.value.edition, file], () => {
  epoch++
  preview.value = null
  payload = null
  publishOpen.value = false
}, { flush: 'sync' })

const ready = computed(() => Boolean(file.value) && Boolean(form.value.source.trim()) && Boolean(form.value.edition.trim()) && Number.isInteger(form.value.year))
const stats = computed(() => (preview.value ? previewStats(preview.value) : null))
const shown = computed(() => (preview.value?.changes ?? []).filter((row) => row.action !== '未变'))
const total = computed(() => (preview.value ? preview.value.retained + preview.value.changes.length : 0))
const entry = (value: CatalogPreview['changes'][number]['after']) => `${value.official_code} ${value.official_name}`

function pick(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}
async function makePreview() {
  const chosen = file.value
  if (!chosen || !ready.value || busy.value) return
  error.value = ''
  flash.value = ''
  if (chosen.size > MAX_BYTES) {
    error.value = 'CSV 不得超过 512 KB。'
    return
  }
  const own = epoch
  busy.value = true
  try {
    let csv: string
    try {
      csv = new TextDecoder('utf-8', { fatal: true }).decode(await chosen.arrayBuffer())
    } catch {
      if (alive && own === epoch) error.value = '请使用 UTF-8 编码的 CSV。'
      return
    }
    const body: ImportInput = { year: form.value.year, source: form.value.source, source_version: form.value.edition, csv }
    const result = await previewPrograms(body, { quiet: true })
    if (!alive || own !== epoch) return
    payload = body
    previewYear.value = body.year
    preview.value = result
  } catch (reason) {
    if (alive && own === epoch) error.value = apiFailure(reason).message
  } finally {
    if (alive) busy.value = false
  }
}
function dropPreview() {
  preview.value = null
  payload = null
}
async function publish() {
  const fingerprint = preview.value?.fingerprint
  if (!payload || !fingerprint || busy.value) return
  const own = epoch
  busy.value = true
  error.value = ''
  try {
    const row = await publishPrograms(payload, fingerprint, { quiet: true })
    if (!alive || own !== epoch) return
    publishOpen.value = false
    preview.value = null
    payload = null
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    flash.value = `已发布 ${row.year} 年第 ${row.revision} 版，共 ${row.count} 项。已绑定旧版本的批次不受影响；尚未绑定的批次可以在“批次与规则”里绑定。`
    void loadVersions()
  } catch (reason) {
    if (!alive || own !== epoch) return
    const failure = apiFailure(reason)
    publishOpen.value = false
    preview.value = null
    payload = null
    error.value = failure.status === 409 ? `没有发布：${failure.message}。` : `没有发布：${failure.message}。请修正后重新生成预览。`
  } finally {
    if (alive) busy.value = false
  }
}
</script>

<template>
  <div class="wsd-obj progs">
    <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>

    <section class="wsd-sec" aria-labelledby="ver-h" data-versions>
      <div class="wsd-sec__head"><h3 id="ver-h">已发布版本</h3><p>批次可以绑定其中一个版本，绑定后不再更换</p></div>
      <StateBlock v-if="versionsLoading && !versions.length" kind="loading" title="正在读取已发布版本…" compact />
      <StateBlock v-else-if="versionsError" kind="error" title="已发布版本没有加载出来" compact>
        {{ versionsError }}
        <template #actions><button type="button" class="btn" @click="loadVersions">重试</button></template>
      </StateBlock>
      <p v-else-if="!versions.length" class="wsd-hint">还没有发布过校内专业目录。没有绑定目录的批次，学生只按开放学科选择。</p>
      <div v-else class="wsd-twrap">
        <table class="wsd-dtable">
          <thead><tr><th scope="col">版本</th><th scope="col" class="wsd-n">条目</th><th scope="col">来源版本</th><th scope="col">发布日期</th><th scope="col" class="wsd-shrink"><span class="sr-only">状态</span></th></tr></thead>
          <tbody>
            <tr v-for="row in versions" :key="row.id" :data-version="row.id">
              <td>{{ row.year }} 年第 {{ row.revision }} 版</td>
              <td class="wsd-n num">{{ row.count }}</td>
              <td>{{ row.source_version }}</td>
              <td class="num">{{ date(row.published_at) }}</td>
              <td class="wsd-shrink"><StatusPill v-if="latestOfYear(row)" tone="success">本年度最新</StatusPill></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="wsd-sec" aria-labelledby="imp-h">
      <div class="wsd-sec__head"><h3 id="imp-h">导入新版本</h3><p>按校方正式文件，每行一个校内专业，对照到官方学科</p></div>
      <div class="wsd-grid2">
        <label class="field">
          <span>目录年度</span>
          <input v-model.number="form.year" class="input num" type="number" min="1900" max="2199" data-field="program-year" :disabled="busy" />
        </label>
        <label class="field">
          <span>来源版本</span>
          <input v-model="form.edition" class="input" maxlength="80" placeholder="例如 2026 年修订版" data-field="program-edition" :disabled="busy" />
        </label>
        <label class="field wsd-wide">
          <span>校方出处</span>
          <input v-model="form.source" class="input" maxlength="512" placeholder="正式文件名或官方链接" data-field="program-source" :disabled="busy" />
        </label>
        <label class="field wsd-wide">
          <span>CSV 文件（UTF-8，不超过 512 KB）</span>
          <input ref="fileInput" class="input" type="file" accept=".csv,text/csv" data-field="program-file" :disabled="busy" @change="pick" />
        </label>
      </div>
      <p class="wsd-hint">表头为“校内代码,校内名称,官方代码,状态”；代码按文本保留前导零，状态填“启用”或“停用”。同一年度里文件没列出的条目保留不变。<a href="/school-program-template.csv" download>下载表头模板</a></p>
      <p v-if="error" class="field-error" role="alert">{{ error }}</p>
      <div class="wsd-acts">
        <button type="button" class="btn btn--outline" data-action="preview-programs" :disabled="busy || !ready" @click="makePreview">{{ busy && !preview ? '正在生成预览…' : '生成预览' }}</button>
      </div>
    </section>

    <section v-if="preview && stats" class="wsd-sec wsd-sec--attention" aria-labelledby="pre-h" data-preview>
      <div class="wsd-sec__head">
        <h3 id="pre-h">预览：{{ previewYear }} 年第 {{ preview.revision }} 版</h3>
        <StatusPill tone="warning">预览未写入</StatusPill>
      </div>
      <p class="wsd-hint">这只是对比结果，目录没有任何变化。确认发布后才会生成新版本。</p>
      <ul class="stats">
        <li><span class="num">{{ stats.added }}</span> 新增</li>
        <li><span class="num">{{ stats.changed }}</span> 变更</li>
        <li><span class="num">{{ stats.unchanged }}</span> 未变</li>
        <li><span class="num">{{ stats.retained }}</span> 保留（文件未列出）</li>
        <li v-if="stats.inactive"><span class="num">{{ stats.inactive }}</span> 其中停用</li>
        <li :class="{ bad: stats.errors }"><span class="num">{{ stats.errors }}</span> 错误</li>
      </ul>
      <div v-if="preview.errors.length" class="wsd-banner wsd-banner--danger" role="alert" data-preview-errors>
        <strong>有 {{ preview.errors.length }} 处需要修正：修改 CSV 后重新生成预览</strong>
        <ul class="errs"><li v-for="(item, index) in preview.errors" :key="index">{{ item }}</li></ul>
      </div>
      <div v-if="shown.length" class="wsd-twrap">
        <table class="wsd-dtable">
          <thead><tr><th scope="col">变化</th><th scope="col">校内代码</th><th scope="col">校内名称</th><th scope="col">对照官方学科</th><th scope="col">状态</th></tr></thead>
          <tbody>
            <tr v-for="row in shown" :key="row.code">
              <td><span class="wsd-tag" :class="row.action === '新增' ? 'tag--add' : ''">{{ row.action }}</span></td>
              <td class="num">{{ row.code }}</td>
              <td>{{ row.after.name }}<span v-if="row.before && row.before.name !== row.after.name" class="muted">（原：{{ row.before.name }}）</span></td>
              <td>{{ entry(row.after) }}<span v-if="row.before && row.before.official_code !== row.after.official_code" class="muted">（原：{{ entry(row.before) }}）</span></td>
              <td>{{ row.after.active ? '启用' : '停用' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="wsd-acts wsd-acts--end">
        <button type="button" class="btn" :disabled="busy" @click="dropPreview">放弃预览</button>
        <button type="button" class="btn btn--primary" data-action="publish-programs" :disabled="busy || !preview.fingerprint || preview.errors.length > 0" @click="publishOpen = true">发布第 {{ preview.revision }} 版…</button>
      </div>
    </section>
  </div>

  <ConfirmDialog :open="publishOpen && Boolean(preview)" title="发布校内专业目录" :busy="busy" @close="busy || (publishOpen = false)">
    <p>发布 {{ previewYear }} 年第 {{ preview?.revision }} 版，共 {{ total }} 项。发布后版本内容不再修改。</p>
    <p class="muted">已绑定旧版本的批次不会更换；尚未绑定的批次可以在“批次与规则”里绑定新版本。</p>
    <template #actions>
      <button type="button" class="btn" :disabled="busy" @click="publishOpen = false">取消</button>
      <button type="button" class="btn btn--primary" data-action="confirm-publish" :disabled="busy" @click="publish">发布</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.progs {
  max-width: 1080px;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ws-muted);
  font-size: 13px;
}
.stats .num {
  margin-right: 2px;
  color: var(--ws-text);
  font-size: 18px;
  font-weight: 600;
}
.stats .bad,
.stats .bad .num {
  color: var(--ws-danger);
}
.errs {
  margin: 0;
  padding-left: 1.1em;
}
.tag--add {
  background: var(--ws-success-soft);
  color: var(--ws-success);
}
</style>
