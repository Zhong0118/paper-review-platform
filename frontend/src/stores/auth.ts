/**
 * @file 认证状态管理（Pinia store）
 */

import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { fetchMe, loginWithPassword, logoutSession, type LoginUser } from '@/api/auth'
import { defaultRouteByRole } from '@/router/menus'
import type { RoleCode } from '@/types/roles'

export interface AuthUser {
  id: string
  displayName: string | null
  role: RoleCode
  demo?: boolean
  username?: string | null
  tenantId?: string | null
  tenantCode?: string | null
  tenantName?: string | null
}

const ACCESS_KEY = 'pr.access_token'
const REFRESH_KEY = 'pr.refresh_token'
const USER_KEY = 'pr.user'

function readUser(): AuthUser | null {
  const raw = sessionStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthUser
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(sessionStorage.getItem(ACCESS_KEY))
  const refreshToken = ref<string | null>(sessionStorage.getItem(REFRESH_KEY))
  const user = ref<AuthUser | null>(readUser())

  function persist() {
    if (accessToken.value) sessionStorage.setItem(ACCESS_KEY, accessToken.value)
    else sessionStorage.removeItem(ACCESS_KEY)
    if (refreshToken.value) sessionStorage.setItem(REFRESH_KEY, refreshToken.value)
    else sessionStorage.removeItem(REFRESH_KEY)
    if (user.value) sessionStorage.setItem(USER_KEY, JSON.stringify(user.value))
    else sessionStorage.removeItem(USER_KEY)
  }

  function setSession(token: string, currentUser: AuthUser, refresh?: string): void {
    accessToken.value = token
    user.value = currentUser
    if (refresh !== undefined) refreshToken.value = refresh
    persist()
  }

  function clearSession(): void {
    accessToken.value = null
    refreshToken.value = null
    user.value = null
    persist()
  }

  function hydrateFromStorage(): void {
    accessToken.value = sessionStorage.getItem(ACCESS_KEY)
    refreshToken.value = sessionStorage.getItem(REFRESH_KEY)
    user.value = readUser()
  }

  const demoNames: Record<RoleCode, string> = {
    system_admin: '系统管理员',
    school_reviewer: '王老师',
    platform_reviewer: '陈岚',
    student: '林知远',
    supervisor: '赵文博教授',
    expert: '周明远教授',
  }

  function loginAsDemo(role: RoleCode): void {
    setSession(`demo-${role}`, {
      id: `demo-${role}`,
      displayName: demoNames[role],
      role,
      demo: true,
    })
  }

  async function loginWithPasswordAction(username: string, password: string): Promise<void> {
    const result = await loginWithPassword(username, password)
    const apiUser: LoginUser = result.user
    setSession(
      result.access_token,
      {
        id: apiUser.id,
        displayName: apiUser.display_name,
        role: apiUser.role as RoleCode,
        username: apiUser.username,
        tenantId: apiUser.tenant_id,
        tenantCode: apiUser.tenant_code,
      },
      result.refresh_token,
    )
    await loadTenantName()
  }

  /** 外壳显示学校名称用（F1 · A1）：登录响应只有学校代码，名称从 /me 补读；失败不影响登录，外壳退回显示代码。 */
  async function loadTenantName(): Promise<void> {
    if (!user.value?.tenantId) return
    try {
      const me = await fetchMe({ quiet: true })
      if (me?.tenant_name && user.value) {
        user.value = { ...user.value, tenantName: me.tenant_name }
        persist()
      }
    } catch {
      /* 保留学校代码 */
    }
  }

  async function logout(): Promise<void> {
    if (refreshToken.value && !user.value?.demo) {
      try {
        await logoutSession(refreshToken.value)
      } catch {
        /* still clear locally */
      }
    }
    clearSession()
  }

  const defaultRoute = computed(() => (user.value ? defaultRouteByRole[user.value.role] : '/login'))

  return {
    accessToken,
    refreshToken,
    user,
    defaultRoute,
    setSession,
    clearSession,
    hydrateFromStorage,
    loginAsDemo,
    loginWithPassword: loginWithPasswordAction,
    logout,
  }
})
