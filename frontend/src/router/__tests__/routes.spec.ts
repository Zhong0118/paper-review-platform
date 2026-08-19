import { describe, expect, it } from 'vitest'

import { appRoutes } from '../routes'
import { menusByRole } from '../menus'

describe('application routes', () => {
  it('assigns one unique route to every golden-path page id', () => {
    const pageIds = appRoutes.map((route) => route.meta?.pageId).filter(Boolean)

    expect(pageIds).toHaveLength(24)
    expect(new Set(pageIds).size).toBe(24)
    expect(pageIds).toEqual(
      expect.arrayContaining(
        Array.from({ length: 24 }, (_, i) => `PAGE-${String(i + 1).padStart(3, '0')}`),
      ),
    )
  })

  it('keeps school and expert workspaces separated by route metadata', () => {
    const schoolRoute = appRoutes.find((route) => route.meta?.pageId === 'PAGE-004')
    const expertRoute = appRoutes.find((route) => route.meta?.pageId === 'PAGE-010')

    expect(schoolRoute?.meta?.roleCodes).toEqual(['school_reviewer'])
    expect(expertRoute?.meta?.roleCodes).toEqual(['expert'])
    expect(schoolRoute?.meta?.roleCodes).not.toContain('expert')
    expect(expertRoute?.meta?.roleCodes).not.toContain('school_reviewer')
  })

  it('uses the approved complete navigation for each demo role', () => {
    expect(menusByRole.student?.map((item) => item.label)).toEqual([
      '我的论文',
      '评审结果与异议',
      '消息通知',
    ])
    expect(menusByRole.school_reviewer?.map((item) => item.label)).toEqual([
      '送审准备',
      '评审进度',
      '结果处理',
      '异议处理',
      '批次与评审规则',
      '学校账户与账单',
      '消息通知',
    ])
    expect(menusByRole.platform_reviewer?.map((item) => item.label)).toEqual([
      '送审运营台',
      '专家库',
      '评阅更正审批',
      '费用结算',
      '消息通知',
      '审计查询',
    ])
    expect(menusByRole.expert?.map((item) => item.label)).toEqual([
      '我的任务',
      '费用与提现',
      '个人资料与资格',
      '消息通知',
    ])
  })

  it('does not leave management routes on the generic pending page', () => {
    const managementPages = ['PAGE-015', 'PAGE-016', 'PAGE-017', 'PAGE-018']

    for (const pageId of managementPages) {
      const route = appRoutes.find((item) => item.meta?.pageId === pageId)
      expect(String(route?.component)).not.toContain('DemoPendingPage')
    }
  })
})
