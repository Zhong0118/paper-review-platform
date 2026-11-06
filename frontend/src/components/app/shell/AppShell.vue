<script setup lang="ts">
/**
 * R1 公共外壳（U4 计划 §17.5、v3 §5）：六种角色共用同一侧栏、顶栏与账户入口，菜单由调用方按权限传入。
 * - 侧栏展开 224px、折叠 56px 图标轨（带 Tooltip），手机为可关闭的 Sheet；折叠偏好只存本浏览器。
 * - 顶栏 52px：标题＋上下文＋页级动作。标题只在这里出现一次。
 * - layout 指定内容模板（v3 §6）：data 满宽、queue 主从、form 居中 960、reading 居中 840、focus 文档优先；
 *   bare 无内边距、不限高，给旧外壳适配层里自带版式的页面（U4 计划 §19.1）。
 * - focus：进入时收起侧栏且不写入偏好，离开后常规页面仍按用户偏好。
 * 外壳不调用接口、不读 store：账户信息由页面传入，退出通过 signOut 交给页面。
 */
import { computed } from 'vue'

import type { NavGroup, WorkspaceAccount } from '@/components/workspace/types'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'

import { navIcon } from './navIcons'
import ShellAccount from './ShellAccount.vue'
import ShellBrand from './ShellBrand.vue'

export type ShellLayout = 'data' | 'queue' | 'form' | 'reading' | 'focus' | 'bare'

const props = withDefaults(
  defineProps<{
    nav: NavGroup[]
    account: WorkspaceAccount
    /** 侧栏顶部的工作空间说明：学校名称或代码（只有代码时就显示代码，不猜名称） */
    workspace?: string
    /** 顶栏标题（16px/600）；需要更复杂的标题时用 #title 插槽 */
    title?: string
    layout?: ShellLayout
  }>(),
  { workspace: '', title: '', layout: 'data' },
)
const emit = defineEmits<{ signOut: [] }>()

const focus = computed(() => props.layout === 'focus')
const workspaceLine = computed(() => [props.account.role, props.workspace].filter(Boolean).join('　'))
const contentClass = computed(
  () =>
    ({
      data: 'px-(--page-x) pt-4 pb-8',
      queue: 'h-[calc(100svh-var(--bar-h))] min-h-0 overflow-hidden',
      form: 'px-(--page-x) py-6',
      reading: 'px-(--page-x) py-8',
      focus: 'h-[calc(100svh-var(--bar-h))] min-h-0 overflow-hidden',
      bare: 'min-w-0',
    })[props.layout],
)
const innerClass = computed(() => ({ form: 'mx-auto w-full max-w-[960px]', reading: 'mx-auto w-full max-w-[840px]' })[props.layout as 'form'] ?? '')
</script>

<template>
  <SidebarProvider :persist="!focus" :default-open="focus ? false : undefined" class="bg-sidebar" data-shell :data-layout="layout">
    <Sidebar collapsible="icon">
      <SidebarHeader class="gap-0 px-3 pt-3 pb-2 group-data-[collapsible=icon]:px-2">
        <ShellBrand />
        <p
          v-if="workspaceLine"
          class="mt-1.5 truncate pl-[42px] text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"
          :title="workspaceLine"
          data-workspace
        >
          {{ workspaceLine }}
        </p>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup v-for="(group, index) in nav" :key="group.label ?? index" class="py-1">
          <SidebarGroupLabel v-if="group.label" class="h-7 text-xs font-medium text-faint">{{ group.label }}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu class="gap-0.5">
              <SidebarMenuItem v-for="item in group.items" :key="item.to ?? item.label">
                <SidebarMenuButton v-if="item.to" as-child :is-active="item.active" :tooltip="item.label">
                  <RouterLink :to="item.to" :aria-current="item.active ? 'page' : undefined">
                    <component :is="navIcon(item.iconKey ?? item.to)" aria-hidden="true" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
                <SidebarMenuButton v-else :tooltip="item.label" aria-disabled="true">
                  <component :is="navIcon(item.iconKey ?? item.to)" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                </SidebarMenuButton>
                <SidebarMenuBadge v-if="item.count !== undefined" class="tabular text-xs font-normal text-muted-foreground">{{ item.count }}</SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter class="p-2">
        <ShellAccount :account="account" @sign-out="emit('signOut')" />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset class="min-w-0 border-l border-sidebar-border md:border-l-0">
      <header class="sticky top-0 z-20 flex h-(--bar-h) shrink-0 items-center gap-2 border-b bg-background px-(--page-x)" data-shell-bar>
        <SidebarTrigger class="-ml-1.5 text-muted-foreground" />
        <Separator orientation="vertical" class="mr-1 data-[orientation=vertical]:h-4" />
        <slot name="back" />
        <div class="flex min-w-0 flex-1 items-baseline gap-3">
          <slot name="title"><h1 v-if="title" class="truncate text-md font-semibold" :title="title">{{ title }}</h1></slot>
          <span class="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline"><slot name="context" /></span>
        </div>
        <div class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
      </header>
      <main :class="contentClass" data-shell-main>
        <div v-if="innerClass" :class="innerClass"><slot /></div>
        <slot v-else />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
