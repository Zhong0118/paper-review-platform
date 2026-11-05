<script setup lang="ts">
/**
 * P05 学校核验台（专注外壳）。发现目录｜匿名稿/原稿｜判断区，底部判断栏。
 * - 检测维度分开读（checkReport.ts）；可做的动作只看 allowed_actions。
 * - 409 先重读详情，再分“已被处理”“已更新”“已不可用”，已写说明一律保留。
 * - 同一次提交尝试重试时沿用同一个幂等键。
 * - 只有服务器确认后才出现“下一篇”。
 * - 确认送出、终止送审原样沿用旧页行为，交互重做属 U2-4。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { confirmDispatch } from '@/api/dispatch'
import { getFileContent } from '@/api/files'
import { confirmAnonymization, getSchoolThesis, terminateThesis } from '@/api/schoolReview'
import { checkSensitiveThesis, type SensitiveFinding } from '@/api/sensitiveChecks'
import type { ThesisDetail } from '@/api/theses'
import FocusShell from '@/components/workspace/FocusShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'

import { anonymousFile, apiFailure, autoText, autoTone, isNotFound, originalFile, readReport, stageLabel } from './checkReport'

const props = defineProps<{ thesisId: string; rows: ThesisDetail[]; rowsReady: boolean; account: WorkspaceAccount }>()
const emit = defineEmits<{ changed: [] }>()
const route = useRoute()
const router = useRouter()

const detail = ref<ThesisDetail | null>(null)
const loadState = ref<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
const loadError = ref('')

/** silent：操作后刷新时不闪回加载态 */
async function fetchDetail(silent = false) {
  if (!silent) loadState.value = 'loading'
  try {
    detail.value = await getSchoolThesis(props.thesisId)
    loadState.value = 'ready'
  } catch (error) {
    if (isNotFound(error)) loadState.value = 'unavailable'
    else {
      loadState.value = 'error'
      loadError.value = apiFailure(error).message
    }
  }
}

const report = computed(() => (detail.value ? readReport(detail.value) : null))
const actions = computed(() => new Set(detail.value?.allowed_actions ?? []))
const canPass = computed(() => actions.value.has('CONFIRM_ANONYMIZATION'))
const canReturn = computed(() => actions.value.has('REJECT_ANONYMIZATION'))
const deciding = computed(() => detail.value?.stage === 'PREPARING' && (canPass.value || canReturn.value))
const passOffText = computed(() => report.value?.passBlocked || '当前不能通过核验，以服务端给出的可用操作为准')

// ── 位置与下一篇：清单只用来排序，当前论文永远排除 ──
const order = ref<string[]>([])
watch(
  () => props.rowsReady,
  (ready) => {
    if (ready && !order.value.length) order.value = props.rows.filter((row) => row.stage === 'PREPARING').map((row) => row.id)
  },
  { immediate: true },
)
const position = computed(() => order.value.indexOf(props.thesisId) + 1)
const nextId = computed(() => {
  const index = order.value.indexOf(props.thesisId)
  const pending = new Set(props.rows.filter((row) => row.stage === 'PREPARING').map((row) => row.id))
  const candidates = index < 0 ? order.value : [...order.value.slice(index + 1), ...order.value.slice(0, index)]
  return candidates.find((id) => id !== props.thesisId && pending.has(id)) ?? null
})
function queueQuery() {
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(route.query)) if (typeof value === 'string' && value && key !== 'thesis') query[key] = value
  return query
}
const backTo = computed(() => ({ path: '/school/preparation', query: { ...queueQuery(), sel: props.thesisId } }))
function goNext() {
  if (nextId.value) void router.replace({ query: { ...queueQuery(), thesis: nextId.value } })
}

