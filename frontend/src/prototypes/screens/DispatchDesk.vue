<script setup lang="ts">
/**
 * P06 平台派单台（处理工作空间）：论文清单｜论文需求与候选比较。
 * 单专家试点：候选单选，不出现多选复选框。排序为规则分，不是自动派单；负荷只作参考。
 * 指派、改派、拒绝后重新指派是三条不同命令路径；成功与否以服务端重新校验为准。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import { accounts, candidates as baseCandidates, dispatchItems, type Candidate, type DispatchItem } from '../data/fixtures'
import { platformNav } from '../data/nav'

const states = [
  { value: 'normal', label: '有候选' },
  { value: 'norecords', label: '无专家记录' },
  { value: 'allblocked', label: '候选全部不可派' },
  { value: 'error', label: '候选加载失败' },
  { value: 'conflict', label: '确认时档案已变' },
  { value: 'reassign', label: '改派确认' },
] as const
const state = useProtoState(states, 'normal')

const view = ref<DispatchItem['view']>('pending')
const views = [
  { key: 'pending', label: '待指派' },
  { key: 'active', label: '进行中' },
  { key: 'follow', label: '需跟进' },
] as const
const countOf = (key: DispatchItem['view']) => dispatchItems.filter((item) => item.view === key).length
const list = computed(() => dispatchItems.filter((item) => item.view === view.value))
const selectedId = ref<string | null>('d1')
const item = computed(() => dispatchItems.find((row) => row.id === selectedId.value) ?? null)
watch(view, () => {
  if (!list.value.some((row) => row.id === selectedId.value)) selectedId.value = narrow.value ? null : (list.value[0]?.id ?? null)
})

const candidates = ref<Candidate[]>(structuredClone(baseCandidates))
const shown = computed(() => {
  if (state.value === 'norecords') return []
  if (state.value === 'allblocked')
    return candidates.value.map((c) => ({ ...c, blocked: c.blocked ?? (c.inReview >= 4 ? '暂停服务（本人申请）' : '方向不符：研究方向与论文学科不匹配') }))
  return candidates.value
})
const available = computed(() => shown.value.filter((c) => !c.blocked).sort((a, b) => b.score - a.score))
const blocked = computed(() => shown.value.filter((c) => c.blocked))
const blockedSummary = computed(() => {
  const counts = new Map<string, number>()
  for (const c of blocked.value) {
    const key = c.blocked!.split('：')[0]!.replace(/（.*$/, '')
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()].map(([k, n]) => `${k} ${n} 位`).join('，')
})

const chosen = ref<string | null>(null)
const chosenExpert = computed(() => shown.value.find((c) => c.id === chosen.value) ?? null)
const pending = ref(false)
const result = ref<null | { kind: 'ok' | 'conflict'; text: string }>(null)
watch([selectedId, state], () => {
  chosen.value = null
  result.value = null
  reassigning.value = state.value === 'reassign'
  if (state.value === 'reassign') {
    view.value = 'active'
    selectedId.value = 'd5'
  }
})

const reassigning = ref(false)
const commandLabel = computed(() => {
  if (item.value?.task && reassigning.value) return '确认改派'
  if (item.value?.history?.some((h) => h.result === '已拒绝')) return '重新指派'
  return '确认指派'
})
const dialogOpen = ref(false)
watch(state, (s) => {
  if (s === 'reassign') {
    chosen.value = 'e2'
    dialogOpen.value = true
  }
}, { immediate: true })

async function confirm() {
  if (!chosenExpert.value || !item.value) return
  if (item.value.task && reassigning.value && !dialogOpen.value) {
    dialogOpen.value = true
    return
  }
  dialogOpen.value = false
  pending.value = true
  result.value = null
  await new Promise((r) => setTimeout(r, 700))
  pending.value = false
  if (state.value === 'conflict') {
    const name = chosenExpert.value.name
    candidates.value = candidates.value.map((c) => (c.id === chosen.value ? { ...c, blocked: '回避：档案更新后与论文同一单位', version: c.version + 1 } : c))
    chosen.value = null
    result.value = { kind: 'conflict', text: `${name}的档案在你选择后已更新，当前不可指派。候选已刷新，请重新选择。` }
    return
  }
  result.value = { kind: 'ok', text: `已向${chosenExpert.value.name}发出评阅邀请，等待专家接受。论文移到“进行中”。` }
}

const extDecision = ref<null | 'approved' | 'rejected'>(null)
const extRejectReason = ref('')

const narrow = ref(false)
let media: MediaQueryList | null = null
const sync = () => (narrow.value = media?.matches ?? false)
onMounted(() => {
  media = window.matchMedia('(max-width: 899px)')
  sync()
  media.addEventListener('change', sync)
})
onBeforeUnmount(() => media?.removeEventListener('change', sync))
</script>

<template>
  <ProtoFrame v-model:state="state" name="平台派单台" :states="states">
    <OperationsShell :nav="platformNav('dispatch', countOf('pending'))" :account="accounts.platform" org="百杰运营">
      <template #title><h1 class="title">派单台</h1></template>
      <template #context><span class="muted ctx">单专家试点，每篇论文指派 1 位专家</span></template>

      <div class="desk" :class="{ 'desk--narrow': narrow, 'desk--detail': narrow && item }">
        <!-- 论文清单 -->
        <section v-show="!narrow || !item" class="desk__list" aria-label="论文清单">
          <div class="views" role="tablist" aria-label="工作视图">
            <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
              {{ v.label }} <span class="num">{{ countOf(v.key) }}</span>
            </button>
          </div>
          <ul class="tlist">
            <li v-for="row in list" :key="row.id">
              <button type="button" class="titem" :class="{ 'titem--on': row.id === selectedId }" :aria-current="row.id === selectedId" @click="selectedId = row.id">
                <span class="titem__title">{{ row.title }}</span>
                <span class="titem__meta muted">{{ row.school }}　{{ row.program }}</span>
                <span class="titem__line" :class="{ 'titem__line--warn': row.view === 'follow' }">{{ row.line }}</span>
              </button>
            </li>
          </ul>
        </section>

        <!-- 论文需求与候选 -->
        <section v-if="item" class="desk__detail" aria-label="当前论文">
          <button v-if="narrow" type="button" class="btn btn--quiet back" @click="selectedId = null">‹ 论文清单</button>
          <header class="need">
            <h2 class="need__title">{{ item.title }}</h2>
            <dl class="need__meta">
              <div><dt>学校</dt><dd>{{ item.school }}</dd></div>
              <div><dt>专业</dt><dd>{{ item.program }}</dd></div>
              <div><dt>材料</dt><dd>当前送审匿名稿</dd></div>
              <div><dt>轮次</dt><dd>第 1 轮，需 1 位专家</dd></div>
            </dl>
            <p class="need__kw"><span class="muted">关键词</span><span v-for="k in item.keywords" :key="k" class="kw">{{ k }}</span></p>
          </header>

          <section v-if="item.task || item.history?.length" class="tasks" aria-label="当前任务与历史">
            <div v-if="item.task" class="task">
              <div class="task__main">
                <StatusPill tone="action">{{ item.task.status }}</StatusPill>
                <span><strong>{{ item.task.expert }}</strong>　{{ item.task.since }} 接受，截止 <span class="num">{{ extDecision === 'approved' ? '11-17' : item.task.deadline }}</span></span>
                <span v-if="extDecision === 'approved'" class="muted">（原截止 {{ item.task.deadline }}，已批准延期）</span>
              </div>
              <button v-if="!item.extension && !reassigning" type="button" class="btn btn--sm" @click="reassigning = true">改派…</button>
              <button v-else-if="reassigning && !item.extension" type="button" class="btn btn--sm btn--quiet" @click="reassigning = false; chosen = null">取消改派</button>
            </div>
            <div v-if="item.extension && !extDecision" class="ext">
              <p><strong>{{ item.extension.expert }}申请延期</strong>：截止 <span class="num">{{ item.extension.original }}</span> 延至 <span class="num">{{ item.extension.requested }}</span></p>
              <p class="muted">理由：{{ item.extension.reason }}</p>
              <label class="field"><span>驳回时的说明（专家可见）</span><input v-model="extRejectReason" class="input" /></label>
              <div class="ext__actions">
                <button type="button" class="btn" :disabled="!extRejectReason.trim()" @click="extDecision = 'rejected'">驳回</button>
                <button type="button" class="btn btn--primary" @click="extDecision = 'approved'">批准延期</button>
              </div>
            </div>
            <p v-if="extDecision === 'rejected'" class="muted ext-done">已驳回延期申请，截止仍为 {{ item.extension?.original }}。</p>
            <ul v-if="item.history?.length" class="hist">
              <li v-for="h in item.history" :key="h.at">
                <StatusPill tone="warning">{{ h.result }}</StatusPill>
                <span><strong>{{ h.expert }}</strong>　<span class="num">{{ h.at }}</span>　{{ h.note }}</span>
              </li>
            </ul>
          </section>

          <section v-if="!item.task || reassigning" class="cands" aria-label="候选专家">
            <div class="cands__head">
              <h3>{{ reassigning ? '选择改派给哪位专家' : '候选专家' }}</h3>
              <p class="muted">按规则分排序（研究方向与关键词命中，规则第 3 版）；在途任务数仅供参考，不是容量上限。</p>
            </div>

            <div v-if="result" class="result" :class="`result--${result.kind}`" :role="result.kind === 'ok' ? 'status' : 'alert'">{{ result.text }}</div>

            <StateBlock v-if="state === 'error'" kind="error" title="候选专家没有加载出来" compact>
              论文信息不受影响。可以重试，或稍后回来。
              <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
            </StateBlock>
            <StateBlock v-else-if="state === 'norecords'" kind="empty" title="专家库里没有 0812 计算机科学与技术方向的专家" compact>
              这不是推荐失败：目前没有任何该学科的专家档案。需要先在专家库新增或导入档案。
              <template #actions><button type="button" class="btn">打开专家库</button></template>
            </StateBlock>
            <template v-else>
              <StateBlock v-if="!available.length" kind="unconfigured" :title="`有 ${blocked.length} 位候选，但当前都不可指派`" compact>
                {{ blockedSummary }}。可以在专家库调整资格或服务状态，或等待暂停结束。
              </StateBlock>

              <div class="table-wrap">
                <table class="ctable">
                  <thead>
                    <tr>
                      <th scope="col"><span class="sr-only">选择</span></th>
                      <th scope="col">专家</th>
                      <th scope="col">匹配依据</th>
                      <th scope="col" class="num-col">在途任务</th>
                      <th scope="col">可否指派</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="c in available" :key="c.id" :class="{ 'row--on': chosen === c.id }" @click="chosen = c.id">
                      <td><input :id="`c-${c.id}`" v-model="chosen" type="radio" name="expert" :value="c.id" :aria-label="`选择${c.name}`" /></td>
                      <td>
                        <label :for="`c-${c.id}`" class="who"><strong>{{ c.name }}</strong><span class="muted">{{ c.title }}，{{ c.unit }}</span></label>
                      </td>
                      <td>
                        <span class="score num">{{ c.score }} 分</span>
                        <span class="reasons"><span v-for="r in c.reasons" :key="r.tag" class="reason">{{ r.kind }}：{{ r.tag }} +{{ r.points }}</span></span>
                      </td>
                      <td class="num-col num">待接 {{ c.invited }}　评阅中 {{ c.inReview }}</td>
                      <td><StatusPill tone="success">可指派</StatusPill></td>
                    </tr>
                    <tr v-if="available.length && blocked.length" class="divider"><td colspan="5">不可指派 {{ blocked.length }} 位</td></tr>
                    <tr v-for="c in blocked" :key="c.id" class="row--blocked">
                      <td><input type="radio" disabled :aria-label="`${c.name}不可指派`" /></td>
                      <td><span class="who"><strong>{{ c.name }}</strong><span class="muted">{{ c.title }}，{{ c.unit }}</span></span></td>
                      <td><span class="score num">{{ c.score }} 分</span></td>
                      <td class="num-col num">待接 {{ c.invited }}　评阅中 {{ c.inReview }}</td>
                      <td><StatusPill tone="danger">{{ c.blocked }}</StatusPill></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
            <ProtoNote>候选形状参照 dispatch.ts（match_score、match_reasons、workload、unavailable_reasons）。“回避/资格/暂停/方向不符”分别来自服务端原因，前端不自行推断。</ProtoNote>
          </section>

          <footer v-if="(!item.task || reassigning) && state !== 'error' && state !== 'norecords'" class="commit">
            <p v-if="chosenExpert" class="commit__sel">已选：<strong>{{ chosenExpert.name }}</strong><span class="muted">　{{ chosenExpert.unit }}</span></p>
            <p v-else class="muted commit__sel">{{ available.length ? '在上方选择一位专家' : '暂无可指派的专家' }}</p>
            <p v-if="commandLabel === '重新指派'" class="muted commit__hint">上一位专家已拒绝，这是一次新的指派，不是改派。</p>
            <button type="button" class="btn btn--primary" :disabled="!chosenExpert || pending" @click="confirm">{{ pending ? '正在提交…' : commandLabel }}</button>
          </footer>
        </section>
        <StateBlock v-else-if="!narrow" kind="empty" title="选择左侧一篇论文开始派单" />
      </div>
    </OperationsShell>

    <ConfirmDialog :open="dialogOpen" title="改派这篇论文？" wide @close="dialogOpen = false">
      <dl class="swap">
        <dt>当前任务</dt><dd>{{ item?.task?.expert }}，{{ item?.task?.status }}，截止 {{ item?.task?.deadline }}</dd>
        <dt>改派给</dt><dd>{{ chosenExpert?.name ?? '尚未选择' }}<span v-if="chosenExpert" class="muted">，{{ chosenExpert.unit }}</span></dd>
      </dl>
      <p>当前任务会被关闭并保留在历史记录中，原专家不能再提交这篇论文的评阅。新专家收到邀请后需要先接受；期限按新任务重新计算，以服务端结果为准。</p>
      <template #actions>
        <button type="button" class="btn" @click="dialogOpen = false">取消</button>
        <button type="button" class="btn btn--primary" :disabled="!chosenExpert" @click="confirm">确认改派</button>
      </template>
    </ConfirmDialog>
  </ProtoFrame>
</template>

<style scoped>
.title {
  font-size: 17px;
  font-weight: 600;
}
.ctx {
  font-size: 13px;
}
.desk {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: calc(100vh - var(--ws-bar));
}
.desk--narrow {
  grid-template-columns: minmax(0, 1fr);
  height: auto;
  min-height: calc(100vh - var(--ws-bar));
}
.desk__list {
  overflow-y: auto;
  border-right: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.views {
  position: sticky;
  z-index: 2;
  top: 0;
  display: flex;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.views__tab {
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--ws-radius);
  background: transparent;
  color: var(--ws-muted);
  cursor: pointer;
}
.views__tab[aria-selected='true'] {
  background: var(--ws-action-soft);
  color: var(--ws-action);
  font-weight: 600;
}
.tlist {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}
.titem {
  display: grid;
  width: 100%;
  gap: 3px;
  padding: 10px 16px;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.titem:hover {
  background: var(--ws-sunken);
}
.titem--on,
.titem--on:hover {
  border-left-color: var(--ws-action);
  background: var(--ws-action-soft);
}
.titem__title {
  font-weight: 500;
  line-height: 1.45;
}
.titem__meta {
  font-size: 12px;
}
.titem__line {
  font-size: 12px;
}
.titem__line--warn {
  color: var(--ws-warning);
  font-weight: 500;
}
.desk__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  background: var(--ws-page);
}
.back {
  align-self: flex-start;
  margin: 8px 8px 0;
  color: var(--ws-action);
}
.need {
  display: grid;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.need__title {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.45;
}
.need__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 24px;
  margin: 0;
  font-size: 13px;
}
.need__meta div {
  display: flex;
  gap: 8px;
}
.need__meta dt {
  color: var(--ws-muted);
}
.need__meta dd {
  margin: 0;
}
.need__kw {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
.kw {
  padding: 1px 8px;
  border: 1px solid var(--ws-border);
  border-radius: 4px;
  background: var(--ws-page);
}
.tasks {
  display: grid;
  gap: 10px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.task {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.task__main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 13px;
}
.ext {
  display: grid;
  gap: 8px;
  padding: 12px;
  border-left: 3px solid var(--ws-warning);
  background: var(--ws-warning-soft);
  font-size: 13px;
}
.ext__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.ext-done {
  font-size: 13px;
}
.hist {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.hist li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.cands {
  display: grid;
  gap: 10px;
  padding: 16px 20px;
}
.cands__head h3 {
  font-size: 15px;
  font-weight: 600;
}
.cands__head p {
  margin-top: 2px;
  font-size: 12px;
}
.result {
  padding: 10px 12px;
  border-left: 3px solid var(--ws-success);
  background: var(--ws-success-soft);
  font-size: 13px;
}
.result--conflict {
  border-left-color: var(--ws-danger);
  background: var(--ws-danger-soft);
}
.table-wrap {
  overflow-x: auto;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-panel);
  background: var(--ws-surface);
}
.ctable {
  width: 100%;
  min-width: 720px;
  border-collapse: collapse;
}
.ctable th {
  height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid var(--ws-border);
  color: var(--ws-muted);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
}
.ctable th:first-child,
.ctable td:first-child {
  width: 36px;
}
.ctable td:nth-child(2) {
  width: 30%;
}
.ctable td:nth-child(3) {
  width: 36%;
}
.ctable td {
  padding: 10px;
  border-bottom: 1px solid var(--ws-border);
  vertical-align: top;
}
.ctable tbody tr:last-child td {
  border-bottom: 0;
}
.ctable tbody tr:not(.row--blocked):not(.divider) {
  cursor: pointer;
}
.ctable tbody tr:not(.row--blocked):not(.divider):hover {
  background: #fafbfc;
}
.row--on,
.ctable tbody tr.row--on:hover {
  background: var(--ws-action-soft);
}
.row--blocked td {
  color: var(--ws-muted);
}
.divider td {
  padding: 6px 10px;
  background: var(--ws-page);
  color: var(--ws-muted);
  font-size: 12px;
}
.who {
  display: grid;
  gap: 2px;
  cursor: inherit;
}
.who .muted {
  font-size: 12px;
}
.score {
  display: block;
  font-weight: 600;
}
.reasons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.reason {
  padding: 0 6px;
  border-radius: 3px;
  background: var(--ws-sunken);
  color: var(--ws-muted);
  font-size: 12px;
}
.num-col {
  white-space: nowrap;
}
.commit {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-top: auto;
  padding: 10px 20px;
  border-top: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
.commit__sel {
  flex: 1;
  font-size: 13px;
}
.commit__hint {
  flex-basis: 100%;
  order: 3;
  font-size: 12px;
}
.swap {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px 12px;
  margin: 0;
  padding: 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-page);
}
.swap dt {
  color: var(--ws-muted);
}
.swap dd {
  margin: 0;
}
@media (max-width: 899px) {
  .ctx {
    display: none;
  }
  .need,
  .tasks,
  .cands {
    padding-inline: 14px;
  }
}
</style>
