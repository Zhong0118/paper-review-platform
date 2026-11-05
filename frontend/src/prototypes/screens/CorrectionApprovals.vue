<script setup lang="ts">
/**
 * P13b 平台更正审批（处理工作空间）：申请清单｜申请对象。
 * 平台只看申请信息（专家、任务、理由、备注），不看学校专属的更正前后对照，也不读论文正文。
 * 批准与驳回都要写原因（接口 DecisionBody.reason 必填）；批准后由专家起草，再交学校确认。
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
import { platformNav } from '../data/nav'
import { correctionRows, correctionStatusText, type CorrectionRow } from '../data/u3'

const states = [
  { value: 'normal', label: '有待审批' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '没有更正申请' },
  { value: 'error', label: '加载失败' },
  { value: 'approve', label: '批准确认' },
  { value: 'reject', label: '驳回确认' },
  { value: 'taken', label: '已被他人处理' },
  { value: 'history', label: '已处理（待学校确认）' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const rows = ref<CorrectionRow[]>(structuredClone(correctionRows))
const views = [
  { key: 'pending', label: '待审批' },
  { key: 'done', label: '已处理' },
  { key: 'all', label: '全部' },
] as const
type ViewKey = (typeof views)[number]['key']
const view = ref<ViewKey>('pending')
const isPending = (r: CorrectionRow) => r.status === 'REQUESTED'
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : rows.value))
const countOf = (key: ViewKey) => (key === 'all' ? loaded.value.length : loaded.value.filter((r) => (key === 'pending') === isPending(r)).length)
const list = computed(() => loaded.value.filter((r) => view.value === 'all' || (view.value === 'pending') === isPending(r)))
const selectedId = ref<string | null>(null)
const selected = computed(() => loaded.value.find((r) => r.id === selectedId.value) ?? null)

const decision = ref<'APPROVE' | 'REJECT' | null>(null)
const reason = ref('')
const tried = ref(false)
const flash = ref('')
const taken = ref(false)

watch(
  state,
  (s) => {
    rows.value = structuredClone(correctionRows)
    flash.value = ''
    reason.value = ''
    tried.value = false
    decision.value = s === 'approve' ? 'APPROVE' : s === 'reject' ? 'REJECT' : null
    taken.value = s === 'taken'
    const target = s === 'history' ? 'c1' : 'c3'
    view.value = s === 'history' ? 'done' : 'pending'
    selectedId.value = narrow.value && ['normal', 'loading', 'empty', 'error'].includes(s) ? null : target
    if (s === 'taken') {
      const r = rows.value.find((x) => x.id === 'c3')
      if (r) {
        r.status = 'APPROVED'
        r.notes.push({ kind: '平台批准（另一位运营）', text: '录入错误，同意更正。' })
      }
    }
  },
  { immediate: true },
)
watch(view, () => {
  if (selectedId.value && !list.value.some((r) => r.id === selectedId.value)) selectedId.value = narrow.value ? null : (list.value[0]?.id ?? null)
})
watch(selectedId, () => (flash.value = ''))

const tone = (r: CorrectionRow) =>
  r.status === 'REQUESTED' ? 'action' : r.status === 'REJECTED' || r.status === 'SCHOOL_REJECTED' || r.status === 'CANCELLED' ? 'neutral' : r.status === 'ACTIVATED' ? 'success' : 'warning'

function decide() {
  tried.value = true
  const r = selected.value
  if (!r || !decision.value || !reason.value.trim()) return
  const d = decision.value
  decision.value = null
  r.status = d === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  r.notes.push({ kind: d === 'APPROVE' ? '平台批准' : '平台驳回', text: reason.value.trim() })
  reason.value = ''
  tried.value = false
  flash.value = d === 'APPROVE' ? '已批准。专家现在可以起草更正稿，提交后交学校确认。' : '已驳回。专家会看到驳回原因，原评阅结果不变。'
}
const steps = [
  { key: 'REQUESTED', label: '专家申请' },
  { key: 'APPROVED', label: '平台批准' },
  { key: 'AWAITING_SCHOOL', label: '专家提交更正稿' },
  { key: 'ACTIVATED', label: '学校确认生效' },
] as const
const stepIndex = (r: CorrectionRow) => ({ REQUESTED: 0, APPROVED: 1, AWAITING_SCHOOL: 2, ACTIVATED: 3 } as Record<string, number>)[r.status] ?? -1
</script>

<template>
  <ProtoFrame v-model:state="state" name="更正审批" :states="states">
    <OperationsShell :nav="platformNav('corrections', undefined, { corrections: countOf('pending') })" :account="accounts.platform" org="百杰运营">
      <template #title><h1 class="title">更正审批</h1></template>
      <template #context><span class="ctx">专家对已发布评阅的更正申请</span></template>

      <MasterDetail :open="Boolean(selected)" :narrow="narrow" list-label="更正申请清单" detail-label="当前申请" back-label="申请清单" @back="selectedId = null">
        <template #list>
          <div class="lhead">
            <div class="views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
                {{ v.label }}<span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
          </div>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取更正申请…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="更正申请没有加载出来" compact>
            网络或服务暂时不可用。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="还没有更正申请" compact>专家在已发布的任务里申请更正后，会出现在这里。</StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'pending' ? '待审批的申请都已处理' : '这个视图里没有申请'" compact />
          <ul v-else class="tlist">
            <li v-for="r in list" :key="r.id">
              <button type="button" class="titem" :class="{ 'titem--on': r.id === selectedId }" :aria-current="r.id === selectedId" @click="selectedId = r.id">
                <span class="titem__title">{{ r.title }}</span>
                <span class="titem__meta">{{ r.expert }}　{{ r.task }}　{{ r.requestedAt }}</span>
                <span class="titem__line"><StatusPill :tone="tone(r)">{{ correctionStatusText[r.status] }}</StatusPill></span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="!['loading', 'error', 'empty'].includes(state)" kind="empty" title="从左侧选择一条申请" compact />
        </template>

        <template v-if="selected">
          <div class="obj">
            <header class="obj__head">
              <div class="obj__row"><StatusPill :tone="tone(selected)">{{ correctionStatusText[selected.status] }}</StatusPill></div>
              <h2 class="obj__title">{{ selected.title }}</h2>
              <dl class="obj__meta">
                <div><dt>专家</dt><dd>{{ selected.expert }}</dd></div>
                <div><dt>任务</dt><dd class="num">{{ selected.task }}</dd></div>
                <div><dt>学校</dt><dd>{{ selected.school }}</dd></div>
                <div><dt>申请</dt><dd class="num">{{ selected.requestedAt }}</dd></div>
              </dl>
            </header>

            <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
            <div v-if="taken && selected.id === 'c3'" class="banner banner--warn" role="alert">
              <strong>这条申请已被另一位运营处理</strong>
              <span>刚才的状态已读回：已批准。你不需要再操作。</span>
            </div>

            <ol v-if="stepIndex(selected) >= 0" class="steps" aria-label="更正进度">
              <li v-for="(st, i) in steps" :key="st.key" :class="{ done: i < stepIndex(selected), now: i === stepIndex(selected) }">
                <span class="dot" aria-hidden="true" />{{ st.label }}<span v-if="i === stepIndex(selected)" class="sr-only">（当前）</span>
              </li>
            </ol>

            <section class="sec" aria-labelledby="rq-h">
              <div class="sec__head"><h3 id="rq-h">申请理由</h3><p>专家原文</p></div>
              <p class="plain reason">{{ selected.reason }}</p>
            </section>

            <section v-if="selected.notes.length" class="sec" aria-labelledby="nt-h">
              <div class="sec__head"><h3 id="nt-h">处理记录</h3></div>
              <ul class="notes">
                <li v-for="(n, i) in selected.notes" :key="i"><strong>{{ n.kind }}</strong><span class="plain">{{ n.text }}</span></li>
              </ul>
            </section>

            <p class="hint">平台审批只看申请理由。更正前后的具体内容由学校在结果处理页核对确认，这里不显示。</p>

            <ProtoNote contract="corrections">
              correctionCommand('decide') 带 version、decision（APPROVE / REJECT）与 reason；状态被他人改变时 409，界面读回最新状态。
            </ProtoNote>
          </div>

          <footer v-if="selected.status === 'REQUESTED'" class="commit">
            <p class="commit__text">批准后专家起草更正稿；驳回则原评阅结果不变。</p>
            <button type="button" class="btn" @click="decision = 'REJECT'">驳回…</button>
            <button type="button" class="btn btn--primary" @click="decision = 'APPROVE'">批准…</button>
          </footer>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="Boolean(decision) && Boolean(selected)" :title="decision === 'APPROVE' ? '批准更正申请' : '驳回更正申请'" @close="decision = null">
        <p v-if="decision === 'APPROVE'">批准后，{{ selected?.expert }}可以起草更正稿；提交后交学校核对确认，学校确认前学生看到的结果不变。</p>
        <p v-else>驳回后原评阅结果不变，{{ selected?.expert }}会看到驳回原因。</p>
        <label class="field">
          <span>{{ decision === 'APPROVE' ? '批准说明' : '驳回原因' }}（专家可见）</span>
          <textarea v-model="reason" class="textarea" rows="3" :aria-invalid="tried && !reason.trim()" />
          <small v-if="tried && !reason.trim()" class="field-error">请填写{{ decision === 'APPROVE' ? '批准说明' : '驳回原因' }}。</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="decision = null">取消</button>
          <button type="button" class="btn" :class="decision === 'APPROVE' ? 'btn--primary' : 'btn--danger'" @click="decide">{{ decision === 'APPROVE' ? '批准' : '驳回' }}</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.reason {
  line-height: 1.75;
}
.notes {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.notes li {
  display: grid;
  gap: 2px;
}
.notes strong {
  font-weight: 600;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--ws-muted);
  font-size: 13px;
}
.steps li {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.dot {
  width: 8px;
  height: 8px;
  border: 1.5px solid var(--ws-border-strong);
  border-radius: 50%;
}
.steps .done .dot {
  border-color: var(--ws-success);
  background: var(--ws-success);
}
.steps .now {
  color: var(--ws-text);
  font-weight: 600;
}
.steps .now .dot {
  border-color: var(--ws-action);
  background: var(--ws-action);
}
</style>
