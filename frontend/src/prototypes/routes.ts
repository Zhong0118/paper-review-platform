/**
 * R1 设计语言样板路由（U3 原型屏已在 R4 删除）。只在 import.meta.env.DEV 时由 router/index.ts 注册；生产构建不包含。
 * 不导入 src/api、src/stores，不发真实请求。
 */
import type { RouteRecordRaw } from 'vue-router'

const meta = { roleCodes: [], layout: 'auth', pageId: 'PROTOTYPE', prototype: true } as const

export const prototypeRoutes: RouteRecordRaw[] = [
  { path: '/prototype', redirect: '/prototype/r1' },
  // R1：统一设计语言样板（U4 计划 §17.7）
  { path: '/prototype/r1', component: () => import('./r1/R1Index.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/r1/nav', component: () => import('./r1/NavDemo.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/r1/experts', component: () => import('./r1/ExpertLibrarySample.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/r1/experts/:id', component: () => import('./r1/ExpertProfileSample.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/r1/verify', component: () => import('./r1/VerifySample.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/r1/feedback', component: () => import('./r1/FeedbackSample.vue'), meta: { ...meta, roleCodes: [] } },
]
