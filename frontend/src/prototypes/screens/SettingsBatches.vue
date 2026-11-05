<script setup lang="ts">
/**
 * P12a 批次与规则（学校设置）：批次清单｜批次对象。
 * 对象区分区：基本信息、生命周期、期限、校内专业目录版本、收尾核对、评审规则（只读侧栏）。
 * 生命周期按钮只按 allowed_actions 出现；409 保留正在编辑的字段，并列出服务端当前值。
 */
import { computed, ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import MasterDetail from '../kit/MasterDetail.vue'
import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useNarrow } from '../kit/useNarrow'
import { useProtoState } from '../kit/useProtoState'
import '../kit/desk.css'
import { accounts } from '../data/fixtures'
import { schoolNav } from '../data/nav'
import { batches as baseBatches, batchStatusText, dimensions, programVersions, type Batch, type BatchStatus } from '../data/u3'

const states = [
  { value: 'normal', label: '开放中的批次' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '还没有批次' },
  { value: 'error', label: '加载失败' },
  { value: 'draft', label: '草稿批次（期限未配置）' },
  { value: 'conflict', label: '保存时版本冲突' },
  { value: 'close', label: '截止收件确认' },
  { value: 'archive', label: '归档确认' },
  { value: 'create', label: '新建批次' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const batches = ref<Batch[]>(structuredClone(baseBatches))
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : batches.value))
const selectedId = ref<string | null>(null)
const creating = ref(false)
const selected = computed(() => loaded.value.find((b) => b.id === selectedId.value) ?? null)

/** 编辑缓冲：与服务端值分开，冲突时保留 */
const form = ref({ name: '', start: '', end: '', acceptDays: '' as string, reviewDays: '' as string, programVersion: '' })
const dirty = computed(() => {
  const b = selected.value
  if (!b) return false
  return (
    form.value.name !== b.name ||
    form.value.start !== b.start ||
    form.value.end !== b.end ||
    form.value.acceptDays !== (b.acceptDays?.toString() ?? '') ||
    form.value.reviewDays !== (b.reviewDays?.toString() ?? '') ||
    form.value.programVersion !== (b.programVersion ?? '')
  )
})
function load(b: Batch | null) {
  if (!b) return
  form.value = {
    name: b.name,
    start: b.start,
    end: b.end,
    acceptDays: b.acceptDays?.toString() ?? '',
    reviewDays: b.reviewDays?.toString() ?? '',
    programVersion: b.programVersion ?? '',
  }
}
const flash = ref('')
const conflict = ref<null | { fields: { label: string; mine: string; theirs: string }[] }>(null)
const lifecycle = ref<null | 'OPEN' | 'CLOSE' | 'ARCHIVE'>(null)
const newForm = ref({ code: '', name: '', start: '', end: '' })
const newTried = ref(false)

watch(
  state,
  (s) => {
    batches.value = structuredClone(baseBatches)
    flash.value = ''
    conflict.value = null
    creating.value = s === 'create'
    newForm.value = { code: '', name: '', start: '', end: '' }
    newTried.value = false
    const target = s === 'draft' ? 'b2' : s === 'archive' ? 'b3' : 'b1'
    selectedId.value = narrow.value && ['normal', 'loading', 'empty', 'error'].includes(s) ? null : s === 'create' ? null : target
    load(batches.value.find((b) => b.id === target) ?? null)
    if (s === 'conflict') {
      form.value.reviewDays = '10'
      form.value.end = '2026-12-31'
      conflict.value = {
        fields: [
          { label: '截止日期', mine: '2026-12-31', theirs: '2026-12-20' },
          { label: '评阅天数', mine: '10', theirs: '14（未变）' },
        ],
      }
    }
    lifecycle.value = s === 'close' ? 'CLOSE' : s === 'archive' ? 'ARCHIVE' : null
  },
  { immediate: true },
)
watch(selectedId, (id) => {
  if (state.value !== 'conflict') load(batches.value.find((b) => b.id === id) ?? null)
  flash.value = ''
})

