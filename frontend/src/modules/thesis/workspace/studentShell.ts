/** 学生个人门户外壳的导航与账户：导航沿用 portalMenus('student')，不另造入口。 */
import type { NavItem, WorkspaceAccount } from '@/components/workspace/types'
import { portalMenus } from '@/router/menus'

interface SessionUser {
  displayName: string | null
  username?: string | null
  tenantCode?: string | null
}

export function studentNav(active: string): NavItem[] {
  return portalMenus('student').map((item) => ({ label: item.label, to: item.path, active: item.path === active }))
}

export function studentAccount(user: SessionUser | null | undefined): WorkspaceAccount {
  return {
    name: user?.displayName || '身份未取得',
    username: user?.username ?? '',
    role: '学生',
    org: user?.tenantCode ?? '',
  }
}
