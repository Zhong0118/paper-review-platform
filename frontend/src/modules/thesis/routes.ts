import type { RouteRecordRaw } from 'vue-router'

export const thesisRoutes: RouteRecordRaw[] = [
  {
    path: '/student/dashboard',
    name: '学生工作台',
    component: () => import('./pages/StudentDashboardPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-002' },
  },
  {
    path: '/student/thesis/edit',
    name: '论文编辑与提交',
    component: () => import('./pages/ThesisEditPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-003' },
  },
]
