import type { NavGroup } from '../kit/types'

/** 学校侧栏：办理目的地 + 学校设置分组；与 LIVE_PATHS 一一对应，不新增未上线目的地。 */
export function schoolNav(active: string, verifyCount: number): NavGroup[] {
  return [
    {
      label: '办理',
      items: [
        { label: '送审准备', to: '/prototype/school', count: verifyCount, active: active === 'preparation' },
        { label: '评审进度' },
        { label: '结果处理' },
        { label: '异议处理' },
      ],
    },
    {
      label: '学校设置',
      items: [{ label: '批次与规则' }, { label: '成员与资格' }, { label: '学科与专业' }, { label: '检测词表' }],
    },
  ]
}

export function platformNav(active: string, pending: number): NavGroup[] {
  return [
    {
      items: [
        { label: '派单台', to: '/prototype/dispatch', count: pending, active: active === 'dispatch' },
        { label: '专家库' },
        { label: '更正审批' },
      ],
    },
  ]
}
