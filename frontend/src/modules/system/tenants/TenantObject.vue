<script setup lang="ts">
/**
 * U4-8 学校详情：状态（暂停需确认，恢复直接执行）与学校管理员（新增含工号 E9、重置密码、停用／启用）。
 * 幂等键：同一命令在没有改动时重试复用同一把键；表单命令按改动序号判断，密码不进签名。
 * 409：重读；已是目标状态按成功说明，否则显示服务端原文（例如“不能停用最后一名学校管理员”）。
 * 密码只在输入框里，成功即清空，不在任何提示里回显。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { apiFailure } from '@/api/failure'
import {
  createReviewer, disableReviewer, enableReviewer, listReviewers, resetReviewerPassword, resumeTenant, suspendTenant,
  type SchoolReviewer, type TenantSummary,
} from '@/api/systemOperations'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'

import { dateText, emptyReviewer, passwordError, reviewerErrors, statusText, statusTone, toReviewerInput } from './tenantView'

const props = defineProps<{ tenant: TenantSummary; flash: string; reload: () => Promise<TenantSummary[] | null> }>()
const emit = defineEmits<{ say: [text: string] }>()

let alive = true
onBeforeUnmount(() => (alive = false))

/* 学校管理员 */
const reviewers = ref<SchoolReviewer[]>([])
const reviewersLoading = ref(true)
const reviewersError = ref('')
let generation = 0
async function loadReviewers(): Promise<SchoolReviewer[] | null> {
  const request = ++generation
  reviewersLoading.value = true
  reviewersError.value = ''
  try {
    const items = await listReviewers(props.tenant.id, { quiet: true })
    if (!alive || request !== generation) return null
    reviewers.value = items
    return items
  } catch (reason) {
    if (!alive || request !== generation) return null
    reviewersError.value = apiFailure(reason).message
    return null
  } finally {
    if (alive && request === generation) reviewersLoading.value = false
  }
}
void loadReviewers()

/* 命令与幂等键 */
const busy = ref(false)
const notice = ref<{ tone: 'warn' | 'danger'; title: string; body: string } | null>(null)
const keys = new Map<string, string>()
const keyFor = (signature: string) => {
  if (!keys.has(signature)) keys.set(signature, crypto.randomUUID())
  return keys.get(signature)!
}
type Outcome = { ok: true } | { ok: false; status: number | undefined; message: string }
async function run(signature: string, call: (key: string) => Promise<unknown>): Promise<Outcome | null> {
  if (busy.value) return null
  busy.value = true
  notice.value = null
  try {
    await call(keyFor(signature))
    keys.delete(signature)
    return alive ? { ok: true } : null
  } catch (reason) {
    const failure = apiFailure(reason)
    if (failure.status !== undefined) keys.delete(signature)
    return alive ? { ok: false, status: failure.status, message: failure.message } : null
  } finally {
    if (alive) busy.value = false
  }
}

/* 暂停／恢复 */
const suspending = ref(false)
const canSuspend = computed(() => props.tenant.allowed_actions.includes('SUSPEND'))
const canResume = computed(() => props.tenant.allowed_actions.includes('RESUME'))
async function changeStatus(action: 'SUSPEND' | 'RESUME') {
  const { id, name } = props.tenant
  const target = action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE'
  const outcome = await run(`status:${id}:${action}`, (key) => (action === 'SUSPEND' ? suspendTenant : resumeTenant)(id, { idempotencyKey: key, quiet: true }))
  if (!outcome) return
  suspending.value = false
  const done = action === 'SUSPEND' ? `已暂停${name}。该校账号已全部退出，恢复前无法登录。` : `已恢复${name}，该校账号可以重新登录。`
  if (outcome.ok) {
    emit('say', done)
    await props.reload()
    return
  }
  if (outcome.status !== 409) {
    notice.value = { tone: 'danger', title: action === 'SUSPEND' ? '没有暂停' : '没有恢复', body: outcome.message }
    return
  }
  const fresh = (await props.reload())?.find((row) => row.id === id)
  if (!alive || !fresh) return
  if (fresh.status === target) emit('say', `${name}已是${statusText[target]}状态，不需要再操作。`)
  else notice.value = { tone: 'danger', title: action === 'SUSPEND' ? '没有暂停' : '没有恢复', body: `${outcome.message}。已读回最新状态。` }
}

