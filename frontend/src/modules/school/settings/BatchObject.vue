<script setup lang="ts">
/**
 * U4-3 批次对象区：生命周期（按 allowed_actions）、基本信息（仅草稿）、期限（草稿/开放）、
 * 校内专业目录（一次性绑定）、收尾核对（非草稿）、评审规则（只读）。
 * 底部提交条一次保存基本信息与期限中改动的部分；409 时保留表单并列出与服务端当前值的对照。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { apiFailure } from '@/api/failure'
import type { ReviewRule } from '@/api/review'
import {
  archiveBatch, closeBatch, getBatchCloseout, openBatch, saveDeadlines, updateBatch,
  type BatchCloseout, type CloseoutItem, type ReviewBatch,
} from '@/api/schoolOperations'
import { pinPrograms, type CatalogVersion } from '@/api/schoolPrograms'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill, { type PillTone } from '@/components/workspace/StatusPill.vue'

import { batchStatusText, changedParts, diffFields, formFrom, parseDays, toIso, validate, type BatchForm, type FormErrors } from './batchForm'

const props = defineProps<{
  batch: ReviewBatch
  rule: ReviewRule | null
  ruleError: string
  versions: CatalogVersion[] | null
  versionsError: string
  reload: () => Promise<ReviewBatch[] | null>
}>()
const emit = defineEmits<{ retryRule: []; retryVersions: [] }>()

let alive = true
onBeforeUnmount(() => (alive = false))
const flash = ref('')
const notice = ref('')

// ---- 表单 ----
const form = ref<BatchForm>(formFrom(props.batch))
const errors = ref<FormErrors>({})
const editBasic = computed(() => props.batch.allowed_actions.includes('EDIT'))
const editDeadlines = computed(() => props.batch.status === 'DRAFT' || props.batch.status === 'OPEN')
const parts = computed(() => {
  const changed = changedParts(form.value, props.batch)
  return { basic: changed.basic && editBasic.value, deadlines: changed.deadlines && editDeadlines.value }
})
const dirty = computed(() => parts.value.basic || parts.value.deadlines)

/** 409 后的对照：保留表单，列出与服务端当前值不同的字段 */
const conflict = ref<{ saved: string } | null>(null)
const conflictRows = computed(() => (conflict.value ? diffFields(form.value, props.batch).filter((row) => (['name', 'startAt', 'endAt'].includes(row.key) ? editBasic.value : editDeadlines.value)) : []))

// 服务端值变化时（他人改动或本页操作后重读），没有未保存修改就跟随服务端
watch(() => props.batch, (next, prev) => {
  if (!conflict.value && prev && !Object.values(changedParts(form.value, prev)).some(Boolean)) form.value = formFrom(next)
})

const saving = ref(false)
const saveError = ref('')
async function save() {
  if (saving.value || !dirty.value) return
  const todo = { ...parts.value }
  errors.value = validate(form.value, todo)
  if (Object.keys(errors.value).length) return
  saving.value = true
  saveError.value = ''
  flash.value = ''
  notice.value = ''
  let version = props.batch.version
  let savedBasic = false
  try {
    if (todo.basic) {
      const next = await updateBatch(props.batch.id, { name: form.value.name.trim(), start_at: toIso(form.value.startAt), end_at: toIso(form.value.endAt), expected_version: version }, { quiet: true })
      version = next.version
      savedBasic = true
    }
    if (todo.deadlines) {
      await saveDeadlines(props.batch.id, version, parseDays(form.value.acceptDays) ?? null, parseDays(form.value.reviewDays) ?? null, { quiet: true })
    }
    if (!alive) return
    conflict.value = null
    const fresh = (await props.reload())?.find((row) => row.id === props.batch.id)
    if (!alive) return
    if (fresh) form.value = formFrom(fresh)
    flash.value = '已保存。'
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    const saved = savedBasic ? '基本信息已保存；' : ''
    if (failure.status === 409) {
      conflict.value = { saved }
      await props.reload()
    } else {
      saveError.value = `${saved}${savedBasic ? '期限没有保存：' : ''}${failure.message}`
      if (savedBasic) await props.reload()
    }
  } finally {
    if (alive) saving.value = false
  }
}
function revert() {
  form.value = formFrom(props.batch)
  errors.value = {}
  conflict.value = null
  saveError.value = ''
}
function keepMine() {
  conflict.value = null
  void save()
}

