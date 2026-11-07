/**
 * @file 前端路由配置
 * @description
 *    定义应用路由。当前为骨架，业务模块路由随实施计划增量注册。

 * 主要功能：
 *    1. 创建路由实例（HTML5 history）。
 *    2. 预留业务模块路由注册入口。

 * 注意事项：
 *    - 路由守卫只改善体验，不能替代服务端授权。
 */

import { createRouter, createWebHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'

import { appRoutes } from './routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/login' },
    ...appRoutes,
    // U1 原型：仅开发服务器注册，生产构建经 DEV 常量折叠后整体移除
    ...(import.meta.env.DEV ? (await import('@/prototypes/routes')).prototypeRoutes : []),
    { path: '/:pathMatch(.*)*', redirect: '/login' },
  ],
})

router.beforeEach((to) => {
  const authStore = useAuthStore()
  if (!authStore.user) authStore.hydrateFromStorage()
  if (to.path === '/login') return true
  if (import.meta.env.DEV && to.meta.prototype) return true

  const role = authStore.user?.role
  if (!role) return { path: '/login', query: { redirect: to.fullPath } }
  if (!to.meta.roleCodes.includes(role)) return authStore.defaultRoute
  return true
})

export default router
