<script setup lang="ts">
/**
 * U4-5 学科与专业（真实模式，P12）：开放学科｜校内专业对照，地址 ?tab=programs。
 * 两种模式共用本页（U4-9 删除了旧页）。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppShell from '@/components/app/shell/AppShell.vue'
import { schoolOrg } from '@/components/app/shell/schoolOrg'
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
  org: schoolOrg(auth.user),
}))
</script>

<template>
  <div class="ws">
    <AppShell :nav="nav" :account="account" :workspace="account.org" layout="bare" title="学科与专业" @sign-out="signOut">
      <template #context>决定学生新建论文时能选的学科与专业</template>
      <div class="page">
        <!-- P1-3：页签与下方内容同宽（1080）、同内边距，左边缘对齐 -->
        <div class="border-b bg-background py-2">
          <div class="tabs-row mx-auto max-w-[1080px]">
            <ViewTabs :model-value="tab" :views="TABS" label="分区" @update:model-value="setTab" />
          </div>
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
/* 与 .wsd-obj 的左右内边距一致（宽屏 24、窄屏 14） */
.tabs-row {
  padding-inline: 24px;
}
@media (max-width: 899px) {
  .tabs-row {
    padding-inline: 14px;
  }
}
/* form 模板：内容居中，提交条仍贴底满宽 */
.page :deep(.wsd-obj) {
  margin-inline: auto;
}
</style>
