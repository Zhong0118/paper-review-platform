<script setup lang="ts">
/**
 * U4-5 学科与专业（真实模式，P12）：开放学科｜校内专业对照，地址 ?tab=programs。
 * 两种模式共用本页（U4-9 删除了旧页）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppShell from '@/components/app/shell/AppShell.vue'
import { useSignOut } from '@/components/app/shell/useSignOut'
import ViewTabs from '@/components/app/data/ViewTabs.vue'
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
const setTab = (next: string) => void router.replace({ query: { ...route.query, tab: next === 'programs' ? next : undefined } })
const TABS = [
  { value: 'open', label: '开放学科', attrs: { 'data-tab': 'open' } },
  { value: 'programs', label: '校内专业对照', attrs: { 'data-tab': 'programs' } },
]

const signOut = useSignOut()
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
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="学科与专业" @sign-out="signOut">
      <template #context>决定学生新建论文时能选的学科与专业</template>
      <div class="page">
        <div class="border-b bg-background px-(--page-x) py-2">
          <ViewTabs :model-value="tab" :views="TABS" label="分区" class="mx-auto max-w-[960px]" @update:model-value="setTab" />
        </div>
        <OpenDisciplines v-if="tab === 'open'" />
        <ProgramImport v-else />
      </div>
    </AppShell>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  min-height: calc(100svh - var(--bar-h));
}
/* form 模板：内容居中 960，提交条仍贴底满宽 */
.page :deep(.wsd-obj) {
  margin-inline: auto;
}
</style>