const allowed = (b: Batch): ('EDIT' | 'OPEN' | 'CLOSE' | 'ARCHIVE')[] =>
  b.status === 'DRAFT' ? ['EDIT', 'OPEN'] : b.status === 'OPEN' ? ['EDIT', 'CLOSE'] : b.status === 'SUBMISSION_CLOSED' ? ['ARCHIVE'] : []
const tone = (s: BatchStatus) => (s === 'OPEN' ? 'success' : s === 'DRAFT' ? 'neutral' : s === 'SUBMISSION_CLOSED' ? 'action' : 'neutral')
const editable = computed(() => (selected.value ? allowed(selected.value).includes('EDIT') : false))
const closeoutTotal = (b: Batch) => b.closeout.unpublished.length + b.closeout.objections.length + b.closeout.corrections.length
const sorted = computed(() => {
  const order: BatchStatus[] = ['OPEN', 'DRAFT', 'SUBMISSION_CLOSED', 'ARCHIVED']
  return [...loaded.value].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
})

function save() {
  const b = selected.value
  if (!b) return
  if (state.value === 'conflict' && conflict.value) return
  b.name = form.value.name
  b.start = form.value.start
  b.end = form.value.end
  b.acceptDays = form.value.acceptDays ? Number(form.value.acceptDays) : null
  b.reviewDays = form.value.reviewDays ? Number(form.value.reviewDays) : null
  b.programVersion = form.value.programVersion || null
  b.version += 1
  flash.value = '已保存。'
}
function keepMine() {
  const b = selected.value
  if (!b) return
  conflict.value = null
  b.end = '2026-12-20'
  b.version += 1
  save()
  flash.value = '已用你的修改覆盖，截止日期为 2026-12-31，评阅天数为 10。'
}
function takeTheirs() {
  const b = selected.value
  if (!b) return
  conflict.value = null
  b.end = '2026-12-20'
  b.version += 1
  load(b)
  flash.value = '已放弃你的修改，显示的是服务端当前值。'
}
function runLifecycle() {
  const b = selected.value
  if (!b || !lifecycle.value) return
  const next: Record<string, BatchStatus> = { OPEN: 'OPEN', CLOSE: 'SUBMISSION_CLOSED', ARCHIVE: 'ARCHIVED' }
  b.status = next[lifecycle.value]!
  flash.value = { OPEN: '批次已开放，学生现在可以提交论文。', CLOSE: '已截止收件。已提交的论文继续办理。', ARCHIVE: '批次已归档，只读保留。' }[lifecycle.value]
  lifecycle.value = null
}
const newMissing = computed(() => ({
  code: !newForm.value.code.trim(),
  name: !newForm.value.name.trim(),
  dates: !newForm.value.start || !newForm.value.end,
}))
function create() {
  newTried.value = true
  if (newMissing.value.code || newMissing.value.name || newMissing.value.dates) return
  const b: Batch = {
    id: `b${batches.value.length + 1}`,
    code: newForm.value.code.trim(),
    name: newForm.value.name.trim(),
    status: 'DRAFT',
    start: newForm.value.start,
    end: newForm.value.end,
    acceptDays: null,
    reviewDays: null,
    programVersion: null,
    ruleVersion: '第 3 版',
    version: 1,
    counts: { theses: 0, published: 0 },
    closeout: { unpublished: [], objections: [], corrections: [] },
  }
  batches.value.push(b)
  creating.value = false
  selectedId.value = b.id
  flash.value = '已建立草稿批次。补齐期限与专业目录版本后再开放。'
}
const lifecycleText = computed(() => {
  const b = selected.value
  if (!b || !lifecycle.value) return null
  return {
    OPEN: { title: '开放这个批次', body: `开放后，本校学生可以向“${b.name}”提交论文。`, cta: '开放批次', danger: false },
    CLOSE: { title: '截止收件', body: `截止后学生不能再向“${b.name}”提交新论文；已提交的 ${b.counts.theses} 篇继续核验、评审与发布。`, cta: '截止收件', danger: false },
    ARCHIVE: { title: '归档这个批次', body: `归档后“${b.name}”只读保留，不能再编辑期限或专业目录版本，也不能重新开放。`, cta: '归档', danger: true },
  }[lifecycle.value]
})
</script>

