/**
 * 工作空间侧栏：基于 portalMenus 的可见菜单分组，并换成已验收原型里的短名称。
 * 名称只在工作空间侧栏生效；menusByRole 的原名称不变（旧 PortalLayout 与 routes.spec 用它）。
 */
import type { NavGroup } from '@/components/workspace/types'
import type { RoleCode } from '@/types/roles'

import { portalMenus } from './menus'

const SCHOOL_SETTINGS = new Set(['/school/batch-rules', '/school/members', '/school/disciplines', '/school/sensitive-terms'])

const SHORT_LABELS: Record<string, string> = {
  '/school/batch-rules': '批次与规则',
  '/school/members': '成员与资格',
  '/school/disciplines': '学科与专业',
  '/school/sensitive-terms': '检测词表',
  '/platform/dispatch': '派单台',
  '/platform/corrections': '更正审批',
  // F1 · A5：侧栏名称与页面标题一致
  '/student/dashboard': '我的送审',
  '/student/results': '评阅结果',
  '/supervisor/results': '学生评阅结果',
}

/** counts：只给传入的路径显示计数；值为 undefined 表示暂不显示（加载中或失败）。 */
export function workspaceNav(
  role: RoleCode,
  activePath: string,
  counts: Record<string, number | undefined> = {},
  demoEnabled?: boolean,
): NavGroup[] {
  const items = portalMenus(role, demoEnabled).map((item) => ({
    label: SHORT_LABELS[item.path] ?? item.label,
    to: item.path,
    active: item.path === activePath,
    count: counts[item.path],
  }))
  if (role !== 'school_reviewer') return [{ items }]
  return [
    { label: '办理', items: items.filter((item) => !SCHOOL_SETTINGS.has(item.to)) },
    { label: '学校设置', items: items.filter((item) => SCHOOL_SETTINGS.has(item.to)) },
  ].filter((group) => group.items.length > 0)
}
