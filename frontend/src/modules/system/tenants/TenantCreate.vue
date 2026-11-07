<script setup lang="ts">
/**
 * U4-8 新增学校：官方院校（必选，名称须与官方名录一致）→ 学校代码（默认取院校标识码，可改）→ 根组织 → 首位学校管理员（含工号 E9）。
 * 幂等键在两次提交之间没有任何改动时复用；任一输入变化即换新键（按改动序号判断，密码不进签名）。
 * 409：保留全部输入（密码需重输），请外壳重读学校列表，按代码找到已使用者时给出链接（E15）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { searchInstitutions, type InstitutionOption } from '@/api/catalogs'
import { apiFailure } from '@/api/failure'
import { createTenant, type TenantSummary } from '@/api/systemOperations'

import { codeOwner, emptyTenant, normalCode, tenantErrors, toTenantInput } from './tenantView'

const props = defineProps<{ tenants: TenantSummary[] }>()
const emit = defineEmits<{ created: [tenant: TenantSummary]; cancel: []; open: [id: string]; refresh: [] }>()

let alive = true
onBeforeUnmount(() => (alive = false))

/* 官方院校检索 */
const SEARCH_LIMIT = 100
const q = ref('')
const results = ref<InstitutionOption[]>([])
const searching = ref(false)
const searched = ref('')
const searchError = ref('')
const picked = ref<InstitutionOption | null>(null)
let searchGeneration = 0
async function search() {
  const keyword = q.value.trim()
  if (!keyword) {
    searchError.value = '请输入院校名称或 10 位学校标识码。'
    return
  }
  const request = ++searchGeneration
  searching.value = true
  searchError.value = ''
  try {
    const items = await searchInstitutions(keyword, { quiet: true })
    if (!alive || request !== searchGeneration) return
    results.value = items
    searched.value = keyword
  } catch (reason) {
    if (!alive || request !== searchGeneration) return
    results.value = []
    searched.value = ''
    searchError.value = apiFailure(reason).message
  } finally {
    if (alive && request === searchGeneration) searching.value = false
  }
}

/* 表单 */
const draft = ref(emptyTenant())
const codeTouched = ref(false)
function pick(item: InstitutionOption) {
  picked.value = item
  if (!codeTouched.value) draft.value.code = item.code
}
function repick() {
  picked.value = null
}

const tried = ref(false)
const saving = ref(false)
const failure = ref<{ message: string; code: string; conflict: boolean } | null>(null)
const errors = computed(() => (tried.value ? tenantErrors(draft.value, picked.value) : {}))
const reviewerErrors = computed(() => errors.value.reviewer ?? {})
const owner = computed(() => (failure.value?.conflict ? codeOwner(props.tenants, failure.value.code) : null))
const codeFlagged = computed(() => Boolean(errors.value.code) || Boolean(owner.value && normalCode(draft.value.code) === owner.value.code))

let seq = 0
watch([draft, picked], () => seq++, { deep: true })
let retry: { seq: number; key: string } | null = null

function clearPasswords() {
  draft.value.reviewer.password = ''
  draft.value.reviewer.again = ''
}

async function submit() {
  tried.value = true
  const institution = picked.value
  if (saving.value || !institution || Object.keys(tenantErrors(draft.value, institution)).length) return
  if (retry?.seq !== seq) retry = { seq, key: crypto.randomUUID() }
  const body = toTenantInput(draft.value, institution)
  saving.value = true
  failure.value = null
  try {
    const tenant = await createTenant(body, { idempotencyKey: retry.key, quiet: true })
    if (!alive) return
    retry = null
    clearPasswords()
    emit('created', tenant)
  } catch (reason) {
    if (!alive) return
    const { status, message } = apiFailure(reason)
    if (status !== undefined) {
      retry = null
      clearPasswords()
    }
    failure.value = { message, code: body.code, conflict: status === 409 }
    if (status === 409) emit('refresh')
  } finally {
    if (alive) saving.value = false
  }
}
</script>

