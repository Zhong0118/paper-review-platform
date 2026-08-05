/**
 * @file 认证状态管理（Pinia store）
 * @description
 *    管理当前登录用户与访问令牌。当前为占位骨架，登录流程在 C1 增量实现。

 * 主要功能：
 *    1. 持有访问令牌与当前用户。
 *    2. 登录/登出动作入口（占位）。

 * TODO(AUTH-001, P1): 实现真实登录流程，接入 /auth/login、/auth/refresh 与 /auth/logout。
 * 完成条件：C1 用户组织权限增量（T-007/T-015）落地后接入接口。
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface AuthUser {
  id: string
  displayName: string | null
}

export const useAuthStore = defineStore('auth', () => {
  const accessToken = ref<string | null>(null)
  const user = ref<AuthUser | null>(null)

  function setSession(token: string, currentUser: AuthUser): void {
    accessToken.value = token
    user.value = currentUser
  }

  function clearSession(): void {
    accessToken.value = null
    user.value = null
  }

  return { accessToken, user, setSession, clearSession }
})