<template>
  <ProtoFrame v-model:state="state" name="批次与规则" :states="states">
    <OperationsShell :nav="schoolNav('batches')" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">批次与规则</h1></template>
      <template #context>
        <button v-if="!['loading', 'error'].includes(state)" type="button" class="btn btn--sm" @click="creating = true; selectedId = null">新建批次</button>
      </template>

      <MasterDetail :open="Boolean(selected) || creating" :narrow="narrow" list-label="批次清单" detail-label="当前批次" back-label="批次清单" list-width="300px" @back="selectedId = null; creating = false">
        <template #list>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取批次…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="批次没有加载出来" compact>
            网络或服务暂时不可用。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="还没有送审批次" compact>
            先建立一个批次，学生才能提交论文。
            <template #actions><button type="button" class="btn btn--primary" @click="creating = true">新建批次</button></template>
          </StateBlock>
          <ul v-else class="tlist">
            <li v-for="b in sorted" :key="b.id">
              <button type="button" class="titem" :class="{ 'titem--on': b.id === selectedId }" :aria-current="b.id === selectedId" @click="selectedId = b.id; creating = false">
                <span class="titem__top"><span class="titem__title">{{ b.name }}</span></span>
                <span class="titem__meta num">{{ b.code }}　{{ b.start }} 至 {{ b.end }}</span>
                <span class="titem__line"><StatusPill :tone="tone(b.status)">{{ batchStatusText[b.status] }}</StatusPill></span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="!['loading', 'error', 'empty'].includes(state)" kind="empty" title="从左侧选择一个批次" compact />
        </template>

        <!-- 新建 -->
        <div v-if="creating" class="obj">
          <header class="obj__head"><h2 class="obj__title">新建批次</h2><p class="hint">新批次是草稿；期限与专业目录版本可以稍后补，开放前确认即可。</p></header>
          <section class="sec">
            <div class="grid2">
              <label class="field">
                <span>批次代码</span>
                <input v-model="newForm.code" class="input" placeholder="例如 2027-AUT" :aria-invalid="newTried && newMissing.code" />
                <small v-if="newTried && newMissing.code" class="field-error">请填写批次代码。</small>
              </label>
              <label class="field">
                <span>名称</span>
                <input v-model="newForm.name" class="input" placeholder="例如 2027 年秋季学位论文送审" :aria-invalid="newTried && newMissing.name" />
                <small v-if="newTried && newMissing.name" class="field-error">请填写名称。</small>
              </label>
              <label class="field"><span>开始日期</span><input v-model="newForm.start" type="date" class="input" :aria-invalid="newTried && newMissing.dates" /></label>
              <label class="field">
                <span>截止日期</span><input v-model="newForm.end" type="date" class="input" :aria-invalid="newTried && newMissing.dates" />
                <small v-if="newTried && newMissing.dates" class="field-error">请填写起止日期。</small>
              </label>
            </div>
            <div class="acts acts--end">
              <button type="button" class="btn" @click="creating = false">取消</button>
              <button type="button" class="btn btn--primary" @click="create">建立草稿批次</button>
            </div>
          </section>
        </div>

        <template v-else-if="selected">
          <div class="bdetail">
            <div class="obj">
              <header class="obj__head">
                <div class="obj__row">
                  <StatusPill :tone="tone(selected.status)">{{ batchStatusText[selected.status] }}</StatusPill>
                  <div class="acts">
                    <button v-if="allowed(selected).includes('OPEN')" type="button" class="btn btn--sm btn--outline" :disabled="dirty" @click="lifecycle = 'OPEN'">开放批次…</button>
                    <button v-if="allowed(selected).includes('CLOSE')" type="button" class="btn btn--sm" :disabled="dirty" @click="lifecycle = 'CLOSE'">截止收件…</button>
                    <button v-if="allowed(selected).includes('ARCHIVE')" type="button" class="btn btn--sm" @click="lifecycle = 'ARCHIVE'">归档…</button>
                  </div>
                </div>
                <h2 class="obj__title">{{ selected.name }}</h2>
                <dl class="obj__meta">
                  <div><dt>代码</dt><dd class="num">{{ selected.code }}</dd></div>
                  <div><dt>论文</dt><dd class="num">{{ selected.counts.theses }} 篇，已发布 {{ selected.counts.published }}</dd></div>
                </dl>
                <p v-if="dirty && allowed(selected).some((a) => a === 'OPEN' || a === 'CLOSE')" class="hint">有未保存的修改，保存后才能变更批次状态。</p>
              </header>

              <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
              <div v-if="conflict" class="banner banner--danger" role="alert">
                <strong>没有保存：另一位学校审核刚刚修改了这个批次</strong>
                <span>你的修改还在下面的表单里。服务端当前值与你的修改：</span>
                <table class="dtable ctable">
                  <thead><tr><th scope="col">字段</th><th scope="col">你的修改</th><th scope="col">服务端当前值</th></tr></thead>
                  <tbody>
                    <tr v-for="f in conflict.fields" :key="f.label"><th scope="row">{{ f.label }}</th><td class="num">{{ f.mine }}</td><td class="num">{{ f.theirs }}</td></tr>
                  </tbody>
                </table>
                <div class="acts">
                  <button type="button" class="btn btn--sm btn--primary" @click="keepMine">用我的修改覆盖</button>
                  <button type="button" class="btn btn--sm" @click="takeTheirs">放弃我的修改</button>
                </div>
              </div>

              <section class="sec" aria-labelledby="basic-h">
                <div class="sec__head"><h3 id="basic-h">基本信息</h3><p v-if="!editable">当前状态下只读</p></div>
                <div class="grid2">
                  <label class="field wide"><span>名称</span><input v-model="form.name" class="input" :disabled="!editable" /></label>
                  <label class="field"><span>开始日期</span><input v-model="form.start" type="date" class="input" :disabled="!editable" /></label>
                  <label class="field"><span>截止日期</span><input v-model="form.end" type="date" class="input" :disabled="!editable" :aria-invalid="Boolean(conflict)" /></label>
                </div>
              </section>

              <section class="sec" :class="{ 'sec--attention': editable && (!selected.acceptDays || !selected.reviewDays) }" aria-labelledby="dl-h">
                <div class="sec__head">
                  <h3 id="dl-h">期限</h3>
                  <p>按天计；修改只影响之后派出的任务</p>
                </div>
                <p v-if="!selected.acceptDays || !selected.reviewDays" class="hint warn">
                  尚未配置。未配置时派出的任务没有截止日，专家与平台都看不到逾期提醒；开放前建议补齐。
                </p>
                <div class="grid2">
                  <label class="field">
                    <span>接单期限（天）</span>
                    <input v-model="form.acceptDays" type="number" min="1" class="input" placeholder="未配置" :disabled="!editable" />
                    <small>派单后专家在这段时间内接受或拒绝</small>
                  </label>
                  <label class="field">
                    <span>评阅期限（天）</span>
                    <input v-model="form.reviewDays" type="number" min="1" class="input" placeholder="未配置" :disabled="!editable" :aria-invalid="Boolean(conflict)" />
                    <small>接受后到提交评阅</small>
                  </label>
                </div>
              </section>

              <section class="sec" aria-labelledby="pv-h">
                <div class="sec__head"><h3 id="pv-h">校内专业目录版本</h3><p>学生创建论文时按这个版本选专业</p></div>
                <label class="field">
                  <span class="sr-only">专业目录版本</span>
                  <select v-model="form.programVersion" class="select" :disabled="!editable">
                    <option value="">未固定（使用最新发布版本）</option>
                    <option v-for="v in programVersions" :key="v.id" :value="v.id">{{ v.label }}，{{ v.published }} 发布</option>
                  </select>
                </label>
                <p class="hint">目录在“学科与专业”中导入和发布。</p>
              </section>

              <section v-if="selected.status !== 'DRAFT'" class="sec" aria-labelledby="co-h">
                <div class="sec__head">
                  <h3 id="co-h">收尾核对</h3>
                  <p>{{ closeoutTotal(selected) ? `还有 ${closeoutTotal(selected)} 项未完成` : '没有未完成的事项' }}</p>
                </div>
                <div v-if="closeoutTotal(selected)" class="closeout">
                  <div v-if="selected.closeout.unpublished.length">
                    <h4>未发布结果 {{ selected.closeout.unpublished.length }}</h4>
                    <ul><li v-for="i in selected.closeout.unpublished" :key="i.id"><RouterLink :to="{ path: '/prototype/results', query: { thesis: i.id } }">{{ i.title }}</RouterLink></li></ul>
                  </div>
                  <div v-if="selected.closeout.objections.length">
                    <h4>未办结异议 {{ selected.closeout.objections.length }}</h4>
                    <ul><li v-for="i in selected.closeout.objections" :key="i.id"><RouterLink :to="{ path: '/prototype/objections', query: { objection: i.id } }">{{ i.title }}</RouterLink></li></ul>
                  </div>
                  <div v-if="selected.closeout.corrections.length">
                    <h4>待确认更正 {{ selected.closeout.corrections.length }}</h4>
                    <ul><li v-for="i in selected.closeout.corrections" :key="i.id"><RouterLink :to="{ path: '/prototype/results', query: { state: 'correction' } }">{{ i.title }}</RouterLink></li></ul>
                  </div>
                </div>
                <p v-else class="hint">全部论文已发布，没有未办结的异议和待确认的更正，可以归档。</p>
              </section>

              <ProtoNote contract="schoolOperations">
                生命周期按钮按 allowed_actions 出现（EDIT / OPEN / CLOSE_SUBMISSIONS / ARCHIVE）；保存带 expected_version。收尾链接沿用现行深链 /school/results?thesis= 与 /school/objections?objection=。更换专业目录版本对已建论文的影响需在接线前核对后端。
              </ProtoNote>
            </div>

            <aside class="rules" aria-labelledby="rule-h">
              <h3 id="rule-h">评审规则（只读）</h3>
              <p class="muted">{{ selected.ruleVersion }}，每篇 1 位专家，满分 100</p>
              <table class="dtable">
                <tbody>
                  <tr v-for="d in dimensions" :key="d.key"><th scope="row">{{ d.label }}</th><td class="n num">{{ d.max }}</td></tr>
                </tbody>
              </table>
              <p class="muted small">结论：80 分及以上“通过”，60–79“修改后通过”，60 以下“不通过”。规则由平台维护，学校不能修改。</p>
            </aside>
          </div>

          <footer v-if="editable" class="commit">
            <p class="commit__text">{{ dirty ? '有未保存的修改' : '没有未保存的修改' }}</p>
            <button type="button" class="btn" :disabled="!dirty" @click="load(selected); conflict = null">撤销修改</button>
            <button type="button" class="btn btn--primary" :disabled="!dirty || Boolean(conflict)" @click="save">保存</button>
          </footer>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="Boolean(lifecycleText)" :title="lifecycleText?.title ?? ''" @close="lifecycle = null">
        <p>{{ lifecycleText?.body }}</p>
        <p v-if="lifecycle === 'ARCHIVE' && selected && closeoutTotal(selected)" class="banner banner--warn">还有 {{ closeoutTotal(selected) }} 项收尾事项未完成。</p>
        <template #actions>
          <button type="button" class="btn" @click="lifecycle = null">取消</button>
          <button type="button" class="btn" :class="lifecycleText?.danger ? 'btn--danger' : 'btn--primary'" @click="runLifecycle">{{ lifecycleText?.cta }}</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
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
