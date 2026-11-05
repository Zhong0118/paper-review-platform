<script setup lang="ts">
/**
 * P13a 平台专家库（处理工作空间）：专家清单｜专家档案。
 * 三种“不可用”分开：资格审核（全局能否派单）、服务状态（本人暂停接单）、回避关系（只对特定学校/导师不可派）。
 * 导入档案：只更新已有专家的档案字段，不新建账号；任何一行有错，整份预览不能应用；过期或档案已变只能重新预览。
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
import { expertImport, experts as baseExperts, qualificationText, serviceText, tenants, type Expert } from '../data/u3'

const states = [
  { value: 'normal', label: '可指派的专家' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '还没有专家' },
  { value: 'nomatch', label: '筛选无匹配' },
  { value: 'error', label: '加载失败' },
  { value: 'pending', label: '资格待审核' },
  { value: 'paused', label: '本人暂停服务' },
  { value: 'conflict', label: '保存档案时版本冲突' },
  { value: 'pause', label: '暂停服务确认' },
  { value: 'import', label: '导入：预览未写入' },
  { value: 'import-invalid', label: '导入：预览有错误' },
  { value: 'import-expired', label: '导入：预览已过期' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const experts = ref<Expert[]>(structuredClone(baseExperts))
const views = [
  { key: 'ready', label: '可指派' },
  { key: 'pending', label: '待审核' },
  { key: 'blocked', label: '不可派' },
  { key: 'all', label: '全部' },
] as const
type ViewKey = (typeof views)[number]['key']
const bucket = (e: Expert): Exclude<ViewKey, 'all'> =>
  e.qualification === 'PENDING' ? 'pending' : e.qualification === 'APPROVED' && e.service === 'AVAILABLE' ? 'ready' : 'blocked'
const view = ref<ViewKey>('ready')
const keyword = ref('')
const discipline = ref('')
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : experts.value))
const disciplines = computed(() => [...new Set(baseExperts.flatMap((e) => e.disciplines))].sort())
const countOf = (key: ViewKey) => (key === 'all' ? loaded.value.length : loaded.value.filter((e) => bucket(e) === key).length)
const list = computed(() =>
  loaded.value.filter(
    (e) =>
      (view.value === 'all' || bucket(e) === view.value) &&
      (!discipline.value || e.disciplines.includes(discipline.value)) &&
      (!keyword.value.trim() || `${e.name}${e.unit}${e.directions.join('')}`.includes(keyword.value.trim())),
  ),
)
const filtersActive = computed(() => Boolean(keyword.value.trim() || discipline.value))
const selectedId = ref<string | null>(null)
const selected = computed(() => loaded.value.find((e) => e.id === selectedId.value) ?? null)
const importing = ref(false)
const importStep = ref<'pick' | 'preview' | 'invalid' | 'expired' | 'done'>('pick')

const profile = ref({ unit: '', title: '', directions: '', keywords: '', sourceUrl: '', sourceNote: '' })
const loadProfile = (e: Expert | null) =>
  e && (profile.value = { unit: e.unit, title: e.title, directions: e.directions.join('、'), keywords: e.keywords.join('、'), sourceUrl: e.sourceUrl, sourceNote: e.sourceNote })
const dirty = computed(() => {
  const e = selected.value
  if (!e) return false
  const p = profile.value
  return p.unit !== e.unit || p.title !== e.title || p.directions !== e.directions.join('、') || p.keywords !== e.keywords.join('、') || p.sourceUrl !== e.sourceUrl || p.sourceNote !== e.sourceNote
})
const flash = ref('')
const conflict = ref(false)
/** 资格与服务状态的每次变更都要写原因（接口 VersionReason.reason 必填） */
type Decision = 'APPROVED' | 'REJECTED' | 'UNAVAILABLE' | 'AVAILABLE'
const decision = ref<Decision | null>(null)
const reason = ref('')
const reasonTried = ref(false)
function ask(d: Decision) {
  decision.value = d
  reason.value = ''
  reasonTried.value = false
}
const newConflict = ref({ kind: 'TENANT' as 'TENANT' | 'SUPERVISOR', tenant: '', name: '' })