// ── 判断 ──
const decision = ref<'pass' | 'return'>('pass')
const note = ref('')
const returnReason = ref('')
const touched = ref(false)
const submitting = ref(false)
const outcome = ref<null | 'passed' | 'returned'>(null)
const submitError = ref('')
const conflict = ref<null | { kind: 'taken' | 'updated' | 'gone'; latest: ThesisDetail | null }>(null)
watch(
  [canPass, canReturn],
  () => {
    if (!canPass.value && canReturn.value) decision.value = 'return'
  },
  { immediate: true },
)
const decisionText = computed(() => (decision.value === 'pass' ? note.value : returnReason.value))
const validation = computed(() => {
  if (decision.value === 'pass') {
    if (!canPass.value) return passOffText.value
    if (report.value?.passNeedsReason && !note.value.trim()) return '请说明你核对了哪些学校词表提示、为何不构成身份泄露'
    return ''
  }
  return returnReason.value.trim() ? '' : '请写明需要学生修改的内容'
})
const locked = computed(() => conflict.value?.kind === 'taken' || conflict.value?.kind === 'gone')

let attempt: { signature: string; key: string } | null = null
function idempotencyKey(signature: string) {
  if (attempt?.signature !== signature) attempt = { signature, key: crypto.randomUUID() }
  return attempt.key
}

async function submit() {
  touched.value = true
  const current = detail.value
  if (!current || validation.value || submitting.value || locked.value || conflict.value) return
  const body: { decision: 'PASS' | 'REJECT'; version: number; reason?: string } = { decision: decision.value === 'pass' ? 'PASS' : 'REJECT', version: current.version }
  const text = decisionText.value.trim()
  if (text) body.reason = text
  submitting.value = true
  submitError.value = ''
  try {
    await confirmAnonymization(current.id, body, { idempotencyKey: idempotencyKey(JSON.stringify(body)) })
    attempt = null
    // 保留作出判断时的报告与材料；服务端新状态只用于刷新清单
    outcome.value = decision.value === 'pass' ? 'passed' : 'returned'
    emit('changed')
  } catch (error) {
    const failure = apiFailure(error)
    if (failure.status === 409) await classifyConflict()
    else if (isNotFound(error)) conflict.value = { kind: 'gone', latest: null }
    else submitError.value = failure.message
  } finally {
    submitting.value = false
  }
}

async function classifyConflict() {
  try {
    const latest = await getSchoolThesis(props.thesisId)
    conflict.value = { kind: latest.stage === 'PREPARING' ? 'updated' : 'taken', latest }
    emit('changed')
  } catch (error) {
    if (isNotFound(error)) conflict.value = { kind: 'gone', latest: null }
    else submitError.value = `提交没有生效，且未能读取最新状态：${apiFailure(error).message}`
  }
}
function loadLatest() {
  if (!conflict.value?.latest) return
  detail.value = conflict.value.latest
  conflict.value = null
  attempt = null
  touched.value = false
}
function quote(finding: SensitiveFinding) {
  const where = finding.page_number ? `第 ${finding.page_number} 页` : sourceLabel(finding)
  const line = `${where}出现“${finding.matched_text}”`
  decision.value = 'return'
  returnReason.value = returnReason.value ? `${returnReason.value}；${line}` : line
}

// ── 重新检测（旧页行为） ──
const rechecking = ref(false)
const recheckError = ref('')
async function recheck() {
  const current = detail.value
  const file = current ? anonymousFile(current) : null
  if (!current || !file || rechecking.value) return
  rechecking.value = true
  recheckError.value = ''
  try {
    await checkSensitiveThesis(current.id, { expected_version: current.version, file_id: file.file_id }, true)
    const latest = await getSchoolThesis(current.id)
    detail.value = latest
    emit('changed')
  } catch (error) {
    recheckError.value = apiFailure(error).message
  } finally {
    rechecking.value = false
  }
}

// ── 确认送出与终止（沿用旧页行为） ──
const transitionBusy = ref(false)
const transitionNotice = ref('')
const terminateReason = ref('')
async function sendOut() {
  const current = detail.value
  if (!current || transitionBusy.value) return
  transitionBusy.value = true
  transitionNotice.value = ''
  try {
    await confirmDispatch(current.id, current.version, { idempotencyKey: crypto.randomUUID() })
    transitionNotice.value = '已确认送出，论文交给百杰运营派单。'
    await fetchDetail(true)
    emit('changed')
  } catch (error) {
    transitionNotice.value = apiFailure(error).message || '确认送出失败'
  } finally {
    transitionBusy.value = false
  }
}
async function terminate() {
  const current = detail.value
  const reason = terminateReason.value.trim()
  if (!current || transitionBusy.value || !reason || !actions.value.has('TERMINATE')) return
  if (!window.confirm(`确认永久终止“${current.current_version?.title ?? '这篇论文'}”？未完成专家任务将取消，历史记录保留。`)) return
  transitionBusy.value = true
  transitionNotice.value = ''
  try {
    await terminateThesis(current.id, { version: current.version, reason }, { idempotencyKey: crypto.randomUUID() })
    terminateReason.value = ''
    transitionNotice.value = '已终止送审，未完成任务已取消。'
    await fetchDetail(true)
    emit('changed')
  } catch (error) {
    transitionNotice.value = apiFailure(error).message || '终止失败'
  } finally {
    transitionBusy.value = false
  }
}

