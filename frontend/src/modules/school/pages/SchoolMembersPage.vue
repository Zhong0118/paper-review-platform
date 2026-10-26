<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createEligibility, createMember, disableMember, enableMember, listBatches,
  listEligibilities, listMembers, resetMemberPassword, resumeEligibility,
  suspendEligibility, updateMember,
  type MembershipType, type ReviewBatch, type SchoolMember, type StudentEligibility,
} from '@/api/schoolOperations'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

type Tab = 'STUDENT' | 'SUPERVISOR' | 'ELIGIBILITY'
const authStore = useAuthStore()
const tab = ref<Tab>('STUDENT')
const students = ref<SchoolMember[]>([])
const supervisors = ref<SchoolMember[]>([])
const batches = ref<ReviewBatch[]>([])
const eligibilities = ref<StudentEligibility[]>([])
const loading = ref(true)
const saving = ref(false)
const listError = ref('')
const actionError = ref('')
const feedback = ref('')
const formMode = ref<'create-member' | 'edit-member' | 'reset' | 'eligibility' | null>(null)
const selectedMember = ref<SchoolMember | null>(null)
const password = ref('')
const memberForm = reactive({ username: '', displayName: '', externalId: '', phone: '', email: '' })
const eligibilityForm = reactive({ batchId: '', studentId: '', supervisorId: '', degreeType: '' })
const visibleMembers = computed(() => tab.value === 'SUPERVISOR' ? supervisors.value : students.value)
const activeStudents = computed(() => students.value.filter(row => row.is_active && row.status === 'ACTIVE'))
const activeSupervisors = computed(() => supervisors.value.filter(row => row.is_active && row.status === 'ACTIVE'))
const availableBatches = computed(() => batches.value.filter(row => row.status === 'DRAFT' || row.status === 'OPEN'))

