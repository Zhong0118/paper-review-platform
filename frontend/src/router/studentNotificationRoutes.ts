import type { RouteRecordRaw } from 'vue-router'

export const studentNotificationRoutes: RouteRecordRaw[] = [
  {
    path: '/student/dashboard',
    name: '学生工作台',
    // U2-3：真实模式用新的“我的送审”；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/thesis/pages/StudentDashboardPage.vue')
      : import('@/modules/thesis/workspace/StudentPortalPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-002' },
  },
  {
    path: '/student/results',
    name: '学生评审结果',
    // U2-6：真实模式用正式反馈阅读页；demo 模式保留旧页
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/result/pages/StudentResultPage.vue')
      : import('@/modules/result/feedback/StudentFeedbackPage.vue'),
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