watch(
  state,
  (s) => {
    experts.value = structuredClone(baseExperts)
    flash.value = ''
    keyword.value = s === 'nomatch' ? '量子' : ''
    discipline.value = ''
    conflict.value = s === 'conflict'
    decision.value = s === 'pause' ? 'UNAVAILABLE' : null
    reason.value = ''
    reasonTried.value = false
    importing.value = s.startsWith('import')
    importStep.value = s === 'import' ? 'preview' : s === 'import-invalid' ? 'invalid' : s === 'import-expired' ? 'expired' : 'pick'
    const target = s === 'pending' ? 'x3' : s === 'paused' ? 'x2' : 'x1'
    view.value = s === 'pending' ? 'pending' : s === 'paused' ? 'blocked' : 'ready'
    const listState = ['normal', 'loading', 'empty', 'error', 'nomatch'].includes(s)
    selectedId.value = importing.value || (narrow.value && listState) || s === 'nomatch' ? null : target
    loadProfile(experts.value.find((e) => e.id === target) ?? null)
    if (s === 'conflict') profile.value.title = '二级教授'
  },
  { immediate: true },
)
watch(selectedId, (id) => {
  if (state.value !== 'conflict') loadProfile(experts.value.find((e) => e.id === id) ?? null)
  flash.value = ''
})
watch(view, () => {
  if (selectedId.value && !list.value.some((e) => e.id === selectedId.value)) selectedId.value = narrow.value ? null : (list.value[0]?.id ?? null)
})

/** 可用性总览：逐条说清是哪一种原因，不合成一个“不可用” */
const availability = computed(() => {
  const e = selected.value
  if (!e) return null
  const reasons: string[] = []
  if (e.qualification === 'PENDING') reasons.push('资格尚未审核')
  if (e.qualification === 'REJECTED') reasons.push('资格审核未通过')
  if (e.service === 'UNAVAILABLE') reasons.push('本人已暂停服务')
  return reasons.length
    ? { tone: 'warning' as const, text: `现在不能指派：${reasons.join('；')}` }
    : { tone: 'success' as const, text: e.conflicts.length ? `可以指派，但对 ${e.conflicts.length} 项回避对象不可派` : '可以指派' }
})
const rowPill = (e: Expert) =>
  e.qualification === 'PENDING'
    ? { tone: 'action' as const, text: '待审核' }
    : e.qualification === 'REJECTED'
      ? { tone: 'neutral' as const, text: '资格未通过' }
      : e.service === 'UNAVAILABLE'
        ? { tone: 'warning' as const, text: '暂停服务' }
        : null

