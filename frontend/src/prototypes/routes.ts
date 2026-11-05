/**
 * U1/U3 原型路由。只在 import.meta.env.DEV 时由 router/index.ts 注册；生产构建不包含。
 * 不导入 src/api、src/stores，不发真实请求。
 */
import type { RouteRecordRaw } from 'vue-router'

const meta = { roleCodes: [], layout: 'auth', pageId: 'PROTOTYPE', prototype: true } as const

export const prototypeRoutes: RouteRecordRaw[] = [
  { path: '/prototype', component: () => import('./screens/PrototypeIndex.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/school', component: () => import('./screens/SchoolQueue.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/school/verify', component: () => import('./screens/SchoolVerify.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/dispatch', component: () => import('./screens/DispatchDesk.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/review', component: () => import('./screens/ExpertReview.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/student', component: () => import('./screens/StudentPortal.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/feedback', component: () => import('./screens/FeedbackReader.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/results', component: () => import('./screens/SchoolResults.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/objections', component: () => import('./screens/SchoolObjections.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/settings/batches', component: () => import('./screens/SettingsBatches.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/settings/members', component: () => import('./screens/SettingsMembers.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/settings/disciplines', component: () => import('./screens/SettingsDisciplines.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/settings/terms', component: () => import('./screens/SettingsTerms.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/experts', component: () => import('./screens/ExpertLibrary.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/corrections', component: () => import('./screens/CorrectionApprovals.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/system', component: () => import('./screens/SystemTenants.vue'), meta: { ...meta, roleCodes: [] } },
  { path: '/prototype/system/catalog', component: () => import('./screens/SystemCatalog.vue'), meta: { ...meta, roleCodes: [] } },
]
