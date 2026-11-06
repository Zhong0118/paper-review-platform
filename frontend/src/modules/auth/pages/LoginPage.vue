<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { failureText } from '@/api/failure'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AuthLayout from '@/layouts/AuthLayout.vue'
import InvitationActivationPanel from '@/modules/auth/components/InvitationActivationPanel.vue'
import LoginChannelTabs, { type LoginChannel } from '@/modules/auth/components/LoginChannelTabs.vue'
import SchoolIdentityPanel from '@/modules/auth/components/SchoolIdentityPanel.vue'
import { safeRedirect } from '@/modules/auth/loginRedirect'
import { defaultRouteByRole } from '@/router/menus'
import { useAuthStore } from '@/stores/auth'
import type { RoleCode } from '@/types/roles'

const props = withDefaults(defineProps<{ demoMode?: boolean }>(), {
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
})

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const form = reactive({ account: '', password: '' })
const notice = ref('')
const activeChannel = ref<LoginChannel>('platform')

const demoRoles: Array<{ role: RoleCode; label: string; note: string }> = [
  { role: 'student', label: '学生', note: '提交论文并查看结果' },
  { role: 'school_reviewer', label: '学校管理员', note: '审核材料与发布结果' },
  { role: 'platform_reviewer', label: '百杰运营', note: '专家匹配与派单' },
  { role: 'expert', label: '评审专家', note: '接单并在线评阅' },
  { role: 'supervisor', label: '导师', note: '查看学生评审结果' },
]

async function startDemo(role: RoleCode) {
  authStore.loginAsDemo(role)
  await router.push(defaultRouteByRole[role])
}

const submitting = ref(false)

async function submitFormalLogin() {
  notice.value = ''
  if (!form.account.trim() || !form.password) {
    notice.value = '请输入账号和密码。'
    return
  }
  submitting.value = true
  try {
    await authStore.loginWithPassword(form.account.trim(), form.password)
    const role = authStore.user?.role
    // 未登录时打开的深链（如 /school/preparation?thesis=…）登录后原样回去；不合法或无权限则回角色默认页
    const back = role ? safeRedirect(router, route.query.redirect, role) : null
    await router.push(back ?? (role ? defaultRouteByRole[role] : '/login'))
  } catch (error) {
    notice.value = failureText(error, '登录失败，请检查账号密码。')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AuthLayout>
    <section class="grid w-full max-w-[26rem] gap-6" aria-labelledby="login-title">
      <header class="grid gap-2">
        <h2 id="login-title" class="text-2xl font-semibold">登录评审平台</h2>
        <p class="text-sm text-muted-foreground">按身份来源选择登录方式；平台不开放公开注册。</p>
      </header>

      <div>
        <LoginChannelTabs v-model="activeChannel" />

        <form
          v-if="activeChannel === 'platform'"
          id="login-panel-platform"
          class="grid gap-4"
          role="tabpanel"
          aria-labelledby="login-tab-platform"
          @submit.prevent="submitFormalLogin"
        >
          <div class="grid gap-1.5">
            <Label for="login-account">账号</Label>
            <Input id="login-account" v-model="form.account" class="h-10" autocomplete="username" placeholder="请输入账号" />
          </div>
          <div class="grid gap-1.5">
            <Label for="login-password">密码</Label>
            <Input id="login-password" v-model="form.password" class="h-10" type="password" autocomplete="current-password" placeholder="请输入密码" />
          </div>
          <Button class="h-10" type="submit" :disabled="submitting">{{ submitting ? '登录中…' : '登录' }}</Button>
          <!-- 提示位常驻并预留高度：出现错误时卡片不变高，不会因垂直居中而整体跳动 -->
          <p
            :class="['login-form__notice min-h-10 rounded-md px-3 py-2.5 text-sm text-warning', notice && 'bg-warning-soft']"
            role="status"
            aria-live="polite"
          >{{ notice }}</p>
        </form>

        <SchoolIdentityPanel v-else-if="activeChannel === 'school'" />
        <InvitationActivationPanel v-else />
      </div>

      <section v-if="props.demoMode" class="grid gap-3 border-t pt-5" aria-label="演示角色入口">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <span class="text-sm font-semibold">甲方演示模式</span>
          <small class="text-sm text-muted-foreground">无需账号，选择角色进入固定演示场景</small>
        </div>
        <div class="grid grid-cols-2 gap-2 max-[480px]:grid-cols-1">
          <button
            v-for="item in demoRoles"
            :key="item.role"
            type="button"
            class="grid gap-0.5 rounded-md border bg-background px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            :data-demo-role="item.role"
            @click="startDemo(item.role)"
          >
            <strong class="text-sm font-medium">{{ item.label }}</strong>
            <small class="text-sm text-muted-foreground">{{ item.note }}</small>
          </button>
        </div>
      </section>
    </section>
  </AuthLayout>
</template>