function errorText(error: unknown) {
  if ((error as { response?: { status?: number } })?.response?.status === 409) return '数据已变更，请刷新后重试。'
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

async function loadAll() {
  loading.value = true
  listError.value = ''
  students.value = []
  supervisors.value = []
  batches.value = []
  eligibilities.value = []
  try {
    const [studentRows, supervisorRows, batchRows] = await Promise.all([
      listMembers('STUDENT'), listMembers('SUPERVISOR'), listBatches(),
    ])
    const eligibilityGroups = await Promise.all(batchRows.map(row => listEligibilities(row.id)))
    students.value = studentRows
    supervisors.value = supervisorRows
    batches.value = batchRows
    eligibilities.value = eligibilityGroups.flat()
    return true
  } catch (error) {
    listError.value = errorText(error)
    return false
  } finally {
    loading.value = false
  }
}

function selectTab(value: Tab) {
  tab.value = value
  feedback.value = ''
  actionError.value = ''
  closeForm()
}

function closeForm() {
  if (saving.value) return
  formMode.value = null
  selectedMember.value = null
  password.value = ''
}

function openCreateMember() {
  Object.assign(memberForm, { username: '', displayName: '', externalId: '', phone: '', email: '' })
  actionError.value = ''
  feedback.value = ''
  password.value = ''
  formMode.value = 'create-member'
}

function openEditMember(row: SchoolMember) {
  selectedMember.value = row
  Object.assign(memberForm, { username: row.username, displayName: row.display_name, externalId: row.external_id, phone: row.contact_phone ?? '', email: row.contact_email ?? '' })
  actionError.value = ''
  feedback.value = ''
  formMode.value = 'edit-member'
}

function openReset(row: SchoolMember) {
  selectedMember.value = row
  password.value = ''
  actionError.value = ''
  feedback.value = ''
  formMode.value = 'reset'
}

function openEligibility() {
  Object.assign(eligibilityForm, { batchId: '', studentId: '', supervisorId: '', degreeType: '' })
  actionError.value = ''
  feedback.value = ''
  formMode.value = 'eligibility'
}

async function submitMember() {
  if (saving.value || (tab.value !== 'STUDENT' && tab.value !== 'SUPERVISOR')) return
  saving.value = true
  actionError.value = ''
  try {
    await createMember({
      membership_type: tab.value as MembershipType,
      username: memberForm.username.trim(), display_name: memberForm.displayName.trim(),
      external_id: memberForm.externalId.trim(), password: password.value,
    }, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    if (await loadAll()) feedback.value = '成员已建立。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    password.value = ''
    saving.value = false
  }
}

async function submitEdit() {
  if (!selectedMember.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await updateMember(selectedMember.value.membership_id, {
      display_name: memberForm.displayName.trim(),
      contact_phone: memberForm.phone.trim() || null,
      contact_email: memberForm.email.trim() || null,
      expected_updated_at: selectedMember.value.updated_at,
    })
    formMode.value = null
    if (await loadAll()) feedback.value = '成员信息已更新。'
  } catch (error) {
    actionError.value = errorText(error)
    if ((error as { response?: { status?: number } })?.response?.status === 409) {
      formMode.value = null
      selectedMember.value = null
      await loadAll()
    }
  } finally {
    saving.value = false
  }
}

async function submitReset() {
  if (!selectedMember.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await resetMemberPassword(selectedMember.value.membership_id, password.value, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    if (await loadAll()) feedback.value = '密码已重置。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    password.value = ''
    saving.value = false
  }
}

async function changeMemberStatus(row: SchoolMember) {
  if (saving.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const options = { idempotencyKey: crypto.randomUUID() }
    if (row.is_active) await disableMember(row.membership_id, options)
    else await enableMember(row.membership_id, options)
    if (await loadAll()) feedback.value = '成员状态已更新。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

async function submitEligibility() {
  if (saving.value || !eligibilityForm.batchId || !eligibilityForm.studentId) return
  saving.value = true
  actionError.value = ''
  try {
    await createEligibility(eligibilityForm.batchId, {
      student_membership_id: eligibilityForm.studentId,
      supervisor_membership_id: eligibilityForm.supervisorId || null,
      degree_type: eligibilityForm.degreeType.trim() || null,
    }, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    if (await loadAll()) feedback.value = '送审资格已建立。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

async function changeEligibilityStatus(row: StudentEligibility) {
  if (saving.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const options = { idempotencyKey: crypto.randomUUID() }
    if (row.status === 'ELIGIBLE') await suspendEligibility(row.id, options)
    else await resumeEligibility(row.id, options)
    if (await loadAll()) feedback.value = '资格状态已更新。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

function batchName(id: string) {
  return batches.value.find(row => row.id === id)?.name ?? '未知批次'
}

onMounted(loadAll)
</script>

<template>
  <PortalLayout :menu-items="portalMenus('school_reviewer', false)" active-path="/school/members" :context-label="'学校端 · ' + (authStore.user?.tenantCode ?? '本校')" :user-name="authStore.user?.displayName ?? '学校管理员'" :background-locked="Boolean(formMode)">
    <section class="members-page">
      <PageHeader eyebrow="PAGE-025 · MEMBERS & ELIGIBILITY" title="成员与送审资格" description="维护本校学生、导师及各批次送审资格；历史资格快照不会随成员更名而变化。" />
      <BlindRail audience="本校成员和送审资格" hidden-from="其他学校成员、专家身份和论文正文" stage="学校运营" />
      <div class="toolbar"><div class="tabs" role="tablist" aria-label="成员与资格"><button type="button" data-action="tab-student" :aria-selected="tab === 'STUDENT'" @click="selectTab('STUDENT')">学生</button><button type="button" data-action="tab-supervisor" :aria-selected="tab === 'SUPERVISOR'" @click="selectTab('SUPERVISOR')">导师</button><button type="button" data-action="tab-eligibility" :aria-selected="tab === 'ELIGIBILITY'" @click="selectTab('ELIGIBILITY')">送审资格</button></div><button type="button" data-action="reload-members" :disabled="loading" @click="loadAll">刷新</button></div>
      <p v-if="loading" role="status">正在加载成员与资格…</p>
      <div v-else-if="listError" role="alert"><p>{{ listError }}</p><button type="button" @click="loadAll">重新加载</button></div>
      <template v-else>
        <template v-if="tab !== 'ELIGIBILITY'">
          <div class="section-heading"><h2>{{ tab === 'STUDENT' ? '学生账号' : '导师账号' }}</h2><button type="button" data-action="new-member" @click="openCreateMember">新增{{ tab === 'STUDENT' ? '学生' : '导师' }}</button></div>
          <p v-if="visibleMembers.length === 0" class="empty">暂无成员。</p>
          <ul v-else class="rows"><li v-for="row in visibleMembers" :key="row.membership_id"><div><strong>{{ row.display_name }}</strong><small>{{ row.username }} · {{ row.external_id }}</small></div><span>{{ row.is_active ? '启用' : '停用' }}</span><div class="actions"><button type="button" data-action="edit-member" :disabled="saving" @click="openEditMember(row)">编辑</button><button type="button" :data-action="row.is_active ? 'disable-member' : 'enable-member'" :disabled="saving" @click="changeMemberStatus(row)">{{ row.is_active ? '停用' : '启用' }}</button><button type="button" data-action="reset-member" :disabled="saving" @click="openReset(row)">重置密码</button></div></li></ul>
        </template>
        <template v-else>
          <div class="section-heading"><h2>批次送审资格</h2><button type="button" data-action="new-eligibility" :disabled="availableBatches.length === 0 || activeStudents.length === 0" @click="openEligibility">建立资格</button></div>
          <p v-if="availableBatches.length === 0" class="empty">当前没有可建立资格的批次。</p>
          <p v-else class="hint">可选批次：{{ availableBatches.map(row => row.name).join('、') }}</p>
          <p v-if="eligibilities.length === 0" class="empty">暂无送审资格。</p>
          <ul v-else class="rows"><li v-for="row in eligibilities" :key="row.id"><div><strong>{{ row.student_name }} · {{ row.student_no }}</strong><small>{{ batchName(row.review_batch_id) }} · {{ row.supervisor_name || '未指定导师' }}</small></div><span>{{ row.status === 'ELIGIBLE' ? '有效' : '已暂停' }}</span><div class="actions"><button type="button" :disabled="saving" @click="changeEligibilityStatus(row)">{{ row.status === 'ELIGIBLE' ? '暂停资格' : '恢复资格' }}</button></div></li></ul>
        </template>
        <p v-if="actionError && !formMode" role="alert">{{ actionError }}</p>
        <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
      </template>
    </section>
    <template #modal>
      <div v-if="formMode" class="dialog-backdrop" @click.self="closeForm">
        <section class="form-dialog" role="dialog" aria-modal="true" aria-label="成员与资格操作">
          <h2>{{ formMode === 'create-member' ? '新增成员' : formMode === 'edit-member' ? '编辑成员' : formMode === 'reset' ? '重置密码' : '建立送审资格' }}</h2>
          <template v-if="formMode === 'create-member'">
            <label>用户名<input v-model="memberForm.username" data-field="member-username" autocomplete="off"></label>
            <label>姓名<input v-model="memberForm.displayName" data-field="member-name"></label>
            <label>成员编号<input v-model="memberForm.externalId" data-field="member-id"></label>
          </template>
          <template v-if="formMode === 'edit-member'">
            <p>{{ memberForm.username }} · {{ memberForm.externalId }}</p>
            <label>姓名<input v-model="memberForm.displayName" data-field="member-name"></label>
            <label>电话<input v-model="memberForm.phone" data-field="member-phone"></label>
            <label>邮箱<input v-model="memberForm.email" data-field="member-email"></label>
          </template>
          <template v-if="formMode === 'eligibility'">
            <label>批次<select v-model="eligibilityForm.batchId" data-field="eligibility-batch"><option value="">请选择</option><option v-for="row in availableBatches" :key="row.id" :value="row.id">{{ row.name }}</option></select></label>
            <label>学生<select v-model="eligibilityForm.studentId" data-field="eligibility-student"><option value="">请选择</option><option v-for="row in activeStudents" :key="row.membership_id" :value="row.membership_id">{{ row.display_name }} · {{ row.external_id }}</option></select></label>
            <label>导师<select v-model="eligibilityForm.supervisorId" data-field="eligibility-supervisor"><option value="">未指定</option><option v-for="row in activeSupervisors" :key="row.membership_id" :value="row.membership_id">{{ row.display_name }}</option></select></label>
            <label>学位类型<input v-model="eligibilityForm.degreeType" data-field="degree-type"></label>
          </template>
          <label v-if="formMode === 'create-member' || formMode === 'reset'">密码<input v-model="password" data-field="password" type="password" autocomplete="new-password" minlength="12"></label>
          <p v-if="actionError" role="alert">{{ actionError }}</p>
          <div class="actions"><button type="button" :disabled="saving" @click="closeForm">取消</button><button v-if="formMode === 'create-member'" type="button" data-action="submit-member" :disabled="saving" @click="submitMember">建立成员</button><button v-else-if="formMode === 'edit-member'" type="button" data-action="submit-edit" :disabled="saving" @click="submitEdit">保存信息</button><button v-else-if="formMode === 'reset'" type="button" data-action="submit-reset" :disabled="saving" @click="submitReset">确认重置</button><button v-else type="button" data-action="submit-eligibility" :disabled="saving || !eligibilityForm.batchId || !eligibilityForm.studentId" @click="submitEligibility">建立资格</button></div>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.members-page{display:grid;gap:1.1rem;max-width:82rem}.toolbar,.section-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.tabs{display:flex;gap:.3rem;border-bottom:1px solid #d8e0e6}.tabs button{padding:.65rem .9rem;border:0;border-bottom:3px solid transparent;background:transparent;color:#586b7c}.tabs button[aria-selected=true]{border-bottom-color:#1b4f8a;color:#1b4f8a;font-weight:700}.toolbar>button,.section-heading button,.form-dialog .actions button:last-child{border:1px solid #1b4f8a;border-radius:.25rem;background:#1b4f8a;color:#fff;padding:.55rem .8rem}.section-heading h2{margin:0;font-size:1.05rem}.rows{list-style:none;margin:0;padding:0;border:1px solid #d8e0e6;background:#fff}.rows li{display:flex;gap:1rem;align-items:center;padding:1rem;border-bottom:1px solid #e6eaed}.rows li:last-child{border-bottom:0}.rows li>div:first-child{flex:1}.rows strong,.rows small{display:block}.rows small{margin-top:.2rem;color:#6d7c87}.actions{display:flex;gap:.45rem;flex-wrap:wrap}.actions button{border:1px solid #b8cbd9;border-radius:.25rem;background:#fff;color:#1b4f8a;padding:.4rem .65rem}.empty,.hint{padding:.9rem;border:1px dashed #cbd7df;color:#687681}.hint{border-style:solid;background:#f7fafc}.feedback{color:#28642d}.dialog-backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:#152b3c99;padding:1rem}.form-dialog{display:grid;gap:.75rem;width:min(34rem,100%);max-height:90vh;overflow:auto;padding:1.4rem;background:#fff;border-radius:.5rem}.form-dialog h2{margin:0}.form-dialog label{display:grid;gap:.25rem;font-size:.78rem;color:#435461}.form-dialog input,.form-dialog select{padding:.55rem;border:1px solid #b8c8d2;border-radius:.25rem;font:inherit}.form-dialog .actions{justify-content:flex-end;margin-top:.5rem}button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:700px){.rows li{flex-wrap:wrap}.toolbar{align-items:stretch;flex-direction:column}}
</style>
