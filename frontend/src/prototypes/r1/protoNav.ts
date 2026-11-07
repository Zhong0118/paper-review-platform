/**
 * 样板导航：菜单取自真实的 workspaceNav（真实模式 portalMenus，不改权限），只把链接换到样板路由。
 * 有样板的页面指向样板；其余指向导航示例页并标出当前项，避免误进需要登录的真实页面。
 */
import type { NavGroup } from '@/components/workspace/types'
import { workspaceNav } from '@/router/workspaceNav'
import type { RoleCode } from '@/types/roles'

export const SAMPLE_ROUTES: Record<string, string> = {
  '/platform/experts': '/prototype/r1/experts',
  '/school/preparation': '/prototype/r1/verify',
  '/student/results': '/prototype/r1/feedback',
}

export function protoNav(role: RoleCode, activeRealPath: string, counts: Record<string, number | undefined> = {}): NavGroup[] {
  return workspaceNav(role, activeRealPath, counts, false).map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      iconKey: item.to,
      to: item.to && (SAMPLE_ROUTES[item.to] ?? `/prototype/r1/nav?role=${role}&at=${encodeURIComponent(item.to)}`),
    })),
  }))
}
