import type { NavGroup } from '../kit/types'

export type SchoolNavKey = 'preparation' | 'results' | 'objections' | 'batches' | 'members' | 'disciplines' | 'terms'

/**
 * 学校侧栏：办理目的地 + 学校设置分组；与 LIVE_PATHS 一一对应，不新增未上线目的地。
 * 计数只在对应页面自己加载过时出现，避免在别的页面显示无来源的数字。
 */
export function schoolNav(active: SchoolNavKey, verifyCount?: number, counts: { results?: number; objections?: number } = {}): NavGroup[] {
  const item = (label: string, key: SchoolNavKey, to: string, count?: number) => ({ label, to, count, active: active === key })
  return [
    {
      label: '办理',
      items: [
        item('送审准备', 'preparation', '/prototype/school', verifyCount),
        { label: '评审进度' },
        item('结果处理', 'results', '/prototype/results', counts.results),
        item('异议处理', 'objections', '/prototype/objections', counts.objections),
      ],
    },
    {
      label: '学校设置',
      items: [
        item('批次与规则', 'batches', '/prototype/settings/batches'),
        item('成员与资格', 'members', '/prototype/settings/members'),
        item('学科与专业', 'disciplines', '/prototype/settings/disciplines'),
        item('检测词表', 'terms', '/prototype/settings/terms'),
      ],
    },
  ]
}

export type PlatformNavKey = 'dispatch' | 'experts' | 'corrections'

export function platformNav(active: PlatformNavKey, pending?: number, counts: { corrections?: number } = {}): NavGroup[] {
  return [
    {
      items: [
        { label: '派单台', to: '/prototype/dispatch', count: pending, active: active === 'dispatch' },
        { label: '专家库', to: '/prototype/experts', active: active === 'experts' },
        { label: '更正审批', to: '/prototype/corrections', count: counts.corrections, active: active === 'corrections' },
      ],
    },
  ]
}

/** 系统管理员：只有学校与官方目录两个目的地，没有论文入口。 */
export function systemNav(active: 'tenants' | 'catalog'): NavGroup[] {
  return [
    {
      items: [
        { label: '学校管理', to: '/prototype/system', active: active === 'tenants' },
        { label: '官方基础目录', to: '/prototype/system/catalog', active: active === 'catalog' },
      ],
    },
  ]
}