// ── 材料：Blob 仅存在于本页，离开即撤销 ──
const material = ref<'anonymous' | 'original'>('anonymous')
const compare = ref(false)
const focusPage = ref(1)
const urls = ref<Record<string, string>>({})
const fileBusy = ref<Record<string, boolean>>({})
const fileError = ref<Record<string, string>>({})
const anonymous = computed(() => (detail.value ? anonymousFile(detail.value) : null))
const original = computed(() => (detail.value ? originalFile(detail.value) : null))
async function ensureFile(fileId: string | undefined) {
  if (!fileId || urls.value[fileId] || fileBusy.value[fileId]) return
  fileBusy.value = { ...fileBusy.value, [fileId]: true }
  fileError.value = { ...fileError.value, [fileId]: '' }
  try {
    const blob = await getFileContent(fileId)
    urls.value = { ...urls.value, [fileId]: URL.createObjectURL(blob) }
  } catch (error) {
    fileError.value = { ...fileError.value, [fileId]: apiFailure(error).message || 'PDF 加载失败' }
  } finally {
    fileBusy.value = { ...fileBusy.value, [fileId]: false }
  }
}
watch(anonymous, (file) => void ensureFile(file?.file_id), { immediate: true })
watch([material, compare], () => {
  if (material.value === 'original' || compare.value) void ensureFile(original.value?.file_id)
})
function revokeAll() {
  for (const url of Object.values(urls.value)) URL.revokeObjectURL(url)
  urls.value = {}
}
const viewed = ref<Set<string>>(new Set())
const openFinding = ref<string | null>(null)
const findingKey = (finding: SensitiveFinding, index: number) => `${finding.severity}-${index}-${finding.matched_text}`
function locate(finding: SensitiveFinding, key: string) {
  viewed.value = new Set([...viewed.value, key])
  openFinding.value = openFinding.value === key ? null : key
  if (finding.page_number) {
    material.value = 'anonymous'
    compare.value = false
    focusPage.value = finding.page_number
    mobileTab.value = 'doc'
  }
  if (mid.value) showFindingsCol.value = false
}
const SOURCES: Record<string, string> = { filename: '文件名', metadata: '文件元数据', thesis_metadata: '登记信息', title: '标题文字核对' }
const sourceLabel = (finding: SensitiveFinding) => SOURCES[finding.source ?? finding.location] ?? '其他来源'
const groups = computed(() =>
  (
    [
      { key: 'BLOCK', label: '阻断', tone: 'danger' },
      { key: 'WARN', label: '警告', tone: 'warning' },
    ] as const
  )
    .map((group) => ({ ...group, items: (report.value?.findings ?? []).map((finding, index) => ({ finding, key: findingKey(finding, index) })).filter((item) => item.finding.severity === group.key) }))
    .filter((group) => group.items.length),
)

// ── 响应式分栏 ──
const mobileTab = ref<'findings' | 'doc' | 'decide'>('doc')
const narrow = ref(false)
const mid = ref(false)
const showFindingsCol = ref(true)
let media: MediaQueryList | null = null
let midMedia: MediaQueryList | null = null
const sync = () => {
  narrow.value = media?.matches ?? false
  const wasMid = mid.value
  mid.value = !narrow.value && (midMedia?.matches ?? false)
  if (mid.value !== wasMid) showFindingsCol.value = !mid.value
}
onMounted(() => {
  void fetchDetail()
  if (typeof window.matchMedia !== 'function') return
  media = window.matchMedia('(max-width: 859px)')
  midMedia = window.matchMedia('(max-width: 1279px)')
  sync()
  media.addEventListener('change', sync)
  midMedia.addEventListener('change', sync)
})
onBeforeUnmount(() => {
  media?.removeEventListener('change', sync)
  midMedia?.removeEventListener('change', sync)
  revokeAll()
})
</script>

