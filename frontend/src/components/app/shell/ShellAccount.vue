<script setup lang="ts">
/**
 * 账户入口（侧栏底部）：只读本人信息＋退出登录。没有切换角色、头像上传或假通知。
 * 不直接调用 auth store：外壳发出 signOut，由页面接到现有 auth.logout()，原型里不触发真实请求。
 */
import { ChevronsUpDown, LogOut } from '@lucide/vue'
import { computed } from 'vue'

import { accountInitial } from '@/components/workspace/accountInitial'
import type { WorkspaceAccount } from '@/components/workspace/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

const props = defineProps<{ account: WorkspaceAccount }>()
const emit = defineEmits<{ signOut: [] }>()
const { isMobile } = useSidebar()
const initial = computed(() => accountInitial(props.account.name))
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton size="lg" class="data-[state=open]:bg-sidebar-accent" :aria-label="`账户：${account.name}，${account.role}`" data-account>
            <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-sm font-medium text-foreground ring-1 ring-border" aria-hidden="true">{{ initial }}</span>
            <span class="grid min-w-0 flex-1 leading-tight">
              <span class="truncate text-sm font-medium">{{ account.name }}</span>
              <span class="truncate text-xs text-muted-foreground">{{ account.role }}</span>
            </span>
            <ChevronsUpDown class="ml-auto size-4 text-muted-foreground" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-60" :side="isMobile ? 'top' : 'right'" align="end" :side-offset="8">
          <DropdownMenuLabel class="grid gap-0.5 font-normal">
            <span class="text-sm font-medium">{{ account.name }}</span>
            <span v-if="account.username" class="text-xs text-muted-foreground">账号 {{ account.username }}</span>
            <span class="text-xs text-muted-foreground">{{ account.role }}<template v-if="account.org">　{{ account.org }}</template></span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-action="sign-out" @select="emit('signOut')"><LogOut />退出登录</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
