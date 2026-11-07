<script setup lang="ts">
/**
 * U4-4 成员对象区：送审资格（学生，按批次）、账号与联系方式、账号安全。
 * 编辑 409 时保留输入并列出与服务端当前值的对照（E8）；命令 409 时重读，已是目标状态按成功说明。
 * 密码只在对话框输入框里，成功或关闭即清空，不回显。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { apiFailure } from '@/api/failure'
import {
  createEligibility, disableMember, enableMember, resetMemberPassword, resumeEligibility, suspendEligibility, updateMember,
  type ReviewBatch, type SchoolMember, type StudentEligibility,
} from '@/api/schoolOperations'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'

import { batchStatusText } from './batchForm'
import { batchesForNewEligibility, contactDiff, contactDirty, contactErrors, contactFrom, currentBatch, idLabel, passwordError, type ContactForm } from './memberView'

export interface Snapshot { members: SchoolMember[]; eligibilities: StudentEligibility[] | null }

const props = defineProps<{
  member: SchoolMember
  batches: ReviewBatch[]
  eligibilities: StudentEligibility[] | null
  eligibilityError: string
  supervisors: SchoolMember[]
  reload: () => Promise<Snapshot | null>
}>()

let alive = true
onBeforeUnmount(() => (alive = false))
const flash = ref('')
const notice = ref('')
const busy = ref(false)
const keys = new Map<string, string>()
const keyFor = (signature: string) => keys.get(signature) ?? keys.set(signature, crypto.randomUUID()).get(signature)!
const isStudent = computed(() => props.member.membership_type === 'STUDENT')
const active = computed(() => props.member.is_active && props.member.status === 'ACTIVE')

/** 执行命令；409 时重读并用 reached 判断是否已是目标状态 */
async function command(signature: string, run: (key: string) => Promise<unknown>, done: string, reached: (fresh: Snapshot) => boolean): Promise<string> {
  if (busy.value) return ''
  busy.value = true
  flash.value = ''
  notice.value = ''
  try {
    await run(keyFor(signature))
    if (!alive) return ''
    keys.delete(signature)
    flash.value = done
    await props.reload()
    return ''
  } catch (reason) {
    if (!alive) return ''
    const failure = apiFailure(reason)
    // 网络或服务错误时保留键，重试同一操作；状态冲突或对象不在时换新键
    if (failure.status === 409 || failure.status === 404) {
      keys.delete(signature)
      const fresh = await props.reload()
      if (!alive) return ''
      if (failure.status === 409 && fresh && reached(fresh)) {
        flash.value = done
        return ''
      }
      return failure.message
    }
    return failure.message
  } finally {
    if (alive) busy.value = false
  }
}
const memberIn = (fresh: Snapshot) => fresh.members.find((row) => row.membership_id === props.member.membership_id)

// ---- 账号与联系方式 ----
const form = ref<ContactForm>(contactFrom(props.member))
const formErrors = ref<Partial<Record<keyof ContactForm, string>>>({})
const conflict = ref(false)
const saving = ref(false)
const saveError = ref('')
const dirty = computed(() => contactDirty(form.value, props.member))
const conflictRows = computed(() => (conflict.value ? contactDiff(form.value, props.member) : []))
watch(() => props.member, (next, prev) => {
  if (!conflict.value && prev && !contactDirty(form.value, prev)) form.value = contactFrom(next)
})
async function save() {
  formErrors.value = contactErrors(form.value)
  if (saving.value || !dirty.value || Object.keys(formErrors.value).length) return
  saving.value = true
  saveError.value = ''
  flash.value = ''
  try {
    const next = await updateMember(props.member.membership_id, {
      display_name: form.value.name.trim(),
      contact_phone: form.value.phone.trim() || null,
      contact_email: form.value.email.trim() || null,
      expected_updated_at: props.member.updated_at,
    }, { quiet: true })
    if (!alive) return
    conflict.value = false
    form.value = contactFrom(next)
    flash.value = '已保存。'
    await props.reload()
  } catch (reason) {
    if (!alive) return
    const failure = apiFailure(reason)
    if (failure.status === 409) {
      conflict.value = true
      await props.reload()
    } else saveError.value = failure.message
  } finally {
    if (alive) saving.value = false
  }
}
function takeTheirs() {
  conflict.value = false
  form.value = contactFrom(props.member)
  formErrors.value = {}
}
function keepMine() {
  conflict.value = false
  void save()
}

