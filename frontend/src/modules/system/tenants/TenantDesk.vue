<script setup lang="ts">
/**
 * U4-8 学校管理（真实模式，P14a）：学校表 → 学校详情（?tenant=）/ 新增学校（?new=1）。
 * 筛选写在地址里：?q= 搜索名称或代码，?status= ACTIVE|SUSPENDED。
 * 系统管理员只管理学校与学校管理员账号，不读论文正文；官方目录在 /system/catalog（E10）。
 * demo 模式与旧页 TenantPermissionsPage 不变（见 router/routes.ts）。
 */
import { ChevronLeft, Search } from '@lucide/vue'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { apiFailure } from '@/api/failure'
import { listTenants, type TenantSummary } from '@/api/systemOperations'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
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

const signOut = useSignOut()
const onList = computed(() => !tenantId.value && !creating.value)
const shellTitle = computed(() => (onList.value ? '学校管理' : creating.value ? '新增学校' : selected.value?.name ?? '学校详情'))
const nav = computed(() => workspaceNav('system_admin', '/system/tenants'))
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '系统管理员', org: '系统管理' }))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" :layout="onList ? 'data' : 'bare'" :title="shellTitle" @sign-out="signOut">
      <template v-if="!onList" #back>
        <Button variant="ghost" size="sm" class="-ml-1 text-muted-foreground" data-action="to-list" @click="toList"><ChevronLeft />学校管理</Button>
      </template>
      <template v-if="onList" #context>系统管理员只管理学校与账号，不读论文正文</template>
      <template v-if="onList && ready" #actions>
        <Button size="sm" data-action="new-tenant" @click="setQuery({ new: '1' })">新增学校</Button>
      </template>

      <div v-if="!onList" class="page">
        <TenantCreate v-if="creating" :tenants="rows" @created="created" @cancel="toList" @open="open" @refresh="load" />
        <StatePanel v-else-if="loading && !selected" kind="loading" title="正在读取学校…" />
        <StatePanel v-else-if="error && !selected" kind="error" title="学校列表没有加载出来，暂时不能打开">
          {{ error }}
          <template #actions><Button variant="outline" data-action="retry-tenants" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!selected" kind="forbidden" title="这所学校已不可见">
          链接可能已过期。学校列表已是最新。
          <template #actions><Button variant="outline" @click="toList">回到学校管理</Button></template>
        </StatePanel>
        <TenantObject v-else :key="selected.id" :tenant="selected" :flash="shownFlash" :reload="load" @say="say" />
      </div>

      <div v-else class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2" role="search">
          <label class="relative w-full sm:w-[280px]">
            <span class="sr-only">搜索学校</span>
            <Search class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              class="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-base outline-none placeholder:text-faint focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50 [&::-webkit-search-cancel-button]:hidden"
              type="search"
              placeholder="学校名称或代码"
              data-field="tenant-search"
              :value="keyword"
              :disabled="!rows.length"
              @input="setQuery({ q: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label>
            <span class="sr-only">状态</span>
            <select
              class="h-9 w-36 rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:opacity-50"
              data-field="tenant-status"
              :value="status"
              :disabled="!rows.length"
              @change="setQuery({ status: ($event.target as HTMLSelectElement).value })"
            >
              <option value="">全部状态</option>
              <option value="ACTIVE">正常</option>
              <option value="SUSPENDED">已暂停</option>
            </select>
          </label>
        </div>

        <StatePanel v-if="loading && !rows.length" kind="loading" title="正在读取学校…" />
        <StatePanel v-else-if="error" kind="error" title="学校列表没有加载出来">
          {{ error }}
          <template #actions><Button variant="outline" data-action="retry-tenants" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!rows.length" kind="empty" title="还没有接入的学校">
          新增学校时会同时建立首位学校管理员，之后由学校自己维护成员。
          <template #actions><Button @click="setQuery({ new: '1' })">新增学校</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!list.length" kind="noresult" title="当前筛选没有匹配的学校">
          <template #actions><Button variant="outline" @click="setQuery({ q: undefined, status: undefined })">清除筛选</Button></template>
        </StatePanel>
        <template v-else>
          <div class="overflow-x-auto rounded-lg border bg-background">
            <table class="w-full min-w-[720px] border-collapse text-sm">
              <thead class="bg-muted/50 text-left text-muted-foreground">
                <tr class="h-10 border-b">
                  <th scope="col" class="px-4 font-medium">学校</th>
                  <th scope="col" class="px-4 font-medium">代码</th>
                  <th scope="col" class="px-4 font-medium">根组织</th>
                  <th scope="col" class="px-4 text-right font-medium">学校管理员</th>
                  <th scope="col" class="px-4 font-medium">状态</th>
                  <th scope="col" class="px-4 font-medium">接入日期</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in list" :key="row.id" class="h-12 cursor-pointer border-b last:border-b-0 hover:bg-muted/50" :data-tenant="row.id" @click="open(row.id)">
                  <td class="px-4"><button type="button" class="rowlink rounded-sm text-left font-medium text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" @click.stop="open(row.id)">{{ row.name }}</button></td>
                  <td class="tabular px-4 text-muted-foreground">{{ row.code }}</td>
                  <td class="px-4">{{ row.root_organization.name }}</td>
                  <td class="tabular px-4 text-right">{{ row.reviewer_count }}</td>
                  <td class="px-4"><StatusPill :tone="statusTone(row.status)">{{ statusText[row.status] }}</StatusPill></td>
                  <td class="tabular px-4 text-muted-foreground">{{ dateText(row.created_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-sm text-muted-foreground" data-count>共 {{ list.length }} 所{{ list.length !== rows.length ? `（全部 ${rows.length} 所）` : '' }}。</p>
        </template>
      </div>
    </AppShell>
  </div>
</template>

<style scoped>
.page {
  min-height: calc(100svh - var(--bar-h));
}
/* 详情、新增：内容居中 960 */
.page :deep(.wsd-obj) {
  margin-inline: auto;
}
</style>