<template>
  <FocusShell :account="account">
    <template #back>
      <RouterLink class="btn btn--quiet back" :to="backTo">‹ 返回清单</RouterLink>
    </template>
    <template #identity>
      <template v-if="detail">
        <h1 class="vt-title" :title="detail.current_version?.title">{{ detail.current_version?.title || '未命名论文' }}</h1>
        <span class="vt-meta muted">{{ detail.student?.name }}　{{ detail.current_version?.school_program?.name || detail.current_version?.discipline_name }}</span>
      </template>
    </template>
    <template #status>
      <span v-if="position > 0" class="vt-pos muted num">待核验 {{ position }} / {{ order.length }}</span>
      <StatusPill v-else-if="detail" tone="neutral">{{ stageLabel(detail.stage) }}</StatusPill>
    </template>

    <StateBlock v-if="loadState === 'loading'" kind="loading" title="正在读取论文与检测报告…" />
    <StateBlock v-else-if="loadState === 'unavailable'" kind="forbidden" title="这篇论文已不可用">
      它可能已被删除、不属于本校，或链接有误。
      <template #actions><RouterLink class="btn btn--primary" :to="backTo">返回清单</RouterLink></template>
    </StateBlock>
    <StateBlock v-else-if="loadState === 'error'" kind="error" title="论文没有加载出来">
      {{ loadError }}
      <template #actions><button type="button" class="btn btn--primary" @click="fetchDetail()">重试</button></template>
    </StateBlock>

    <div v-else-if="detail && report" class="verify">
      <nav v-if="narrow" class="mtabs" aria-label="核验视图">
        <button type="button" :aria-pressed="mobileTab === 'findings'" @click="mobileTab = 'findings'">发现 {{ report.findings.length }}</button>
        <button type="button" :aria-pressed="mobileTab === 'doc'" @click="mobileTab = 'doc'">材料</button>
        <button type="button" :aria-pressed="mobileTab === 'decide'" @click="mobileTab = 'decide'">判断</button>
      </nav>

      <div class="verify__grid" :class="{ 'verify__grid--nofind': !showFindingsCol || compare || mid, 'verify__grid--narrow': narrow, 'verify__grid--mid': mid }">
        <aside v-show="narrow ? mobileTab === 'findings' : showFindingsCol && !compare" class="col col--find" :class="{ 'col--overlay': mid }" aria-label="检测发现">
          <div class="find__head">
            <h2>检测发现 <span class="num muted">{{ report.findings.length }}</span></h2>
            <button v-if="!narrow" type="button" class="btn btn--sm btn--quiet" @click="showFindingsCol = false">收起</button>
          </div>
          <p v-if="report.stale" class="find__empty">报告已过期，单项发现不再对应当前匿名稿，这里不展示。</p>
          <p v-else-if="report.auto === null" class="find__empty">当前匿名稿还没有检测报告。</p>
          <p v-else-if="!report.findings.length" class="find__empty">
            检测器没有发现身份线索。这不代表匿名化一定完整，请在材料中人工通读封面、致谢、附录和页眉页脚。
          </p>
          <section v-for="group in groups" :key="group.key" class="find__group">
            <h3><StatusPill :tone="group.tone">{{ group.label }} {{ group.items.length }}</StatusPill></h3>
            <ul>
              <li v-for="item in group.items" :key="item.key">
                <button type="button" class="finding" :class="{ 'finding--open': openFinding === item.key }" :aria-expanded="openFinding === item.key" @click="locate(item.finding, item.key)">
                  <span class="finding__top">
                    <span class="num">{{ item.finding.page_number ? `第 ${item.finding.page_number} 页` : sourceLabel(item.finding) }}</span>
                    <span class="muted">{{ item.finding.kind === 'SCHOOL_TERM' ? '学校词表' : '身份信息' }}</span>
                    <span v-if="viewed.has(item.key)" class="finding__seen">已查看</span>
                  </span>
                  <span class="finding__match">“{{ item.finding.matched_text }}”</span>
                </button>
                <div v-if="openFinding === item.key" class="finding__detail">
                  <p v-if="item.finding.context" class="context">{{ item.finding.context }}</p>
                  <p v-if="item.finding.description" class="muted">{{ item.finding.description }}</p>
                  <button v-if="canReturn && !locked" type="button" class="btn btn--sm" @click="quote(item.finding)">写入退回原因</button>
                </div>
              </li>
            </ul>
          </section>
        </aside>

        <section v-show="!narrow || mobileTab === 'doc'" class="col col--doc" aria-label="论文材料">
          <div class="doc-switch">
            <button v-if="!showFindingsCol && !compare && !narrow" type="button" class="btn btn--sm" @click="showFindingsCol = true">发现 {{ report.findings.length }}</button>
            <div class="seg" role="group" aria-label="材料">
              <button type="button" :aria-pressed="material === 'anonymous' && !compare" @click="material = 'anonymous'; compare = false">匿名稿</button>
              <button type="button" :aria-pressed="material === 'original' && !compare" :disabled="!original" @click="material = 'original'; compare = false">原稿</button>
              <button v-if="!narrow" type="button" :aria-pressed="compare" :disabled="!original" @click="compare = !compare">并排对照</button>
            </div>
            <p class="visibility">
              <template v-if="compare">左：原稿（仅本校可见）｜右：匿名稿（这份材料将交给评阅专家）</template>
              <template v-else-if="material === 'anonymous'">你正在看匿名稿，这份材料将交给评阅专家<template v-if="focusPage > 1">；已定位到 PDF 物理第 {{ focusPage }} 页</template></template>
              <template v-else>你正在看原稿，仅本校可见，不会交给专家</template>
            </p>
          </div>
          <div class="doc-area" :class="{ 'doc-area--compare': compare }">
            <template v-for="file in compare ? [original, anonymous] : [material === 'anonymous' ? anonymous : original]" :key="file?.file_id ?? 'none'">
              <StateBlock v-if="!file" kind="empty" title="没有这份材料" compact>学生尚未上传。</StateBlock>
              <StateBlock v-else-if="fileError[file.file_id]" kind="error" title="PDF 没有加载出来" compact>
                {{ fileError[file.file_id] }}
                <template #actions><button type="button" class="btn btn--sm" @click="ensureFile(file.file_id)">重试</button></template>
              </StateBlock>
              <StateBlock v-else-if="!urls[file.file_id]" kind="loading" title="正在读取 PDF…" compact />
              <iframe
                v-else
                :key="`${file.file_id}-${file.purpose === 'anonymous' ? focusPage : 1}`"
                class="doc-frame"
                :src="`${urls[file.file_id]}#page=${file.purpose === 'anonymous' ? focusPage : 1}`"
                :title="file.purpose === 'anonymous' ? '匿名稿 PDF' : '原稿 PDF'"
              />
            </template>
          </div>
        </section>

        <aside v-show="!narrow || mobileTab === 'decide'" class="col col--decide" aria-label="核验判断">
          <div class="decide">
            <div v-if="conflict?.kind === 'taken'" class="banner" role="status">
              <strong>这篇论文已被处理，当前为“{{ stageLabel(conflict.latest?.stage ?? '') }}”。</strong>
              <span>你的操作没有生效。下方输入保留在本页，可以复制后离开。</span>
            </div>
            <div v-else-if="conflict?.kind === 'gone'" class="banner banner--danger" role="alert">
              <strong>这篇论文已不可用。</strong>
              <span>你的操作没有生效。下方输入保留在本页，可以复制后离开。</span>
            </div>
            <div v-else-if="conflict?.kind === 'updated'" class="banner banner--danger" role="alert">
              <strong>提交没有生效：论文在你打开后已更新。</strong>
              <span>你的说明仍在下方。请载入最新材料，重新核对后再提交。</span>
              <button type="button" class="btn btn--sm" @click="loadLatest">载入最新材料（保留说明）</button>
            </div>
            <div v-if="submitError" class="banner banner--danger" role="alert">
              <strong>提交没有生效。</strong>
              <span>{{ submitError }}</span>
            </div>

            <section class="basis" aria-label="当前报告依据">
              <h2>当前报告依据</h2>
              <dl>
                <dt>{{ report.stale ? '上次自动结论' : '自动结论' }}</dt>
                <dd>
                  <StatusPill v-if="report.auto" :tone="autoTone(report)">{{ autoText(report.auto) }}</StatusPill>
                  <span v-else class="muted">尚未检测</span>
                </dd>
                <dt>报告时效</dt>
                <dd>
                  <StatusPill v-if="report.stale" tone="warning">已过期</StatusPill>
                  <span v-else-if="report.auto">对应当前匿名稿</span>
                  <span v-else class="muted">无报告</span>
                </dd>
                <dt>单项发现</dt>
                <dd>
                  <template v-if="report.stale">以过期报告为准，不展示</template>
                  <template v-else-if="report.auto">阻断 {{ report.blockCount }}，警告 {{ report.warnCount }}</template>
                  <template v-else>—</template>
                </dd>
                <dt>人工结论</dt>
                <dd>{{ report.manual === 'PASS' ? '已通过核验' : report.manual === 'FAIL' ? '已退回' : '尚未作出' }}</dd>
                <template v-if="report.pageCount">
                  <dt>检测对象</dt><dd>匿名稿，共 {{ report.pageCount }} 页</dd>
                </template>
                <template v-if="report.termsVersion !== null">
                  <dt>依据</dt><dd>本校检测词表第 {{ report.termsVersion }} 版</dd>
                </template>
              </dl>
              <div v-if="report.stale" class="basis__stale">
                <p>这份报告不再对应当前匿名稿（材料或登记信息在检测后有变化），不能作为通过依据。</p>
              </div>
              <p v-if="report.uncertainPages.length" class="basis__note">
                第 {{ report.uncertainPages.join('、') }} 页无法可靠提取文字（可能是扫描图片），请人工查看。
              </p>
              <p v-if="report.titleStatus === 'TITLE_NOT_FOUND'" class="basis__note">前两页没有找到登记标题的文字，请人工核对；这不代表论文内容不一致。</p>
              <div v-if="!outcome && detail.stage === 'PREPARING' && anonymous" class="basis__recheck">
                <button type="button" class="btn btn--sm" :disabled="rechecking || locked" @click="recheck">{{ rechecking ? '正在检测…' : '重新检测匿名稿' }}</button>
                <span v-if="recheckError" class="field-error" role="alert">{{ recheckError }}</span>
              </div>
            </section>

            <template v-if="deciding || outcome">
              <fieldset class="choice" :disabled="locked || Boolean(outcome)">
                <legend>你的判断</legend>
                <label class="choice__opt" :class="{ 'choice__opt--off': !canPass }">
                  <input v-model="decision" type="radio" name="decision" value="pass" :disabled="!canPass" />
                  <span>
                    <strong>通过核验</strong>
                    <small v-if="!canPass">{{ passOffText }}</small>
                    <small v-else>匿名稿可以交给专家；之后仍需单独确认送出</small>
                  </span>
                </label>
                <label class="choice__opt" :class="{ 'choice__opt--off': !canReturn }">
                  <input v-model="decision" type="radio" name="decision" value="return" :disabled="!canReturn" />
                  <span>
                    <strong>退回修改</strong>
                    <small>学生收到原因后修改，论文回到草稿</small>
                  </span>
                </label>
              </fieldset>

              <label v-if="decision === 'pass'" class="field">
                <span>通过说明（校内留存）<template v-if="!report.passNeedsReason">，选填</template></span>
                <textarea
                  v-model="note"
                  class="textarea"
                  :disabled="locked || Boolean(outcome)"
                  :aria-invalid="touched && Boolean(validation)"
                  aria-describedby="decision-err"
                  placeholder="例如：第 3 页的校区名称是公开地名，不指向个人。"
                />
                <small v-if="report.passNeedsReason">存在学校词表提示，通过时必须写明核对结论。</small>
              </label>
              <label v-else class="field">
                <span>退回原因（学生会看到）</span>
                <textarea
                  v-model="returnReason"
                  class="textarea"
                  :disabled="locked || Boolean(outcome)"
                  :aria-invalid="touched && Boolean(validation)"
                  aria-describedby="decision-err"
                  placeholder="写明需要学生修改的位置与内容"
                />
                <small>可在检测发现中点“写入退回原因”引用页码。</small>
              </label>
              <span v-if="touched && validation && !outcome" id="decision-err" class="field-error">{{ validation }}</span>
            </template>

            <section v-if="!outcome && (actions.has('CONFIRM_DISPATCH') || actions.has('TERMINATE'))" class="transition" aria-label="其他操作">
              <h2>其他操作</h2>
              <button v-if="actions.has('CONFIRM_DISPATCH')" type="button" class="btn btn--primary" :disabled="transitionBusy" @click="sendOut">确认送出</button>
              <template v-if="actions.has('TERMINATE')">
                <label class="field">
                  <span>终止原因（终止送审时必填）</span>
                  <textarea v-model="terminateReason" class="textarea textarea--short" data-terminate-reason :disabled="transitionBusy" />
                </label>
                <button type="button" class="btn btn--danger-outline" data-action="terminate-thesis" :disabled="transitionBusy || !terminateReason.trim()" @click="terminate">终止送审</button>
              </template>
              <p v-if="transitionNotice" role="status" class="muted">{{ transitionNotice }}</p>
            </section>
          </div>
        </aside>
      </div>

      <footer v-if="deciding || outcome" class="decide-bar">
        <div v-if="outcome" class="decide-bar__done" role="status">
          <StatusPill tone="success">{{ outcome === 'passed' ? '已通过核验' : '已退回修改' }}</StatusPill>
          <span>{{ outcome === 'passed' ? '论文进入“待送出”，确认送出需单独操作。' : '学生会看到退回原因。' }}</span>
        </div>
        <p v-else-if="conflict" class="decide-bar__state muted">{{ conflict.kind === 'updated' ? '论文已更新，请载入最新材料' : '这篇论文已不能在此处理' }}</p>
        <p v-else class="decide-bar__state muted">
          待核验<template v-if="report.findings.length">，已查看 {{ viewed.size }} / {{ report.findings.length }} 个发现项</template>
        </p>
        <div class="decide-bar__actions">
          <template v-if="outcome">
            <RouterLink class="btn" :to="backTo">返回清单</RouterLink>
            <button v-if="nextId" type="button" class="btn btn--primary" @click="goNext">下一篇</button>
          </template>
          <button
            v-else
            type="button"
            class="btn btn--primary"
            data-action="submit-decision"
            :disabled="submitting || locked || Boolean(conflict) || (decision === 'pass' && !canPass)"
            @click="submit"
          >
            {{ submitting ? '正在提交…' : decision === 'pass' ? '通过核验' : '退回修改' }}
          </button>
        </div>
      </footer>
    </div>
  </FocusShell>