// ---- 生命周期 ----
type Lifecycle = 'OPEN' | 'CLOSE_SUBMISSIONS' | 'ARCHIVE'
const lifecycle = ref<Lifecycle | null>(null)
const lifecycleBusy = ref(false)
const lifecycleError = ref('')
let lifecycleKey: { signature: string; key: string } | null = null
const lifecycleText = computed(() => {
  const name = props.batch.name
  return lifecycle.value && {
    OPEN: { title: '开放这个批次', body: `开放后，本校学生可以向“${name}”提交论文；名称与起止时间随之不能再改。`, cta: '开放批次', danger: false, done: '批次已开放，学生现在可以提交论文。' },
    CLOSE_SUBMISSIONS: { title: '截止收件', body: `截止后学生不能再向“${name}”提交新论文；已提交的论文继续核验、评审与发布。`, cta: '截止收件', danger: false, done: '已截止收件。已提交的论文继续办理。' },
    ARCHIVE: { title: '归档这个批次', body: `归档后“${name}”只读保留，不能再修改，也不能重新开放。`, cta: '归档', danger: true, done: '批次已归档，只读保留。' },
  }[lifecycle.value]
})
function ask(action: Lifecycle) {
  lifecycleError.value = ''
  lifecycle.value = action
}
async function runLifecycle() {
  const action = lifecycle.value
  if (!action || lifecycleBusy.value) return
  const signature = `${action}:${props.batch.version}`
  if (lifecycleKey?.signature !== signature) lifecycleKey = { signature, key: crypto.randomUUID() }
  const options = { idempotencyKey: lifecycleKey.key, quiet: true }
  const done = lifecycleText.value!.done
  lifecycleBusy.value = true
  lifecycleError.value = ''
  flash.value = ''
  notice.value = ''
  try {
    if (action === 'OPEN') await openBatch(props.batch.id, props.batch.version, options)
    else if (action === 'CLOSE_SUBMISSIONS') await closeBatch(props.batch.id, props.batch.version, options)
    else await archiveBatch(props.batch.id, props.batch.version, options)
    if (!alive) return
    lifecycleKey = null
    lifecycle.value = null
    flash.value = done
    await props.reload()
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) {
      lifecycleKey = null
      lifecycle.value = null
      notice.value = '批次在你打开之后有变化，已重新读取，请核对后再操作。'
      await props.reload()
    } else lifecycleError.value = failure.message
  } finally {
    if (alive) lifecycleBusy.value = false
  }
}
const tone = computed<PillTone>(() => (props.batch.status === 'OPEN' ? 'success' : props.batch.status === 'SUBMISSION_CLOSED' ? 'action' : 'neutral'))

// ---- 校内专业目录 ----
const bound = computed(() => props.versions?.find((item) => item.id === props.batch.program_catalog_id) ?? null)
const canPin = computed(() => !props.batch.program_catalog_id && editDeadlines.value)
const pick = ref('')
const pinOpen = ref(false)
const pinBusy = ref(false)
const pinError = ref('')
const versionLabel = (item: CatalogVersion) => `${item.year} 年第 ${item.revision} 版（${item.count} 项）`
const picked = computed(() => props.versions?.find((item) => item.id === pick.value) ?? null)
async function pin() {
  if (!picked.value || pinBusy.value) return
  pinBusy.value = true
  pinError.value = ''
  flash.value = ''
  notice.value = ''
  try {
    await pinPrograms(props.batch.id, picked.value.id, props.batch.version, { quiet: true })
    if (!alive) return
    pinOpen.value = false
    flash.value = `已绑定 ${versionLabel(picked.value)}，本批不再更换。`
    pick.value = ''
    await props.reload()
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) {
      pinOpen.value = false
      notice.value = '批次已绑定目录、已截止或有其他变化，已重新读取，请核对。'
      await props.reload()
    } else pinError.value = failure.message
  } finally {
    if (alive) pinBusy.value = false
  }
}