const decisionText = computed(() => {
  const e = selected.value
  if (!e || !decision.value) return null
  return {
    APPROVED: { title: '资格通过', body: `通过后，${e.name}在服务状态为“可接单”时会出现在派单候选中。`, cta: '通过', danger: false, label: '审核依据' },
    REJECTED: { title: '资格不通过', body: `不通过的专家不会出现在派单候选中；已接的 ${e.inFlight} 个任务不受影响。`, cta: '不通过', danger: true, label: '不通过的原因' },
    UNAVAILABLE: { title: '暂停服务', body: `暂停后，${e.name}不再出现在派单候选中。已接的 ${e.inFlight} 个任务继续，不受影响。`, cta: '暂停服务', danger: false, label: '暂停原因' },
    AVAILABLE: { title: '恢复接单', body: `恢复后，${e.name}重新出现在派单候选中。`, cta: '恢复接单', danger: false, label: '恢复原因' },
  }[decision.value]
})
function decide() {
  reasonTried.value = true
  const e = selected.value
  if (!e || !decision.value || !reason.value.trim()) return
  const d = decision.value
  decision.value = null
  if (d === 'APPROVED' || d === 'REJECTED') e.qualification = d
  else e.service = d
  flash.value = {
    APPROVED: '资格已通过。服务状态为“可接单”时，该专家会出现在派单候选中。',
    REJECTED: '已记为资格未通过，不会出现在派单候选中。',
    UNAVAILABLE: `已暂停服务。已接的 ${e.inFlight} 个任务不受影响。`,
    AVAILABLE: '已恢复接单。',
  }[d]
}
function addConflict() {
  const e = selected.value
  if (!e) return
  const value = newConflict.value.kind === 'TENANT' ? newConflict.value.tenant : newConflict.value.name.trim()
  if (!value) return
  e.conflicts.push({ kind: newConflict.value.kind, value })
  newConflict.value = { kind: 'TENANT', tenant: '', name: '' }
  flash.value = '回避关系已保存。之后的派单候选会排除对应论文。'
}
function removeConflict(i: number) {
  selected.value?.conflicts.splice(i, 1)
  flash.value = '回避关系已更新。'
}
function saveProfile() {
  const e = selected.value
  if (!e || conflict.value) return
  e.unit = profile.value.unit
  e.title = profile.value.title
  e.directions = profile.value.directions.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
  e.keywords = profile.value.keywords.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)
  e.sourceUrl = profile.value.sourceUrl
  e.sourceNote = profile.value.sourceNote
  flash.value = '档案已保存。'
}
function keepMine() {
  conflict.value = false
  const e = selected.value
  if (e) e.sourceNote = '学院官网教师页（11-05 复核）'
  profile.value.sourceNote = '学院官网教师页（11-05 复核）'
  saveProfile()
  flash.value = '已保存你的职称修改；来源说明采用对方刚保存的新值。'
}
function applyImport() {
  importStep.value = 'done'
  flash.value = ''
}
const changedCount = expertImport.changes.filter((c) => c.diff.length).length
const tenantName = (code: string) => tenants.find((t) => t.code === code)?.name ?? code
</script>