/* 停用／启用管理员 */
async function toggleReviewer(row: SchoolReviewer) {
  const tenantId = props.tenant.id
  const enabling = !row.is_active
  const outcome = await run(`reviewer:${row.user_id}:${enabling ? 'enable' : 'disable'}`, (key) =>
    (enabling ? enableReviewer : disableReviewer)(tenantId, row.user_id, { idempotencyKey: key, quiet: true }),
  )
  if (!outcome) return
  const done = enabling ? `已启用 ${row.display_name}。` : `已停用 ${row.display_name}，该账号无法再登录。`
  if (outcome.ok) {
    emit('say', done)
    await Promise.all([loadReviewers(), props.reload()])
    return
  }
  if (outcome.status !== 409) {
    notice.value = { tone: 'danger', title: enabling ? '没有启用' : '没有停用', body: outcome.message }
    return
  }
  const fresh = (await loadReviewers())?.find((item) => item.user_id === row.user_id)
  if (!alive) return
  if (fresh && fresh.is_active === enabling) emit('say', `${row.display_name}已是${enabling ? '启用' : '停用'}状态，不需要再操作。`)
  else notice.value = { tone: 'danger', title: enabling ? '没有启用' : '没有停用', body: outcome.message }
}

/* 新增学校管理员 */
const adding = ref(false)
const draft = ref(emptyReviewer())
const draftTried = ref(false)
const draftError = ref('')
let draftSeq = 0
watch(draft, () => draftSeq++, { deep: true })
const draftErrors = computed(() => (draftTried.value ? reviewerErrors(draft.value) : {}))
function openAdd() {
  draft.value = emptyReviewer()
  draftTried.value = false
  draftError.value = ''
  adding.value = true
}
function closeAdd() {
  if (busy.value) return
  adding.value = false
  draft.value.password = ''
  draft.value.again = ''
}
async function addReviewer() {
  draftTried.value = true
  if (Object.keys(reviewerErrors(draft.value)).length) return
  draftError.value = ''
  const body = toReviewerInput(draft.value)
  const outcome = await run(`add:${props.tenant.id}:${draftSeq}`, (key) => createReviewer(props.tenant.id, body, { idempotencyKey: key, quiet: true }))
  if (!outcome) return
  if (outcome.ok) {
    adding.value = false
    draft.value = emptyReviewer()
    emit('say', `已建立学校管理员 ${body.display_name}（${body.username}）。初始密码不会再显示，请通过线下方式告知本人。`)
    await Promise.all([loadReviewers(), props.reload()])
    return
  }
  if (outcome.status !== undefined) {
    draft.value.password = ''
    draft.value.again = ''
  }
  draftError.value = outcome.message
  if (outcome.status === 409) void props.reload()
}

/* 重置密码 */
const resetFor = ref<SchoolReviewer | null>(null)
const pw = ref({ password: '', again: '' })
const pwTried = ref(false)
const pwError = ref('')
let pwSeq = 0
watch(pw, () => pwSeq++, { deep: true })
const pwInvalid = computed(() => (pwTried.value ? passwordError(pw.value.password, pw.value.again) : ''))
function openReset(row: SchoolReviewer) {
  pw.value = { password: '', again: '' }
  pwTried.value = false
  pwError.value = ''
  resetFor.value = row
}
function closeReset() {
  if (busy.value) return
  resetFor.value = null
  pw.value = { password: '', again: '' }
}
async function resetPassword() {
  pwTried.value = true
  const row = resetFor.value
  if (!row || passwordError(pw.value.password, pw.value.again)) return
  pwError.value = ''
  const password = pw.value.password
  const outcome = await run(`reset:${row.user_id}:${pwSeq}`, (key) => resetReviewerPassword(props.tenant.id, row.user_id, password, { idempotencyKey: key, quiet: true }))
  if (!outcome) return
  if (outcome.ok) {
    resetFor.value = null
    pw.value = { password: '', again: '' }
    emit('say', `已重置 ${row.display_name} 的密码。新密码不会再显示，请通过线下方式告知本人。`)
    return
  }
  if (outcome.status !== undefined) pw.value = { password: '', again: '' }
  pwError.value = outcome.message
  if (outcome.status === 409 || outcome.status === 404) void loadReviewers()
}

