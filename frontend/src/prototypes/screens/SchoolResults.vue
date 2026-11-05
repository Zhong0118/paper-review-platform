<script setup lang="ts">
/**
 * P09 学校结果处理（处理工作空间）：清单｜对象。
 * 对象区先列“将公开的内容”，再列“不会公开”，发布是唯一主动作；发布后读回发布快照，导出为次要动作。
 * 更正待确认是对象内分区：原生效版本与待确认更正对照，确认后自动追加发布记录，不需要再次发布。
 * 确认与不予确认都要写原因（接口 SchoolBody.reason 必填）。
 * 学校只看到专家别名，看不到专家身份。
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
import { dimensions, outcomeLabel, resultTheses, type OutcomeCode, type ResultThesis } from '../data/u3'

const states = [
  { value: 'normal', label: '待发布' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '范围内无论文' },
  { value: 'error', label: '加载失败' },
  { value: 'notready', label: '评阅未齐，不能发布' },
  { value: 'publish', label: '发布确认' },
  { value: 'conflict', label: '发布时结果已变化' },
  { value: 'published', label: '已发布（读回快照）' },
  { value: 'correction', label: '更正待确认' },
  { value: 'correction-reject', label: '不予确认更正' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const theses = ref<ResultThesis[]>(structuredClone(resultTheses))
const views = [
  { key: 'publish', label: '待发布' },
  { key: 'correction', label: '更正待确认' },
  { key: 'published', label: '已发布' },
  { key: 'all', label: '全部' },
] as const
type ViewKey = (typeof views)[number]['key']
const view = ref<ViewKey>('publish')
const loaded = computed(() => (state.value === 'empty' || state.value === 'loading' || state.value === 'error' ? [] : theses.value))
const countOf = (key: ViewKey) => (key === 'all' ? loaded.value.length : loaded.value.filter((t) => t.view === key).length)
const list = computed(() => loaded.value.filter((t) => view.value === 'all' || t.view === view.value))

const selectedId = ref<string | null>(null)
const selected = computed(() => loaded.value.find((t) => t.id === selectedId.value) ?? null)
const flash = ref('')
const publishOpen = ref(false)
const activateOpen = ref(false)
const activateReason = ref('')
const activateTried = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')
const rejectTried = ref(false)
const conflict = ref(false)

function reset() {
  theses.value = structuredClone(resultTheses)
  flash.value = ''
  publishOpen.value = state.value === 'publish'
  rejectOpen.value = state.value === 'correction-reject'
  activateOpen.value = false
  activateReason.value = ''
  activateTried.value = false
  rejectReason.value = ''
  rejectTried.value = false
  conflict.value = state.value === 'conflict'
  const target = state.value.startsWith('correction') ? 'r2' : state.value === 'published' ? 'r3' : 'r1'
  view.value = target === 'r2' ? 'correction' : target === 'r3' ? 'published' : 'publish'
  const listState = state.value === 'normal' || state.value === 'loading' || state.value === 'empty' || state.value === 'error'
  selectedId.value = narrow.value && listState ? null : target
}
watch(state, reset, { immediate: true })
watch(view, () => {
  if (selectedId.value && !list.value.some((t) => t.id === selectedId.value)) selectedId.value = narrow.value ? null : (list.value[0]?.id ?? null)
})

const notReady = computed(() => state.value === 'notready' && selected.value?.id === 'r1')
const pill = (t: ResultThesis) =>
  t.view === 'publish'
    ? { tone: 'action' as const, text: '待发布' }
    : t.view === 'correction'
      ? { tone: 'warning' as const, text: '更正待确认' }
      : { tone: 'success' as const, text: `已发布 ${t.publishedAt}` }
const outcomeTone = (code: OutcomeCode) => (code === 'PASS' ? 'success' : code === 'FAIL' ? 'danger' : 'warning')
const line = (t: ResultThesis) => (t.view === 'correction' ? `${t.correction?.alias} 申请更正，等待确认` : `${outcomeLabel[t.outcome]}，总分 ${t.total}`)

function publish() {
  const t = selected.value
  if (!t) return
  publishOpen.value = false
  t.view = 'published'
  t.publishedAt = '11-05'
  conflict.value = false
  flash.value = '已发布。学生与导师现在可以阅读正式反馈；下方内容读回自发布快照。'
  view.value = 'published'
}
function activate() {
  const t = selected.value
  activateTried.value = true
  if (!t?.correction || !activateReason.value.trim()) return
  activateOpen.value = false
  const after = t.correction.after
  t.total = after.total
  t.items[0]!.overall = after.fields.find((f) => f.label === '总体评价')?.value ?? t.items[0]!.overall
  t.items[0]!.scores[5] = Number(after.fields.find((f) => f.label === '研究成果与工作量')?.value ?? t.items[0]!.scores[5])
  t.correction = undefined
  t.view = 'published'
  t.publishedAt = '11-05'
  flash.value = '已确认更正，系统已自动追加一条发布记录。学生与导师现在看到更正后的结果。'
  view.value = 'published'
}
function reject() {
  rejectTried.value = true
  if (!rejectReason.value.trim()) return
  const t = selected.value
  if (!t) return
  rejectOpen.value = false
  t.correction = undefined
  t.view = 'published'
  flash.value = '已不予确认，原生效版本保持不变。原因已记录，平台与专家可以看到。'
  view.value = 'published'
}
const compareRows = computed(() => {
  const c = selected.value?.correction
  if (!c) return []
  const rows = c.before.fields.map((f, i) => ({ label: f.label, before: f.value, after: c.after.fields[i]?.value ?? '' }))
  return [{ label: '总分', before: String(c.before.total), after: String(c.after.total) }, ...rows]
})
</script>

<template>
  <ProtoFrame v-model:state="state" name="学校结果处理" :states="states">
    <OperationsShell :nav="schoolNav('results', undefined, { results: countOf('publish') + countOf('correction') })" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">结果处理</h1></template>
      <template #context><span class="ctx">2026 年秋季学位论文送审</span></template>

      <MasterDetail :open="Boolean(selected)" :narrow="narrow" list-label="结果清单" detail-label="当前论文结果" back-label="结果清单" @back="selectedId = null">
        <template #list>
          <div class="lhead">
            <div class="views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
                {{ v.label }}<span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <p v-if="loaded.length" class="scope">计数为本批次已加载的 {{ loaded.length }} 篇。</p>
          </div>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取评阅结果…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="结果清单没有加载出来" compact>
            网络或服务暂时不可用。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="本批次还没有完成评阅的论文" compact>
            专家提交评阅后，论文会出现在“待发布”。
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'correction' ? '没有待确认的更正' : '这个视图里没有论文'" compact />
          <ul v-else class="tlist">
            <li v-for="t in list" :key="t.id">
              <button type="button" class="titem" :class="{ 'titem--on': t.id === selectedId }" :aria-current="t.id === selectedId" @click="selectedId = t.id">
                <span class="titem__title">{{ t.title }}</span>
                <span class="titem__meta">{{ t.student }}　{{ t.studentNo }}</span>
                <span class="titem__line" :class="{ 'titem__line--warn': t.view === 'correction' }">{{ line(t) }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="state !== 'loading' && state !== 'error' && state !== 'empty'" kind="empty" title="从左侧选择一篇论文" compact>
            对象区会列出发布后学生与导师能看到的全部内容。
          </StateBlock>
        </template>

        <template v-if="selected">
          <div class="obj">
            <header class="obj__head">
              <div class="obj__row">
                <StatusPill :tone="pill(selected).tone">{{ pill(selected).text }}</StatusPill>
                <button v-if="selected.view === 'published'" type="button" class="btn btn--sm">导出评阅书</button>
              </div>
              <h2 class="obj__title">{{ selected.title }}</h2>
              <dl class="obj__meta">
                <div><dt>学生</dt><dd>{{ selected.student }}（{{ selected.studentNo }}）</dd></div>
                <div><dt>专业</dt><dd>{{ selected.program }}</dd></div>
                <div><dt>评审规则</dt><dd>第 3 版，满分 100</dd></div>
              </dl>
            </header>

            <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
            <div v-if="conflict && selected.view === 'publish'" class="banner banner--danger" role="alert">
              <strong>没有发布：评阅结果在你打开之后有变化</strong>
              <span>已重新读取最新结果（E-001 的“主要问题”有改动）。请核对下方内容，确认无误后再发布。</span>
            </div>

            <!-- 更正待确认：对象内分区 -->
            <section v-if="selected.correction" class="sec sec--attention" aria-labelledby="corr-h">
              <div class="sec__head">
                <h3 id="corr-h">更正待确认</h3>
                <p>{{ selected.correction.alias }} 于 {{ selected.correction.requestedAt }} 申请，平台已批准</p>
              </div>
              <p class="plain">申请理由：{{ selected.correction.reason }}</p>
              <div class="twrap">
                <table class="dtable compare">
                  <thead>
                    <tr><th scope="col">项目</th><th scope="col">原生效版本</th><th scope="col">待确认更正</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in compareRows" :key="row.label">
                      <th scope="row" class="shrink">{{ row.label }}</th>
                      <td class="plain" data-label="原生效版本">{{ row.before }}</td>
                      <td class="plain" data-label="待确认更正" :class="{ changed: row.before !== row.after }">{{ row.after }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="hint">确认后，系统自动追加一条发布记录，学生与导师会看到更正后的结果和“已更正”说明，不需要再次发布。</p>
              <div class="acts acts--end">
                <button type="button" class="btn" @click="rejectOpen = true">不予确认…</button>
                <button type="button" class="btn btn--primary" @click="activateOpen = true">确认更正</button>
              </div>
            </section>

            <StateBlock v-if="notReady" kind="unconfigured" title="尚未收到有效评阅意见">
              E-001 还没有正式提交评阅。专家提交后，这里会列出将公开的内容，届时才能发布。
            </StateBlock>

            <template v-else>
              <section class="sec" aria-labelledby="pub-h">
                <div class="sec__head">
                  <h3 id="pub-h">{{ selected.view === 'publish' ? '将公开的内容' : selected.correction ? '当前生效的发布内容' : '已发布的内容' }}</h3>
                  <p>{{ selected.view === 'publish' ? '发布后学生与导师按这个顺序阅读' : '读回自发布快照' }}</p>
                </div>
                <div class="verdict">
                  <div>
                    <span class="verdict__k">评阅结论</span>
                    <StatusPill :tone="outcomeTone(selected.outcome)">{{ outcomeLabel[selected.outcome] }}</StatusPill>
                  </div>
                  <div>
                    <span class="verdict__k">总分</span>
                    <span class="verdict__v num">{{ selected.total }}<small> / 100</small></span>
                  </div>
                </div>
                <article v-for="item in selected.items" :key="item.alias" class="opinion">
                  <h4>{{ item.alias }}<span class="muted">　{{ item.total }} 分，{{ item.recommendation }}</span></h4>
                  <dl class="opinion__body">
                    <dt>总体评价</dt><dd class="plain">{{ item.overall }}</dd>
                    <dt>主要问题</dt><dd class="plain">{{ item.issues }}</dd>
                    <dt>修改建议</dt><dd class="plain" :class="{ muted: !item.advice }">{{ item.advice || '专家未填写修改建议' }}</dd>
                  </dl>
                  <table class="dtable scores">
                    <caption class="sr-only">{{ item.alias }} 分项评分</caption>
                    <tbody>
                      <tr v-for="(d, i) in dimensions" :key="d.key">
                        <th scope="row" class="shrink">{{ d.label }}</th>
                        <td><span class="bar" :style="{ '--v': `${(item.scores[i]! / d.max) * 100}%` }" /></td>
                        <td class="n num">{{ item.scores[i] }} / {{ d.max }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="item.checks.length" class="checks">
                    <span class="muted">提交时复核提示（专家已逐条确认，不改变分数与结论）：</span>
                    <span v-for="c in item.checks" :key="c.label" class="tag">{{ c.label }} {{ c.count }}</span>
                  </p>
                </article>
              </section>

              <section v-if="selected.view === 'publish'" class="sec" aria-labelledby="hidden-h">
                <div class="sec__head"><h3 id="hidden-h">不会公开</h3></div>
                <p class="hint">专家身份与单位、主要优点、分项评价、专家与平台之间的往来记录。学校这里也只看到别名 E-001。</p>
              </section>
            </template>

            <ProtoNote contract="C-RESULT">
              发布件按快照 v2：修改建议空串显示“专家未填写修改建议”；不发布主要优点与分项评价。发布按钮是否出现以服务端 allowed_actions 的 PUBLISH_RESULT 为准，原型不加前端门禁。
            </ProtoNote>
          </div>

          <footer v-if="selected.view === 'publish'" class="commit">
            <p class="commit__text">{{ notReady ? '专家提交后才能发布。' : '发布后学生与导师即可阅读，发布不能撤回；之后的修改只能走更正。' }}</p>
            <button type="button" class="btn btn--primary" :disabled="notReady" @click="publishOpen = true">发布结果</button>
          </footer>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="publishOpen && Boolean(selected)" title="发布评阅结果" @close="publishOpen = false">
        <p>发布《{{ selected?.title }}》的评阅结果后，学生{{ selected?.student }}与其导师会看到：</p>
        <ul class="dlg-list">
          <li>评阅结论“{{ selected && outcomeLabel[selected.outcome] }}”与总分 {{ selected?.total }}</li>
          <li>E-001 的评审建议、总体评价、主要问题、修改建议与分项评分</li>
        </ul>
        <p class="muted">不会看到专家身份、主要优点与分项评价。发布不能撤回。</p>
        <template #actions>
          <button type="button" class="btn" @click="publishOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="publish">确认发布</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="activateOpen" title="确认这次更正" @close="activateOpen = false">
        <p>确认后，总分由 {{ selected?.correction?.before.total }} 变为 {{ selected?.correction?.after.total }}，系统自动追加一条发布记录。</p>
        <p class="muted">学生与导师会看到更正后的结果，并看到“结果已更正”的说明。</p>
        <label class="field">
          <span>确认说明（平台与专家可见）</span>
          <textarea v-model="activateReason" class="textarea" rows="2" placeholder="例如：已核对，属于录入错误" :aria-invalid="activateTried && !activateReason.trim()" />
          <small v-if="activateTried && !activateReason.trim()" class="field-error">请填写确认说明。</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="activateOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="activate">确认更正</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="rejectOpen" title="不予确认这次更正" @close="rejectOpen = false">
        <p>原生效版本保持不变，学生与导师看到的内容不变。</p>
        <label class="field">
          <span>不予确认的原因（平台与专家可见）</span>
          <textarea v-model="rejectReason" class="textarea" rows="3" :aria-invalid="rejectTried && !rejectReason.trim()" aria-describedby="reject-err" />
          <small v-if="rejectTried && !rejectReason.trim()" id="reject-err" class="field-error">请填写原因。</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="rejectOpen = false">取消</button>
          <button type="button" class="btn btn--danger" @click="reject">不予确认</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 40px;
  padding: 12px 14px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.verdict > div {
  display: grid;
  gap: 4px;
  justify-items: start;
}
.verdict__k {
  color: var(--ws-muted);
  font-size: 12px;
}
.verdict__v {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
}
.verdict__v small {
  color: var(--ws-muted);
  font-size: 13px;
  font-weight: 400;
}
.opinion {
  display: grid;
  gap: 12px;
  padding-top: 4px;
}
.opinion h4 {
  font-size: 14px;
  font-weight: 600;
}
.opinion__body {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  line-height: 1.7;
}
.opinion__body dt {
  color: var(--ws-muted);
  font-size: 13px;
}
.opinion__body dd {
  margin: 0;
}
.scores th {
  color: var(--ws-muted);
  font-weight: 400;
}
.scores td,
.scores th {
  padding-block: 6px;
}
.bar {
  display: block;
  min-width: 80px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, var(--ws-action) var(--v), var(--ws-sunken) var(--v));
}
.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 12px;
}
.compare th[scope='row'] {
  color: var(--ws-muted);
  font-weight: 400;
  vertical-align: top;
}
.compare td {
  width: 45%;
  vertical-align: top;
  line-height: 1.65;
}
.changed {
  background: var(--ws-warning-soft);
}
.dlg-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 1.2em;
}
@media (max-width: 899px) {
  .opinion__body {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .opinion__body dd {
    margin-bottom: 8px;
  }
  /* 窄屏：对照表改为逐项上下排列，两个版本都在视口内，不需要横向滚动 */
  .compare thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .compare tr {
    display: grid;
    gap: 4px;
    padding: 8px 0;
    border-bottom: 1px solid var(--ws-border);
  }
  .compare th,
  .compare td {
    display: block;
    width: auto;
    padding: 2px 8px;
    border: 0;
  }
  .compare td::before {
    content: attr(data-label) '：';
    color: var(--ws-muted);
    font-size: 12px;
  }
}
</style>
