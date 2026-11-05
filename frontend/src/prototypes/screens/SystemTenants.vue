<script setup lang="ts">
/**
 * P14a 系统管理：学校管理表 → 学校详情 / 新增学校。
 * 新增学校先检索官方院校（名称须与官方名录一致），再填学校代码、根组织与首位学校管理员。
 * 学校代码重复时 409：保留全部输入，只标出代码。暂停学校二次确认：该校所有账号立即退出且无法登录。
 * 系统管理员没有任何论文入口；密码只在输入框出现，提交后不回显。
 */
import { computed, ref, watch } from 'vue'

import ConfirmDialog from '../kit/ConfirmDialog.vue'
import OperationsShell from '../kit/OperationsShell.vue'
import ProtoFrame from '../kit/ProtoFrame.vue'
import ProtoNote from '../kit/ProtoNote.vue'
import StateBlock from '../kit/StateBlock.vue'
import StatusPill from '../kit/StatusPill.vue'
import { useProtoState } from '../kit/useProtoState'
import '../kit/desk.css'
import { systemNav } from '../data/nav'
import { institutions, systemAccount, tenants as baseTenants, type Tenant } from '../data/u3'

const states = [
  { value: 'normal', label: '学校列表' },
  { value: 'loading', label: '首次加载' },
  { value: 'empty', label: '还没有学校' },
  { value: 'nomatch', label: '筛选无匹配' },
  { value: 'error', label: '加载失败' },
  { value: 'detail', label: '学校详情' },
  { value: 'suspend', label: '暂停学校确认' },
  { value: 'reviewer', label: '新增学校管理员' },
  { value: 'create', label: '新增学校' },
  { value: 'duplicate', label: '新增：学校代码重复' },
] as const
const state = useProtoState(states, 'normal')

const tenants = ref<Tenant[]>(structuredClone(baseTenants))
const keyword = ref('')
const status = ref<'' | Tenant['status']>('')
const loaded = computed(() => (['empty', 'loading', 'error'].includes(state.value) ? [] : tenants.value))
const list = computed(() =>
  loaded.value.filter((t) => (!status.value || t.status === status.value) && (!keyword.value.trim() || `${t.name}${t.code}`.includes(keyword.value.trim()))),
)
const mode = ref<'list' | 'detail' | 'create'>('list')
const selectedId = ref<string | null>(null)
const selected = computed(() => tenants.value.find((t) => t.id === selectedId.value) ?? null)
const flash = ref('')
const suspendOpen = ref(false)
const reviewerOpen = ref(false)
const resetFor = ref<null | { name: string; username: string }>(null)
const pw = ref({ a: '', b: '', tried: false })
const rv = ref({ name: '', username: '', a: '', b: '', tried: false })

/* 新增学校 */
const q = ref('')
const picked = ref<(typeof institutions)[number] | null>(null)
const nt = ref({ code: '', orgId: '', orgName: '研究生院', name: '', username: '', a: '', b: '', tried: false })
const duplicate = ref(false)
const matches = computed(() => (q.value.trim() ? institutions.filter((i) => `${i.name}${i.code}`.includes(q.value.trim())) : []))

watch(
  state,
  (s) => {
    tenants.value = structuredClone(baseTenants)
    flash.value = ''
    keyword.value = s === 'nomatch' ? '量子' : ''
    status.value = ''
    mode.value = s === 'create' || s === 'duplicate' ? 'create' : ['detail', 'suspend', 'reviewer'].includes(s) ? 'detail' : 'list'
    selectedId.value = mode.value === 'detail' ? 's1' : null
    suspendOpen.value = s === 'suspend'
    reviewerOpen.value = s === 'reviewer'
    resetFor.value = null
    pw.value = { a: '', b: '', tried: false }
    rv.value = { name: '', username: '', a: '', b: '', tried: false }
    duplicate.value = s === 'duplicate'
    q.value = s === 'duplicate' ? '交通' : ''
    picked.value = s === 'duplicate' ? institutions[2]! : null
    nt.value = s === 'duplicate'
      ? { code: 'demo-u02', orgId: 'GS', orgName: '研究生院', name: '吕青', username: 'demo_school_12', a: '', b: '', tried: false }
      : { code: '', orgId: '', orgName: '研究生院', name: '', username: '', a: '', b: '', tried: false }
  },
  { immediate: true },
)

