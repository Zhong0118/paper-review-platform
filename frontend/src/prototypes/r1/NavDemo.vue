<script setup lang="ts">
/**
 * R1 六角色共用导航（v3 §5）：同一个 AppShell，菜单按角色取自真实的 workspaceNav（不改权限）。
 * 有样板的菜单项打开样板，其余停在本页并标出“本轮未做样板”。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppShell from '@/components/app/shell/AppShell.vue'
import StatePanel from '@/components/app/state/StatePanel.vue'
import { Button } from '@/components/ui/button'
import { workspaceNav } from '@/router/workspaceNav'
import type { RoleCode } from '@/types/roles'

import { SAMPLE_NOTE, sampleAccounts } from './fixtures'
import { protoNav, SAMPLE_ROUTES } from './protoNav'

const ROLES: { code: RoleCode; label: string }[] = [
  { code: 'student', label: '学生' },
  { code: 'supervisor', label: '导师' },
  { code: 'school_reviewer', label: '学校审核' },
  { code: 'platform_reviewer', label: '百杰运营' },
  { code: 'expert', label: '评审专家' },
  { code: 'system_admin', label: '系统管理员' },
]
const route = useRoute()
const router = useRouter()
const role = computed<RoleCode>(() => (ROLES.some((r) => r.code === route.query.role) ? (route.query.role as RoleCode) : 'school_reviewer'))
const at = computed(() => (typeof route.query.at === 'string' ? route.query.at : ''))
const realItems = computed(() => workspaceNav(role.value, at.value, {}, false).flatMap((group) => group.items))
const current = computed(() => realItems.value.find((item) => item.to === at.value) ?? realItems.value[0])
const nav = computed(() => protoNav(role.value, current.value?.to ?? ''))
const shell = computed(() => sampleAccounts[role.value]!)
const SAMPLE_TITLES: Record<string, string> = { '/platform/experts': '专家库', '/school/preparation': '单篇匿名核验', '/student/results': '正式反馈' }
const samples = computed(() => realItems.value.filter((item) => item.to && SAMPLE_ROUTES[item.to]))
</script>

<template>
  <AppShell :nav="nav" :account="shell.account" :workspace="shell.workspace" layout="form" :title="current?.label ?? '导航示例'">
    <template #context>导航示例：{{ ROLES.find((r) => r.code === role)?.label }}</template>

    <div class="grid gap-6">
      <section class="grid gap-3 rounded-lg border bg-background p-5" aria-labelledby="role-h">
        <h2 id="role-h" class="text-md font-semibold">切换角色看同一套导航</h2>
        <div class="flex flex-wrap gap-2" role="group" aria-label="样板角色">
          <Button
            v-for="r in ROLES"
            :key="r.code"
            size="sm"
            :variant="r.code === role ? 'default' : 'outline'"
            :aria-pressed="r.code === role"
            @click="router.replace({ query: { role: r.code } })"
          >
            {{ r.label }}
          </Button>
        </div>
        <p class="text-sm text-muted-foreground">
          菜单项与顺序来自真实的角色菜单，不在样板里增减权限。侧栏可以用 ⌘B / Ctrl+B 或侧栏边缘收起成图标轨，偏好只存本浏览器；手机宽度下侧栏改为左侧抽屉。
        </p>
      </section>

      <StatePanel kind="empty" :title="`「${current?.label ?? '这个页面'}」本轮没有做样板`">
        R1 只做三张代表样板，其余页面在 R2–R3 按同一外壳与内容模板迁移。{{ SAMPLE_NOTE }}
        <template v-if="samples.length" #actions>
          <Button v-for="item in samples" :key="item.to" variant="outline" as-child><RouterLink :to="SAMPLE_ROUTES[item.to!]!">打开样板：{{ SAMPLE_TITLES[item.to!] }}</RouterLink></Button>
        </template>
      </StatePanel>
    </div>
  </AppShell>
</template>
