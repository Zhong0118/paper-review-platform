<script setup lang="ts">
/**
 * P12b 成员与资格（学校设置）：成员清单｜成员对象。
 * 对象区：账号与联系方式、送审资格（仅学生）、账号状态、重置密码。
 * 密码只在输入框里出现，提交后不回显；暂停资格只影响新建论文，已有草稿可以继续办理。
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
import { members as baseMembers, type Member } from '../data/u3'

const states = [
  { value: 'normal', label: '学生（有资格）' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '还没有成员' },
  { value: 'nomatch', label: '筛选无匹配' },
  { value: 'error', label: '加载失败' },
  { value: 'suspended', label: '资格已暂停（有草稿）' },
  { value: 'noeligibility', label: '尚未建立资格' },
  { value: 'conflict', label: '保存时版本冲突' },
  { value: 'disable', label: '停用确认' },
  { value: 'reset', label: '重置密码' },
  { value: 'create', label: '新建成员' },
  { value: 'gone', label: '成员已不在本校' },
] as const
const state = useProtoState(states, 'normal')
const narrow = useNarrow()

const members = ref<Member[]>(structuredClone(baseMembers))
const views = [
  { key: 'STUDENT', label: '学生' },
  { key: 'SUPERVISOR', label: '导师' },
  { key: 'all', label: '全部' },
] as const
type ViewKey = (typeof views)[number]['key']
const view = ref<ViewKey>('STUDENT')
const keyword = ref('')
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : members.value))
const countOf = (key: ViewKey) => (key === 'all' ? loaded.value.length : loaded.value.filter((m) => m.type === key).length)
const list = computed(() =>
  loaded.value.filter(
    (m) => (view.value === 'all' || m.type === view.value) && (!keyword.value.trim() || `${m.name}${m.externalId}${m.username}`.includes(keyword.value.trim())),
  ),
)
const supervisors = computed(() => members.value.filter((m) => m.type === 'SUPERVISOR' && m.active))
const selectedId = ref<string | null>(null)
const selected = computed(() => loaded.value.find((m) => m.id === selectedId.value) ?? null)
const creating = ref(false)

const form = ref({ name: '', phone: '', email: '' })
const dirty = computed(() => Boolean(selected.value && (form.value.name !== selected.value.name || form.value.phone !== selected.value.phone || form.value.email !== selected.value.email)))
const load = (m: Member | null) => m && (form.value = { name: m.name, phone: m.phone, email: m.email })
const flash = ref('')
const conflict = ref(false)
const disableOpen = ref(false)
const suspendOpen = ref(false)
const resetOpen = ref(false)
const pw = ref({ a: '', b: '', tried: false })
const elig = ref({ degree: '', supervisor: '', tried: false })
const draft = ref({ type: 'STUDENT' as Member['type'], name: '', externalId: '', username: '', a: '', b: '', tried: false })

watch(
  state,
  (s) => {
    members.value = structuredClone(baseMembers)
    flash.value = ''
    keyword.value = s === 'nomatch' ? '量子' : ''
    view.value = 'STUDENT'
    creating.value = s === 'create'
    conflict.value = s === 'conflict'
    disableOpen.value = s === 'disable'
    resetOpen.value = s === 'reset'
    suspendOpen.value = false
    pw.value = { a: '', b: '', tried: false }
    elig.value = { degree: '', supervisor: '', tried: false }
    draft.value = { type: 'STUDENT', name: '', externalId: '', username: '', a: '', b: '', tried: false }
    const target = s === 'suspended' ? 'm2' : s === 'noeligibility' ? 'm3' : 'm1'
    const listState = ['normal', 'loading', 'empty', 'error', 'nomatch'].includes(s)
    selectedId.value = s === 'create' || (narrow.value && listState) || s === 'nomatch' ? null : target
    load(members.value.find((m) => m.id === target) ?? null)
    if (s === 'conflict') form.value.phone = '138 0000 0199'
  },
  { immediate: true },
)
watch(selectedId, (id) => {
  if (state.value !== 'conflict') load(members.value.find((m) => m.id === id) ?? null)
  flash.value = ''
})

function save() {
  const m = selected.value
  if (!m || conflict.value) return
  Object.assign(m, form.value)
  flash.value = '已保存。'
}
function keepMine() {
  conflict.value = false
  const m = selected.value
  if (m) m.email = 'linzx@example.edu'
  save()
  flash.value = '已保存你的修改；邮箱保留对方刚保存的新值。'
}
function toggleActive() {
  const m = selected.value
  if (!m) return
  disableOpen.value = false
  m.active = !m.active
  flash.value = m.active ? '已启用，本人可以重新登录。' : '已停用。本人无法登录，论文与处理记录保留。'
}
function suspendOrResume() {
  const m = selected.value
  if (!m?.eligibility) return
  suspendOpen.value = false
  m.eligibility.status = m.eligibility.status === 'ELIGIBLE' ? 'SUSPENDED' : 'ELIGIBLE'
  flash.value = m.eligibility.status === 'SUSPENDED' ? '已暂停送审资格。' : '已恢复送审资格，学生可以新建论文。'
}
function createEligibility() {
  elig.value.tried = true
  const m = selected.value
  if (!m || !elig.value.degree || !elig.value.supervisor) return
  m.eligibility = { status: 'ELIGIBLE', degree: elig.value.degree, supervisor: elig.value.supervisor }
  flash.value = '已建立送审资格，学生现在可以新建论文。'
}
const pwError = computed(() => (!pw.value.a ? '请输入新密码。' : pw.value.a.length < 12 ? '至少 12 位。' : pw.value.a !== pw.value.b ? '两次输入不一致。' : ''))
function resetPassword() {
  pw.value.tried = true
  if (pwError.value) return
  resetOpen.value = false
  pw.value = { a: '', b: '', tried: false }
  flash.value = '密码已重置。新密码不会再次显示，请通过线下方式告知本人。'
}
const draftMissing = computed(() => ({
  name: !draft.value.name.trim(),
  externalId: !draft.value.externalId.trim(),
  username: !draft.value.username.trim(),
  pw: !draft.value.a || draft.value.a.length < 12 || draft.value.a !== draft.value.b,
}))
function createMember() {
  draft.value.tried = true
  if (Object.values(draftMissing.value).some(Boolean)) return
  const m: Member = {
    id: `m${members.value.length + 1}`,
    type: draft.value.type,
    name: draft.value.name.trim(),
    externalId: draft.value.externalId.trim(),
    username: draft.value.username.trim(),
    active: true,
    phone: '',
    email: '',
    updated: '11-05',
    eligibility: draft.value.type === 'STUDENT' ? null : undefined,
  }
  members.value.unshift(m)
  creating.value = false
  view.value = m.type
  selectedId.value = m.id
  flash.value = m.type === 'STUDENT' ? '已建立账号。建立送审资格后，学生才能新建论文。' : '已建立导师账号。'
}
const idLabel = (t: Member['type']) => (t === 'STUDENT' ? '学号' : '工号')
</script>

<template>
  <ProtoFrame v-model:state="state" name="成员与资格" :states="states">
    <OperationsShell :nav="schoolNav('members')" :account="accounts.school" org="示例大学">
      <template #title><h1 class="title">成员与资格</h1></template>
      <template #context>
        <button v-if="!['loading', 'error'].includes(state)" type="button" class="btn btn--sm" @click="creating = true; selectedId = null">新建成员</button>
      </template>

      <MasterDetail :open="Boolean(selected) || creating || state === 'gone'" :narrow="narrow" list-label="成员清单" detail-label="当前成员" back-label="成员清单" @back="selectedId = null; creating = false">
        <template #list>
          <div class="lhead">
            <div class="views" role="tablist" aria-label="成员类型">
              <button v-for="v in views" :key="v.key" type="button" role="tab" class="views__tab" :aria-selected="view === v.key" @click="view = v.key">
                {{ v.label }}<span v-if="state !== 'loading' && state !== 'error'" class="views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <label>
              <span class="sr-only">搜索成员</span>
              <input v-model="keyword" class="input" type="search" placeholder="姓名、学号/工号或账号" :disabled="!loaded.length" />
            </label>
          </div>
          <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取成员…" compact />
          <StateBlock v-else-if="state === 'error'" kind="error" title="成员没有加载出来" compact>
            网络或服务暂时不可用。
            <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="state === 'empty'" kind="empty" title="还没有本校成员" compact>
            先建立学生与导师账号，再为学生建立送审资格。
            <template #actions><button type="button" class="btn btn--primary" @click="creating = true">新建成员</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length && keyword.trim()" kind="nomatch" :title="`没有匹配“${keyword.trim()}”的成员`" compact>
            <template #actions><button type="button" class="btn" @click="keyword = ''">清除搜索</button></template>
          </StateBlock>
          <ul v-else class="tlist">
            <li v-for="m in list" :key="m.id">
              <button type="button" class="titem" :class="{ 'titem--on': m.id === selectedId }" :aria-current="m.id === selectedId" @click="selectedId = m.id; creating = false">
                <span class="titem__top">
                  <span class="titem__title">{{ m.name }}</span>
                  <StatusPill v-if="!m.active" tone="neutral">已停用</StatusPill>
                  <StatusPill v-else-if="m.type === 'STUDENT' && m.eligibility?.status === 'SUSPENDED'" tone="warning">资格暂停</StatusPill>
                  <StatusPill v-else-if="m.type === 'STUDENT' && !m.eligibility" tone="warning">无资格</StatusPill>
                </span>
                <span class="titem__meta num">{{ m.type === 'STUDENT' ? '学生' : '导师' }}　{{ m.externalId }}　{{ m.username }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="!['loading', 'error', 'empty'].includes(state)" kind="empty" title="从左侧选择一位成员" compact />
        </template>

        <div v-if="state === 'gone'" class="obj">
          <StateBlock kind="forbidden" title="这个成员已不在本校">
            可能已被另一位学校审核移出，或链接来自其他学校。成员清单已刷新。
            <template #actions><button type="button" class="btn" @click="state = 'normal'">回到成员清单</button></template>
          </StateBlock>
        </div>

        <!-- 新建成员 -->
        <div v-else-if="creating" class="obj">
          <header class="obj__head"><h2 class="obj__title">新建成员</h2></header>
          <section class="sec">
            <fieldset class="fs">
              <legend>类型</legend>
              <div class="choices">
                <label class="choice"><input v-model="draft.type" type="radio" value="STUDENT" /> 学生</label>
                <label class="choice"><input v-model="draft.type" type="radio" value="SUPERVISOR" /> 导师</label>
              </div>
            </fieldset>
            <div class="grid2">
              <label class="field"><span>姓名</span><input v-model="draft.name" class="input" :aria-invalid="draft.tried && draftMissing.name" /><small v-if="draft.tried && draftMissing.name" class="field-error">请填写姓名。</small></label>
              <label class="field"><span>{{ idLabel(draft.type) }}</span><input v-model="draft.externalId" class="input" :aria-invalid="draft.tried && draftMissing.externalId" /><small v-if="draft.tried && draftMissing.externalId" class="field-error">请填写{{ idLabel(draft.type) }}。</small></label>
              <label class="field wide"><span>登录账号</span><input v-model="draft.username" class="input" autocomplete="off" :aria-invalid="draft.tried && draftMissing.username" /><small v-if="draft.tried && draftMissing.username" class="field-error">请填写登录账号。</small></label>
              <label class="field"><span>初始密码</span><input v-model="draft.a" class="input" type="password" autocomplete="new-password" :aria-invalid="draft.tried && draftMissing.pw" /><small>至少 12 位，提交后不再显示</small></label>
              <label class="field"><span>再次输入</span><input v-model="draft.b" class="input" type="password" autocomplete="new-password" :aria-invalid="draft.tried && draftMissing.pw" /><small v-if="draft.tried && draftMissing.pw" class="field-error">两次输入需一致，且至少 12 位。</small></label>
            </div>
            <p v-if="draft.type === 'STUDENT'" class="hint">建立账号后，还需要在成员详情里建立送审资格，学生才能新建论文。</p>
            <div class="acts acts--end">
              <button type="button" class="btn" @click="creating = false">取消</button>
              <button type="button" class="btn btn--primary" @click="createMember">建立账号</button>
            </div>
          </section>
        </div>

        <template v-else-if="selected">
          <div class="obj">
            <header class="obj__head">
              <div class="obj__row">
                <StatusPill :tone="selected.active ? 'success' : 'neutral'">{{ selected.active ? '启用中' : '已停用' }}</StatusPill>
              </div>
              <h2 class="obj__title">{{ selected.name }}</h2>
              <dl class="obj__meta">
                <div><dt>类型</dt><dd>{{ selected.type === 'STUDENT' ? '学生' : '导师' }}</dd></div>
                <div><dt>{{ idLabel(selected.type) }}</dt><dd class="num">{{ selected.externalId }}</dd></div>
                <div><dt>账号</dt><dd>{{ selected.username }}</dd></div>
              </dl>
            </header>

            <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>

            <section v-if="selected.type === 'STUDENT'" class="sec" :class="{ 'sec--attention': !selected.eligibility || selected.eligibility.status === 'SUSPENDED' }" aria-labelledby="el-h">
              <div class="sec__head"><h3 id="el-h">送审资格</h3><p>决定学生能否新建论文</p></div>
              <template v-if="!selected.eligibility">
                <p class="hint">尚未建立。没有资格的学生登录后只能看到说明，不能新建论文。</p>
                <div class="grid2">
                  <label class="field">
                    <span>学位类型</span>
                    <select v-model="elig.degree" class="select" :aria-invalid="elig.tried && !elig.degree">
                      <option value="">请选择</option><option>学术型硕士</option><option>专业型硕士</option><option>博士</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>导师</span>
                    <select v-model="elig.supervisor" class="select" :aria-invalid="elig.tried && !elig.supervisor">
                      <option value="">请选择</option>
                      <option v-for="s in supervisors" :key="s.id" :value="s.name">{{ s.name }}（{{ s.externalId }}）</option>
                    </select>
                  </label>
                </div>
                <small v-if="elig.tried && (!elig.degree || !elig.supervisor)" class="field-error">请选择学位类型和导师。</small>
                <div class="acts"><button type="button" class="btn btn--primary" @click="createEligibility">建立资格</button></div>
              </template>
              <template v-else>
                <dl class="kv">
                  <dt>状态</dt>
                  <dd><StatusPill :tone="selected.eligibility.status === 'ELIGIBLE' ? 'success' : 'warning'">{{ selected.eligibility.status === 'ELIGIBLE' ? '可以送审' : '已暂停' }}</StatusPill></dd>
                  <dt>学位类型</dt><dd>{{ selected.eligibility.degree }}</dd>
                  <dt>导师</dt><dd>{{ selected.eligibility.supervisor }}</dd>
                </dl>
                <p v-if="selected.eligibility.status === 'SUSPENDED'" class="hint">
                  暂停期间不能新建论文。{{ selected.hasDraft ? '这位学生已有一篇草稿，仍可以继续修改并提交。' : '' }}
                </p>
                <div class="acts">
                  <button v-if="selected.eligibility.status === 'ELIGIBLE'" type="button" class="btn" @click="suspendOpen = true">暂停资格…</button>
                  <button v-else type="button" class="btn btn--primary" @click="suspendOrResume">恢复资格</button>
                </div>
              </template>
            </section>

            <section class="sec" aria-labelledby="ct-h">
              <div class="sec__head"><h3 id="ct-h">账号与联系方式</h3></div>
              <div v-if="conflict" class="banner banner--danger" role="alert">
                <strong>没有保存：这位成员的资料刚被另一位学校审核修改</strong>
                <span>对方把邮箱改为 linzx@example.edu。你填写的电话还在下面。</span>
                <div class="acts">
                  <button type="button" class="btn btn--sm btn--primary" @click="keepMine">保存我的电话，保留对方的邮箱</button>
                  <button type="button" class="btn btn--sm" @click="conflict = false; load(selected)">放弃我的修改</button>
                </div>
              </div>
              <div class="grid2">
                <label class="field wide"><span>姓名</span><input v-model="form.name" class="input" /></label>
                <label class="field"><span>电话</span><input v-model="form.phone" class="input" placeholder="未填写" /></label>
                <label class="field"><span>邮箱</span><input v-model="form.email" class="input" placeholder="未填写" /></label>
              </div>
              <div class="acts acts--end">
                <span v-if="dirty" class="hint">有未保存的修改</span>
                <button type="button" class="btn btn--primary" :disabled="!dirty || conflict" @click="save">保存</button>
              </div>
            </section>

            <section class="sec" aria-labelledby="ac-h">
              <div class="sec__head"><h3 id="ac-h">账号安全</h3></div>
              <div class="acts">
                <button type="button" class="btn" @click="resetOpen = true">重置密码…</button>
                <button v-if="selected.active" type="button" class="btn" @click="disableOpen = true">停用账号…</button>
                <button v-else type="button" class="btn btn--outline" @click="toggleActive">启用账号</button>
              </div>
              <p class="hint">密码由你设定后告知本人；平台不显示、不发送密码。</p>
            </section>

            <ProtoNote contract="schoolOperations">
              账号接口 createMember / updateMember / enable / disable / resetMemberPassword；资格接口 createEligibility / suspend / resume。界面不展示 membership_id 等内部编号。
            </ProtoNote>
          </div>
        </template>
      </MasterDetail>

      <ConfirmDialog :open="disableOpen && Boolean(selected)" title="停用这个账号" @close="disableOpen = false">
        <p>停用后，{{ selected?.name }}（{{ selected?.username }}）无法登录。论文、评阅结果与处理记录都保留，之后可以重新启用。</p>
        <template #actions>
          <button type="button" class="btn" @click="disableOpen = false">取消</button>
          <button type="button" class="btn btn--danger" @click="toggleActive">停用</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="suspendOpen" title="暂停送审资格" @close="suspendOpen = false">
        <p>暂停后，{{ selected?.name }}不能新建论文。已有的草稿与已提交的论文继续办理，不受影响。</p>
        <template #actions>
          <button type="button" class="btn" @click="suspendOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="suspendOrResume">暂停资格</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="resetOpen && Boolean(selected)" title="重置密码" @close="resetOpen = false; pw = { a: '', b: '', tried: false }">
        <p>为 {{ selected?.name }}（{{ selected?.username }}）设定新密码。提交后密码不会再显示，请通过线下方式告知本人。</p>
        <label class="field"><span>新密码</span><input v-model="pw.a" class="input" type="password" autocomplete="new-password" :aria-invalid="pw.tried && Boolean(pwError)" /></label>
        <label class="field">
          <span>再次输入</span><input v-model="pw.b" class="input" type="password" autocomplete="new-password" :aria-invalid="pw.tried && Boolean(pwError)" />
          <small v-if="pw.tried && pwError" class="field-error">{{ pwError }}</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="resetOpen = false; pw = { a: '', b: '', tried: false }">取消</button>
          <button type="button" class="btn btn--primary" @click="resetPassword">重置密码</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
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
</style>
