<script setup lang="ts">
/**
 * U4-3 批次与规则（真实模式，P12）：批次清单｜批次对象。地址：?batch= 选中批次，?new=1 新建。
 * 批次、评审规则、校内目录版本在这里各读一次；规则或目录失败只影响各自分区。
 * demo 模式仍走旧页 BatchRulesPage（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { apiFailure } from '@/api/failure'
import type { ReviewRule } from '@/api/review'
import { getSchoolReviewRule, listBatches, type ReviewBatch } from '@/api/schoolOperations'
import { listProgramVersions, type CatalogVersion } from '@/api/schoolPrograms'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import StatusPill from '@/components/workspace/StatusPill.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import BatchCreate from './BatchCreate.vue'
import BatchObject from './BatchObject.vue'
import { batchStatusText, sortBatches } from './batchForm'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const narrow = useNarrow()

const rows = ref<ReviewBatch[]>([])
const loading = ref(true)
const error = ref('')
let generation = 0
let alive = true
onBeforeUnmount(() => {
  alive = false
  generation++
})

async function load(): Promise<ReviewBatch[] | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  try {
    const data = await listBatches({ quiet: true })
    if (request !== generation) return null
    rows.value = sortBatches(data)
    return rows.value
  } catch (reason) {
    if (request !== generation) return null
    error.value = apiFailure(reason).message
    return null
  } finally {
    if (request === generation) loading.value = false
  }
}

const rule = ref<ReviewRule | null>(null)
const ruleError = ref('')
async function loadRule() {
  ruleError.value = ''
  try {
    const data = await getSchoolReviewRule({ quiet: true })
    if (alive) rule.value = data
  } catch (reason) {
    if (alive) ruleError.value = apiFailure(reason).message
  }
}
const versions = ref<CatalogVersion[] | null>(null)
const versionsError = ref('')
async function loadVersions() {
  versionsError.value = ''
  try {
    const data = await listProgramVersions({ quiet: true })
    if (alive) versions.value = data
  } catch (reason) {
    if (alive) versionsError.value = apiFailure(reason).message
  }
}
void load()
void loadRule()
void loadVersions()

const batchId = computed(() => (typeof route.query.batch === 'string' ? route.query.batch : ''))
const creating = computed(() => route.query.new === '1')
const selected = computed(() => rows.value.find((row) => row.id === batchId.value) ?? null)
const ready = computed(() => !loading.value && !error.value)
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}
watch([ready, rows, narrow], () => {
  if (!ready.value || narrow.value || batchId.value || creating.value || !rows.value.length) return
  setQuery({ batch: rows.value[0]!.id })
})

async function created(batch: ReviewBatch) {
  await load()
  if (alive) setQuery({ new: undefined, batch: batch.id })
}
const tone = (status: ReviewBatch['status']) => (status === 'OPEN' ? 'success' : status === 'SUBMISSION_CLOSED' ? 'action' : 'neutral')
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString('zh-CN') : '未设置')

const signOut = useSignOut()
const nav = computed(() => workspaceNav('school_reviewer', '/school/batch-rules'))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="批次与规则" @sign-out="signOut">
      <template #actions>
        <Button v-if="ready" type="button" variant="outline" size="sm" data-action="new-batch" @click="setQuery({ new: '1', batch: undefined })">新建批次</Button>
      </template>

      <MasterDetail :open="Boolean(batchId) || creating" :narrow="narrow" list-label="批次清单" detail-label="当前批次" back-label="批次清单" list-width="300px" @back="setQuery({ batch: undefined, new: undefined })">
        <template #list>
          <StatePanel v-if="loading && !rows.length" kind="loading" title="正在读取批次…" compact />
          <StatePanel v-else-if="error" kind="error" title="批次没有加载出来" compact>
            {{ error }}
            <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
          </StatePanel>
          <StatePanel v-else-if="!rows.length" kind="empty" title="还没有送审批次" compact>
            先建立一个批次，学生才能提交论文。
            <template #actions><Button type="button" @click="setQuery({ new: '1' })">新建批次</Button></template>
          </StatePanel>
          <ul v-else class="wsd-tlist">
            <li v-for="row in rows" :key="row.id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.id === batchId }" :aria-current="row.id === batchId || undefined" @click="setQuery({ batch: row.id, new: undefined })">
                <span class="wsd-titem__title">{{ row.name }}</span>
                <span class="wsd-titem__meta num">{{ row.code }}　{{ day(row.start_at) }} 至 {{ day(row.end_at) }}</span>
                <span class="wsd-titem__line"><StatusPill :tone="tone(row.status)">{{ batchStatusText[row.status] }}</StatusPill></span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StatePanel v-if="ready && rows.length" kind="empty" title="从左侧选择一个批次" compact />
        </template>

        <BatchCreate v-if="creating" @created="created" @cancel="setQuery({ new: undefined })" />
        <StatePanel v-else-if="loading && !selected" kind="loading" title="正在读取批次…" />
        <StatePanel v-else-if="error" kind="error" title="批次没有加载出来，暂时不能打开">
          <template #actions><Button type="button" variant="outline" @click="load">重试</Button></template>
        </StatePanel>
        <StatePanel v-else-if="!selected" kind="forbidden" title="这个批次不在本校的批次中">
          <template #actions><Button type="button" variant="outline" @click="setQuery({ batch: undefined })">返回批次清单</Button></template>
        </StatePanel>
        <BatchObject
          v-else
          :key="selected.id"
          :batch="selected"
          :rule="rule"
          :rule-error="ruleError"
          :versions="versions"
          :versions-error="versionsError"
          :reload="load"
          @retry-rule="loadRule"
          @retry-versions="loadVersions"
        />
      </MasterDetail>
    </AppShell>
  </div>
</template>
