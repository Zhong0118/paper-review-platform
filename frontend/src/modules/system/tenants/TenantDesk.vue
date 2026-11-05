<script setup lang="ts">
/**
 * U4-8 学校管理（真实模式，P14a）：学校表 → 学校详情（?tenant=）/ 新增学校（?new=1）。
 * 筛选写在地址里：?q= 搜索名称或代码，?status= ACTIVE|SUSPENDED。
 * 系统管理员只管理学校与学校管理员账号，不读论文正文；官方目录在 /system/catalog（E10）。
 * demo 模式与旧页 TenantPermissionsPage 不变（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { apiFailure } from '@/api/failure'
import { listTenants, type TenantSummary } from '@/api/systemOperations'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import TenantCreate from './TenantCreate.vue'
import TenantObject from './TenantObject.vue'
import { dateText, isStatus, matchTenant, statusText, statusTone } from './tenantView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const rows = ref<TenantSummary[]>([])
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => generation++)

async function load(): Promise<TenantSummary[] | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const items = await listTenants({ quiet: true })
    if (request !== generation) return null
    rows.value = items
    return items
  } catch (reason) {
    if (request !== generation) return null
    error.value = apiFailure(reason).message
    return null
  } finally {
    if (request === generation) loading.value = false
  }
}
void load()

const query = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const tenantId = computed(() => query('tenant'))
const creating = computed(() => query('new') === '1' && !tenantId.value)
const keyword = computed(() => query('q'))
const status = computed(() => (isStatus(query('status')) ? (query('status') as TenantSummary['status']) : ''))
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}
const open = (id: string) => setQuery({ tenant: id, new: undefined })

const ready = computed(() => !loading.value && !error.value)
const list = computed(() => rows.value.filter((row) => matchTenant(row, keyword.value, status.value)))
const selected = computed(() => rows.value.find((row) => row.id === tenantId.value) ?? null)

/** 操作说明只属于发出它的学校：换学校或回到列表即不再显示。 */
const flash = ref<{ tenant: string; text: string } | null>(null)
const shownFlash = computed(() => (flash.value && flash.value.tenant === tenantId.value ? flash.value.text : ''))
const say = (text: string) => (flash.value = { tenant: tenantId.value, text })
function toList() {
  flash.value = null
  setQuery({ tenant: undefined, new: undefined })
}

async function created(tenant: TenantSummary) {
  flash.value = { tenant: tenant.id, text: `已建立${tenant.name}与首位学校管理员。初始密码不会再显示，请通过线下方式告知本人。` }
  open(tenant.id)
  await load()
}

const nav = computed(() => workspaceNav('system_admin', '/system/tenants'))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '系统管理员', org: '系统管理' }))
</script>

<template>
  <div class="ws">
    <OperationsShell :nav="nav" :account="account" :org="account.org">
      <template #title>
        <h1 class="wsd-title">
          <template v-if="!tenantId && !creating">学校管理</template>
          <template v-else>
            <button type="button" class="crumb" data-action="to-list" @click="toList">学校管理</button><span class="sep" aria-hidden="true"> › </span>{{ creating ? '新增学校' : selected?.name ?? '学校详情' }}
          </template>
        </h1>
      </template>
      <template #context>
        <button v-if="!tenantId && !creating && ready" type="button" class="btn btn--sm btn--primary" data-action="new-tenant" @click="setQuery({ new: '1' })">新增学校</button>
      </template>

      <div class="page">
        <TenantCreate v-if="creating" :tenants="rows" @created="created" @cancel="toList" @open="open" @refresh="load" />

        <template v-else-if="tenantId">
          <StateBlock v-if="loading && !selected" kind="loading" title="正在读取学校…" />
          <StateBlock v-else-if="error && !selected" kind="error" title="学校列表没有加载出来，暂时不能打开">
            {{ error }}
            <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!selected" kind="forbidden" title="这所学校已不可见">
            链接可能已过期。学校列表已是最新。
            <template #actions><button type="button" class="btn" @click="toList">回到学校管理</button></template>
          </StateBlock>
          <TenantObject v-else :key="selected.id" :tenant="selected" :flash="shownFlash" :reload="load" @say="say" />
        </template>

        <div v-else class="wsd-obj">
          <div class="toolbar" role="search">
            <label>
              <span class="sr-only">搜索学校</span>
              <input class="input" type="search" placeholder="学校名称或代码" data-field="tenant-search" :value="keyword" :disabled="!rows.length" @input="setQuery({ q: ($event.target as HTMLInputElement).value })" />
            </label>
            <label>
              <span class="sr-only">状态</span>
              <select class="select" data-field="tenant-status" :value="status" :disabled="!rows.length" @change="setQuery({ status: ($event.target as HTMLSelectElement).value })">
                <option value="">全部状态</option>
                <option value="ACTIVE">正常</option>
                <option value="SUSPENDED">已暂停</option>
              </select>
            </label>
          </div>
          <StateBlock v-if="loading && !rows.length" kind="loading" title="正在读取学校…" />
          <StateBlock v-else-if="error" kind="error" title="学校列表没有加载出来">
            {{ error }}
            <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!rows.length" kind="empty" title="还没有接入的学校">
            新增学校时会同时建立首位学校管理员，之后由学校自己维护成员。
            <template #actions><button type="button" class="btn btn--primary" @click="setQuery({ new: '1' })">新增学校</button></template>
          </StateBlock>
          <StateBlock v-else-if="!list.length" kind="nomatch" title="当前筛选没有匹配的学校">
            <template #actions><button type="button" class="btn" @click="setQuery({ q: undefined, status: undefined })">清除筛选</button></template>
          </StateBlock>
          <template v-else>
            <div class="wsd-twrap">
              <table class="wsd-dtable tenants">
                <thead>
                  <tr>
                    <th scope="col">学校</th>
                    <th scope="col">代码</th>
                    <th scope="col">根组织</th>
                    <th scope="col" class="wsd-n">学校管理员</th>
                    <th scope="col">状态</th>
                    <th scope="col">接入日期</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in list" :key="row.id" :data-tenant="row.id" @click="open(row.id)">
                    <td><button type="button" class="rowlink" @click.stop="open(row.id)">{{ row.name }}</button></td>
                    <td class="num">{{ row.code }}</td>
                    <td>{{ row.root_organization.name }}</td>
                    <td class="wsd-n num">{{ row.reviewer_count }}</td>
                    <td><StatusPill :tone="statusTone(row.status)">{{ statusText[row.status] }}</StatusPill></td>
                    <td class="num">{{ dateText(row.created_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="wsd-scope">共 {{ list.length }} 所{{ list.length !== rows.length ? `（全部 ${rows.length} 所）` : '' }}。系统管理员只管理学校与账号，不读论文正文。</p>
          </template>
        </div>
      </div>
    </OperationsShell>
  </div>
</template>

<style scoped>
.page {
  min-height: calc(100vh - var(--ws-bar));
}
.page > .wsd-obj {
  max-width: 1080px;
}
.crumb {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ws-action);
  font: inherit;
  cursor: pointer;
}
.crumb:hover {
  text-decoration: underline;
}
.sep {
  color: var(--ws-muted);
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
.tenants tbody tr {
  cursor: pointer;
}
.tenants tbody tr:hover {
  background: var(--ws-sunken);
}
.rowlink {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ws-action);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.rowlink:hover {
  text-decoration: underline;
}
</style>