// ---- 收尾核对 ----
const closeout = ref<BatchCloseout | null>(null)
const closeoutError = ref('')
let closeoutRequest = 0
async function loadCloseout() {
  if (props.batch.status === 'DRAFT') return
  const request = ++closeoutRequest
  closeoutError.value = ''
  try {
    const data = await getBatchCloseout(props.batch.id, { quiet: true })
    if (alive && request === closeoutRequest) closeout.value = data
  } catch (reason) {
    if (alive && request === closeoutRequest) closeoutError.value = apiFailure(reason).message
  }
}
watch(() => props.batch.status, () => void loadCloseout(), { immediate: true })
const closeoutTotal = computed(() => (closeout.value ? closeout.value.unpublished.length + closeout.value.objections.length + closeout.value.corrections.length : 0))
const closeoutGroups = [
  { key: 'unpublished', label: '未发布论文' },
  { key: 'objections', label: '未办结异议' },
  { key: 'corrections', label: '待学校确认的更正' },
] as const
const stageText: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '已提交', PREPARING: '学校核验', READY_FOR_DISPATCH: '待送出', UNDER_REVIEW: '评阅中', RESULT_PROCESSING: '待发布' }
/** 收尾链接（E14，与旧 BatchCloseout 相同） */
function link(group: keyof BatchCloseout, row: CloseoutItem) {
  if (group === 'objections') return { path: '/school/objections', query: { objection: row.id } }
  if (group === 'corrections') return { path: '/school/results', query: { thesis: row.thesis_id, correction: row.id } }
  if (row.status === 'RESULT_PROCESSING') return { path: '/school/results', query: { thesis: row.thesis_id } }
  return { path: '/school/preparation', query: { thesis: row.thesis_id } }
}
function linkText(group: keyof BatchCloseout, row: CloseoutItem) {
  if (group === 'objections') return '处理异议'
  if (group === 'corrections') return '确认更正'
  return stageText[row.status] ?? row.status
}
const maxTotal = computed(() => props.rule?.dimensions.reduce((sum, item) => sum + item.max_score, 0) ?? 0)
const time = (value: string | null) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未设置')
</script>

