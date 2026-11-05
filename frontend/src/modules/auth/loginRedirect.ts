/**
 * 登录后回到原来的深链（路由守卫写入的 `redirect`）。
 * 只接受站内路径，且目标路由必须允许当前角色；否则返回 null，由调用方回到角色默认页。
 */
import type { Router } from 'vue-router'

import type { RoleCode } from '@/types/roles'

export function safeRedirect(router: Router, raw: unknown, role: RoleCode): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null
  const target = router.resolve(raw)
  if (!target.matched.length || target.path === '/login' || target.redirectedFrom) return null
  const last = target.matched[target.matched.length - 1]
  if (last.redirect || last.path.includes(':pathMatch')) return null
  const roles = target.meta.roleCodes as RoleCode[] | undefined
  return Array.isArray(roles) && roles.includes(role) ? target.fullPath : null
}
