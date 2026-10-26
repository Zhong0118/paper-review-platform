<script setup lang="ts">
import OfficialCatalogImport from '@/components/app/OfficialCatalogImport.vue'
import InstitutionSelector from '@/components/app/InstitutionSelector.vue'
import type { InstitutionOption } from '@/api/catalogs'
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createReviewer, createTenant, disableReviewer, enableReviewer, listReviewers, listTenants,
  resetReviewerPassword, resumeTenant, suspendTenant,
  type SchoolReviewer, type TenantSummary,
} from '@/api/systemOperations'
import BlindRail from '@/components/app/BlindRail.vue'
import PageHeader from '@/components/app/PageHeader.vue'
import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'

const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true'
const authStore = useAuthStore()
const rows = ref<TenantSummary[]>([])
const reviewers = ref<SchoolReviewer[]>([])
const selectedId = ref<string | null>(null)
const selected = computed(() => rows.value.find(row => row.id === selectedId.value) ?? null)
const loading = ref(!demoEnabled)
const reviewerLoading = ref(false)
const saving = ref(false)
const listError = ref('')
const reviewerError = ref('')
const actionError = ref('')
const feedback = ref('')
const formMode = ref<'tenant' | 'reviewer' | 'reset' | null>(null)
const resetTarget = ref<SchoolReviewer | null>(null)
const password = ref('')
const institution = ref<InstitutionOption|null>(null)
const tenantForm = reactive({ code: '', name: '', orgId: '', orgName: '', username: '', reviewerName: '', reviewerId: '' })
const reviewerForm = reactive({ username: '', displayName: '', externalId: '' })
let reviewerGeneration = 0
const demoRows = [
  { code: 'HYU', name: '海岳大学', status: '正常', admins: 3 },
  { code: 'DJUT', name: '东江理工大学', status: '试用', admins: 2 },
]

function errorText(error: unknown) {
  if ((error as { response?: { status?: number } })?.response?.status === 409) return '数据已变更，请刷新后重试。'
  return error instanceof Error ? error.message : '操作未完成，请重试。'
}

async function loadTenants() {
  if (demoEnabled) return true
  reviewerGeneration += 1
  reviewerLoading.value = false
  reviewerError.value = ''
  loading.value = true
  listError.value = ''
  rows.value = []
  try {
    rows.value = await listTenants()
    if (!rows.value.some(row => row.id === selectedId.value)) {
      reviewerGeneration += 1
      selectedId.value = null
      reviewers.value = []
    }
    return true
  } catch (error) {
    listError.value = errorText(error)
    reviewerGeneration += 1
    selectedId.value = null
    reviewers.value = []
    return false
  } finally {
    loading.value = false
  }
}

async function loadReviewers() {
  const tenantId = selectedId.value
  if (!tenantId) return
  const generation = ++reviewerGeneration
  const isCurrent = () => generation === reviewerGeneration && selectedId.value === tenantId
  reviewerLoading.value = true
  reviewerError.value = ''
  reviewers.value = []
  try {
    const loaded = await listReviewers(tenantId)
    if (isCurrent()) reviewers.value = loaded
  } catch (error) {
    if (isCurrent()) reviewerError.value = errorText(error)
  } finally {
    if (isCurrent()) reviewerLoading.value = false
  }
}

async function selectTenant(id: string) {
  selectedId.value = id
  feedback.value = ''
  await loadReviewers()
}

function closeForm() {
  if (saving.value) return
  formMode.value = null
  resetTarget.value = null
  password.value = ''
  actionError.value = ''
}

function openForm(mode: 'tenant' | 'reviewer' | 'reset', target: SchoolReviewer | null = null) {
  password.value = ''
  actionError.value = ''
  feedback.value = ''
  resetTarget.value = target
  if(mode==='tenant') institution.value=null
  formMode.value = mode
}