<template>
  <div class="bdetail">
    <div class="wsd-obj">
      <header class="wsd-obj__head">
        <div class="wsd-obj__row">
          <StatusPill :tone="tone">{{ batchStatusText[batch.status] }}</StatusPill>
          <div class="wsd-acts">
            <button v-if="batch.allowed_actions.includes('OPEN')" type="button" class="btn btn--sm btn--outline" data-action="open-batch" :disabled="dirty" @click="ask('OPEN')">开放批次…</button>
            <button v-if="batch.allowed_actions.includes('CLOSE_SUBMISSIONS')" type="button" class="btn btn--sm" data-action="close-batch" :disabled="dirty" @click="ask('CLOSE_SUBMISSIONS')">截止收件…</button>
            <button v-if="batch.allowed_actions.includes('ARCHIVE')" type="button" class="btn btn--sm" data-action="archive-batch" :disabled="dirty" @click="ask('ARCHIVE')">归档…</button>
          </div>
        </div>
        <h2 class="wsd-obj__title">{{ batch.name }}</h2>
        <dl class="wsd-obj__meta">
          <div><dt>代码</dt><dd class="num">{{ batch.code }}</dd></div>
          <div><dt>起止</dt><dd class="num">{{ time(batch.start_at) }} 至 {{ time(batch.end_at) }}</dd></div>
        </dl>
        <p v-if="dirty && batch.allowed_actions.some((a) => a !== 'EDIT')" class="wsd-hint">有未保存的修改，保存或撤销后才能变更批次状态。</p>
        <p v-if="batch.status === 'SUBMISSION_CLOSED' && !batch.allowed_actions.includes('ARCHIVE')" class="wsd-hint">本批还有未完成的论文，全部发布或终止后才能归档。</p>
      </header>

      <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
      <div v-if="notice" class="wsd-banner wsd-banner--danger" role="alert">{{ notice }}</div>
      <div v-if="conflict" class="wsd-banner wsd-banner--danger" role="alert" data-conflict>
        <strong>没有保存：这个批次在你打开之后被修改过</strong>
        <span>{{ conflict.saved }}你的修改还在下面的表单里。与服务端当前值不同的字段：</span>
        <table v-if="conflictRows.length" class="wsd-dtable ctable">
          <thead><tr><th scope="col">字段</th><th scope="col">你的修改</th><th scope="col">服务端当前值</th></tr></thead>
          <tbody><tr v-for="row in conflictRows" :key="row.key"><th scope="row">{{ row.label }}</th><td>{{ row.mine }}</td><td>{{ row.theirs }}</td></tr></tbody>
        </table>
        <span v-else>你的修改与服务端当前值已经一致，或这些字段在当前状态下不能再改。</span>
        <div class="wsd-acts">
          <button v-if="conflictRows.length" type="button" class="btn btn--sm btn--primary" data-action="keep-mine" :disabled="saving" @click="keepMine">用我的修改覆盖</button>
          <button type="button" class="btn btn--sm" data-action="take-theirs" :disabled="saving" @click="revert">放弃我的修改</button>
        </div>
      </div>

      <section class="wsd-sec" aria-labelledby="basic-h">
        <div class="wsd-sec__head"><h3 id="basic-h">基本信息</h3><p v-if="!editBasic">只有草稿批次可以修改</p></div>
        <div class="wsd-grid2">
          <label class="field wsd-wide">
            <span>名称</span>
            <input v-model="form.name" class="input" data-field="batch-name" :disabled="!editBasic || saving" :aria-invalid="Boolean(errors.name)" />
            <small v-if="errors.name" class="field-error">{{ errors.name }}</small>
          </label>
          <label class="field"><span>开始时间</span><input v-model="form.startAt" type="datetime-local" class="input" data-field="start-at" :disabled="!editBasic || saving" /></label>
          <label class="field">
            <span>结束时间</span>
            <input v-model="form.endAt" type="datetime-local" class="input" data-field="end-at" :disabled="!editBasic || saving" :aria-invalid="Boolean(errors.endAt)" />
            <small v-if="errors.endAt" class="field-error">{{ errors.endAt }}</small>
          </label>
        </div>
      </section>

      <section class="wsd-sec" :class="{ 'wsd-sec--attention': editDeadlines && (batch.accept_days == null || batch.review_days == null) }" aria-labelledby="dl-h">
        <div class="wsd-sec__head"><h3 id="dl-h">期限</h3><p>{{ editDeadlines ? '按自然日计；修改只影响之后派出的任务' : '当前状态下只读' }}</p></div>
        <p v-if="editDeadlines && (batch.accept_days == null || batch.review_days == null)" class="wsd-hint warn">
          有期限尚未配置。未配置时派出的任务没有截止日，也就没有逾期提醒；留空表示不限期。
        </p>
        <div class="wsd-grid2">
          <label class="field">
            <span>接单期限（天）</span>
            <input v-model="form.acceptDays" inputmode="numeric" class="input" data-field="accept-days" placeholder="不限期" :disabled="!editDeadlines || saving" :aria-invalid="Boolean(errors.acceptDays)" />
            <small v-if="errors.acceptDays" class="field-error">{{ errors.acceptDays }}</small>
            <small v-else>派单后专家在这段时间内接受或拒绝</small>
          </label>
          <label class="field">
            <span>评阅期限（天）</span>
            <input v-model="form.reviewDays" inputmode="numeric" class="input" data-field="review-days" placeholder="不限期" :disabled="!editDeadlines || saving" :aria-invalid="Boolean(errors.reviewDays)" />
            <small v-if="errors.reviewDays" class="field-error">{{ errors.reviewDays }}</small>
            <small v-else>接受后到提交评阅</small>
          </label>
        </div>
      </section>

      <section class="wsd-sec" aria-labelledby="pv-h" data-program-catalog>
        <div class="wsd-sec__head"><h3 id="pv-h">校内专业目录</h3><p>学生创建论文时按这个版本选专业</p></div>
        <p v-if="versionsError" class="field-error" role="alert">目录版本没有加载出来：{{ versionsError }} <button type="button" class="btn btn--quiet btn--sm" @click="emit('retryVersions')">重试</button></p>
        <p v-else-if="batch.program_catalog_id">已绑定：{{ bound ? versionLabel(bound) : '已绑定的版本（版本信息没有取得）' }}。绑定后本批不再更换。</p>
        <template v-else-if="canPin">
          <p class="wsd-hint">未绑定时沿用官方学科目录。绑定只能做一次，之后本批不再更换；未选校内专业的既有草稿可以继续送审。</p>
          <p v-if="versions && !versions.length" class="wsd-hint">还没有已发布的校内专业目录，请先在“学科与专业”中导入并发布。</p>
          <div v-else-if="versions" class="pin">
            <label class="field">
              <span class="sr-only">目录版本</span>
              <select v-model="pick" class="select" data-field="program-version">
                <option value="">选择要绑定的版本</option>
                <option v-for="item in versions" :key="item.id" :value="item.id">{{ versionLabel(item) }} · {{ item.source_version }}</option>
              </select>
            </label>
            <button type="button" class="btn" data-action="pin-catalog" :disabled="!pick" @click="pinError = ''; pinOpen = true">绑定本批目录…</button>
          </div>
        </template>
        <p v-else class="wsd-hint">未绑定，沿用官方学科目录。批次截止收件后不能再绑定。</p>
      </section>

      <section v-if="batch.status !== 'DRAFT'" class="wsd-sec" aria-labelledby="co-h" data-closeout>
        <div class="wsd-sec__head">
          <h3 id="co-h">收尾核对</h3>
          <p v-if="closeout">{{ closeoutTotal ? `还有 ${closeoutTotal} 项未完成` : '没有未完成的事项' }}</p>
        </div>
        <p class="wsd-hint">包含本批全部年份；已终止的论文不计入未发布。</p>
        <p v-if="closeoutError" class="field-error" role="alert">收尾清单没有加载出来：{{ closeoutError }} <button type="button" class="btn btn--quiet btn--sm" @click="loadCloseout">重试</button></p>
        <StateBlock v-else-if="!closeout" kind="loading" title="正在核对本批事项…" compact />
        <div v-else-if="closeoutTotal" class="closeout">
          <div v-for="group in closeoutGroups" v-show="closeout[group.key].length" :key="group.key">
            <h4>{{ group.label }} {{ closeout[group.key].length }}</h4>
            <ul>
              <li v-for="row in closeout[group.key]" :key="row.id">
                <RouterLink :to="link(group.key, row)">{{ row.title || '未命名论文' }}</RouterLink><span class="muted">　{{ linkText(group.key, row) }}</span>
              </li>
            </ul>
          </div>
        </div>
        <p v-else class="wsd-hint">全部论文已发布或终止，没有未办结的异议和待确认的更正。</p>
      </section>
    </div>

    <aside class="rules" aria-labelledby="rule-h" data-review-rule>
      <h3 id="rule-h">评审规则（只读）</h3>
      <template v-if="rule">
        <p class="muted">{{ rule.version }}，每篇 {{ rule.required_experts }} 位专家，满分 {{ maxTotal }}</p>
        <table class="wsd-dtable">
          <tbody><tr v-for="d in rule.dimensions" :key="d.key"><th scope="row">{{ d.label }}</th><td class="wsd-n num">{{ d.max_score }}</td></tr></tbody>
        </table>
        <p class="muted small">结论：{{ rule.bands.map((b) => `${b.min}–${b.max} ${b.label}`).join('；') }}。“修改后通过”是评分档位，不代表已验收修改稿。规则由平台维护，学校不能修改。</p>
      </template>
      <p v-else-if="ruleError" class="field-error" role="alert">规则没有加载出来：{{ ruleError }} <button type="button" class="btn btn--quiet btn--sm" @click="emit('retryRule')">重试</button></p>
      <p v-else class="muted">正在读取评审规则…</p>
    </aside>
  </div>

  <footer v-if="editBasic || editDeadlines" class="wsd-commit">
    <p class="wsd-commit__text">{{ saveError || (dirty ? '有未保存的修改' : '没有未保存的修改') }}</p>
    <button type="button" class="btn" data-action="revert-batch" :disabled="!dirty || saving" @click="revert">撤销修改</button>
    <button type="button" class="btn btn--primary" data-action="save-batch" :disabled="!dirty || saving || Boolean(conflict)" @click="save">{{ saving ? '正在保存…' : '保存' }}</button>
  </footer>

  <ConfirmDialog :open="Boolean(lifecycleText)" :title="lifecycleText ? lifecycleText.title : ''" :busy="lifecycleBusy" @close="lifecycleBusy || (lifecycle = null)">
    <p>{{ lifecycleText && lifecycleText.body }}</p>
    <p v-if="lifecycle === 'OPEN' && (batch.accept_days == null || batch.review_days == null)" class="wsd-banner wsd-banner--warn">期限尚未全部配置，开放后派出的任务可能没有截止日。</p>
    <p v-if="lifecycle === 'ARCHIVE' && closeoutTotal" class="wsd-banner wsd-banner--warn">还有 {{ closeoutTotal }} 项收尾事项未完成。</p>
    <p v-if="lifecycleError" class="field-error" role="alert">{{ lifecycleError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="lifecycleBusy" @click="lifecycle = null">取消</button>
      <button type="button" class="btn" :class="lifecycleText && lifecycleText.danger ? 'btn--danger' : 'btn--primary'" data-action="confirm-lifecycle" :disabled="lifecycleBusy" @click="runLifecycle">
        {{ lifecycleBusy ? '正在提交…' : lifecycleText && lifecycleText.cta }}
      </button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="pinOpen" title="绑定本批校内专业目录" :busy="pinBusy" @close="pinBusy || (pinOpen = false)">
    <p>将“{{ batch.name }}”绑定到 {{ picked && versionLabel(picked) }}。</p>
    <p class="muted">绑定后本批不再更换或解绑；学生创建论文时按这个版本选校内专业。</p>
    <p v-if="pinError" class="field-error" role="alert">{{ pinError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="pinBusy" @click="pinOpen = false">取消</button>
      <button type="button" class="btn btn--primary" data-action="confirm-pin" :disabled="pinBusy" @click="pin">{{ pinBusy ? '正在绑定…' : '确认绑定' }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.bdetail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  align-items: start;
}
.rules {
  position: sticky;
  top: 0;
  display: grid;
  gap: 8px;
  margin: 20px 20px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.rules h3 {
  font-size: 14px;
  font-weight: 600;
}
.rules th {
  color: var(--ws-muted);
  font-weight: 400;
}
.small {
  font-size: 12px;
}
.warn {
  color: var(--ws-warning);
}
.pin {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.pin .field {
  flex: 1;
  min-width: 14em;
}
.closeout {
  display: grid;
  gap: 12px;
}
.closeout h4 {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
}
.closeout ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 1.1em;
}
.closeout a {
  color: var(--ws-action);
}
.ctable {
  background: var(--ws-surface);
}
@media (max-width: 1180px) {
  .bdetail {
    grid-template-columns: minmax(0, 1fr);
  }
  .rules {
    position: static;
    margin: 0 24px 24px;
  }
}
@media (max-width: 899px) {
  .rules {
    margin: 0 14px 24px;
  }
}
</style>