function open(t: Tenant) {
  selectedId.value = t.id
  mode.value = 'detail'
  flash.value = ''
}
function back() {
  mode.value = 'list'
  selectedId.value = null
}
function toggleTenant() {
  const t = selected.value
  if (!t) return
  suspendOpen.value = false
  t.status = t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'
  flash.value = t.status === 'SUSPENDED' ? `已暂停${t.name}。该校账号已全部退出，恢复前无法登录。` : `已恢复${t.name}，该校账号可以重新登录。`
}
const pwError = (a: string, b: string) => (!a ? '请输入密码。' : a.length < 12 ? '至少 12 位。' : a !== b ? '两次输入不一致。' : '')
function addReviewer() {
  rv.value.tried = true
  const t = selected.value
  if (!t || !rv.value.name.trim() || !rv.value.username.trim() || pwError(rv.value.a, rv.value.b)) return
  t.reviewers.push({ id: `v${Date.now()}`, name: rv.value.name.trim(), username: rv.value.username.trim(), active: true })
  reviewerOpen.value = false
  rv.value = { name: '', username: '', a: '', b: '', tried: false }
  flash.value = '已建立学校管理员账号。初始密码不会再显示，请通过线下方式告知本人。'
}
function resetPassword() {
  pw.value.tried = true
  if (pwError(pw.value.a, pw.value.b)) return
  resetFor.value = null
  pw.value = { a: '', b: '', tried: false }
  flash.value = '密码已重置。新密码不会再显示，请通过线下方式告知本人。'
}
function toggleReviewer(id: string) {
  const r = selected.value?.reviewers.find((x) => x.id === id)
  if (!r) return
  r.active = !r.active
  flash.value = r.active ? `已启用 ${r.name}。` : `已停用 ${r.name}，该账号无法再登录。`
}
const codeOk = computed(() => /^[a-z0-9-]{2,32}$/.test(nt.value.code))
const ntMissing = computed(() => ({
  institution: !picked.value,
  code: !codeOk.value,
  org: !nt.value.orgId.trim() || !nt.value.orgName.trim(),
  name: !nt.value.name.trim(),
  username: !nt.value.username.trim(),
  pw: pwError(nt.value.a, nt.value.b),
}))
function createTenant() {
  nt.value.tried = true
  const m = ntMissing.value
  if (m.institution || m.code || m.org || m.name || m.username || m.pw) return
  if (tenants.value.some((t) => t.code === nt.value.code)) {
    duplicate.value = true
    return
  }
  const t: Tenant = {
    id: `s${tenants.value.length + 1}`,
    code: nt.value.code,
    name: picked.value!.name,
    org: nt.value.orgName,
    status: 'ACTIVE',
    created: '2026-11-05',
    reviewers: [{ id: `v${Date.now()}`, name: nt.value.name, username: nt.value.username, active: true }],
  }
  tenants.value.push(t)
  selectedId.value = t.id
  mode.value = 'detail'
  flash.value = `已建立${t.name}与首位学校管理员。初始密码不会再显示，请通过线下方式告知本人。`
}
const dupOwner = computed(() => tenants.value.find((t) => t.code === nt.value.code))
</script>