<template>
  <ProtoFrame v-model:state="state" name="专家库" :states="states">
    <OperationsShell :nav="platformNav('experts')" :account="accounts.platform" org="百杰运营">
      <template #title><h1 class="title">专家库</h1></template>
      <template #context>
        <button v-if="!['loading', 'error'].includes(state)" type="button" class="btn btn--sm" @click="importing = true; importStep = 'pick'; selectedId = null">导入档案</button>
        <button v-if="!['loading', 'error'].includes(state)" type="button" class="btn btn--sm">新建专家</button>
      </template>

      <MasterDetail :open="Boolean(selected) || importing" :narrow="narrow" list-label="专家清单" detail-label="专家档案" back-label="专家清单" list-width="340px" @back="selectedId = null; importing = false">
        <template #list>
          <div class="lhead">
            <div class="views" role="tablist" aria-label="视图">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
                {{ v.label }}<span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <div class="filters">
              <label><span class="sr-only">搜索专家</span><input v-model="keyword" class="input" type="search" placeholder="姓名、单位或研究方向" :disabled="!loaded.length" /></label>
              <label>
                <span class="sr-only">学科</span>
                <select v-model="discipline" class="select" :disabled="!loaded.length">
                  <option value="">全部学科</option>
                  <option v-for="d in disciplines" :key="d" :value="d">{{ d }}</option>
                </select>
              </label>
            </div>
          </div>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取专家档案…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="专家清单没有加载出来" compact>
            网络或服务暂时不可用，筛选条件已保留。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="专家库还是空的" compact>
            先新建专家；之后可以按模板导入 CSV 批量更新档案。
            <template #actions><button type="button" class="btn btn--primary">新建专家</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length && filtersActive" kind="nomatch" title="当前筛选没有匹配的专家" compact>
            <template #actions><button type="button" class="btn" @click="keyword = ''; discipline = ''">清除筛选</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" title="这个视图里没有专家" compact />
          <ul v-else class="tlist">
            <li v-for="e in list" :key="e.id">
              <button type="button" class="titem" :class="{ 'titem--on': e.id === selectedId }" :aria-current="e.id === selectedId" @click="selectedId = e.id; importing = false">
                <span class="titem__top">
                  <span class="titem__title">{{ e.name }}<span class="muted">　{{ e.title }}</span></span>
                  <StatusPill v-if="rowPill(e)" :tone="rowPill(e)!.tone">{{ rowPill(e)!.text }}</StatusPill>
                </span>
                <span class="titem__meta">{{ e.unit }}</span>
                <span class="titem__line muted">{{ e.disciplines.join('、') }}　在途 {{ e.inFlight }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="!['loading', 'error', 'empty'].includes(state)" kind="empty" title="从左侧选择一位专家" compact />
        </template>

        <!-- 导入 -->
        <div v-if="importing" class="obj">
          <header class="obj__head">
            <h2 class="obj__title">导入专家档案</h2>
            <p class="hint">用于批量更新已有专家的档案字段，按账号精确匹配；不会新建账号，也不改动资格、服务状态与回避关系。新专家请用“新建专家”。</p>
          </header>
          <section class="sec">
            <div class="acts">
              <button type="button" class="btn" @click="importStep = 'preview'">选择 CSV 文件</button>
              <span class="hint">{{ importStep === 'pick' ? '尚未选择文件' : expertImport.file }}</span>
              <button type="button" class="btn btn--quiet btn--sm">下载模板</button>
            </div>
          </section>

          <section v-if="['preview', 'invalid', 'expired'].includes(importStep)" class="sec sec--attention" aria-labelledby="ip-h">
            <div class="sec__head">
              <h3 id="ip-h">预览</h3>
              <StatusPill :tone="importStep === 'preview' ? 'warning' : 'danger'">{{ importStep === 'expired' ? '预览已过期' : importStep === 'invalid' ? '预览有错误，不能应用' : `预览未写入，${expertImport.expires}` }}</StatusPill>
            </div>
            <div v-if="importStep === 'expired'" class="banner banner--danger" role="alert">
              <strong>这份预览已失效，整批没有更新</strong>
              <span>超过有效期，或预览之后有人修改了其中专家的档案、资格或服务状态。请重新上传文件生成预览。</span>
            </div>
            <div v-if="importStep === 'invalid'" class="banner banner--danger" role="alert">
              <strong>{{ expertImport.errors.length }} 行有错误，整份文件都不能应用</strong>
              <span v-for="e in expertImport.errors" :key="e.row">第 {{ e.row }} 行：{{ e.message }}</span>
              <span>修正 CSV 后重新上传。为避免泄露，错误信息不回显单元格原值。</span>
            </div>
            <p class="hint">{{ changedCount }} 位专家有变化，{{ expertImport.changes.length - changedCount }} 位与现有档案一致。</p>
            <div class="twrap">
              <table class="dtable">
                <thead><tr><th scope="col">账号</th><th scope="col">字段</th><th scope="col">现在</th><th scope="col">导入后</th></tr></thead>
                <tbody>
                  <template v-for="c in expertImport.changes" :key="c.username">
                    <tr v-for="(d, i) in c.diff" :key="c.username + d.field">
                      <td>{{ i === 0 ? c.username : '' }}</td><td>{{ d.field }}</td><td class="muted">{{ d.before }}</td><td>{{ d.after }}</td>
                    </tr>
                    <tr v-if="!c.diff.length"><td>{{ c.username }}</td><td colspan="3" class="muted">没有变化</td></tr>
                  </template>
                </tbody>
              </table>
            </div>
            <div class="acts acts--end">
              <button type="button" class="btn" @click="importStep = 'pick'">放弃</button>
              <button v-if="importStep !== 'preview'" type="button" class="btn btn--primary" @click="importStep = 'pick'">重新上传</button>
              <button v-else type="button" class="btn btn--primary" @click="applyImport">应用到 {{ changedCount }} 位专家</button>
            </div>
          </section>

          <div v-if="importStep === 'done'" class="banner banner--ok" role="status">
            <strong>已更新 {{ changedCount }} 位专家的档案</strong>
            <span>来源核对日期同时更新为今天。资格、服务状态与回避关系没有变化。</span>
          </div>
          <ProtoNote contract="expertOperations">
            previewExpertImport 返回 preview_id / expires_at（10 分钟）/ changes / errors；有错误时预览状态为 INVALID。applyExpertImport 遇到过期、INVALID 或任一专家版本/资格/服务状态变化，整批 409 不更新。
          </ProtoNote>
        </div>

        <template v-else-if="selected">
          <div class="obj">
            <header class="obj__head">
              <h2 class="obj__title">{{ selected.name }}<span class="muted sub">　{{ selected.title }}</span></h2>
              <dl class="obj__meta">
                <div><dt>单位</dt><dd>{{ selected.unit }}</dd></div>
                <div><dt>账号</dt><dd>{{ selected.username }}</dd></div>
                <div><dt>在途任务</dt><dd class="num">{{ selected.inFlight }}</dd></div>
              </dl>
              <p v-if="availability" class="avail" :class="`avail--${availability.tone}`" role="status">{{ availability.text }}</p>
            </header>

            <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>

            <div class="three">
              <section class="sec" :class="{ 'sec--attention': selected.qualification === 'PENDING' }" aria-labelledby="q-h">
                <div class="sec__head"><h3 id="q-h">资格审核</h3><StatusPill :tone="selected.qualification === 'APPROVED' ? 'success' : selected.qualification === 'PENDING' ? 'action' : 'neutral'">{{ qualificationText[selected.qualification] }}</StatusPill></div>
                <p class="hint">决定能否被派单。依据档案中的职称、导师资格与来源。</p>
                <div class="acts">
                  <template v-if="selected.qualification === 'PENDING'">
                    <button type="button" class="btn btn--primary" @click="ask('APPROVED')">通过…</button>
                    <button type="button" class="btn" @click="ask('REJECTED')">不通过…</button>
                  </template>
                  <button v-else-if="selected.qualification === 'APPROVED'" type="button" class="btn btn--sm" @click="ask('REJECTED')">改为不通过…</button>
                  <button v-else type="button" class="btn btn--sm" @click="ask('APPROVED')">改为通过…</button>
                </div>
              </section>

              <section class="sec" aria-labelledby="s-h">
                <div class="sec__head"><h3 id="s-h">服务状态</h3><StatusPill :tone="selected.service === 'AVAILABLE' ? 'success' : 'warning'">{{ serviceText[selected.service] }}</StatusPill></div>
                <p class="hint">本人是否接新任务，例如出差或休假时暂停。不影响已接的任务。</p>
                <div class="acts">
                  <button v-if="selected.service === 'AVAILABLE'" type="button" class="btn btn--sm" @click="ask('UNAVAILABLE')">暂停服务…</button>
                  <button v-else type="button" class="btn btn--sm btn--outline" @click="ask('AVAILABLE')">恢复接单…</button>
                </div>
              </section>

              <section class="sec" aria-labelledby="c-h">
                <div class="sec__head"><h3 id="c-h">回避关系</h3><span class="muted num">{{ selected.conflicts.length }} 项</span></div>
                <p class="hint">只对这些学校或导师的论文不可派，其他论文照常。</p>
                <ul v-if="selected.conflicts.length" class="clist">
                  <li v-for="(c, i) in selected.conflicts" :key="c.kind + c.value">
                    <span><span class="muted">{{ c.kind === 'TENANT' ? '学校' : '导师' }}</span>　{{ c.value }}</span>
                    <button type="button" class="btn btn--sm btn--quiet" :aria-label="`移除回避：${c.value}`" @click="removeConflict(i)">移除</button>
                  </li>
                </ul>
                <div class="addc">
                  <label><span class="sr-only">回避类型</span>
                    <select v-model="newConflict.kind" class="select"><option value="TENANT">学校</option><option value="SUPERVISOR">导师姓名</option></select>
                  </label>
                  <label v-if="newConflict.kind === 'TENANT'"><span class="sr-only">回避学校</span>
                    <select v-model="newConflict.tenant" class="select">
                      <option value="">选择学校</option>
                      <option v-for="t in tenants" :key="t.code" :value="`${tenantName(t.code)}（${t.code}）`">{{ t.name }}</option>
                    </select>
                  </label>
                  <label v-else><span class="sr-only">回避导师姓名</span><input v-model="newConflict.name" class="input" placeholder="导师姓名" /></label>
                  <button type="button" class="btn btn--sm" :disabled="newConflict.kind === 'TENANT' ? !newConflict.tenant : !newConflict.name.trim()" @click="addConflict">添加</button>
                </div>
              </section>
            </div>

            <section class="sec" aria-labelledby="p-h">
              <div class="sec__head"><h3 id="p-h">档案</h3><p>{{ selected.disciplines.join('、') }}；{{ selected.province }}</p></div>
              <div v-if="conflict" class="banner banner--danger" role="alert">
                <strong>没有保存：这份档案刚被另一位运营修改</strong>
                <span>对方把来源说明改为“学院官网教师页（11-05 复核）”。你改的职称还在下面。</span>
                <div class="acts">
                  <button type="button" class="btn btn--sm btn--primary" @click="keepMine">保存我的职称，采用对方的来源说明</button>
                  <button type="button" class="btn btn--sm" @click="conflict = false; loadProfile(selected)">放弃我的修改</button>
                </div>
              </div>
              <div class="grid2">
                <label class="field"><span>单位</span><input v-model="profile.unit" class="input" /></label>
                <label class="field"><span>职称</span><input v-model="profile.title" class="input" :aria-invalid="conflict" /></label>
                <label class="field"><span>研究方向</span><input v-model="profile.directions" class="input" /><small>用顿号分隔；派单按方向与关键词匹配</small></label>
                <label class="field"><span>关键词</span><input v-model="profile.keywords" class="input" /></label>
                <label class="field"><span>来源链接</span><input v-model="profile.sourceUrl" class="input" placeholder="未填写" /></label>
                <label class="field"><span>来源说明</span><input v-model="profile.sourceNote" class="input" /><small>{{ selected.checkedAt ? `上次核对 ${selected.checkedAt}` : '尚未核对来源' }}</small></label>
              </div>
              <p class="hint">导师资格：{{ selected.doctoral ? '博士生导师' : '' }}{{ selected.doctoral && selected.masters ? '、' : '' }}{{ selected.masters ? '硕士生导师' : '' }}{{ !selected.doctoral && !selected.masters ? '未记录' : '' }}</p>
              <div class="acts acts--end">
                <span v-if="dirty" class="hint">有未保存的修改</span>
                <button type="button" class="btn btn--primary" :disabled="!dirty || conflict" @click="saveProfile">保存档案</button>
              </div>
            </section>

            <ProtoNote contract="expertOperations">
              三个分区分别对应 reviewQualification、setServiceStatus（两者都要求 reason）、replaceConflicts；档案 updateExpert 带 version。派单台的“不可派原因”与这里的分区一一对应。
            </ProtoNote>
          </div>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="Boolean(decisionText)" :title="decisionText?.title ?? ''" @close="decision = null">
        <p>{{ decisionText?.body }}</p>
        <label class="field">
          <span>{{ decisionText?.label }}（运营内部可见，记入审计）</span>
          <textarea v-model="reason" class="textarea" rows="3" :aria-invalid="reasonTried && !reason.trim()" />
          <small v-if="reasonTried && !reason.trim()" class="field-error">请填写原因。</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="decision = null">取消</button>
          <button type="button" class="btn" :class="decisionText?.danger ? 'btn--danger' : 'btn--primary'" @click="decide">{{ decisionText?.cta }}</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.filters {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 140px;
  gap: 6px;
}
.sub {
  font-size: 14px;
  font-weight: 400;
}
.avail {
  justify-self: start;
  padding: 6px 10px;
  border-radius: var(--ws-radius);
  font-size: 13px;
  font-weight: 500;
}
.avail--success {
  background: var(--ws-success-soft);
  color: var(--ws-success);
}
.avail--warning {
  background: var(--ws-warning-soft);
  color: var(--ws-warning);
}
.three {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
/* 回避关系条目多、带添加表单，占满一行 */
.three .sec:last-child {
  grid-column: 1 / -1;
}
.three .sec {
  align-content: start;
}
.clist {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
}
.clist li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.addc {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr) auto;
  gap: 6px;
}
@media (max-width: 1100px) {
  .three {
    grid-template-columns: minmax(0, 1fr);
  }
}
.addc {
  max-width: 520px;
}
</style>