const suspended = computed(() => props.tenant.status === 'SUSPENDED')
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <div class="wsd-obj__row">
        <StatusPill :tone="statusTone(tenant.status)">{{ statusText[tenant.status] }}</StatusPill>
        <button v-if="canSuspend" type="button" class="btn btn--sm" data-action="suspend-tenant" :disabled="busy" @click="suspending = true">暂停学校…</button>
        <button v-if="canResume" type="button" class="btn btn--sm btn--outline" data-action="resume-tenant" :disabled="busy" @click="changeStatus('RESUME')">恢复学校</button>
      </div>
      <h2 class="wsd-obj__title">{{ tenant.name }}</h2>
      <dl class="wsd-obj__meta">
        <div><dt>代码</dt><dd class="num">{{ tenant.code }}</dd></div>
        <div><dt>根组织</dt><dd>{{ tenant.root_organization.name }}<span class="muted num">（{{ tenant.root_organization.external_id }}）</span></dd></div>
        <div><dt>接入</dt><dd class="num">{{ dateText(tenant.created_at) }}</dd></div>
      </dl>
    </header>
    <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status" data-flash>{{ flash }}</div>
    <div v-if="notice" class="wsd-banner" :class="`wsd-banner--${notice.tone}`" role="alert" data-notice>
      <strong>{{ notice.title }}</strong>
      <span>{{ notice.body }}</span>
    </div>
    <div v-if="suspended" class="wsd-banner wsd-banner--warn">该校已暂停：所有账号无法登录。数据保留，恢复后可以继续使用。</div>

    <section class="wsd-sec" aria-labelledby="rv-h">
      <div class="wsd-sec__head">
        <h3 id="rv-h">学校管理员</h3>
        <button type="button" class="btn btn--sm" data-action="new-reviewer" :disabled="busy || suspended" @click="openAdd">新增学校管理员…</button>
      </div>
      <p v-if="suspended" class="wsd-hint">学校暂停期间不能新增管理员，恢复后再添加。</p>
      <StateBlock v-if="reviewersLoading && !reviewers.length" kind="loading" title="正在读取学校管理员…" compact />
      <StateBlock v-else-if="reviewersError" kind="error" title="学校管理员没有加载出来" compact>
        {{ reviewersError }}
        <template #actions><button type="button" class="btn btn--primary" @click="loadReviewers">重试</button></template>
      </StateBlock>
      <StateBlock v-else-if="!reviewers.length" kind="empty" title="这所学校还没有学校管理员" compact />
      <div v-else class="wsd-twrap">
        <table class="wsd-dtable">
          <thead>
            <tr><th scope="col">姓名</th><th scope="col">登录名</th><th scope="col">工号</th><th scope="col">状态</th><th scope="col" class="wsd-shrink"><span class="sr-only">操作</span></th></tr>
          </thead>
          <tbody>
            <tr v-for="row in reviewers" :key="row.user_id" :data-reviewer="row.user_id">
              <td>{{ row.display_name }}</td>
              <td class="num">{{ row.username }}</td>
              <td class="num">{{ row.external_id }}</td>
              <td><StatusPill :tone="row.is_active ? 'success' : 'neutral'">{{ row.is_active ? '启用中' : '已停用' }}</StatusPill></td>
              <td class="wsd-shrink">
                <button type="button" class="btn btn--sm btn--quiet" data-action="reset-reviewer" :disabled="busy" @click="openReset(row)">重置密码…</button>
                <button type="button" class="btn btn--sm btn--quiet" data-action="toggle-reviewer" :disabled="busy" @click="toggleReviewer(row)">{{ row.is_active ? '停用' : '启用' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="wsd-hint">学生与导师由学校管理员在本校“成员与资格”中维护。每所学校至少保留一名启用中的学校管理员。</p>
    </section>

    <ConfirmDialog :open="suspending" title="暂停学校" :busy="busy" @close="!busy && (suspending = false)">
      <p>暂停{{ tenant.name }}（{{ tenant.code }}）后，该校全部账号立即退出，恢复前无法登录。</p>
      <p class="muted">数据保留，之后可以恢复。请先与学校确认。</p>
      <template #actions>
        <button type="button" class="btn" :disabled="busy" @click="suspending = false">取消</button>
        <button type="button" class="btn btn--danger" data-action="confirm-suspend" :disabled="busy" @click="changeStatus('SUSPEND')">暂停学校</button>
      </template>
    </ConfirmDialog>

    <ConfirmDialog :open="adding" title="新增学校管理员" :busy="busy" @close="closeAdd">
      <label class="field">
        <span>姓名</span>
        <input v-model="draft.display_name" class="input" data-field="reviewer-name" :disabled="busy" :aria-invalid="Boolean(draftErrors.display_name)" />
        <small v-if="draftErrors.display_name" class="field-error">{{ draftErrors.display_name }}</small>
      </label>
      <label class="field">
        <span>登录名</span>
        <input v-model="draft.username" class="input num" data-field="reviewer-username" autocomplete="off" spellcheck="false" :disabled="busy" :aria-invalid="Boolean(draftErrors.username)" />
        <small v-if="draftErrors.username" class="field-error">{{ draftErrors.username }}</small>
      </label>
      <label class="field">
        <span>工号</span>
        <input v-model="draft.external_id" class="input num" data-field="reviewer-staff" :disabled="busy" :aria-invalid="Boolean(draftErrors.external_id)" />
        <small v-if="draftErrors.external_id" class="field-error">{{ draftErrors.external_id }}</small>
      </label>
      <label class="field">
        <span>初始密码</span>
        <input v-model="draft.password" class="input" type="password" autocomplete="new-password" data-field="reviewer-password" :disabled="busy" :aria-invalid="Boolean(draftErrors.password)" />
        <small>至少 12 位，提交后不再显示</small>
      </label>
      <label class="field">
        <span>再次输入</span>
        <input v-model="draft.again" class="input" type="password" autocomplete="new-password" data-field="reviewer-again" :disabled="busy" :aria-invalid="Boolean(draftErrors.password)" />
        <small v-if="draftErrors.password" class="field-error">{{ draftErrors.password }}</small>
      </label>
      <p v-if="draftError" class="field-error" role="alert">{{ draftError }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="busy" @click="closeAdd">取消</button>
        <button type="button" class="btn btn--primary" data-action="confirm-reviewer" :disabled="busy" @click="addReviewer">建立账号</button>
      </template>
    </ConfirmDialog>

    <ConfirmDialog :open="Boolean(resetFor)" title="重置密码" :busy="busy" @close="closeReset">
      <p>为 {{ resetFor?.display_name }}（{{ resetFor?.username }}）设定新密码。提交后不会再显示。</p>
      <label class="field">
        <span>新密码</span>
        <input v-model="pw.password" class="input" type="password" autocomplete="new-password" data-field="reset-password" :disabled="busy" :aria-invalid="Boolean(pwInvalid)" />
      </label>
      <label class="field">
        <span>再次输入</span>
        <input v-model="pw.again" class="input" type="password" autocomplete="new-password" data-field="reset-again" :disabled="busy" :aria-invalid="Boolean(pwInvalid)" />
        <small v-if="pwInvalid" class="field-error">{{ pwInvalid }}</small>
      </label>
      <p v-if="pwError" class="field-error" role="alert">{{ pwError }}</p>
      <template #actions>
        <button type="button" class="btn" :disabled="busy" @click="closeReset">取消</button>
        <button type="button" class="btn btn--primary" data-action="confirm-reset" :disabled="busy" @click="resetPassword">重置密码</button>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.muted {
  color: var(--ws-muted);
}
</style>
