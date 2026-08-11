import type { RouteRecordRaw } from 'vue-router'

export const studentNotificationRoutes: RouteRecordRaw[] = [
  {
    path: '/student/dashboard',
    name: '学生工作台',
    component: () => import('@/modules/thesis/pages/StudentDashboardPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-002' },
  },
  {
    path: '/student/results',
    name: '学生评审结果',
    component: () => import('@/modules/result/pages/StudentResultPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-012' },
  },
  {
    path: '/notifications',
    name: '消息通知',
    component: () => import('@/modules/shared/pages/NotificationCenterPage.vue'),
    meta: {
      roleCodes: ['student', 'supervisor', 'school_reviewer', 'platform_reviewer', 'expert'],
      layout: 'portal',
      pageId: 'PAGE-015',
    },
  },
]
