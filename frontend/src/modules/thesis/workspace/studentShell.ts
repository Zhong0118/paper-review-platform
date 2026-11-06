/** 学生个人门户外壳的导航与账户：导航沿用 workspaceNav('student')（portalMenus 的入口＋工作空间短名称），不另造入口。 */
import { schoolOrg } from '@/components/app/shell/schoolOrg'
import type { NavItem, WorkspaceAccount } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'

interface SessionUser {
  displayName: string | null
  username?: string | null
  tenantCode?: string | null
  tenantName?: string | null
}

export function studentNav(active: string): NavItem[] {
  return workspaceNav('student', active)[0]?.items ?? []
}

export function studentAccount(user: SessionUser | null | undefined): WorkspaceAccount {
  return {
    name: user?.displayName || '身份未取得',
    username: user?.username ?? '',
    role: '学生',
    org: schoolOrg(user),
  }
}
