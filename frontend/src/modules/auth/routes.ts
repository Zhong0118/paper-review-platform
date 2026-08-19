import type { RouteRecordRaw } from 'vue-router'

export const authRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: '登录',
    component: () => import('./pages/LoginPage.vue'),
    meta: { roleCodes: [], layout: 'auth', pageId: 'PAGE-001' },
  },
]
