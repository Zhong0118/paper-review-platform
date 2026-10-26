import type { RouteRecordRaw } from 'vue-router'

import { studentNotificationRoutes } from './studentNotificationRoutes'

export const appRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: '登录',
    component: () => import('@/modules/auth/pages/LoginPage.vue'),
    meta: { roleCodes: [], layout: 'auth', pageId: 'PAGE-001' },
  },
  ...studentNotificationRoutes,
  {
    path: '/student/thesis/edit',
    name: '论文编辑与提交',
    component: () => import('@/modules/thesis/pages/ThesisEditPage.vue'),
    meta: { roleCodes: ['student'], layout: 'portal', pageId: 'PAGE-003' },
  },
  {
    path: '/school/preparation',
    name: '送审准备',
    component: () => import('@/modules/school/pages/PreparationListPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-004' },
  },
  {
    path: '/school/progress',
    name: '评审进度',
    component: () => import('@/modules/school/pages/ReviewProgressPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-005' },
  },
  {
    path: '/platform/experts',
    name: '专家库',
    component: () => import.meta.env.VITE_DEMO_MODE === 'true'
      ? import('@/modules/expert-management/pages/ExpertLibraryPage.vue')
      : import('@/modules/expert-management/pages/RealExpertLibraryPage.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-006' },
  },
  {
    path: '/platform/dispatch',
    name: '送审运营台',
    component: () => import('@/modules/dispatch/pages/DispatchWorkbenchPage.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-007' },
  },
  {
    path: '/expert/tasks',
    name: '专家任务',
    component: () => import('@/modules/review/pages/ExpertTasksPage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-008' },
  },
  {
    path: '/expert/invitation',
    name: '评审邀请',
    component: () => import('@/modules/review/pages/InvitationPage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-009' },
  },
  {
    path: '/expert/review',
    name: '在线评阅',
    component: () => import('@/modules/review/pages/ReviewWorkspacePage.vue'),
    meta: { roleCodes: ['expert'], layout: 'review', pageId: 'PAGE-010' },
  },
  {
    path: '/school/results',
    name: '结果处理',
    component: () => import('@/modules/result/pages/ResultProcessingPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-011' },
  },
  {
    path: '/supervisor/results',
    name: '导师评审结果',
    component: () => import('@/modules/result/pages/SupervisorResultPage.vue'),
    meta: { roleCodes: ['supervisor'], layout: 'portal', pageId: 'PAGE-013' },
  },
  {
    path: '/expert/finance',
    name: '费用与提现',
    component: () => import('@/modules/review/pages/ExpertFinancePage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-014' },
  },
  {
    path: '/exports',
    name: '导出中心',
    component: () => import('@/modules/shared/pages/ExportCenterPage.vue'),
    meta: {
      roleCodes: ['school_reviewer', 'platform_reviewer'],
      layout: 'admin',
      pageId: 'PAGE-016',
    },
  },
  {
    path: '/system/tenants',
    name: '租户与权限',
    component: () => import('@/modules/system/pages/TenantPermissionsPage.vue'),
    meta: { roleCodes: ['system_admin'], layout: 'admin', pageId: 'PAGE-017' },
  },
  {
    path: '/audit',
    name: '审计查询',
    component: () => import('@/modules/system/pages/AuditQueryPage.vue'),
    meta: {
      roleCodes: ['system_admin', 'school_reviewer', 'platform_reviewer'],
      layout: 'admin',
      pageId: 'PAGE-018',
    },
  },
  {
    path: '/school/objections',
    name: '异议处理',
    component: () => import('@/modules/school/pages/ObjectionWorkbenchPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-019' },
  },
  {
    path: '/platform/corrections',
    name: '评阅更正审批',
    component: () => import('@/modules/expert-management/pages/CorrectionApprovalPage.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-020' },
  },
  {
    path: '/expert/profile',
    name: '个人资料与资格',
    component: () => import('@/modules/review/pages/ExpertProfilePage.vue'),
    meta: { roleCodes: ['expert'], layout: 'portal', pageId: 'PAGE-021' },
  },
  {
    path: '/platform/settlements',
    name: '费用结算',
    component: () => import('@/modules/finance/pages/SettlementWorkbenchPage.vue'),
    meta: { roleCodes: ['platform_reviewer'], layout: 'admin', pageId: 'PAGE-022' },
  },
  {
    path: '/school/batch-rules',
    name: '批次与评审规则',
    component: () => import('@/modules/school/pages/BatchRulesPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-023' },
  },
  {
    path: '/school/account',
    name: '学校账户与账单',
    component: () => import('@/modules/school/pages/SchoolAccountPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-024' },
  },
  {
    path: '/school/sensitive-terms',
    name: '本校材料检测词表',
    component: () => import('@/modules/school/pages/SensitiveTermsPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-027' },
  },
  {
    path: '/school/disciplines',
    name: '本校送审学科',
    component: () => import('@/modules/school/pages/SchoolDisciplinesPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-026' },
  },
  {
    path: '/school/members',
    name: '成员与送审资格',
    component: () => import('@/modules/school/pages/SchoolMembersPage.vue'),
    meta: { roleCodes: ['school_reviewer'], layout: 'admin', pageId: 'PAGE-025' },
  },
]
