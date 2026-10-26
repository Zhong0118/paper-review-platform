<script setup lang="ts">
import CatalogMultiSelect from '@/components/app/CatalogMultiSelect.vue'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import PortalLayout from '@/layouts/PortalLayout.vue'
import { portalMenus } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import {
  createExpert, expertOptions, listExperts, replaceConflicts, reviewQualification,
  setServiceStatus, updateExpert,
  type CreateExpert, type ExpertOptions, type ExpertRecord,
} from '@/api/expertOperations'

const router = useRouter()
const auth = useAuthStore()
const rows = ref<ExpertRecord[]>([])
const options = ref<ExpertOptions>({ schools: [], disciplines: [] })
const loading = ref(true)
const error = ref('')
const feedback = ref('')
const busy = ref(false)
const mode = ref<'create' | 'edit' | 'conflicts' | 'qualification' | 'status' | null>(null)
const selected = ref<ExpertRecord | null>(null)
const create = ref<CreateExpert>({ username: '', display_name: '', initial_password: '', unit: '', title: '', discipline_codes: [] })
const profile = ref({ unit: '', title: '', discipline_codes: [] as string[] })
const schoolIds = ref<string[]>([])
const supervisors = ref('')
const reason = ref('')
const target = ref<'APPROVED' | 'REJECTED' | 'AVAILABLE' | 'UNAVAILABLE'>('APPROVED')
let createKey: string | null = null

function message(value: unknown) {
  return value instanceof Error ? value.message : '操作失败，请稍后重试。'
}

function schoolName(id: string) {
  return options.value.schools.find((school) => school.id === id)?.name ?? id
}

function disciplineName(code: string) {
  return options.value.disciplines.find((item) => item.code === code)?.name ?? code
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [experts, choices] = await Promise.all([listExperts(), expertOptions()])
    rows.value = experts
    options.value = choices
  } catch (cause) {
    rows.value = []
    error.value = message(cause)
  } finally {
    loading.value = false
  }
}

function openCreate() {
  create.value = { username: '', display_name: '', initial_password: '', unit: '', title: '', discipline_codes: [] }
  createKey = null
  selected.value = null
  mode.value = 'create'
  error.value = ''
}

function open(row: ExpertRecord, action: NonNullable<typeof mode.value>, value?: typeof target.value) {
  selected.value = row
  mode.value = action
  error.value = ''
  reason.value = ''
  if (value) target.value = value
  profile.value = { unit: row.unit, title: row.title, discipline_codes: [...row.discipline_codes] }
  schoolIds.value = row.conflicts.filter((item) => item.kind === 'TENANT_ID').map((item) => item.value)
  supervisors.value = row.conflicts.filter((item) => item.kind === 'SUPERVISOR_NAME').map((item) => item.value).join('，')
}

function close() {
  if (!busy.value) mode.value = null
}

function splitCodes(value: string) {
  return value.split(/[,，]/).map((part) => part.trim()).filter(Boolean)
}

async function save() {
  if (busy.value || !mode.value) return
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    if (mode.value === 'create') {
      createKey ??= crypto.randomUUID()
      await createExpert(create.value, { idempotencyKey: createKey })
      createKey = null
    } else {
      const row = selected.value
      if (!row) return
      if (mode.value === 'edit') {
        await updateExpert(row.id, { ...profile.value, version: row.version })
      } else if (mode.value === 'conflicts') {
        await replaceConflicts(row.id, {
          version: row.version,
          items: [
            ...schoolIds.value.map((value) => ({ kind: 'TENANT_ID' as const, value })),
            ...splitCodes(supervisors.value).map((value) => ({ kind: 'SUPERVISOR_NAME' as const, value })),
          ],
        })
      } else if (mode.value === 'qualification') {
        if (!reason.value.trim()) { error.value = '请填写审核理由。'; return }
        await reviewQualification(row.id, { version: row.version, status: target.value as 'APPROVED' | 'REJECTED', reason: reason.value.trim() })
      } else if (mode.value === 'status') {
        if (!reason.value.trim()) { error.value = '请填写变更理由。'; return }
        await setServiceStatus(row.id, { version: row.version, status: target.value as 'AVAILABLE' | 'UNAVAILABLE', reason: reason.value.trim() })
      }
    }
    mode.value = null
    await load()
    if (!error.value) feedback.value = '已保存，列表已从服务器刷新。'
  } catch (cause) {
    if ((cause as { response?: { status?: number } })?.response?.status === 409) {
      mode.value = null
      await load()
      error.value = '数据已变更，列表已刷新。请查看最新状态后重新确认操作。'
    } else {
      error.value = message(cause)
    }
  } finally {
    busy.value = false
  }
}

