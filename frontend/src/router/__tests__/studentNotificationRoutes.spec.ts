import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import productionRouter, { createAppRouter } from '../index'
import { studentNotificationRoutes } from '../studentNotificationRoutes'

describe('production student notification routes', () => {
  it('registers the notification workflow on the production router', () => {
    const routes = productionRouter.getRoutes()

    expect(routes.map((route) => route.name)).toEqual(
      expect.arrayContaining(['消息通知', '学生工作台', '学生评审结果']),
    )
    expect(routes.find((route) => route.name === '消息通知')?.path).toBe('/notifications')
  })

  it('preserves the approved role metadata at the real route boundary', () => {
    const notifications = studentNotificationRoutes.find((route) => route.name === '消息通知')
    const dashboard = studentNotificationRoutes.find((route) => route.name === '学生工作台')
    const results = studentNotificationRoutes.find((route) => route.name === '学生评审结果')

    expect(notifications?.meta?.roleCodes).toEqual([
      'student',
      'supervisor',
      'school_reviewer',
      'platform_reviewer',
      'expert',
    ])
    expect(dashboard?.meta?.roleCodes).toEqual(['student'])
    expect(results?.meta?.roleCodes).toEqual(['student'])
  })

  it('resolves both named student targets with the owned thesis id', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: studentNotificationRoutes,
    })

    expect(
      router.resolve({ name: '学生工作台', query: { thesisId: 'thesis-main' } }),
    ).toMatchObject({
      path: '/student/dashboard',
      query: { thesisId: 'thesis-main' },
    })
    expect(
      router.resolve({ name: '学生评审结果', query: { thesisId: 'thesis-main' } }),
    ).toMatchObject({
      path: '/student/results',
      query: { thesisId: 'thesis-main' },
    })
  })

  it('creates isolated routers from the same production route records', () => {
    const router = createAppRouter(createMemoryHistory())

    expect(router.getRoutes().map((route) => route.name)).toEqual(
      expect.arrayContaining(['消息通知', '学生工作台', '学生评审结果']),
    )
  })
})