// ---- 账号安全 ----
const disableOpen = ref(false)
const disableError = ref('')
async function disable() {
  disableError.value = await command(`disable:${props.member.updated_at}`, (key) => disableMember(props.member.membership_id, { idempotencyKey: key, quiet: true }),
    '已停用。本人无法登录，已登录的会话也已失效；论文与处理记录保留。', (fresh) => memberIn(fresh)?.is_active === false)
  if (!disableError.value) disableOpen.value = false
}
async function enable() {
  notice.value = ''
  const error = await command(`enable:${props.member.updated_at}`, (key) => enableMember(props.member.membership_id, { idempotencyKey: key, quiet: true }),
    '已启用，本人可以重新登录。', (fresh) => memberIn(fresh)?.is_active === true)
  if (error) notice.value = error
}
const resetOpen = ref(false)
const pw = ref({ a: '', b: '', tried: false })
const pwError = computed(() => (pw.value.tried ? passwordError(pw.value.a, pw.value.b) : ''))
const resetError = ref('')
/** 改了密码就换一把幂等键；不把密码本身放进任何键或签名 */
let resetSeq = 0
watch(() => [pw.value.a, pw.value.b], () => resetSeq++)
function openReset() {
  pw.value = { a: '', b: '', tried: false }
  resetError.value = ''
  resetOpen.value = true
}
function closeReset() {
  if (busy.value) return
  resetOpen.value = false
  pw.value = { a: '', b: '', tried: false }
}
async function reset() {
  pw.value.tried = true
  if (passwordError(pw.value.a, pw.value.b)) return
  const password = pw.value.a
  resetError.value = await command(`reset:${props.member.membership_id}:${resetSeq}`, (key) => resetMemberPassword(props.member.membership_id, password, { idempotencyKey: key, quiet: true }),
    '密码已重置。新密码不会再次显示，请通过线下方式告知本人。', () => false)
  if (!resetError.value) {
    resetOpen.value = false
    pw.value = { a: '', b: '', tried: false }
  }
}

