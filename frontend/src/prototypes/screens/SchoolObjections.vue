<script setup lang="ts">
/**
 * P11 学校异议处理（处理工作空间）：异议队列｜异议对象。
 * 待处理只有“开始处理”；处理中才出现办结表单（渠道＋结论，均必填，结论学生可见）；办结前确认。
 * 学生原文按纯文本显示，不改写。
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
import { objectionRows, type ObjectionRow } from '../data/u3'

const states = [
  { value: 'normal', label: '有待处理' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '没有异议' },
  { value: 'error', label: '加载失败' },
  { value: 'processing', label: '处理中（办结表单）' },
  { value: 'resolve', label: '办结确认' },
  { value: 'resolved', label: '已办结' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const rows = ref<ObjectionRow[]>(structuredClone(objectionRows))
const views = [
  { key: 'SUBMITTED', label: '待处理' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'RESOLVED', label: '已办结' },
] as const
type ViewKey = (typeof views)[number]['key']
const view = ref<ViewKey>('SUBMITTED')
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : rows.value))
const countOf = (key: ViewKey) => loaded.value.filter((r) => r.status === key).length
const list = computed(() => loaded.value.filter((r) => r.status === view.value))
const selectedId = ref<string | null>(null)
const selected = computed(() => loaded.value.find((r) => r.id === selectedId.value) ?? null)

const channel = ref<'ONLINE' | 'OFFLINE' | ''>('')
const conclusion = ref('')
const tried = ref(false)
const confirmOpen = ref(false)
const flash = ref('')

watch(
  state,
  (s) => {
    rows.value = structuredClone(objectionRows)
    flash.value = ''
    tried.value = false
    channel.value = s === 'resolve' ? 'ONLINE' : ''
    conclusion.value = s === 'resolve' ? '已核对：评分说明见评阅意见“研究方法”一项，专家认为方法合理但实验设计仍有改进空间，分数与评语一致。评阅结论不变。' : ''
    confirmOpen.value = s === 'resolve'
    const target = s === 'processing' || s === 'resolve' ? 'o2' : s === 'resolved' ? 'o3' : 'o1'
    view.value = (rows.value.find((r) => r.id === target)?.status ?? 'SUBMITTED') as ViewKey
    selectedId.value = narrow.value && ['normal', 'loading', 'empty', 'error'].includes(s) ? null : target
  },
  { immediate: true },
)
watch(view, () => {
  if (selectedId.value && !list.value.some((r) => r.id === selectedId.value)) selectedId.value = narrow.value ? null : (list.value[0]?.id ?? null)
})

const pill = (r: ObjectionRow) =>
  r.status === 'SUBMITTED' ? { tone: 'action' as const, text: '待处理' } : r.status === 'PROCESSING' ? { tone: 'warning' as const, text: '处理中' } : { tone: 'success' as const, text: '已办结' }
const missing = computed(() => ({ channel: !channel.value, conclusion: !conclusion.value.trim() }))

function start() {
  const r = selected.value
  if (!r) return
  r.status = 'PROCESSING'
  view.value = 'PROCESSING'
  flash.value = '已开始处理。学生会看到“学校正在处理你的异议”。'
}
function requestResolve() {
  tried.value = true
  if (missing.value.channel || missing.value.conclusion) return
  confirmOpen.value = true
}
function resolve() {
  const r = selected.value
  if (!r || !channel.value) return
  confirmOpen.value = false
  r.status = 'RESOLVED'
  r.channel = channel.value
  r.conclusion = conclusion.value.trim()
  view.value = 'RESOLVED'
  flash.value = '已办结。学生现在可以在反馈页看到处理结论。'
}
const channelText = { ONLINE: '线上答复', OFFLINE: '线下沟通' } as const
</script>

<template>
  <ProtoFrame v-model:state="state" name="学校异议处理" :states="states">
    <OperationsShell :nav="schoolNav('objections', undefined, { objections: countOf('SUBMITTED') + countOf('PROCESSING') })" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">异议处理</h1></template>
      <template #context><span class="ctx">学生对已发布结果登记的异议</span></template>

      <MasterDetail :open="Boolean(selected)" :narrow="narrow" list-label="异议清单" detail-label="当前异议" back-label="异议清单" @back="selectedId = null">
        <template #list>
          <div class="lhead">
            <div class="views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
                {{ v.label }}<span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
          </div>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取异议…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="异议清单没有加载出来" compact>
            网络或服务暂时不可用。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="还没有学生登记异议" compact>学生在反馈页登记异议后，会出现在“待处理”。</StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'SUBMITTED' ? '待处理的异议都已开始处理' : '这个视图里没有异议'" compact />
          <ul v-else class="tlist">
            <li v-for="r in list" :key="r.id">
              <button type="button" class="titem" :class="{ 'titem--on': r.id === selectedId }" :aria-current="r.id === selectedId" @click="selectedId = r.id">
                <span class="titem__title">{{ r.title }}</span>
                <span class="titem__meta">{{ r.student }}　{{ r.studentNo }}　{{ r.createdAt }} 登记</span>
                <span class="titem__line clamp">{{ r.reason }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="!['loading', 'error', 'empty'].includes(state)" kind="empty" title="从左侧选择一条异议" compact />
        </template>

        <template v-if="selected">
          <div class="obj">
            <header class="obj__head">
              <div class="obj__row">
                <StatusPill :tone="pill(selected).tone">{{ pill(selected).text }}</StatusPill>
                <RouterLink class="btn btn--sm btn--quiet" :to="{ path: '/prototype/results', query: { state: 'published' } }">查看已发布结果</RouterLink>
              </div>
              <h2 class="obj__title">{{ selected.title }}</h2>
              <dl class="obj__meta">
                <div><dt>学生</dt><dd>{{ selected.student }}（{{ selected.studentNo }}）</dd></div>
                <div><dt>登记</dt><dd class="num">{{ selected.createdAt }}</dd></div>
              </dl>
            </header>

            <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>

            <section class="sec" aria-labelledby="obj-h">
              <div class="sec__head"><h3 id="obj-h">学生的异议</h3><p>原文</p></div>
              <dl class="said">
                <dt>理由</dt><dd class="plain">{{ selected.reason }}</dd>
                <dt>诉求</dt><dd class="plain">{{ selected.request }}</dd>
              </dl>
            </section>

            <section v-if="selected.status === 'SUBMITTED'" class="sec" aria-labelledby="do-h">
              <div class="sec__head"><h3 id="do-h">办理</h3></div>
              <p class="hint">开始处理后，学生会看到“学校正在处理”。之后在这里记录办理渠道与结论。</p>
              <div class="acts"><button type="button" class="btn btn--primary" @click="start">开始处理</button></div>
            </section>

            <section v-else-if="selected.status === 'PROCESSING'" class="sec" aria-labelledby="do-h">
              <div class="sec__head"><h3 id="do-h">办结</h3><p>结论学生可见</p></div>
              <fieldset class="field fs">
                <legend>办理渠道</legend>
                <div class="choices" :aria-invalid="tried && missing.channel">
                  <label class="choice"><input v-model="channel" type="radio" name="channel" value="ONLINE" /> 线上答复</label>
                  <label class="choice"><input v-model="channel" type="radio" name="channel" value="OFFLINE" /> 线下沟通</label>
                </div>
                <small v-if="tried && missing.channel" class="field-error">请选择办理渠道。</small>
              </fieldset>
              <label class="field">
                <span>处理结论</span>
                <textarea v-model="conclusion" class="textarea" rows="4" :aria-invalid="tried && missing.conclusion" placeholder="写明核对了什么、结论是什么、评阅结论是否改变" />
                <small v-if="tried && missing.conclusion" class="field-error">请填写处理结论。</small>
              </label>
              <div class="acts acts--end"><button type="button" class="btn btn--primary" @click="requestResolve">办结异议</button></div>
            </section>

            <section v-else class="sec" aria-labelledby="done-h">
              <div class="sec__head"><h3 id="done-h">处理结论</h3></div>
              <dl class="kv">
                <dt>渠道</dt><dd>{{ selected.channel && channelText[selected.channel] }}</dd>
                <dt>结论</dt><dd class="plain">{{ selected.conclusion }}</dd>
              </dl>
            </section>

            <ProtoNote contract="objections">
              现行接口：开始处理 startObjection、办结 resolveObjection(channel, conclusion)。需要专家复核时的系统内路径未定义（更正只能由专家发起），原型不提供“转专家”按钮。
            </ProtoNote>
          </div>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="confirmOpen" title="办结这条异议" @close="confirmOpen = false">
        <p>办结后学生会看到渠道“{{ channel && channelText[channel] }}”和下面的结论：</p>
        <p class="quote plain">{{ conclusion.trim() }}</p>
        <template #actions>
          <button type="button" class="btn" @click="confirmOpen = false">再改改</button>
          <button type="button" class="btn btn--primary" @click="resolve">确认办结</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.clamp {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ws-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.said {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  line-height: 1.75;
}
.said dt {
  color: var(--ws-muted);
  font-size: 13px;
}
.said dd {
  margin: 0;
}
.fs {
  margin: 0;
  padding: 0;
  border: 0;
}
.fs legend {
  margin-bottom: 6px;
  padding: 0;
  font-size: 13px;
  font-weight: 500;
}
.quote {
  padding: 10px 12px;
  border-left: 3px solid var(--ws-border-strong);
  background: var(--ws-page);
}
</style>
