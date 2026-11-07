import { describe, expect, it } from 'vitest'

import { portalMenus } from '../menus'
import { workspaceNav } from '../workspaceNav'

const labels = (groups: ReturnType<typeof workspaceNav>) => groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.label) }))

describe('workspaceNav', () => {
  it('groups the live school menu into 办理 and 学校设置 with the accepted labels', () => {
    expect(labels(workspaceNav('school_reviewer', '/school/preparation', {}, false))).toEqual([
      { label: '办理', items: ['送审准备', '评审进度', '结果处理', '异议处理'] },
      { label: '学校设置', items: ['批次与规则', '成员与资格', '学科与专业', '检测词表'] },
    ])
  })

  it('links each item to its path and marks only the active one', () => {
    const items = workspaceNav('school_reviewer', '/school/members', {}, false).flatMap((g) => g.items)
    expect(items.find((i) => i.label === '成员与资格')).toMatchObject({ to: '/school/members', active: true })
    expect(items.filter((i) => i.active)).toHaveLength(1)
  })

  it('gives counts only to the paths the caller passes', () => {
    const items = workspaceNav('school_reviewer', '/school/preparation', { '/school/preparation': 3, '/school/results': 0 }, false).flatMap((g) => g.items)
    expect(items.find((i) => i.to === '/school/preparation')?.count).toBe(3)
    expect(items.find((i) => i.to === '/school/results')?.count).toBe(0)
    expect(items.find((i) => i.to === '/school/progress')?.count).toBeUndefined()
  })

  it('gives platform and system admin one unlabeled group', () => {
    expect(labels(workspaceNav('platform_reviewer', '/platform/dispatch', {}, false))).toEqual([
      { label: undefined, items: ['派单台', '专家库', '更正审批'] },
    ])
    expect(labels(workspaceNav('system_admin', '/system/tenants', {}, false))).toEqual([
      { label: undefined, items: ['学校管理', '官方基础目录'] },
    ])
  })

  it('follows portalMenus for the demo flag and leaves its names unchanged', () => {
    const demoSchool = workspaceNav('school_reviewer', '/school/preparation', {}, true).flatMap((g) => g.items.map((i) => i.to))
    expect([...demoSchool].sort()).toEqual(portalMenus('school_reviewer', true).map((m) => m.path).sort())
    expect(portalMenus('platform_reviewer', false).map((m) => m.label)).toEqual(['送审运营台', '专家库', '评阅更正审批'])
  })

  it('gives the system admin live entries for schools and the official catalog (U4-8, E10)', () => {
    expect(portalMenus('system_admin', false)).toEqual([
      { label: '学校管理', path: '/system/tenants' },
      { label: '官方基础目录', path: '/system/catalog' },
    ])
    expect(portalMenus('system_admin', true)).toEqual([{ label: '学校管理', path: '/system/tenants' }])
  })
})