onMounted(() => { void load() })
</script>

<template>
  <PortalLayout :menu-items="portalMenus('platform_reviewer', false)" active-path="/platform/experts"
    context-label="百杰运营端 · 专家库" :user-name="auth.user?.displayName ?? ''" :background-locked="Boolean(mode)">
    <main class="real-experts">
      <header class="real-experts__header">
        <div><p>PLATFORM · EXPERT DIRECTORY</p><h1>专家库</h1><p>维护专家资格、服务状态与回避；变更仅影响新派单。</p></div>
        <button type="button" data-action="create-expert" @click="openCreate">新增专家</button>
      </header>
      <p v-if="feedback" role="status">{{ feedback }}</p>
      <div v-if="error" role="alert">{{ error }} <button v-if="!mode" type="button" @click="load">重新加载</button></div>
      <p v-if="loading">正在加载专家库…</p>
      <p v-else-if="!rows.length && !error">暂无专家</p>
      <div v-else class="real-experts__list">
        <article v-for="row in rows" :key="row.id" class="real-experts__card" :data-expert-id="row.id">
          <div class="real-experts__identity"><strong>{{ row.display_name }}</strong><span>{{ row.username }}</span></div>
          <p>{{ row.unit }} · {{ row.title }}</p>
          <p>学科：{{ row.discipline_codes.map(disciplineName).join('、') }}</p>
          <p>账号：{{ row.account_status === 'ACTIVE' ? '正常' : row.account_status === 'DISABLED' ? '停用' : '不可用' }}
            · 资格：{{ row.qualification_status === 'APPROVED' ? '已通过' : row.qualification_status === 'REJECTED' ? '已驳回' : '待审核' }}
            · 服务：{{ row.service_status === 'AVAILABLE' ? '可接单' : '暂停接单，不可派单' }}</p>
          <p>回避学校：{{ row.conflicts.filter(item => item.kind === 'TENANT_ID').map(item => schoolName(item.value)).join('、') || '无' }}</p>
          <p>回避导师：{{ row.conflicts.filter(item => item.kind === 'SUPERVISOR_NAME').map(item => item.value).join('、') || '无' }}</p>
          <div class="real-experts__actions">
            <button type="button" @click="open(row, 'edit')">编辑资料</button>
            <button type="button" @click="open(row, 'conflicts')">编辑回避</button>
            <button type="button" @click="open(row, 'qualification', 'APPROVED')">通过资格</button>
            <button type="button" @click="open(row, 'qualification', 'REJECTED')">驳回资格</button>
            <button v-if="row.service_status === 'AVAILABLE'" type="button" data-action="pause-expert" @click="open(row, 'status', 'UNAVAILABLE')">暂停接单</button>
            <button v-else type="button" @click="open(row, 'status', 'AVAILABLE')">恢复接单</button>
            <button v-if="row.account_status === 'ACTIVE' && row.qualification_status === 'APPROVED' && row.service_status === 'AVAILABLE'" type="button" @click="router.push('/platform/dispatch')">前往派单</button>
          </div>
        </article>
      </div>
    </main>
    <template #modal>
      <div v-if="mode" class="real-experts__backdrop" @click.self="close">
        <section role="dialog" aria-modal="true" :aria-label="mode === 'create' ? '新增专家' : '维护专家'" class="real-experts__dialog">
          <h2>{{ mode === 'create' ? '新增专家' : mode === 'edit' ? '编辑专家资料' : mode === 'conflicts' ? '编辑回避' : mode === 'qualification' ? '资格审核' : '服务状态' }}</h2>
          <template v-if="mode === 'create'">
            <label>登录名<input v-model="create.username" data-field="username" @input="createKey = null" /></label>
            <label>姓名<input v-model="create.display_name" data-field="display_name" @input="createKey = null" /></label>
            <label>初始密码<input v-model="create.initial_password" type="password" autocomplete="new-password" data-field="initial_password" @input="createKey = null" /></label>
            <label>单位<input v-model="create.unit" data-field="unit" @input="createKey = null" /></label>
            <label>职称<input v-model="create.title" data-field="title" @input="createKey = null" /></label>
            <CatalogMultiSelect v-model="create.discipline_codes" :options="options.disciplines" label="学科" data-field="discipline_codes" @update:model-value="createKey = null" />
            <p>新专家需资格审核通过后才能派单。</p>
          </template>
          <template v-if="mode === 'edit'">
            <label>单位<input v-model="profile.unit" /></label><label>职称<input v-model="profile.title" /></label>
            <CatalogMultiSelect v-model="profile.discipline_codes" :options="options.disciplines" label="学科" />
          </template>
          <template v-if="mode === 'conflicts'">
            <CatalogMultiSelect v-model="schoolIds" :options="options.schools.map(s=>({code:s.id,name:s.name}))" label="回避学校" />
            <label>回避导师（姓名用逗号分隔）<input v-model="supervisors" /></label>
          </template>
          <template v-if="mode === 'qualification' || mode === 'status'">
            <p>操作：{{ target === 'APPROVED' ? '通过资格' : target === 'REJECTED' ? '驳回资格' : target === 'UNAVAILABLE' ? '暂停接单' : '恢复接单' }}</p>
            <label>理由<textarea v-model="reason" data-field="reason" /></label>
          </template>
          <footer><button type="button" :disabled="busy" @click="close">取消</button>
            <button type="button" :disabled="busy" :data-action="mode === 'status' ? 'save-status' : 'save-expert'" @click="save">{{ busy ? '保存中…' : '确认保存' }}</button></footer>
        </section>
      </div>
    </template>
  </PortalLayout>
</template>

<style scoped>
.real-experts { max-width: 1100px; margin: 0 auto; padding: 28px; }
.real-experts__header, .real-experts__identity, .real-experts__actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.real-experts__header { margin-bottom: 24px; }
.real-experts__header h1 { margin: 4px 0; }
.real-experts__list { display: grid; gap: 16px; }
.real-experts__card { border: 1px solid #d8dfde; background: white; border-radius: 12px; padding: 20px; }
.real-experts__card p { margin: 8px 0; }
.real-experts__actions { justify-content: flex-start; margin-top: 16px; }
.real-experts__backdrop { position: fixed; inset: 0; background: #0008; display: grid; place-items: center; z-index: 100; padding: 20px; }
.real-experts__dialog { background: white; color: #162725; width: min(100%, 560px); max-height: 90vh; overflow: auto; border-radius: 12px; padding: 24px; }
.real-experts__dialog label { display: grid; gap: 4px; margin: 12px 0; }
.real-experts__dialog input, .real-experts__dialog select, .real-experts__dialog textarea { width: 100%; min-height: 38px; box-sizing: border-box; }
.real-experts__dialog select[multiple] { min-height: 100px; }
.real-experts__dialog footer { display: flex; justify-content: flex-end; gap: 12px; }
</style>
