import type { NavigationItem, RoleCode } from '@/types/roles'

export const defaultRouteByRole: Record<RoleCode, string> = {
  system_admin: '/system/tenants',
  school_reviewer: '/school/preparation',
  platform_reviewer: '/platform/dispatch',
  student: '/student/dashboard',
  supervisor: '/supervisor/results',
  expert: '/expert/tasks',
}

const LIVE_PATHS: Partial<Record<RoleCode, string[]>> = {
  school_reviewer: ['/school/preparation', '/school/progress', '/school/results', '/school/objections', '/school/batch-rules', '/school/members', '/school/disciplines', '/school/sensitive-terms'],
  platform_reviewer: ['/platform/dispatch', '/platform/experts', '/platform/corrections'],
  student: ['/student/dashboard', '/student/results'],
  supervisor: ['/supervisor/results'],
  expert: ['/expert/tasks'],
  system_admin: ['/system/tenants', '/system/catalog'],
}

export const menusByRole: Partial<Record<RoleCode, NavigationItem[]>> = {
  school_reviewer: [
    { label: '送审准备', path: '/school/preparation', description: '匿名核验与确认送出' },
    { label: '评审进度', path: '/school/progress', description: '任务状态与催审处理' },
    { label: '结果处理', path: '/school/results', description: '汇总、确认与发布' },
    { label: '异议处理', path: '/school/objections' },
    { label: '批次与评审规则', path: '/school/batch-rules' },
    { label: '学校账户与账单', path: '/school/account' },
    { label: '消息通知', path: '/notifications' },
  ],
  platform_reviewer: [
    { label: '送审运营台', path: '/platform/dispatch', badge: 6 },
    { label: '专家库', path: '/platform/experts' },
    { label: '评阅更正审批', path: '/platform/corrections' },
    { label: '费用结算', path: '/platform/settlements' },
    { label: '消息通知', path: '/notifications' },
    { label: '审计查询', path: '/audit' },
  ],
  student: [
    { label: '我的论文', path: '/student/dashboard' },
    { label: '评审结果与异议', path: '/student/results' },
    { label: '消息通知', path: '/notifications' },
  ],
  supervisor: [{ label: '学生评审结果', path: '/supervisor/results' }],
  expert: [
    { label: '我的任务', path: '/expert/tasks', badge: 2 },
    { label: '费用与提现', path: '/expert/finance' },
    { label: '个人资料与资格', path: '/expert/profile' },
    { label: '消息通知', path: '/notifications' },
  ],
  system_admin: [{ label: '学校管理', path: '/system/tenants' }],
}

export function portalMenus(
  role: RoleCode,
  demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true',
): NavigationItem[] {
  const items = menusByRole[role] ?? []
  if (demoEnabled) return items
  const allowed = new Set(LIVE_PATHS[role] ?? [])
  const liveItems = role === 'school_reviewer'
    ? [...items, { label: '成员与送审资格', path: '/school/members' }, {label:'本校送审学科',path:'/school/disciplines'}, {label:'材料检测词表',path:'/school/sensitive-terms'}]
    : role === 'system_admin'
      ? [...items, { label: '官方基础目录', path: '/system/catalog' }]
      : items
  return liveItems.filter((item) => allowed.has(item.path)).map(({ badge, ...item }) => item)
}
