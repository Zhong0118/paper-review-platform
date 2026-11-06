<script setup lang="ts">
/**
 * U2-6 导师正式反馈（真实模式，/supervisor/results?thesisId=）：只读，只列出本人指导且结果已发布的学生。
 * 与学生共用 FeedbackDocument（R3-4 起 AppShell reading）；没有异议入口。快照无法识别时按接口错误处理（D7）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getPublishedResult, listSupervisedPublishedTheses, type SupervisedPublishedThesis } from '@/api/results'
import ScopeSelect from '@/components/app/data/ScopeSelect.vue'
import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import type { NavItem, WorkspaceAccount } from '@/components/workspace/types'
import { useTimeScope } from '@/composables/useTimeScope'
import { portalMenus } from '@/router/menus'
import { failureText } from '@/api/failure'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import FeedbackDocument from './FeedbackDocument.vue'
import { readPublished, type FeedbackView } from './publishedFeedback'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const timeScope = useTimeScope()
const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status
const messageOf = (error: unknown, fallback: string) => failureText(error, fallback)

const choices = ref<SupervisedPublishedThesis[]>([])
const listLoading = ref(true)
const listError = ref('')
const queryId = computed(() => (typeof route.query.thesisId === 'string' ? route.query.thesisId : ''))
const chosen = computed(() => choices.value.find((row) => row.id === queryId.value) ?? null)

type Load = { kind: 'idle' | 'loading' | 'missing' | 'error' | 'invalid' } | { kind: 'ready'; view: FeedbackView }
const state = ref<Load>({ kind: 'idle' })
const loadError = ref('')
let listGeneration = 0
let resultGeneration = 0

async function loadList() {
  const own = ++listGeneration
  listLoading.value = true
  listError.value = ''
  try {
    const rows = await listSupervisedPublishedTheses(...timeScope.request())
    if (own !== listGeneration) return
    choices.value = rows
    if (rows[0] && !rows.some((row) => row.id === queryId.value)) await router.replace({ query: { ...route.query, thesisId: rows[0].id } })
    // 地址里的选择可能刚被补上：两条路都在这里取结果，监听在清单加载期间不触发
    void loadResult()
  } catch (error) {
    if (own === listGeneration) listError.value = messageOf(error, '学生名单没有加载出来')
  } finally {
    if (own === listGeneration) listLoading.value = false
  }
}

async function loadResult() {
  const own = ++resultGeneration
  if (!chosen.value) {
    state.value = { kind: choices.value.length ? 'missing' : 'idle' }
    return
  }
  state.value = { kind: 'loading' }
  try {
    const view = readPublished(await getPublishedResult(chosen.value.id, { quiet: true }))
    if (own !== resultGeneration) return
    state.value = view ? { kind: 'ready', view } : { kind: 'invalid' }
  } catch (error) {
    if (own !== resultGeneration) return
    if (statusOf(error) === 404 || statusOf(error) === 403) state.value = { kind: 'missing' }
    else {
      loadError.value = messageOf(error, '评阅结果没有加载出来')
      state.value = { kind: 'error' }
    }
  }
}

watch([timeScope.scope, () => auth.user?.id], () => void loadList(), { immediate: true })
watch(queryId, (value, old) => { if (value !== old && !listLoading.value) void loadResult() })
onBeforeUnmount(() => { listGeneration++; resultGeneration++ })

function choose(id: string) {
  void router.replace({ query: { ...route.query, thesisId: id } })
}

const signOut = useSignOut()
const nav = computed(() => [{ items: portalMenus('supervisor').map<NavItem>((item) => ({ label: item.label, to: item.path, active: item.path === '/supervisor/results' })) }])
const account = computed<WorkspaceAccount>(() => ({ name: auth.user?.displayName || '身份未取得', username: auth.user?.username ?? '', role: '导师', org: auth.user?.tenantCode ?? '' }))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="reading" title="学生评阅结果" @sign-out="signOut">
      <template #context>只列出你指导的、结果已发布的学生</template>
      <template #actions><ScopeSelect :model-value="timeScope.scope.value" @update:model-value="timeScope.setScope" /></template>

      <label v-if="choices.length" class="mb-6 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span class="text-muted-foreground">学生</span>
        <select
          class="h-(--control-h) min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          :value="queryId"
          data-student-picker
          @change="choose(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="row in choices" :key="row.id" :value="row.id">{{ row.student_name }}：{{ row.title || '未命名论文' }}</option>
        </select>
      </label>

      <StatePanel v-if="listLoading || state.kind === 'loading'" kind="loading" title="正在载入学生评审结果" />
      <StatePanel v-else-if="listError" kind="error" title="学生名单没有加载出来">
        {{ listError }}
        <template #actions><Button variant="outline" data-action="retry-feedback" @click="loadList">重试</Button></template>
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'idle'" kind="empty" title="还没有已发布的学生评审结果">
        你指导的学生的结果经学校发布后，会在这里显示。
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'missing'" kind="empty" title="这篇论文的结果不可查看" data-feedback-missing>
        它可能不在你的指导名单里，或者学校还没有发布。请从上方选择一位学生。
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'invalid'" kind="error" title="这份评阅结果暂时无法显示" data-feedback-invalid>
        结果数据的格式无法识别，为避免显示错误内容，本页没有展示任何部分。请稍后再试；如果一直如此，请联系学校。
      </StatePanel>
      <StatePanel v-else-if="state.kind === 'error'" kind="error" title="评阅结果没有加载出来">
        {{ loadError }}
        <template #actions><Button variant="outline" data-action="retry-feedback" @click="loadResult">重试</Button></template>
      </StatePanel>
      <FeedbackDocument v-else-if="state.kind === 'ready' && chosen" :view="state.view" :title="chosen.title || '未命名论文'" :context="[`学生：${chosen.student_name}`]" />
    </AppShell>
  </div>
</template>