<template>
  <div class="wsd-obj create">
    <p class="wsd-hint">建立学校的同时建立首位学校管理员。之后学生、导师与其他成员由学校管理员在本校维护。</p>

    <div v-if="failure" class="wsd-banner wsd-banner--danger" role="alert" data-failure>
      <strong>没有建立：{{ failure.message }}</strong>
      <template v-if="failure.conflict">
        <span v-if="owner">学校代码 {{ owner.code }} 已被{{ owner.name }}使用。如果这就是同一所学校，请到它的详情里新增学校管理员；否则换一个代码。其他内容已保留，密码需要重新输入。</span>
        <span v-else>请换一个学校代码或登录名后再提交。其他内容已保留，密码需要重新输入。</span>
        <div v-if="owner" class="wsd-acts"><button type="button" class="btn btn--sm" data-action="open-owner" @click="emit('open', owner.id)">打开{{ owner.name }}</button></div>
      </template>
      <span v-else>其他内容已保留，可以修改后重新提交。</span>
    </div>

    <section class="wsd-sec" aria-labelledby="in-h">
      <div class="wsd-sec__head"><h3 id="in-h">官方院校</h3><p>名称须与官方名录一致</p></div>
      <template v-if="!picked">
        <div class="search">
          <label class="field">
            <span>院校名称或学校标识码</span>
            <input v-model="q" class="input" type="search" placeholder="例如 农业大学" data-field="institution-search" :disabled="saving" :aria-invalid="Boolean(errors.institution)" @keydown.enter.prevent="search" />
          </label>
          <button type="button" class="btn" data-action="search-institution" :disabled="searching || saving" @click="search">{{ searching ? '检索中…' : '检索' }}</button>
        </div>
        <small v-if="errors.institution" class="field-error">{{ errors.institution }}</small>
        <p v-if="searchError" class="field-error" role="alert">{{ searchError }}</p>
        <ul v-if="results.length" class="pick" aria-label="检索结果">
          <li v-for="item in results" :key="item.code">
            <button type="button" class="pick__item" :data-institution="item.code" @click="pick(item)">
              <span>{{ item.name }}</span><span class="muted num">{{ item.code }}　{{ item.province }}　{{ item.level || '成人高校' }}</span>
            </button>
          </li>
        </ul>
        <p v-if="results.length >= SEARCH_LIMIT" class="wsd-hint">最多显示 {{ SEARCH_LIMIT }} 项，请输入更完整的名称缩小范围。</p>
        <p v-else-if="searched && !results.length" class="wsd-hint">官方名录里没有匹配“{{ searched }}”的院校。名录由“官方基础目录”导入。</p>
      </template>
      <div v-else class="chosen" data-picked>
        <span><strong>{{ picked.name }}</strong><span class="muted num">　{{ picked.code }}　{{ picked.province }}</span></span>
        <button type="button" class="btn btn--sm btn--quiet" data-action="repick" :disabled="saving" @click="repick">重新选择</button>
      </div>
    </section>

    <section class="wsd-sec" aria-labelledby="tc-h">
      <div class="wsd-sec__head"><h3 id="tc-h">学校账号</h3></div>
      <div class="wsd-grid2">
        <label class="field wsd-wide">
          <span>学校代码</span>
          <input v-model="draft.code" class="input num code" data-field="tenant-code" spellcheck="false" :disabled="saving" :aria-invalid="codeFlagged" @input="codeTouched = true" />
          <small>默认取学校标识码；2–32 位小写字母、数字或短横线，登录与接口里使用，建立后不建议更改</small>
          <small v-if="errors.code" class="field-error">{{ errors.code }}</small>
        </label>
        <label class="field">
          <span>根组织编号</span>
          <input v-model="draft.org_id" class="input num" placeholder="例如 GS" data-field="org-id" :disabled="saving" :aria-invalid="Boolean(errors.org_id)" />
          <small v-if="errors.org_id" class="field-error">{{ errors.org_id }}</small>
        </label>
        <label class="field">
          <span>根组织名称</span>
          <input v-model="draft.org_name" class="input" placeholder="例如 研究生院" data-field="org-name" :disabled="saving" :aria-invalid="Boolean(errors.org_name)" />
          <small v-if="errors.org_name" class="field-error">{{ errors.org_name }}</small>
        </label>
      </div>
    </section>

    <section class="wsd-sec" aria-labelledby="fr-h">
      <div class="wsd-sec__head"><h3 id="fr-h">首位学校管理员</h3></div>
      <div class="wsd-grid2">
        <label class="field">
          <span>姓名</span>
          <input v-model="draft.reviewer.display_name" class="input" data-field="reviewer-name" :disabled="saving" :aria-invalid="Boolean(reviewerErrors.display_name)" />
          <small v-if="reviewerErrors.display_name" class="field-error">{{ reviewerErrors.display_name }}</small>
        </label>
        <label class="field">
          <span>工号</span>
          <input v-model="draft.reviewer.external_id" class="input num" data-field="reviewer-staff" :disabled="saving" :aria-invalid="Boolean(reviewerErrors.external_id)" />
          <small v-if="reviewerErrors.external_id" class="field-error">{{ reviewerErrors.external_id }}</small>
        </label>
        <label class="field wsd-wide">
          <span>登录名</span>
          <input v-model="draft.reviewer.username" class="input num" autocomplete="off" spellcheck="false" data-field="reviewer-username" :disabled="saving" :aria-invalid="Boolean(reviewerErrors.username)" />
          <small v-if="reviewerErrors.username" class="field-error">{{ reviewerErrors.username }}</small>
        </label>
        <label class="field">
          <span>初始密码</span>
          <input v-model="draft.reviewer.password" class="input" type="password" autocomplete="new-password" data-field="reviewer-password" :disabled="saving" :aria-invalid="Boolean(reviewerErrors.password)" />
          <small>至少 12 位，提交后不再显示</small>
        </label>
        <label class="field">
          <span>再次输入</span>
          <input v-model="draft.reviewer.again" class="input" type="password" autocomplete="new-password" data-field="reviewer-again" :disabled="saving" :aria-invalid="Boolean(reviewerErrors.password)" />
          <small v-if="reviewerErrors.password" class="field-error">{{ reviewerErrors.password }}</small>
        </label>
      </div>
    </section>

    <div class="wsd-acts wsd-acts--end">
      <button type="button" class="btn" :disabled="saving" @click="emit('cancel')">取消</button>
      <button type="button" class="btn btn--primary" data-action="submit-tenant" :disabled="saving" @click="submit">{{ saving ? '正在建立…' : '建立学校' }}</button>
    </div>
  </div>
</template>

<style scoped>
.create {
  max-width: 760px;
}
.muted {
  color: var(--ws-muted);
}
.search {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.search .field {
  flex: 1;
}
.code {
  max-width: 320px;
}
.pick {
  display: grid;
  max-height: 280px;
  margin: 0;
  padding: 0;
  overflow: auto;
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
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  padding: 8px 12px;
  border: 0;
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.pick__item:hover,
.pick__item:focus-visible {
  background: var(--ws-sunken);
}
.chosen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius);
  background: var(--ws-sunken);
}
</style>