// ---- 送审资格 ----
const batchById = computed(() => new Map(props.batches.map((batch) => [batch.id, batch])))
const mine = computed(() => (props.eligibilities ?? []).filter((row) => row.student_membership_id === props.member.membership_id))
const currentRows = computed(() => mine.value.filter((row) => currentBatch(batchById.value.get(row.review_batch_id))))
const pastRows = computed(() => mine.value.filter((row) => !currentBatch(batchById.value.get(row.review_batch_id))))
const openable = computed(() => (props.eligibilities ? batchesForNewEligibility(props.member.membership_id, props.eligibilities, props.batches) : []))
const batchName = (id: string) => batchById.value.get(id)?.name ?? '批次已不可见'
const batchState = (id: string) => {
  const batch = batchById.value.get(id)
  return batch ? batchStatusText[batch.status] : ''
}
const suspendTarget = ref<StudentEligibility | null>(null)
const suspendError = ref('')
async function suspend() {
  const row = suspendTarget.value
  if (!row) return
  suspendError.value = await command(`suspend:${row.id}`, (key) => suspendEligibility(row.id, { idempotencyKey: key, quiet: true }),
    `已暂停“${batchName(row.review_batch_id)}”的送审资格。已有的草稿与已提交的论文继续办理。`, (fresh) => fresh.eligibilities?.find((item) => item.id === row.id)?.status === 'SUSPENDED')
  if (!suspendError.value) suspendTarget.value = null
}
async function resume(row: StudentEligibility) {
  const error = await command(`resume:${row.id}`, (key) => resumeEligibility(row.id, { idempotencyKey: key, quiet: true }),
    `已恢复“${batchName(row.review_batch_id)}”的送审资格。`, (fresh) => fresh.eligibilities?.find((item) => item.id === row.id)?.status === 'ELIGIBLE')
  if (error) notice.value = error
}
const newElig = ref({ batchId: '', supervisorId: '', degree: '', tried: false })
const newEligError = ref('')
const degreeTooLong = computed(() => newElig.value.degree.trim().length > 32)
watch(openable, (rows) => {
  if (!rows.some((batch) => batch.id === newElig.value.batchId)) newElig.value.batchId = rows.length === 1 ? rows[0]!.id : ''
}, { immediate: true })
async function addEligibility() {
  newElig.value.tried = true
  if (!newElig.value.batchId || degreeTooLong.value) return
  const batchId = newElig.value.batchId
  const body = { student_membership_id: props.member.membership_id, supervisor_membership_id: newElig.value.supervisorId || null, degree_type: newElig.value.degree.trim() || null }
  newEligError.value = await command(`elig:${JSON.stringify({ batchId, body })}`, (key) => createEligibility(batchId, body, { idempotencyKey: key, quiet: true }),
    `已为“${batchName(batchId)}”建立送审资格，学生现在可以在这个批次新建论文。`, () => false)
  if (!newEligError.value) newElig.value = { batchId: '', supervisorId: '', degree: '', tried: false }
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <div class="wsd-obj__row">
        <StatusPill :tone="active ? 'success' : 'neutral'">{{ active ? '启用中' : '已停用' }}</StatusPill>
      </div>
      <h2 class="wsd-obj__title">{{ member.display_name }}</h2>
      <dl class="wsd-obj__meta">
        <div><dt>类型</dt><dd>{{ isStudent ? '学生' : '导师' }}</dd></div>
        <div><dt>{{ idLabel(member.membership_type) }}</dt><dd class="num">{{ member.external_id }}</dd></div>
        <div><dt>账号</dt><dd>{{ member.username }}</dd></div>
      </dl>
    </header>

    <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
    <div v-if="notice" class="wsd-banner wsd-banner--danger" role="alert">{{ notice }}</div>

    <section v-if="isStudent" class="wsd-sec" :class="{ 'wsd-sec--attention': eligibilities && !currentRows.some((row) => row.status === 'ELIGIBLE') }" aria-labelledby="el-h" data-eligibility>
      <div class="wsd-sec__head"><h3 id="el-h">送审资格</h3><p>按批次建立，决定学生能否在该批次新建论文</p></div>
      <p v-if="eligibilityError" class="field-error" role="alert">送审资格没有加载出来：{{ eligibilityError }}</p>
      <template v-else-if="eligibilities">
        <p v-if="!currentRows.length" class="wsd-hint">草稿或开放的批次里还没有这位学生的资格。没有资格的学生登录后只能看到说明，不能新建论文。</p>
        <div v-else class="wsd-twrap">
          <table class="wsd-dtable">
            <thead><tr><th scope="col">批次</th><th scope="col">状态</th><th scope="col">导师</th><th scope="col">学位类型</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead>
            <tbody>
              <tr v-for="row in currentRows" :key="row.id" :data-eligibility-row="row.id">
                <td>{{ batchName(row.review_batch_id) }}<span class="muted">　{{ batchState(row.review_batch_id) }}</span></td>
                <td><StatusPill :tone="row.status === 'ELIGIBLE' ? 'success' : 'warning'">{{ row.status === 'ELIGIBLE' ? '可以送审' : '已暂停' }}</StatusPill></td>
                <td>{{ row.supervisor_name || '未指定' }}</td>
                <td>{{ row.degree_type || '未填写' }}</td>
                <td class="wsd-shrink">
                  <button v-if="row.status === 'ELIGIBLE'" type="button" class="btn btn--sm" data-action="suspend-eligibility" :disabled="busy" @click="suspendError = ''; suspendTarget = row">暂停…</button>
                  <button v-else type="button" class="btn btn--sm btn--outline" data-action="resume-eligibility" :disabled="busy" @click="resume(row)">恢复</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="currentRows.some((row) => row.status === 'SUSPENDED')" class="wsd-hint">暂停期间不能在该批次新建论文；已有的草稿与已提交的论文继续办理。</p>

        <div v-if="!active" class="wsd-hint">账号已停用，启用后才能建立送审资格。</div>
        <div v-else-if="openable.length" class="newelig" data-new-eligibility>
          <h4>建立送审资格</h4>
          <div class="wsd-grid2">
            <label class="field">
              <span>批次</span>
              <select v-model="newElig.batchId" class="select" data-field="eligibility-batch" :disabled="busy" :aria-invalid="newElig.tried && !newElig.batchId">
                <option value="">请选择</option>
                <option v-for="batch in openable" :key="batch.id" :value="batch.id">{{ batch.name }}（{{ batchStatusText[batch.status] }}）</option>
              </select>
              <small v-if="newElig.tried && !newElig.batchId" class="field-error">请选择批次。</small>
            </label>
            <label class="field">
              <span>导师（可不指定）</span>
              <select v-model="newElig.supervisorId" class="select" data-field="eligibility-supervisor" :disabled="busy">
                <option value="">不指定</option>
                <option v-for="row in supervisors" :key="row.membership_id" :value="row.membership_id">{{ row.display_name }}（{{ row.external_id }}）</option>
              </select>
            </label>
            <label class="field">
              <span>学位类型（可不填）</span>
              <input v-model="newElig.degree" class="input" data-field="degree-type" maxlength="64" placeholder="例如 工学硕士" :disabled="busy" :aria-invalid="degreeTooLong" />
              <small v-if="degreeTooLong" class="field-error">学位类型不超过 32 个字。</small>
            </label>
          </div>
          <p v-if="newEligError" class="field-error" role="alert">{{ newEligError }}</p>
          <div class="wsd-acts"><button type="button" class="btn btn--primary" data-action="create-eligibility" :disabled="busy" @click="addEligibility">建立资格</button></div>
        </div>
        <p v-else class="wsd-hint">没有可以再建立资格的草稿或开放批次。</p>

        <details v-if="pastRows.length" class="past">
          <summary>往期批次的资格 {{ pastRows.length }}</summary>
          <ul><li v-for="row in pastRows" :key="row.id">{{ batchName(row.review_batch_id) }}　{{ batchState(row.review_batch_id) }}　{{ row.status === 'ELIGIBLE' ? '可以送审' : '已暂停' }}</li></ul>
        </details>
      </template>
      <p v-else class="muted">正在读取送审资格…</p>
    </section>

    <section class="wsd-sec" aria-labelledby="ct-h">
      <div class="wsd-sec__head"><h3 id="ct-h">账号与联系方式</h3></div>
      <div v-if="conflict" class="wsd-banner wsd-banner--danger" role="alert" data-conflict>
        <strong>没有保存：这位成员的资料在你打开之后被修改过</strong>
        <span>你的修改还在下面的表单里。与服务端当前值不同的字段：</span>
        <table v-if="conflictRows.length" class="wsd-dtable ctable">
          <thead><tr><th scope="col">字段</th><th scope="col">你的修改</th><th scope="col">服务端当前值</th></tr></thead>
          <tbody><tr v-for="row in conflictRows" :key="row.key"><th scope="row">{{ row.label }}</th><td>{{ row.mine }}</td><td>{{ row.theirs }}</td></tr></tbody>
        </table>
        <div class="wsd-acts">
          <button v-if="conflictRows.length" type="button" class="btn btn--sm btn--primary" data-action="keep-mine" :disabled="saving" @click="keepMine">用我的修改覆盖</button>
          <button type="button" class="btn btn--sm" data-action="take-theirs" :disabled="saving" @click="takeTheirs">放弃我的修改</button>
        </div>
      </div>
      <div class="wsd-grid2">
        <label class="field wsd-wide">
          <span>姓名</span>
          <input v-model="form.name" class="input" data-field="member-name" :disabled="saving" :aria-invalid="Boolean(formErrors.name)" />
          <small v-if="formErrors.name" class="field-error">{{ formErrors.name }}</small>
        </label>
        <label class="field">
          <span>电话</span>
          <input v-model="form.phone" class="input" data-field="member-phone" placeholder="未填写" :disabled="saving" :aria-invalid="Boolean(formErrors.phone)" />
          <small v-if="formErrors.phone" class="field-error">{{ formErrors.phone }}</small>
        </label>
        <label class="field">
          <span>邮箱</span>
          <input v-model="form.email" class="input" data-field="member-email" placeholder="未填写" :disabled="saving" :aria-invalid="Boolean(formErrors.email)" />
          <small v-if="formErrors.email" class="field-error">{{ formErrors.email }}</small>
        </label>
      </div>
      <p v-if="isStudent" class="wsd-hint">已建立的送审资格保存了当时的姓名与学号，改名不会改动已有资格与论文上的记录。</p>
      <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
      <div class="wsd-acts wsd-acts--end">
        <span v-if="dirty" class="wsd-hint">有未保存的修改</span>
        <button type="button" class="btn" :disabled="!dirty || saving" @click="takeTheirs">撤销修改</button>
        <button type="button" class="btn btn--primary" data-action="save-member" :disabled="!dirty || saving || conflict" @click="save">{{ saving ? '正在保存…' : '保存' }}</button>
      </div>
    </section>

    <section class="wsd-sec" aria-labelledby="ac-h">
      <div class="wsd-sec__head"><h3 id="ac-h">账号安全</h3></div>
      <div class="wsd-acts">
        <button type="button" class="btn" data-action="reset-password" :disabled="busy" @click="openReset">重置密码…</button>
        <button v-if="active" type="button" class="btn" data-action="disable-member" :disabled="busy" @click="disableError = ''; disableOpen = true">停用账号…</button>
        <button v-else type="button" class="btn btn--outline" data-action="enable-member" :disabled="busy" @click="enable">启用账号</button>
      </div>
      <p class="wsd-hint">密码由你设定后告知本人；平台不显示、不发送密码。</p>
    </section>
  </div>

  <ConfirmDialog :open="disableOpen" title="停用这个账号" :busy="busy" @close="busy || (disableOpen = false)">
    <p>停用后，{{ member.display_name }}（{{ member.username }}）无法登录，已登录的会话也会失效。论文、评阅结果与处理记录都保留，之后可以重新启用。</p>
    <p v-if="disableError" class="field-error" role="alert">{{ disableError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="busy" @click="disableOpen = false">取消</button>
      <button type="button" class="btn btn--danger" data-action="confirm-disable" :disabled="busy" @click="disable">停用</button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="Boolean(suspendTarget)" title="暂停送审资格" :busy="busy" @close="busy || (suspendTarget = null)">
    <p>暂停后，{{ member.display_name }}不能在“{{ suspendTarget && batchName(suspendTarget.review_batch_id) }}”新建论文。已有的草稿与已提交的论文继续办理，不受影响。</p>
    <p v-if="suspendError" class="field-error" role="alert">{{ suspendError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="busy" @click="suspendTarget = null">取消</button>
      <button type="button" class="btn btn--primary" data-action="confirm-suspend" :disabled="busy" @click="suspend">暂停资格</button>
    </template>
  </ConfirmDialog>

  <ConfirmDialog :open="resetOpen" title="重置密码" :busy="busy" @close="closeReset">
    <p>为 {{ member.display_name }}（{{ member.username }}）设定新密码。提交后密码不会再显示，请通过线下方式告知本人。</p>
    <label class="field"><span>新密码</span><input v-model="pw.a" class="input" type="password" data-field="new-password" autocomplete="new-password" :disabled="busy" :aria-invalid="Boolean(pwError)" /></label>
    <label class="field">
      <span>再次输入</span><input v-model="pw.b" class="input" type="password" data-field="new-password-again" autocomplete="new-password" :disabled="busy" :aria-invalid="Boolean(pwError)" />
      <small v-if="pwError" class="field-error">{{ pwError }}</small>
      <small v-else>至少 12 位</small>
    </label>
    <p v-if="resetError" class="field-error" role="alert">{{ resetError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="busy" @click="closeReset">取消</button>
      <button type="button" class="btn btn--primary" data-action="confirm-reset" :disabled="busy" @click="reset">重置密码</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
.newelig {
  display: grid;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ws-border);
}
.newelig h4 {
  font-size: 13px;
  font-weight: 600;
}
.past summary {
  color: var(--ws-muted);
  font-size: 13px;
  cursor: pointer;
}
.past ul {
  margin: 6px 0 0;
  padding-left: 1.1em;
  font-size: 13px;
}
.ctable {
  background: var(--ws-surface);
}
</style>
