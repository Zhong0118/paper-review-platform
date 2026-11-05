<script setup lang="ts">
/**
 * U4-5 学科与专业（真实模式，P12）：开放学科｜校内专业对照，地址 ?tab=programs。
 * 两种模式共用本页（U4-9 删除了旧页）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import OperationsShell from '@/components/workspace/OperationsShell.vue'
import type { WorkspaceAccount } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'
import { useAuthStore } from '@/stores/auth'
import '@/styles/workspace.css'

import OpenDisciplines from './OpenDisciplines.vue'
import ProgramImport from './ProgramImport.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const tab = computed(() => (route.query.tab === 'programs' ? 'programs' : 'open'))
const setTab = (next: 'open' | 'programs') => void router.replace({ query: { ...route.query, tab: next === 'open' ? undefined : next } })

const nav = computed(() => workspaceNav('school_reviewer', '/school/disciplines'))
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
      <template #title><h1 class="wsd-title">学科与专业</h1></template>
      <template #context><span class="wsd-ctx">决定学生新建论文时能选的学科与专业</span></template>
      <div class="page">
        <div class="wsd-views tabs" role="tablist" aria-label="分区">
          <button type="button" role="tab" class="wsd-views__tab" :aria-selected="tab === 'open'" data-tab="open" @click="setTab('open')">开放学科</button>
          <button type="button" role="tab" class="wsd-views__tab" :aria-selected="tab === 'programs'" data-tab="programs" @click="setTab('programs')">校内专业对照</button>
        </div>
        <OpenDisciplines v-if="tab === 'open'" />
        <ProgramImport v-else />
      </div>
    </OperationsShell>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - var(--ws-bar));
}
.tabs {
  padding: 10px 24px;
  border-bottom: 1px solid var(--ws-border);
  background: var(--ws-surface);
}
</style>