</template>

<style scoped>
.back {
  min-height: 32px;
  padding: 0 8px;
  color: var(--ws-action);
  text-decoration: none;
}
.vt-title {
  min-width: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vt-meta {
  flex: none;
  font-size: 13px;
}
.vt-pos {
  font-size: 13px;
  white-space: nowrap;
}
.verify {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.verify__grid {
  display: grid;
  flex: 1;
  grid-template-columns: 264px minmax(0, 1fr) 360px;
  min-height: 0;
}
.verify__grid--nofind {
  grid-template-columns: minmax(0, 1fr) 360px;
}
.verify__grid--narrow {
  grid-template-columns: minmax(0, 1fr);
}
.verify__grid--mid {
  position: relative;
  grid-template-columns: minmax(0, 1fr) 340px;
}
.col {
  min-height: 0;
  overflow-y: auto;
  background: var(--ws-surface);
}
.col--find {
  border-right: 1px solid var(--ws-border);
}
.col--overlay {
  position: absolute;
  z-index: 20;
  top: 0;
  bottom: 0;
  left: 0;
  width: 300px;
  box-shadow: var(--ws-shadow-float);
}
.col--doc {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}
.col--decide {
  border-left: 1px solid var(--ws-border);
}
.find__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 4px 16px;
}
.find__head h2 {
  font-size: 14px;
  font-weight: 600;
}
.find__empty {
  margin: 8px 16px;
  color: var(--ws-muted);
  font-size: 13px;
}
.find__group {
  padding: 8px 8px 4px;
}
.find__group h3 {
  margin: 4px 8px 6px;
}
.find__group ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.finding {
  display: grid;
  width: 100%;
  gap: 2px;
  padding: 8px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.finding:hover,
.finding--open {
  background: var(--ws-sunken);
}
.finding__top {
  display: flex;
  gap: 8px;
  font-size: 12px;
}
.finding__seen {
  margin-left: auto;
  color: var(--ws-success);
}
.finding__match {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.finding__detail {
  display: grid;
  gap: 6px;
  justify-items: start;
  margin: 2px 8px 8px;
  padding: 8px 10px;
  border-left: 2px solid var(--ws-border-strong);
  font-size: 13px;
}
.context {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.doc-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ws-border);
}
.seg {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--ws-radius);
  background: var(--ws-sunken);
}
.seg button {
  min-height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ws-muted);
  font-size: 13px;
  cursor: pointer;
}
.seg button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.seg button[aria-pressed='true'] {
  background: var(--ws-surface);
  box-shadow: 0 1px 2px var(--ws-border-strong);
  color: var(--ws-text);
  font-weight: 600;
}
.visibility {
  color: var(--ws-muted);
  font-size: 12px;
}
.doc-area {
  display: grid;
  min-height: 0;
  background: var(--ws-sunken);
}
.doc-area--compare {
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--ws-border);
}
.doc-frame {
  width: 100%;
  height: 100%;
  min-height: 60vh;
  border: 0;
  background: var(--ws-surface);
}
.decide {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.banner {
  display: grid;
  gap: 6px;
  justify-items: start;
  padding: 10px 12px;
  border-left: 3px solid var(--ws-action);
  border-radius: 0 var(--ws-radius) var(--ws-radius) 0;
  background: var(--ws-action-soft);
  font-size: 13px;
}
.banner--danger {
  border-left-color: var(--ws-danger);
  background: var(--ws-danger-soft);
}
.basis h2,
.transition h2,
.choice legend {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
}
.basis dl {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 6px 10px;
  margin: 0;
  font-size: 13px;
}
.basis dt {
  color: var(--ws-muted);
}
.basis dd {
  margin: 0;
}
.basis__stale {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-warning-soft);
  font-size: 13px;
}
.basis__note {
  margin-top: 10px;
  color: var(--ws-muted);
  font-size: 13px;
}
.basis__recheck {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.choice {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}
.choice__opt {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  cursor: pointer;
}
.choice__opt:has(input:checked) {
  border-color: var(--ws-action);
  background: var(--ws-action-soft);
}
.choice__opt--off {
  cursor: not-allowed;
  opacity: 0.7;
}
.choice__opt input {
  margin-top: 3px;
}
.choice__opt span {
  display: grid;
  gap: 2px;
}
.choice__opt small {
  color: var(--ws-muted);
  font-size: 12px;
}
.transition {
  display: grid;
  gap: 10px;
  justify-items: start;
  padding-top: 12px;
  border-top: 1px solid var(--ws-border);
}
.transition .field {
  width: 100%;
}
.textarea--short {
  min-height: 64px;
}
.btn--danger-outline {
  border-color: var(--ws-danger);
  color: var(--ws-danger);
}
.btn--danger-outline:hover:not(:disabled) {
  background: var(--ws-danger-soft);
}
.decide-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  min-height: 56px;
  padding: 8px 16px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.decide-bar__state {
  font-size: 13px;
}
.decide-bar__done {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.decide-bar__actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.mtabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.mtabs button {
  min-height: 44px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ws-muted);
}
.mtabs button[aria-pressed='true'] {
  border-bottom-color: var(--ws-action);
  color: var(--ws-text);
  font-weight: 600;
}
@media (max-width: 859px) {
  .vt-meta,
  .vt-pos {
    display: none;
  }
  .decide-bar__actions {
    width: 100%;
  }
  .decide-bar__actions .btn--primary {
    flex: 1;
  }
}
</style>