async function submitTenant() {
  if (saving.value) return
  if (!institution.value) { actionError.value='请先选择官方院校。'; return }
  saving.value = true
  actionError.value = ''
  try {
    await createTenant({
      code: institution.value.code,
      institution_code: institution.value.code, name: institution.value.name,
      organization: { external_id: tenantForm.orgId.trim(), name: tenantForm.orgName.trim() },
      reviewer: {
        username: tenantForm.username.trim(), display_name: tenantForm.reviewerName.trim(),
        external_id: tenantForm.reviewerId.trim(), password: password.value,
      },
    }, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    Object.assign(tenantForm, { code: '', name: '', orgId: '', orgName: '', username: '', reviewerName: '', reviewerId: '' })
    if (await loadTenants()) feedback.value = '学校已建立。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    password.value = ''
    saving.value = false
  }
}

async function submitReviewer() {
  if (!selectedId.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await createReviewer(selectedId.value, {
      username: reviewerForm.username.trim(), display_name: reviewerForm.displayName.trim(),
      external_id: reviewerForm.externalId.trim(), password: password.value,
    }, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    Object.assign(reviewerForm, { username: '', displayName: '', externalId: '' })
    if (await loadTenants()) await loadReviewers()
    feedback.value = '管理员已建立。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    password.value = ''
    saving.value = false
  }
}

async function submitReset() {
  if (!selectedId.value || !resetTarget.value || saving.value) return
  saving.value = true
  actionError.value = ''
  try {
    await resetReviewerPassword(selectedId.value, resetTarget.value.user_id, password.value, { idempotencyKey: crypto.randomUUID() })
    formMode.value = null
    await loadReviewers()
    feedback.value = '密码已重置。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    password.value = ''
    saving.value = false
  }
}

async function changeTenantStatus(action: 'SUSPEND' | 'RESUME') {
  if (!selectedId.value || saving.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const options = { idempotencyKey: crypto.randomUUID() }
    if (action === 'SUSPEND') await suspendTenant(selectedId.value, options)
    else await resumeTenant(selectedId.value, options)
    if (await loadTenants()) await loadReviewers()
    feedback.value = action === 'SUSPEND' ? '学校已暂停。' : '学校已恢复。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

async function changeReviewerStatus(row: SchoolReviewer) {
  if (!selectedId.value || saving.value) return
  saving.value = true
  actionError.value = ''
  feedback.value = ''
  try {
    const options = { idempotencyKey: crypto.randomUUID() }
    if (row.is_active) await disableReviewer(selectedId.value, row.user_id, options)
    else await enableReviewer(selectedId.value, row.user_id, options)
    if (await loadTenants()) await loadReviewers()
    feedback.value = '管理员状态已更新。'
  } catch (error) {
    actionError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

onMounted(loadTenants)
</script>

<template>
  <PortalLayout :menu-items="portalMenus('system_admin', demoEnabled)" active-path="/system/tenants" context-label="系统管理端" :user-name="authStore.user?.displayName ?? '系统管理员'" :background-locked="Boolean(formMode)">
    <section class="tenant-page">
      <OfficialCatalogImport v-if="!demoEnabled" />
      <PageHeader eyebrow="PAGE-017 · TENANT & RBAC" title="租户与权限" description="建立学校及首个管理员，维护学校状态与管理员账号。">
        <template #actions><button v-if="!demoEnabled" type="button" data-action="new-tenant" @click="openForm('tenant')">新增学校</button></template>
      </PageHeader>
      <BlindRail audience="学校与管理员账号元数据" hidden-from="论文正文、学生材料和评审内容" stage="组织隔离 · RBAC" />
      <section v-if="demoEnabled" class="tenant-list">
        <article v-for="item in demoRows" :key="item.code"><strong>{{ item.name }}</strong><code>{{ item.code }}</code><span>{{ item.status }}</span><span>{{ item.admins }} 名管理员</span></article>
      </section>
      <template v-else>
        <div class="section-heading"><h2>学校租户</h2><button type="button" data-action="reload-tenants" :disabled="loading" @click="loadTenants">刷新</button></div>
        <p v-if="loading" role="status">正在加载学校租户…</p>
        <p v-else-if="listError" role="alert">{{ listError }}</p>
        <p v-else-if="rows.length === 0" class="empty">尚无学校租户，可建立首个学校。</p>
        <div v-else class="tenant-list">
          <article v-for="item in rows" :key="item.id" :class="{ selected: selectedId === item.id }">
            <div><strong>{{ item.name }}</strong><code>{{ item.code }}</code><small>{{ item.root_organization.name }}</small></div>
            <span>{{ item.status === 'ACTIVE' ? '正常' : '已暂停' }}</span>
            <span>{{ item.reviewer_count }} 名管理员</span>
            <button type="button" data-action="select-tenant" @click="selectTenant(item.id)">管理</button>
          </article>
        </div>
        <section v-if="selected" class="reviewer-panel">
          <div class="section-heading"><div><h2>{{ selected.name }} · 学校管理员</h2><p>只维护账号元数据。</p></div><button type="button" data-action="new-reviewer" :disabled="saving || selected.status !== 'ACTIVE'" @click="openForm('reviewer')">新增管理员</button></div>
          <div class="actions"><button v-if="selected.allowed_actions.includes('SUSPEND')" type="button" data-action="suspend-tenant" :disabled="saving" @click="changeTenantStatus('SUSPEND')">暂停学校</button><button v-if="selected.allowed_actions.includes('RESUME')" type="button" data-action="resume-tenant" :disabled="saving" @click="changeTenantStatus('RESUME')">恢复学校</button></div>
          <p v-if="reviewerLoading" role="status">正在加载管理员…</p>
          <p v-else-if="reviewerError" role="alert">{{ reviewerError }}</p>
          <p v-else-if="reviewers.length === 0" class="empty">尚无管理员。</p>
          <ul v-else class="reviewer-list"><li v-for="reviewer in reviewers" :key="reviewer.user_id"><div><strong>{{ reviewer.display_name }}</strong><small>{{ reviewer.username }} · {{ reviewer.external_id }}</small></div><span>{{ reviewer.is_active ? '启用' : '停用' }}</span><button type="button" :disabled="saving" @click="changeReviewerStatus(reviewer)">{{ reviewer.is_active ? '停用' : '启用' }}</button><button type="button" data-action="reset-reviewer" :disabled="saving" @click="openForm('reset', reviewer)">重置密码</button></li></ul>
        </section>
        <p v-if="feedback" role="status" class="feedback">{{ feedback }}</p>
        <p v-if="actionError && !formMode" role="alert">{{ actionError }}</p>
      </template>
    </section>
    <template #modal>
      <div v-if="formMode" class="dialog-backdrop" @click.self="closeForm">
        <section class="form-dialog" role="dialog" aria-modal="true" :aria-label="formMode === 'tenant' ? '新增学校' : formMode === 'reviewer' ? '新增管理员' : '重置密码'">
          <h2>{{ formMode === 'tenant' ? '新增学校' : formMode === 'reviewer' ? '新增管理员' : '重置密码' }}</h2>
          <template v-if="formMode === 'tenant'">
            <InstitutionSelector v-model="institution" />
            <label>根组织编号<input v-model="tenantForm.orgId" data-field="organization-id"></label>
            <label>根组织名称<input v-model="tenantForm.orgName" data-field="organization-name"></label>
            <label>管理员用户名<input v-model="tenantForm.username" data-field="reviewer-username" autocomplete="off"></label>
            <label>管理员姓名<input v-model="tenantForm.reviewerName" data-field="reviewer-name"></label>
            <label>管理员编号<input v-model="tenantForm.reviewerId" data-field="reviewer-id"></label>
          </template>
          <template v-if="formMode === 'reviewer'">
            <label>用户名<input v-model="reviewerForm.username" autocomplete="off"></label>
            <label>姓名<input v-model="reviewerForm.displayName"></label>
            <label>成员编号<input v-model="reviewerForm.externalId"></label>
          </template>
          <label>密码<input v-model="password" data-field="password" type="password" autocomplete="new-password" minlength="12"></label>
          <p v-if="actionError" role="alert">{{ actionError }}</p>
          <div class="dialog-actions"><button type="button" :disabled="saving" @click="closeForm">取消</button><button v-if="formMode === 'tenant'" type="button" data-action="submit-tenant" :disabled="saving" @click="submitTenant">{{ saving ? '提交中…' : '建立学校' }}</button><button v-else-if="formMode === 'reviewer'" type="button" :disabled="saving" @click="submitReviewer">{{ saving ? '提交中…' : '建立管理员' }}</button><button v-else type="button" data-action="submit-reset" :disabled="saving" @click="submitReset">{{ saving ? '提交中…' : '确认重置' }}</button></div>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.tenant-page{display:grid;gap:1.2rem;max-width:82rem}.tenant-page :deep(.page-header__actions) button,.section-heading button,.dialog-actions button:last-child{border:1px solid #1b4f8a;border-radius:.3rem;background:#1b4f8a;color:#fff;padding:.6rem .9rem;font-weight:650}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem}.section-heading h2{margin:0;font-size:1.05rem;color:#243c50}.section-heading p{margin:.3rem 0 0;color:#687681;font-size:.78rem}.tenant-list,.reviewer-panel{border:1px solid #d8e0e6;background:#fff}.tenant-list article{display:grid;grid-template-columns:minmax(12rem,1fr) 7rem 9rem auto;align-items:center;gap:1rem;padding:1rem;border-bottom:1px solid #e6eaed}.tenant-list article.selected{background:#f3f8fd}.tenant-list article:last-child{border-bottom:0}.tenant-list strong,.tenant-list code,.tenant-list small{display:block}.tenant-list code,.tenant-list small{margin-top:.2rem;color:#6d7c87;font-size:.72rem}.tenant-list button,.reviewer-list button,.actions button{border:1px solid #b8cbd9;border-radius:.25rem;background:#fff;color:#1b4f8a;padding:.4rem .7rem}.reviewer-panel{padding:1rem}.actions{margin:.9rem 0}.reviewer-list{list-style:none;margin:0;padding:0}.reviewer-list li{display:flex;align-items:center;gap:1rem;padding:.7rem 0;border-top:1px solid #e6eaed}.reviewer-list li div{flex:1}.reviewer-list small{display:block;color:#6d7c87}.empty{padding:1.1rem;border:1px dashed #cbd7df;color:#687681}.feedback{color:#28642d}.dialog-backdrop{position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:#152b3c99;padding:1rem}.form-dialog{display:grid;gap:.7rem;width:min(34rem,100%);max-height:90vh;overflow:auto;padding:1.4rem;background:#fff;border-radius:.5rem;box-shadow:0 1rem 3rem #10223140}.form-dialog h2{margin:0 0 .3rem}.form-dialog label{display:grid;gap:.25rem;font-size:.78rem;color:#435461}.form-dialog input{padding:.55rem;border:1px solid #b8c8d2;border-radius:.25rem;font:inherit}.dialog-actions{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.5rem}.dialog-actions button{padding:.6rem .9rem;border:1px solid #b8c8d2;border-radius:.3rem;background:#fff;cursor:pointer}button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:700px){.tenant-list article{grid-template-columns:1fr 1fr}.reviewer-list li{flex-wrap:wrap}}
</style>
