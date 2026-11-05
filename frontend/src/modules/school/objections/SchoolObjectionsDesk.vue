<script setup lang="ts">
/**
 * U4-2 学校异议处理（真实模式，P11）：异议清单｜异议对象。
 * 异议清单不分时间范围；题目与学号从全部本校论文里按 thesis_id 关联（E11），取不到时如实说明。
 * 视图与选中异议放在地址里：?view= &objection=（收尾清单深链）。
 * demo 模式仍走旧页 ObjectionWorkbenchPage（见 router/routes.ts）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { apiFailure } from '@/api/failure'
import { listSchoolObjections, type ObjectionRow } from '@/api/objections'
import { listSchoolTheses } from '@/api/schoolReview'
import type { ThesisDetail } from '@/api/theses'
import MasterDetail from '@/components/workspace/MasterDetail.vue'
import OperationsShell from '@/components/workspace/OperationsShell.vue'
import StateBlock from '@/components/workspace/StateBlock.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { useNarrow } from '@/components/workspace/useNarrow'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import ObjectionObject from './ObjectionObject.vue'
import { objectionViews, type ObjectionStatus } from './objectionView'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const narrow = useNarrow()

const rows = ref<ObjectionRow[]>([])
const theses = ref<Map<string, ThesisDetail> | null>(null)
const loading = ref(true)
const error = ref('')
let generation = 0
onBeforeUnmount(() => generation++)

/** 返回最新清单；失败或已被更新的请求取代时返回 null */
async function load(): Promise<ObjectionRow[] | null> {
  const request = ++generation
  loading.value = true
  error.value = ''
  const [objections, thesisList] = await Promise.allSettled([listSchoolObjections({ quiet: true }), listSchoolTheses(undefined, undefined, { quiet: true })])
  if (request !== generation) return null
  theses.value = thesisList.status === 'fulfilled' ? new Map(thesisList.value.map((item) => [item.id, item])) : null
  loading.value = false
  if (objections.status === 'rejected') {
    rows.value = []
    error.value = apiFailure(objections.reason).message
    return null
  }
  rows.value = objections.value
  return rows.value
}
void load()

const objectionId = computed(() => (typeof route.query.objection === 'string' ? route.query.objection : ''))
const selected = computed(() => rows.value.find((row) => row.id === objectionId.value) ?? null)
const view = computed<ObjectionStatus>(() => {
  const asked = objectionViews.find((item) => item.key === route.query.view)?.key
  return asked ?? (selected.value?.status as ObjectionStatus | undefined) ?? 'SUBMITTED'
})
function setQuery(patch: Record<string, string | undefined>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) if (typeof value === 'string' && value) next[key] = value
  void router.replace({ query: next })
}

const ready = computed(() => !loading.value && !error.value)
const countOf = (key: ObjectionStatus) => rows.value.filter((row) => row.status === key).length
const list = computed(() => rows.value.filter((row) => row.status === view.value || row.id === objectionId.value))

watch([ready, list, narrow], () => {
  if (!ready.value || narrow.value || objectionId.value || !list.value.length) return
  setQuery({ objection: list.value[0]!.id })
})

function thesisOf(row: ObjectionRow) {
  return theses.value?.get(row.thesis_id) ?? null
}
function titleOf(row: ObjectionRow) {
  if (!theses.value) return '论文题目没有加载出来'
  return thesisOf(row)?.current_version?.title || '论文已不在当前范围'
}
function moved(status: ObjectionStatus) {
  setQuery({ view: status })
}

const openCount = computed(() => (ready.value ? countOf('SUBMITTED') + countOf('PROCESSING') : undefined))
const nav = computed(() => workspaceNav('school_reviewer', '/school/objections', { '/school/objections': openCount.value }))
const account = computed<WorkspaceAccount>(() => ({
  name: auth.user?.displayName || '身份未取得',
  username: auth.user?.username ?? '',
  role: '学校审核',
  org: auth.user?.tenantCode ?? '',
}))
</script>

<template>
  <div class="ws">
    <OperationsShell :nav="nav" :account="account" :org="account.org">
      <template #title><h1 class="wsd-title">异议处理</h1></template>
      <template #context><span class="wsd-ctx">学生对已发布结果登记的异议</span></template>

      <MasterDetail :open="Boolean(objectionId)" :narrow="narrow" list-label="异议清单" detail-label="当前异议" back-label="异议清单" @back="setQuery({ objection: undefined })">
        <template #list>
          <div class="wsd-lhead">
            <div class="wsd-views" role="tablist" aria-label="视图">
              <button v-for="v in objectionViews" :key="v.key" type="button" role="tab" class="wsd-views__tab" :aria-selected="view === v.key" @click="setQuery({ view: v.key, objection: undefined })">
                {{ v.label }}<span v-if="ready" class="wsd-views__count num">{{ countOf(v.key) }}</span>
              </button>
            </div>
            <p v-if="ready" class="wsd-scope">共 {{ rows.length }} 条，不分时间范围。</p>
          </div>
          <StateBlock v-if="loading && !rows.length" kind="loading" title="正在读取异议…" compact />
          <StateBlock v-else-if="error" kind="error" title="异议清单没有加载出来" compact>
            {{ error }}
            <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
          </StateBlock>
          <StateBlock v-else-if="!rows.length" kind="empty" title="还没有学生登记异议" compact>学生在反馈页登记异议后，会出现在“待处理”。</StateBlock>
          <StateBlock v-else-if="!list.length" kind="empty" :title="view === 'SUBMITTED' ? '待处理的异议都已开始处理' : '这个视图里没有异议'" compact />
          <ul v-else class="wsd-tlist">
            <li v-for="row in list" :key="row.id">
              <button type="button" class="wsd-titem" :class="{ 'wsd-titem--on': row.id === objectionId }" :aria-current="row.id === objectionId || undefined" @click="setQuery({ objection: row.id })">
                <span class="wsd-titem__title" :class="{ muted: !thesisOf(row) }">{{ titleOf(row) }}</span>
                <span class="wsd-titem__meta">{{ row.student_name || '未取得姓名' }}　{{ thesisOf(row)?.student?.student_no ?? '' }}　{{ row.created_at.slice(0, 10) }} 登记</span>
                <span class="wsd-titem__line clamp">{{ row.reason }}</span>
              </button>
            </li>
          </ul>
        </template>

        <template #empty>
          <StateBlock v-if="ready && rows.length" kind="empty" title="从左侧选择一条异议" compact />
        </template>

        <StateBlock v-if="loading && !selected" kind="loading" title="正在读取异议…" />
        <StateBlock v-else-if="error" kind="error" title="异议清单没有加载出来，暂时不能打开异议">
          <template #actions><button type="button" class="btn btn--primary" @click="load">重试</button></template>
        </StateBlock>
        <StateBlock v-else-if="!selected" kind="forbidden" title="这条异议不在本校的异议记录中">
          <template #actions><button type="button" class="btn" @click="setQuery({ objection: undefined })">返回异议清单</button></template>
        </StateBlock>
        <ObjectionObject
          v-else
          :key="selected.id"
          :row="selected"
          :title="titleOf(selected)"
          :student-no="thesisOf(selected)?.student?.student_no ?? ''"
          :thesis-found="Boolean(thesisOf(selected))"
          :reload="load"
          @moved="moved"
        />
      </MasterDetail>
    </OperationsShell>
  </div>
</template>

<style scoped>
.clamp {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ws-muted);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
