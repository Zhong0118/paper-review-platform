<script setup lang="ts">
/**
 * U4-6 专家对象区：能否指派的逐条说明；资格审核｜服务状态｜回避关系三个分区；档案表单。
 * 四类修改共用一个 version：命令 409 时重读，已是目标状态按成功说明；档案 409 时保留输入并列出对照（E8 同式）。
 * 资料为人工维护、未核验；不显示在途任务数（E6）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { replaceConflicts, reviewQualification, setServiceStatus, updateExpert, type ExpertConflict, type ExpertOptions, type ExpertRecord } from '@/api/expertOperations'
import { apiFailure } from '@/api/failure'
import CatalogMultiSelect from '@/components/app/CatalogMultiSelect.vue'
import ConfirmDialog from '@/components/workspace/ConfirmDialog.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'

import { accountActive, availability, bucket, profileDiff, profileErrors, profileFrom, qualificationText, serviceText, toProfile, type ProfileForm } from './expertView'

const props = defineProps<{ expert: ExpertRecord; options: ExpertOptions; reload: () => Promise<ExpertRecord[] | null> }>()

let alive = true
onBeforeUnmount(() => (alive = false))
const flash = ref('')
const notice = ref('')
const busy = ref(false)
const fresh = (rows: ExpertRecord[] | null) => rows?.find((row) => row.id === props.expert.id)
const avail = computed(() => availability(props.expert))
const schoolName = (id: string) => props.options.schools.find((school) => school.id === id)?.name ?? '学校已不可见'
const disciplineName = (code: string) => props.options.disciplines.find((item) => item.code === code)?.name ?? code
const checkedAt = computed(() => {
  const at = props.expert.source_checked_at ? new Date(props.expert.source_checked_at) : null
  return at && !Number.isNaN(at.getTime()) ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}` : ''
})

// ---- 资格与服务：每次变更要理由 ----
type Decision = 'APPROVED' | 'REJECTED' | 'UNAVAILABLE' | 'AVAILABLE'
const decision = ref<Decision | null>(null)
const reason = ref('')
const reasonTried = ref(false)
const decisionError = ref('')
const reasonError = computed(() => (!reasonTried.value ? '' : !reason.value.trim() ? '请填写原因。' : reason.value.trim().length > 500 ? '原因不超过 500 个字。' : ''))
const copy = computed(() => {
  const name = props.expert.display_name
  return decision.value && {
    APPROVED: { title: '资格通过', body: `通过后，${name}在可接单且账号正常时会出现在派单候选中。`, cta: '通过', danger: false, label: '审核依据', done: '资格已通过。可接单且账号正常时，会出现在派单候选中。' },
    REJECTED: { title: '资格不通过', body: `不通过的专家不会出现在派单候选中；已接的任务不受影响。`, cta: '不通过', danger: true, label: '不通过的原因', done: '已记为资格未通过，不会出现在派单候选中。' },
    UNAVAILABLE: { title: '暂停接单', body: `暂停后，${name}不再出现在派单候选中；已接的任务继续，不受影响。`, cta: '暂停接单', danger: false, label: '暂停原因', done: '已暂停接单。已接的任务不受影响。' },
    AVAILABLE: { title: '恢复接单', body: `恢复后，${name}在资格通过时重新出现在派单候选中。`, cta: '恢复接单', danger: false, label: '恢复原因', done: '已恢复接单。' },
  }[decision.value]
})
function ask(next: Decision) {
  decision.value = next
  reason.value = ''
  reasonTried.value = false
  decisionError.value = ''
}
async function decide() {
  reasonTried.value = true
  const target = decision.value
  const text = copy.value
  if (!target || !text || reasonError.value || busy.value) return
  const qualification = target === 'APPROVED' || target === 'REJECTED'
  busy.value = true
  flash.value = ''
  notice.value = ''
  decisionError.value = ''
  try {
    const body = { version: props.expert.version, reason: reason.value.trim() }
    if (qualification) await reviewQualification(props.expert.id, { ...body, status: target }, { quiet: true })
    else await setServiceStatus(props.expert.id, { ...body, status: target }, { quiet: true })
    if (!alive) return
    decision.value = null
    flash.value = text.done
    await props.reload()
  } catch (cause) {
    if (!alive) return
    const failure = apiFailure(cause)
    if (failure.status !== 409 && failure.status !== 404) {
      decisionError.value = failure.message
      return
    }
    const row = fresh(await props.reload())
    if (!alive) return
    decision.value = null
    if (row && (qualification ? row.qualification_status : row.service_status) === target) flash.value = text.done
    else if (row) notice.value = `没有保存：这位专家的资料刚被修改，已读回最新状态（${qualification ? qualificationText[row.qualification_status] : serviceText[row.service_status]}）。请确认后重新操作。`
  } finally {
    if (alive) busy.value = false
  }
}

// ---- 回避关系：增删即整组保存 ----
const newConflict = ref<{ kind: ExpertConflict['kind']; school: string; name: string }>({ kind: 'TENANT_ID', school: '', name: '' })
const conflictError = ref('')
const freeSchools = computed(() => props.options.schools.filter((school) => !props.expert.conflicts.some((item) => item.kind === 'TENANT_ID' && item.value === school.id)))
const newValue = computed(() => (newConflict.value.kind === 'TENANT_ID' ? newConflict.value.school : newConflict.value.name.trim()))
const nameTooLong = computed(() => newConflict.value.kind === 'SUPERVISOR_NAME' && newConflict.value.name.trim().length > 128)
const duplicate = computed(() => props.expert.conflicts.some((item) => item.kind === newConflict.value.kind && item.value === newValue.value))
async function saveConflicts(items: ExpertConflict[], done: string) {
  if (busy.value) return false
  busy.value = true
  flash.value = ''
  notice.value = ''
  conflictError.value = ''
  try {
    await replaceConflicts(props.expert.id, { version: props.expert.version, items }, { quiet: true })
    if (!alive) return false
    flash.value = done
    await props.reload()
    return true
  } catch (cause) {
    if (!alive) return false
    const failure = apiFailure(cause)
    if (failure.status === 409 || failure.status === 404) {
      await props.reload()
      if (alive) conflictError.value = '回避关系没有保存：这位专家的资料刚被修改，已读回最新，请重新操作。'
    } else conflictError.value = failure.message
    return false
  } finally {
    if (alive) busy.value = false
  }
}
async function addConflict() {
  if (!newValue.value || nameTooLong.value || duplicate.value) return
  const item = { kind: newConflict.value.kind, value: newValue.value }
  const label = item.kind === 'TENANT_ID' ? schoolName(item.value) : item.value
  if (await saveConflicts([...props.expert.conflicts, item], `已添加回避：${label}。之后的派单候选会排除对应论文。`)) newConflict.value = { kind: newConflict.value.kind, school: '', name: '' }
}
function removeConflict(target: ExpertConflict) {
  const label = target.kind === 'TENANT_ID' ? schoolName(target.value) : target.value
  void saveConflicts(props.expert.conflicts.filter((item) => !(item.kind === target.kind && item.value === target.value)), `已移除回避：${label}。`)
}

// ---- 档案 ----
const form = ref<ProfileForm>(profileFrom(props.expert))
const formErrors = ref<Partial<Record<keyof ProfileForm, string>>>({})
const profileConflict = ref(false)
const saving = ref(false)
const saveError = ref('')
const diff = computed(() => profileDiff(form.value, props.expert, props.options.disciplines))
const dirty = computed(() => diff.value.length > 0)
const provinces = computed(() => (form.value.province_name && !props.options.provinces.includes(form.value.province_name) ? [form.value.province_name, ...props.options.provinces] : props.options.provinces))
watch(() => props.expert, (next, prev) => {
  if (!profileConflict.value && prev && !profileDiff(form.value, prev).length) form.value = profileFrom(next)
})
async function saveProfile() {
  formErrors.value = profileErrors(form.value)
  if (saving.value || busy.value || !dirty.value || Object.keys(formErrors.value).length) return
  saving.value = true
  saveError.value = ''
  flash.value = ''
  notice.value = ''
  try {
    const next = await updateExpert(props.expert.id, { ...toProfile(form.value), version: props.expert.version }, { quiet: true })
    if (!alive) return
    profileConflict.value = false
    form.value = profileFrom(next)
    flash.value = '档案已保存，“最近人工维护”时间已更新。'
    await props.reload()
  } catch (cause) {
    if (!alive) return
    const failure = apiFailure(cause)
    if (failure.status === 409) {
      profileConflict.value = true
      await props.reload()
    } else saveError.value = failure.message
  } finally {
    if (alive) saving.value = false
  }
}
function takeTheirs() {
  profileConflict.value = false
  form.value = profileFrom(props.expert)
  formErrors.value = {}
}
function keepMine() {
  profileConflict.value = false
  void saveProfile()
}
</script>

<template>
  <div class="wsd-obj">
    <header class="wsd-obj__head">
      <h2 class="wsd-obj__title">{{ expert.display_name }}<span v-if="expert.title" class="muted sub">　{{ expert.title }}</span></h2>
      <dl class="wsd-obj__meta">
        <div><dt>单位</dt><dd>{{ expert.unit || '未填写' }}</dd></div>
        <div><dt>登录名</dt><dd>{{ expert.username }}</dd></div>
        <div><dt>账号</dt><dd>{{ accountActive(expert) ? '正常' : '不可登录' }}</dd></div>
      </dl>
      <p class="avail" :class="`avail--${avail.tone}`" role="status" data-availability>{{ avail.text }}</p>
      <RouterLink v-if="bucket(expert) === 'ready'" class="btn btn--sm dispatch" to="/platform/dispatch">去派单台</RouterLink>
    </header>

    <div v-if="flash" class="wsd-banner wsd-banner--ok" role="status">{{ flash }}</div>
    <div v-if="notice" class="wsd-banner wsd-banner--danger" role="alert">{{ notice }}</div>

    <div class="three">
      <section class="wsd-sec" :class="{ 'wsd-sec--attention': expert.qualification_status === 'PENDING' }" aria-labelledby="q-h" data-qualification>
        <div class="wsd-sec__head">
          <h3 id="q-h">资格审核</h3>
          <StatusPill :tone="expert.qualification_status === 'APPROVED' ? 'success' : expert.qualification_status === 'PENDING' ? 'action' : 'neutral'">{{ qualificationText[expert.qualification_status] }}</StatusPill>
        </div>
        <p class="wsd-hint">决定能否被派单。依据档案中的职称、导师资格与来源。</p>
        <div class="wsd-acts">
          <template v-if="expert.qualification_status === 'PENDING'">
            <button type="button" class="btn btn--primary btn--sm" data-action="approve" :disabled="busy" @click="ask('APPROVED')">通过…</button>
            <button type="button" class="btn btn--sm" data-action="reject" :disabled="busy" @click="ask('REJECTED')">不通过…</button>
          </template>
          <button v-else-if="expert.qualification_status === 'APPROVED'" type="button" class="btn btn--sm" data-action="reject" :disabled="busy" @click="ask('REJECTED')">改为不通过…</button>
          <button v-else type="button" class="btn btn--sm" data-action="approve" :disabled="busy" @click="ask('APPROVED')">改为通过…</button>
        </div>
      </section>
      <section class="wsd-sec" aria-labelledby="s-h" data-service>
        <div class="wsd-sec__head">
          <h3 id="s-h">服务状态</h3>
          <StatusPill :tone="expert.service_status === 'AVAILABLE' ? 'success' : 'warning'">{{ serviceText[expert.service_status] }}</StatusPill>
        </div>
        <p class="wsd-hint">本人是否接新任务，例如出差或休假时暂停。不影响已接的任务。</p>
        <div class="wsd-acts">
          <button v-if="expert.service_status === 'AVAILABLE'" type="button" class="btn btn--sm" data-action="pause" :disabled="busy" @click="ask('UNAVAILABLE')">暂停接单…</button>
          <button v-else type="button" class="btn btn--sm btn--outline" data-action="resume" :disabled="busy" @click="ask('AVAILABLE')">恢复接单…</button>
        </div>
      </section>
      <section class="wsd-sec" aria-labelledby="c-h" data-conflicts>
        <div class="wsd-sec__head"><h3 id="c-h">回避关系</h3><span class="muted num">{{ expert.conflicts.length }} 项</span></div>
        <p class="wsd-hint">只对这些学校或导师的论文不可派，其他论文照常。</p>
        <ul v-if="expert.conflicts.length" class="clist">
          <li v-for="item in expert.conflicts" :key="`${item.kind}:${item.value}`" :data-conflict-item="item.kind">
            <span><span class="muted">{{ item.kind === 'TENANT_ID' ? '学校' : '导师' }}</span>　{{ item.kind === 'TENANT_ID' ? schoolName(item.value) : item.value }}</span>
            <button type="button" class="btn btn--sm btn--quiet" data-action="remove-conflict" :disabled="busy" :aria-label="`移除回避：${item.kind === 'TENANT_ID' ? schoolName(item.value) : item.value}`" @click="removeConflict(item)">移除</button>
          </li>
        </ul>
        <div class="addc">
          <label><span class="sr-only">回避类型</span>
            <select v-model="newConflict.kind" class="select" data-field="conflict-kind" :disabled="busy"><option value="TENANT_ID">学校</option><option value="SUPERVISOR_NAME">导师姓名</option></select>
          </label>
          <label v-if="newConflict.kind === 'TENANT_ID'"><span class="sr-only">回避学校</span>
            <select v-model="newConflict.school" class="select" data-field="conflict-school" :disabled="busy">
              <option value="">选择学校</option>
              <option v-for="school in freeSchools" :key="school.id" :value="school.id">{{ school.name }}</option>
            </select>
          </label>
          <label v-else><span class="sr-only">回避导师姓名</span><input v-model="newConflict.name" class="input" data-field="conflict-name" placeholder="导师姓名" :disabled="busy" :aria-invalid="nameTooLong" /></label>
          <button type="button" class="btn btn--sm" data-action="add-conflict" :disabled="busy || !newValue || nameTooLong || duplicate" @click="addConflict">添加</button>
        </div>
        <small v-if="nameTooLong" class="field-error">导师姓名不超过 128 个字。</small>
        <small v-else-if="duplicate" class="wsd-hint">已在回避清单中。</small>
        <p v-if="conflictError" class="field-error" role="alert">{{ conflictError }}</p>
      </section>
    </div>

    <section class="wsd-sec" aria-labelledby="p-h" data-profile>
      <div class="wsd-sec__head">
        <h3 id="p-h">档案</h3>
        <p>人工维护，未核验{{ checkedAt ? `；最近维护 ${checkedAt}` : '' }}</p>
      </div>
      <div v-if="profileConflict" class="wsd-banner wsd-banner--danger" role="alert" data-profile-conflict>
        <strong>没有保存：这位专家的资料在你打开之后被修改过</strong>
        <template v-if="diff.length">
          <span>你的修改还在下面的表单里。与当前值不同的字段：</span>
          <table class="wsd-dtable ctable">
            <thead><tr><th scope="col">字段</th><th scope="col">你的修改</th><th scope="col">当前值</th></tr></thead>
            <tbody><tr v-for="row in diff" :key="row.key"><th scope="row">{{ row.label }}</th><td>{{ row.mine }}</td><td>{{ row.theirs }}</td></tr></tbody>
          </table>
        </template>
        <span v-else>对方改的是资格、服务状态或回避关系，档案字段与当前值一致，不需要再保存。</span>
        <div class="wsd-acts">
          <button v-if="diff.length" type="button" class="btn btn--sm btn--primary" data-action="keep-mine" :disabled="saving" @click="keepMine">用我的修改覆盖</button>
          <button type="button" class="btn btn--sm" data-action="take-theirs" :disabled="saving" @click="takeTheirs">{{ diff.length ? '放弃我的修改' : '知道了' }}</button>
        </div>
      </div>
      <div class="wsd-grid2">
        <label class="field">
          <span>单位</span>
          <input v-model="form.unit" class="input" data-field="profile-unit" :disabled="saving" :aria-invalid="Boolean(formErrors.unit)" />
          <small v-if="formErrors.unit" class="field-error">{{ formErrors.unit }}</small>
        </label>
        <label class="field">
          <span>职称</span>
          <input v-model="form.title" class="input" data-field="profile-title" list="profile-titles" :disabled="saving" :aria-invalid="Boolean(formErrors.title)" />
          <datalist id="profile-titles"><option v-for="item in options.titles" :key="item" :value="item" /></datalist>
          <small v-if="formErrors.title" class="field-error">{{ formErrors.title }}</small>
        </label>
        <label class="field">
          <span>省份</span>
          <select v-model="form.province_name" class="select" data-field="profile-province" :disabled="saving">
            <option value="">未填写</option>
            <option v-for="item in provinces" :key="item" :value="item">{{ item }}</option>
          </select>
        </label>
        <div class="field tri">
          <label><span>博导</span>
            <select v-model="form.doctoral_supervisor" class="select" data-field="profile-doctoral" :disabled="saving"><option :value="null">未知</option><option :value="true">是</option><option :value="false">否</option></select>
          </label>
          <label><span>硕导</span>
            <select v-model="form.masters_supervisor" class="select" data-field="profile-masters" :disabled="saving"><option :value="null">未知</option><option :value="true">是</option><option :value="false">否</option></select>
          </label>
        </div>
        <label class="field">
          <span>研究方向</span>
          <input v-model="form.directions" class="input" data-field="profile-directions" :disabled="saving" :aria-invalid="Boolean(formErrors.directions)" />
          <small v-if="formErrors.directions" class="field-error">{{ formErrors.directions }}</small>
          <small v-else>用分号或顿号分隔，每项 2–64 字，最多 20 项</small>
        </label>
        <label class="field">
          <span>关键词</span>
          <input v-model="form.keywords" class="input" data-field="profile-keywords" :disabled="saving" :aria-invalid="Boolean(formErrors.keywords)" />
          <small v-if="formErrors.keywords" class="field-error">{{ formErrors.keywords }}</small>
        </label>
        <label class="field">
          <span>来源链接</span>
          <input v-model="form.source_url" class="input" type="url" data-field="profile-source-url" placeholder="未填写" :disabled="saving" :aria-invalid="Boolean(formErrors.source_url)" />
          <small v-if="formErrors.source_url" class="field-error">{{ formErrors.source_url }}</small>
          <small v-else>只作记录，不会自动读取</small>
        </label>
        <label class="field">
          <span>来源说明</span>
          <input v-model="form.source_note" class="input" data-field="profile-source-note" placeholder="未填写" :disabled="saving" :aria-invalid="Boolean(formErrors.source_note)" />
          <small v-if="formErrors.source_note" class="field-error">{{ formErrors.source_note }}</small>
        </label>
      </div>
      <div class="wsd-wide" data-field="profile-disciplines">
        <CatalogMultiSelect v-model="form.discipline_codes" :options="options.disciplines" label="学科" :disabled="saving" />
        <small v-if="formErrors.discipline_codes" class="field-error">{{ formErrors.discipline_codes }}</small>
        <p v-else class="wsd-hint">现为：{{ expert.discipline_codes.map(disciplineName).join('、') || '未填写' }}</p>
      </div>
      <p v-if="saveError" class="field-error" role="alert">{{ saveError }}</p>
      <div class="wsd-acts wsd-acts--end">
        <span v-if="dirty" class="wsd-hint">有未保存的修改</span>
        <button type="button" class="btn" :disabled="!dirty || saving" @click="takeTheirs">撤销修改</button>
        <button type="button" class="btn btn--primary" data-action="save-profile" :disabled="!dirty || saving || busy || profileConflict" @click="saveProfile">{{ saving ? '正在保存…' : '保存档案' }}</button>
      </div>
    </section>
  </div>

  <ConfirmDialog :open="Boolean(copy)" :title="copy ? copy.title : ''" :busy="busy" @close="busy || (decision = null)">
    <p>{{ copy?.body }}</p>
    <label class="field">
      <span>{{ copy?.label }}（运营内部可见，记入审计）</span>
      <textarea v-model="reason" class="textarea" rows="3" maxlength="600" data-field="decision-reason" :disabled="busy" :aria-invalid="Boolean(reasonError)" />
      <small v-if="reasonError" class="field-error">{{ reasonError }}</small>
    </label>
    <p v-if="decisionError" class="field-error" role="alert">{{ decisionError }}</p>
    <template #actions>
      <button type="button" class="btn" :disabled="busy" @click="decision = null">取消</button>
      <button type="button" class="btn" :class="copy?.danger ? 'btn--danger' : 'btn--primary'" data-action="confirm-decision" :disabled="busy" @click="decide">{{ copy?.cta }}</button>
    </template>
  </ConfirmDialog>
</template>

<style scoped>
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
.dispatch {
  justify-self: start;
}
.three {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
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
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}
.addc {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.addc label {
  flex: 1 1 120px;
  min-width: 0;
}
.tri {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.tri label {
  display: grid;
  gap: 4px;
}
.ctable {
  background: var(--ws-surface);
}
</style>