<template>
  <ProtoFrame v-model:state="state" name="学校管理" :states="states">
    <OperationsShell :nav="systemNav('tenants')" :account="systemAccount" org="系统管理">
      <template #title>
        <h1 class="title">
          <template v-if="mode === 'list'">学校管理</template>
          <template v-else>
            <button type="button" class="crumb" @click="back">学校管理</button><span class="muted"> › </span>{{ mode === 'create' ? '新增学校' : selected?.name }}
          </template>
        </h1>
      </template>
      <template #context>
        <button v-if="mode === 'list' && !['loading', 'error'].includes(state)" type="button" class="btn btn--sm btn--primary" @click="mode = 'create'">新增学校</button>
      </template>

      <!-- 列表 -->
      <div v-if="mode === 'list'" class="obj page">
        <div class="toolbar">
          <label><span class="sr-only">搜索学校</span><input v-model="keyword" class="input" type="search" placeholder="学校名称或代码" :disabled="!loaded.length" /></label>
          <label>
            <span class="sr-only">状态</span>
            <select v-model="status" class="select" :disabled="!loaded.length">
              <option value="">全部状态</option><option value="ACTIVE">正常</option><option value="SUSPENDED">已暂停</option>
            </select>
          </label>
        </div>
        <StateBlock v-if="state === 'loading'" kind="loading" title="正在读取学校…" />
        <StateBlock v-else-if="state === 'error'" kind="error" title="学校列表没有加载出来">
          网络或服务暂时不可用。
          <template #actions><button type="button" class="btn btn--primary" @click="state = 'normal'">重试</button></template>
        </StateBlock>
        <StateBlock v-else-if="state === 'empty'" kind="empty" title="还没有接入的学校">
          新增学校时会同时建立首位学校管理员，之后由学校自己维护成员。
          <template #actions><button type="button" class="btn btn--primary" @click="mode = 'create'">新增学校</button></template>
        </StateBlock>
        <StateBlock v-else-if="!list.length" kind="nomatch" title="当前筛选没有匹配的学校">
          <template #actions><button type="button" class="btn" @click="keyword = ''; status = ''">清除筛选</button></template>
        </StateBlock>
        <section v-else class="sec flush">
          <div class="twrap">
            <table class="dtable tenants">
              <thead>
                <tr>
                  <th scope="col">学校</th><th scope="col">代码</th><th scope="col">根组织</th><th scope="col" class="n">学校管理员</th><th scope="col">状态</th><th scope="col">接入日期</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in list" :key="t.id" @click="open(t)">
                  <td><button type="button" class="rowlink" @click.stop="open(t)">{{ t.name }}</button></td>
                  <td class="num">{{ t.code }}</td>
                  <td>{{ t.org }}</td>
                  <td class="n num">{{ t.reviewers.length }}</td>
                  <td><StatusPill :tone="t.status === 'ACTIVE' ? 'success' : 'warning'">{{ t.status === 'ACTIVE' ? '正常' : '已暂停' }}</StatusPill></td>
                  <td class="num">{{ t.created }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <p v-if="list.length" class="scope">共 {{ list.length }} 所。系统管理员只管理学校与账号，不读论文正文。</p>
      </div>

      <!-- 详情 -->
      <div v-else-if="mode === 'detail' && selected" class="obj page">
        <header class="obj__head">
          <div class="obj__row">
            <StatusPill :tone="selected.status === 'ACTIVE' ? 'success' : 'warning'">{{ selected.status === 'ACTIVE' ? '正常' : '已暂停' }}</StatusPill>
            <button v-if="selected.status === 'ACTIVE'" type="button" class="btn btn--sm" @click="suspendOpen = true">暂停学校…</button>
            <button v-else type="button" class="btn btn--sm btn--outline" @click="toggleTenant">恢复学校</button>
          </div>
          <h2 class="obj__title">{{ selected.name }}</h2>
          <dl class="obj__meta">
            <div><dt>代码</dt><dd class="num">{{ selected.code }}</dd></div>
            <div><dt>根组织</dt><dd>{{ selected.org }}</dd></div>
            <div><dt>接入</dt><dd class="num">{{ selected.created }}</dd></div>
          </dl>
        </header>
        <div v-if="flash" class="banner banner--ok" role="status">{{ flash }}</div>
        <div v-if="selected.status === 'SUSPENDED'" class="banner banner--warn">该校已暂停：所有账号无法登录。数据保留，恢复后可以继续使用。</div>

        <section class="sec" aria-labelledby="rv-h">
          <div class="sec__head">
            <h3 id="rv-h">学校管理员</h3>
            <button type="button" class="btn btn--sm" @click="reviewerOpen = true">新增学校管理员</button>
          </div>
          <div class="twrap">
            <table class="dtable">
              <thead><tr><th scope="col">姓名</th><th scope="col">账号</th><th scope="col">状态</th><th scope="col" class="shrink"><span class="sr-only">操作</span></th></tr></thead>
              <tbody>
                <tr v-for="r in selected.reviewers" :key="r.id">
                  <td>{{ r.name }}</td>
                  <td>{{ r.username }}</td>
                  <td><StatusPill :tone="r.active ? 'success' : 'neutral'">{{ r.active ? '启用中' : '已停用' }}</StatusPill></td>
                  <td class="shrink">
                    <button type="button" class="btn btn--sm btn--quiet" @click="resetFor = { name: r.name, username: r.username }">重置密码…</button>
                    <button type="button" class="btn btn--sm btn--quiet" @click="toggleReviewer(r.id)">{{ r.active ? '停用' : '启用' }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="hint">学生与导师由学校管理员在本校“成员与资格”中维护。</p>
        </section>
        <ProtoNote contract="systemOperations">
          暂停学校会撤销该校全部会话，登录校验要求学校为 ACTIVE；系统管理员目前在真实前端没有菜单项（C-ACCOUNT），接线时补导航。
        </ProtoNote>
      </div>

      <!-- 新增 -->
      <div v-else-if="mode === 'create'" class="obj page narrowpage">
        <div v-if="duplicate" class="banner banner--danger" role="alert">
          <strong>没有建立：学校代码 {{ nt.code }} 已被使用</strong>
          <span>{{ dupOwner ? `使用者：${dupOwner.name}。` : '' }}如果这就是同一所学校，请到它的详情里新增学校管理员；否则换一个代码。其他内容已保留。</span>
          <div v-if="dupOwner" class="acts"><button type="button" class="btn btn--sm" @click="open(dupOwner)">打开{{ dupOwner.name }}</button></div>
        </div>

        <section class="sec" aria-labelledby="in-h">
          <div class="sec__head"><h3 id="in-h">官方院校</h3><p>名称须与官方名录一致</p></div>
          <template v-if="!picked">
            <label class="field">
              <span>检索院校名称或代码</span>
              <input v-model="q" class="input" type="search" placeholder="例如 农业大学" :aria-invalid="nt.tried && ntMissing.institution" />
              <small v-if="nt.tried && ntMissing.institution" class="field-error">请从官方名录中选择一所院校。</small>
            </label>
            <ul v-if="matches.length" class="pick" aria-label="检索结果">
              <li v-for="i in matches" :key="i.code"><button type="button" class="pick__item" @click="picked = i"><span>{{ i.name }}</span><span class="muted num">{{ i.code }}　{{ i.province }}</span></button></li>
            </ul>
            <p v-else-if="q.trim()" class="hint">官方名录里没有匹配“{{ q.trim() }}”的院校。名录由“官方基础目录”导入。</p>
          </template>
          <div v-else class="chosen">
            <span><strong>{{ picked.name }}</strong><span class="muted num">　{{ picked.code }}　{{ picked.province }}</span></span>
            <button type="button" class="btn btn--sm btn--quiet" @click="picked = null">重新选择</button>
          </div>
        </section>

        <section class="sec" aria-labelledby="tc-h">
          <div class="sec__head"><h3 id="tc-h">学校账号</h3></div>
          <div class="grid2">
            <label class="field">
              <span>学校代码</span>
              <input v-model="nt.code" class="input num" placeholder="例如 demo-u04" :aria-invalid="(nt.tried && ntMissing.code) || duplicate" @input="duplicate = false" />
              <small>2–32 位小写字母、数字或短横线；登录与接口里使用，建立后不建议更改</small>
              <small v-if="nt.tried && ntMissing.code" class="field-error">格式不符合要求。</small>
            </label>
            <span />
            <label class="field"><span>根组织编号</span><input v-model="nt.orgId" class="input" placeholder="例如 GS" :aria-invalid="nt.tried && !nt.orgId.trim()" /></label>
            <label class="field"><span>根组织名称</span><input v-model="nt.orgName" class="input" :aria-invalid="nt.tried && !nt.orgName.trim()" /></label>
          </div>
          <small v-if="nt.tried && ntMissing.org" class="field-error">请填写根组织编号与名称。</small>
        </section>

        <section class="sec" aria-labelledby="fr-h">
          <div class="sec__head"><h3 id="fr-h">首位学校管理员</h3></div>
          <div class="grid2">
            <label class="field"><span>姓名</span><input v-model="nt.name" class="input" :aria-invalid="nt.tried && ntMissing.name" /></label>
            <label class="field"><span>登录账号</span><input v-model="nt.username" class="input" autocomplete="off" :aria-invalid="nt.tried && ntMissing.username" /></label>
            <label class="field"><span>初始密码</span><input v-model="nt.a" class="input" type="password" autocomplete="new-password" :aria-invalid="nt.tried && Boolean(ntMissing.pw)" /><small>至少 12 位，提交后不再显示</small></label>
            <label class="field"><span>再次输入</span><input v-model="nt.b" class="input" type="password" autocomplete="new-password" :aria-invalid="nt.tried && Boolean(ntMissing.pw)" /><small v-if="nt.tried && ntMissing.pw" class="field-error">{{ ntMissing.pw }}</small></label>
          </div>
        </section>

        <div class="acts acts--end">
          <button type="button" class="btn" @click="back">取消</button>
          <button type="button" class="btn btn--primary" @click="createTenant">建立学校</button>
        </div>
      </div>

      <ConfirmDialog :open="suspendOpen && Boolean(selected)" title="暂停学校" @close="suspendOpen = false">
        <p>暂停{{ selected?.name }}（{{ selected?.code }}）后，该校全部账号立即退出，恢复前无法登录。</p>
        <p class="muted">数据保留，之后可以恢复。请先与学校确认。</p>
        <template #actions>
          <button type="button" class="btn" @click="suspendOpen = false">取消</button>
          <button type="button" class="btn btn--danger" @click="toggleTenant">暂停学校</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="reviewerOpen && Boolean(selected)" title="新增学校管理员" @close="reviewerOpen = false">
        <label class="field"><span>姓名</span><input v-model="rv.name" class="input" :aria-invalid="rv.tried && !rv.name.trim()" /></label>
        <label class="field"><span>登录账号</span><input v-model="rv.username" class="input" autocomplete="off" :aria-invalid="rv.tried && !rv.username.trim()" /></label>
        <label class="field"><span>初始密码</span><input v-model="rv.a" class="input" type="password" autocomplete="new-password" :aria-invalid="rv.tried && Boolean(pwError(rv.a, rv.b))" /></label>
        <label class="field">
          <span>再次输入</span><input v-model="rv.b" class="input" type="password" autocomplete="new-password" :aria-invalid="rv.tried && Boolean(pwError(rv.a, rv.b))" />
          <small v-if="rv.tried && pwError(rv.a, rv.b)" class="field-error">{{ pwError(rv.a, rv.b) }}</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="reviewerOpen = false">取消</button>
          <button type="button" class="btn btn--primary" @click="addReviewer">建立账号</button>
        </template>
      </ConfirmDialog>

      <ConfirmDialog :open="Boolean(resetFor)" title="重置密码" @close="resetFor = null; pw = { a: '', b: '', tried: false }">
        <p>为 {{ resetFor?.name }}（{{ resetFor?.username }}）设定新密码。提交后不会再显示。</p>
        <label class="field"><span>新密码</span><input v-model="pw.a" class="input" type="password" autocomplete="new-password" :aria-invalid="pw.tried && Boolean(pwError(pw.a, pw.b))" /></label>
        <label class="field">
          <span>再次输入</span><input v-model="pw.b" class="input" type="password" autocomplete="new-password" :aria-invalid="pw.tried && Boolean(pwError(pw.a, pw.b))" />
          <small v-if="pw.tried && pwError(pw.a, pw.b)" class="field-error">{{ pwError(pw.a, pw.b) }}</small>
        </label>
        <template #actions>
          <button type="button" class="btn" @click="resetFor = null; pw = { a: '', b: '', tried: false }">取消</button>
          <button type="button" class="btn btn--primary" @click="resetPassword">重置密码</button>
        </template>
      </ConfirmDialog>
    </OperationsShell>
  </ProtoFrame>
</template>

<style scoped>
.page {
  max-width: 1080px;
}
.narrowpage {
  max-width: 760px;
}
.crumb {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ws-action);
  font: inherit;
  cursor: pointer;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.toolbar .input {
  width: 240px;
}
.toolbar .select {
  width: 140px;
}
.flush {
  padding: 0;
}
.tenants tbody tr {
  cursor: pointer;
}
.tenants tbody tr:hover {
  background: #fafbfc;
}
.tenants td {
  height: var(--ws-row);
}
.rowlink {
  padding: 0;
  border: 0;
  background: none;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}
.pick {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  list-style: none;
}
.pick li + li {
  border-top: 1px solid var(--ws-border);
}
.pick__item {
  display: flex;
  width: 100%;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.pick__item:hover {
  background: var(--ws-sunken);
}
.chosen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--ws-radius);
  background: var(--ws-action-soft);
}
@media (max-width: 720px) {
  .toolbar label,
  .toolbar .input,
  .toolbar .select {
    width: 100%;
  }
  .tenants {
    min-width: 640px;
  }
}
</style>
