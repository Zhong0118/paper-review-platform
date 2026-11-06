<script setup lang="ts">
/**
 * U4-4 成员与资格（真实模式，P12）：成员清单｜成员对象。
 * 学生、导师、批次与各批资格在这里读取；资格读取失败只影响资格分区与行标。
 * 地址：?view= &q= &member= &new=1。两种模式共用本页（U4-9 删除了旧页）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { apiFailure } from '@/api/failure'
import { listBatches, listEligibilities, listMembers, type ReviewBatch, type SchoolMember, type StudentEligibility } from '@/api/schoolOperations'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import MemberCreate from './MemberCreate.vue'
import MemberObject, { type Snapshot } from './MemberObject.vue'
import { eligibilityState, idLabel } from './memberView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const narrow = useNarrow()

const members = ref<SchoolMember[]>([])
const batches = ref<ReviewBatch[]>([])
const eligibilities = ref<StudentEligibility[] | null>(null)
const eligibilityError = ref('')
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => generation++)

async function load(): Promise<Snapshot | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const [students, supervisors, batchRows] = await Promise.all([
      listMembers('STUDENT', { quiet: true }), listMembers('SUPERVISOR', { quiet: true }), listBatches({ quiet: true }),
    ])
    if (request !== generation) return null
    members.value = [...students, ...supervisors]
    batches.value = batchRows
    const groups = await Promise.allSettled(batchRows.map((batch) => listEligibilities(batch.id, { quiet: true })))
    if (request !== generation) return null
    const failed = groups.find((group) => group.status === 'rejected')
    eligibilities.value = failed ? null : groups.flatMap((group) => (group.status === 'fulfilled' ? group.value : []))
    eligibilityError.value = failed ? apiFailure(failed.reason).message : ''
    return { members: members.value, eligibilities: eligibilities.value }
  } catch (reason) {
    if (request !== generation) return null
    error.value = apiFailure(reason).message
    return null
  } finally {
    if (request === generation) loading.value = false
  }
}
void load()

type ViewKey = 'STUDENT' | 'SUPERVISOR' | 'all'
const views: { key: ViewKey; label: string }[] = [
  { key: 'STUDENT', label: '学生' },
  { key: 'SUPERVISOR', label: '导师' },
  { key: 'all', label: '全部' },
]
const text = (key: string) => (typeof route.query[key] === 'string' ? (route.query[key] as string) : '')
const view = computed<ViewKey>(() => views.find((item) => item.key === route.query.view)?.key ?? 'STUDENT')
const keyword = computed(() => text('q'))
const memberId = computed(() => text('member'))
const creating = computed(() => route.query.new === '1')
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}

const ready = computed(() => !loading.value && !error.value)
const viewTabs = computed(() => views.map((item) => ({ value: item.key, label: item.label, count: ready.value ? countOf(item.key) : undefined })))
const pickView = (key: string) => setQuery({ view: key === 'STUDENT' ? undefined : key, member: undefined })
const countOf = (key: ViewKey) => (key === 'all' ? members.value.length : members.value.filter((row) => row.membership_type === key).length)
const list = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  return members.value.filter((row) =>
    (view.value === 'all' || row.membership_type === view.value) &&
    (!needle || `${row.display_name}${row.external_id}${row.username}`.toLowerCase().includes(needle)))
})
const selected = computed(() => members.value.find((row) => row.membership_id === memberId.value) ?? null)
const activeSupervisors = computed(() => members.value.filter((row) => row.membership_type === 'SUPERVISOR' && row.is_active && row.status === 'ACTIVE'))
const isActive = (row: SchoolMember) => row.is_active && row.status === 'ACTIVE'
function flag(row: SchoolMember) {
  if (!isActive(row)) return { tone: 'neutral' as const, text: '已停用' }
  if (row.membership_type !== 'STUDENT' || !eligibilities.value) return null
  const state = eligibilityState(row.membership_id, eligibilities.value, batches.value)
  return state === 'none' ? { tone: 'warning' as const, text: '无资格' } : state === 'suspended' ? { tone: 'warning' as const, text: '资格暂停' } : null
}

watch([ready, list, narrow], () => {
  if (!ready.value || narrow.value || memberId.value || creating.value || !list.value.length) return
  setQuery({ member: list.value[0]!.membership_id })
})
async function created(member: SchoolMember) {
  await load()
  setQuery({ new: undefined, view: member.membership_type, q: undefined, member: member.membership_id })
}

const signOut = useSignOut()
const nav = computed(() => workspaceNav('school_reviewer', '/school/members'))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="成员与资格" @sign-out="signOut">
      <template #actions>
        <Button v-if="ready" type="button" variant="outline" size="sm" data-action="new-member" @click="setQuery({ new: '1', member: undefined })">新建成员</Button>
      </template>

      <MasterDetail :open="Boolean(memberId) || creating" :narrow="narrow" list-label="成员清单" detail-label="当前成员" back-label="成员清单" @back="setQuery({ member: undefined, new: undefined })">
        <template #list>
          <div class="wsd-lhead">
            <ViewTabs :model-value="view" :views="viewTabs" label="成员类型" @select="pickView" />
            <label>
              <span class="sr-only">搜索成员</span>
              <input class="input" type="search" :value="keyword" placeholder="姓名、学号/工号或账号" :disabled="!ready || !members.length" @input="setQuery({ q: ($event.target as HTMLInputElement).value || undefined, member: undefined })" />
            </label>
            <p v-if="ready && eligibilityError" class="wsd-scope warn" role="status">送审资格没有加载出来，行上不标资格状态。<Button type="button" variant="ghost" size="sm" @click="load">重试</Button></p>
          </div>
          <StatePanel v-if="loading && !members.length" kind="loading" title="正在读取成员…" compact />
          <StatePanel v-else-if="error" kind="error" title="成员没有加载出来" compact>
            {{ error }}
            <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!members.length" kind="empty" title="还没有本校成员" compact>
            先建立学生与导师账号，再为学生建立送审资格。
            <template #actions><Button type="button" @click="setQuery({ new: '1' })">新建成员</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!list.length && keyword.trim()" kind="noresult" :title="`没有匹配“${keyword.trim()}”的成员`" compact>
            <template #actions><Button type="button" variant="outline" @click="setQuery({ q: undefined })">清除搜索</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!list.length" kind="empty" title="这个视图里没有成员" compact />
          <ul v-else class="wsd-tlist">
            <li v-for="row in list" :key="row.membership_id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.membership_id === memberId }" :aria-current="row.membership_id === memberId || undefined" @click="setQuery({ member: row.membership_id, new: undefined })">
                <span class="wsd-titem__top">
                  <span class="wsd-titem__title">{{ row.display_name }}</span>
                  <StatusPill v-if="flag(row)" :tone="flag(row)!.tone">{{ flag(row)!.text }}</StatusPill>
                </span>
                <span class="wsd-titem__meta num">{{ row.membership_type === 'STUDENT' ? '学生' : '导师' }}　{{ idLabel(row.membership_type) }} {{ row.external_id }}　{{ row.username }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StatePanel v-if="ready && members.length" kind="empty" title="从左侧选择一位成员" compact />
        </template>

        <MemberCreate v-if="creating" :initial-type="view === 'SUPERVISOR' ? 'SUPERVISOR' : 'STUDENT'" @created="created" @cancel="setQuery({ new: undefined })" />
        <StatePanel v-else-if="loading && !selected" kind="loading" title="正在读取成员…" />
        <StatePanel v-else-if="error" kind="error" title="成员没有加载出来，暂时不能打开">
          <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!selected" kind="forbidden" title="这个成员已不在本校">
          可能已被另一位学校审核移出，或链接来自其他学校。成员清单已是最新。
          <template #actions><Button type="button" variant="outline" @click="setQuery({ member: undefined })">回到成员清单</Button></template>
        </StatePanel>
        <MemberObject
          v-else
          :key="selected.membership_id"
          :member="selected"
          :batches="batches"
          :eligibilities="eligibilities"
          :eligibility-error="eligibilityError"
          :supervisors="activeSupervisors"
          :reload="load"
        />
      </MasterDetail>
    </AppShell>
  </div>
</template>

<style scoped>
.warn {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: center;
  color: var(--ws-warning);
}
</style>
